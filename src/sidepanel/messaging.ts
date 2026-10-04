import {
  videoIdFromUrl,
  type Reply,
  type Transcript,
  type VideoMessage,
} from "../shared/types";
export type VideoTarget = { tabId: number; videoId: string };
export async function activeVideo(windowId: number): Promise<VideoTarget> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  const videoId = videoIdFromUrl(tab?.url ?? "");
  if (!tab?.id || !videoId)
    throw new Error(
      "Abre un vídeo de YouTube (youtube.com/watch) en esta ventana.",
    );
  return { tabId: tab.id, videoId };
}
async function send<T>(target: VideoTarget, message: VideoMessage): Promise<T> {
  let reply: Reply<T>;
  try {
    reply = await chrome.tabs.sendMessage(target.tabId, message);
  } catch {
    throw new Error(
      "No se pudo contactar con el vídeo. Recarga la página de YouTube tras instalar o actualizar la extensión.",
    );
  }
  if (!reply?.ok)
    throw new Error(
      reply?.error || "YouTube no respondió. Vuelve a intentarlo.",
    );
  return reply.data;
}
export function getTranscript(target: VideoTarget): Promise<Transcript> {
  return send(target, { type: "GET_TRANSCRIPT", videoId: target.videoId });
}
export function seekTo(target: VideoTarget, seconds: number): Promise<null> {
  return send(target, { type: "SEEK", videoId: target.videoId, seconds });
}
