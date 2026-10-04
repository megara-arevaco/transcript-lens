import type { Transcript, TranscriptSegment } from "../shared/types";
import { videoIdFromUrl } from "../shared/types";
import { parseTimestamp } from "../shared/timestamps";

const panelSelector =
  '[target-id="engagement-panel-searchable-transcript"], [target-id="PAmodern_transcript_view"], ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]';
const rowSelector =
  "ytd-transcript-segment-renderer, transcript-segment-view-model, yt-transcript-segment-view-model";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return (
    element.getClientRects().length > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0
  );
}
function checkVideo(videoId: string) {
  if (videoIdFromUrl(location.href) !== videoId)
    throw new Error("El vídeo ha cambiado. Obtén la transcripción de nuevo.");
}
async function waitFor<T>(
  find: () => T | null,
  videoId: string,
  timeout = 8000,
): Promise<T | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    checkVideo(videoId);
    const result = find();
    if (result) return result;
    await pause(200);
  }
  return null;
}
function readRows(root: Element): TranscriptSegment[] {
  return Array.from(root.querySelectorAll(rowSelector)).flatMap((row) => {
    const timestamp = row
      .querySelector(
        '.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp, .ytTranscriptSegmentViewModelTimestamp, [class*="timestamp" i]',
      )
      ?.textContent?.trim();
    const text = row
      .querySelector(
        '.segment-text, span.ytAttributedStringHost[role="text"], span.yt-core-attributed-string, .ytTranscriptSegmentViewModelText, [class*="segmenttext" i]',
      )
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    const startSeconds = timestamp ? parseTimestamp(timestamp) : null;
    return text && timestamp && startSeconds !== null
      ? [{ text, timestamp, startSeconds }]
      : [];
  });
}
function findPanel(): HTMLElement | null {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>(panelSelector),
  );
  const panelVisible = (element: HTMLElement) =>
    !element.closest('[visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"]') &&
    isVisible(element);
  const populated = roots.find(
    (root) => panelVisible(root) && readRows(root).length,
  );
  if (populated) return populated;
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(rowSelector),
  ).find(panelVisible);
  return (
    row?.closest<HTMLElement>(
      "ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer, yt-section-list-renderer",
    ) ??
    row?.parentElement ??
    null
  );
}
function scrollContainer(root: HTMLElement): HTMLElement | null {
  const first = root.querySelector(rowSelector);
  let node = first?.parentElement;
  while (node && root.contains(node)) {
    if (
      node.scrollHeight > node.clientHeight + 4 &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)
    )
      return node;
    node = node.parentElement;
  }
  return null;
}

export async function extractTranscript(videoId: string): Promise<Transcript> {
  checkVideo(videoId);
  const originalPageScroll = window.scrollY;
  let scroller: HTMLElement | null = null;
  let originalTranscriptScroll = 0;
  try {
    let panel = findPanel();
    if (
      !panel ||
      !readRows(panel).length ||
      panel.closest('[visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"]')
    ) {
      // Component selectors avoid depending on the language of YouTube's UI.
      const findButton = () =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            'ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer [role="button"]',
          ),
        ).find(
          (candidate) =>
            isVisible(candidate) &&
            candidate.getAttribute("aria-disabled") !== "true" &&
            !candidate.hasAttribute("disabled"),
        ) ?? null;
      const expand = document.querySelector<HTMLElement>(
        "ytd-watch-metadata #description-inline-expander #expand, ytd-text-inline-expander #expand",
      );
      if (expand && isVisible(expand)) expand.click();
      let button = findButton();
      if (!button) button = await waitFor(findButton, videoId, 3000);
      button?.click();
      panel = await waitFor(() => {
        const candidate = findPanel();
        return candidate && readRows(candidate).length ? candidate : null;
      }, videoId);
    }
    if (!panel || !readRows(panel).length)
      throw new Error(
        "No se pudo obtener la transcripción. Abre «Mostrar transcripción» en YouTube y vuelve a intentarlo. Puede que el vídeo no tenga subtítulos o que su interfaz haya cambiado.",
      );
    const accumulated = new Map<string, TranscriptSegment>();
    const collect = () => {
      for (const segment of readRows(panel))
        accumulated.set(
          `${segment.startSeconds}\u0000${segment.text}`,
          segment,
        );
    };
    scroller = scrollContainer(panel);
    originalTranscriptScroll = scroller?.scrollTop ?? 0;
    if (scroller) {
      scroller.scrollTop = 0;
      await pause(350);
    }
    let stableAtEnd = 0;
    let finished = !scroller;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      checkVideo(videoId);
      const previousSize = accumulated.size;
      collect();
      if (!scroller) {
        await pause(600);
        collect();
        break;
      }
      const atEnd =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
      stableAtEnd =
        atEnd && previousSize === accumulated.size ? stableAtEnd + 1 : 0;
      if (stableAtEnd >= 4) {
        finished = true;
        break;
      }
      scroller.scrollTop = Math.min(
        scroller.scrollTop + Math.max(100, scroller.clientHeight * 0.7),
        scroller.scrollHeight,
      );
      await pause(350);
    }
    checkVideo(videoId);
    const segments = [...accumulated.values()].sort(
      (a, b) => a.startSeconds - b.startSeconds,
    );
    if (!segments.length)
      throw new Error(
        "La transcripción no contiene segmentos con timestamps legibles.",
      );
    return {
      videoId,
      title:
        document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() ||
        document.title.replace(/ - YouTube$/, ""),
      segments,
      warnings: finished
        ? undefined
        : [
            "La extracción alcanzó el límite de 45 segundos. La transcripción puede estar incompleta; vuelve a intentarlo con el panel nativo abierto.",
          ],
    };
  } finally {
    // Keep the native panel available, restore scroll without hiding unrelated UI.
    if (scroller) scroller.scrollTop = originalTranscriptScroll;
    if (videoIdFromUrl(location.href) === videoId)
      window.scrollTo({ top: originalPageScroll, behavior: "instant" });
  }
}
