export type TranscriptSegment = {
  text: string;
  timestamp: string;
  startSeconds: number;
};
export type Transcript = {
  videoId: string;
  title?: string;
  segments: TranscriptSegment[];
  warnings?: string[];
};
export type VideoMessage =
  | { type: "GET_TRANSCRIPT"; videoId: string }
  | { type: "SEEK"; videoId: string; seconds: number };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export function videoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://www.youtube.com" &&
      parsed.pathname === "/watch"
      ? parsed.searchParams.get("v")
      : null;
  } catch {
    return null;
  }
}
