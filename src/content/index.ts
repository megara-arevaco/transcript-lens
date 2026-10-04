import { extractTranscript } from "../transcript/extract";
import {
  videoIdFromUrl,
  type VideoMessage,
  type Transcript,
} from "../shared/types";
let pending: { videoId: string; promise: Promise<Transcript> } | undefined;
chrome.runtime.onMessage.addListener(
  (message: VideoMessage, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      !message ||
      !["GET_TRANSCRIPT", "SEEK"].includes(message.type)
    )
      return;
    if (videoIdFromUrl(location.href) !== message.videoId) {
      sendResponse({
        ok: false,
        error: "El vídeo ha cambiado. Actualiza la transcripción.",
      });
      return;
    }
    if (message.type === "SEEK") {
      const video = document.querySelector("video");
      if (!video || !Number.isFinite(message.seconds) || message.seconds < 0) {
        sendResponse({ ok: false, error: "No se puede saltar a ese momento." });
        return;
      }
      video.currentTime = message.seconds;
      sendResponse({ ok: true, data: null });
      return;
    }
    if (!pending || pending.videoId !== message.videoId) {
      const job = {
        videoId: message.videoId,
        promise: extractTranscript(message.videoId),
      };
      pending = job;
      void job.promise
        .finally(() => {
          if (pending === job) pending = undefined;
        })
        .catch(() => undefined);
    }
    void pending.promise.then(
      (data) => sendResponse({ ok: true, data }),
      (error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Error al obtener la transcripción.",
        }),
    );
    return true;
  },
);
