import type { Transcript } from "../shared/types";
import {
  analyzeTranscript,
  estimateTokens,
  formatTranscript,
} from "./transcript";
import { transcriptBudget, type LongOptions } from "./chunking";
import { ApiError } from "./openrouter";
const tokens = (text: string): string[] =>
  text
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
const stopwords = new Set([
  "que",
  "como",
  "con",
  "del",
  "las",
  "los",
  "una",
  "por",
  "para",
  "este",
  "esta",
  "video",
  "the",
  "and",
  "what",
  "does",
]);
export function selectRelevantTranscript(
  transcript: Transcript,
  question: string,
  budget: number,
): { transcript: Transcript; matched: boolean } {
  const terms = [...new Set(tokens(question).filter((t) => !stopwords.has(t)))];
  const ranked = transcript.segments
    .map((s, index) => {
      const words = new Set(tokens(s.text));
      return {
        index,
        score: terms.reduce((n, term) => n + (words.has(term) ? 1 : 0), 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const matched = ranked.some((s) => s.score > 0);
  const candidates = matched
    ? ranked
        .filter((s) => s.score > 0)
        .flatMap((s) => [s.index, s.index - 1, s.index + 1])
    : Array.from({ length: Math.min(24, transcript.segments.length) }, (_, i) =>
        Math.floor(
          (i * (transcript.segments.length - 1)) /
            Math.max(1, Math.min(24, transcript.segments.length) - 1),
        ),
      );
  const selected = new Set<number>();
  let used = 0;
  for (const index of candidates) {
    const segment = transcript.segments[index];
    if (!segment || selected.has(index)) continue;
    const size = estimateTokens(`[${segment.timestamp}] ${segment.text}\n`);
    if (used + size > budget) continue;
    selected.add(index);
    used += size;
  }
  if (!selected.size)
    throw new ApiError(
      "context_too_long",
      "Ningún segmento cabe en el presupuesto de la pregunta. Aumenta el límite.",
    );
  return {
    transcript: {
      ...transcript,
      segments: [...selected]
        .sort((a, b) => a - b)
        .map((i) => transcript.segments[i]!),
    },
    matched,
  };
}
export async function askVideo(
  options: LongOptions & { question: string },
): Promise<{ answer: string; limited: boolean; matched: boolean }> {
  const questionPrompt = `Responde a esta pregunta sobre el vídeo:\n${options.question}`;
  const budget = transcriptBudget({ ...options, prompt: questionPrompt });
  const limited = estimateTokens(formatTranscript(options.transcript)) > budget;
  const selection = limited
    ? selectRelevantTranscript(options.transcript, options.question, budget)
    : { transcript: options.transcript, matched: true };
  const answer = await analyzeTranscript({
    ...options,
    transcript: selection.transcript,
    prompt: `${questionPrompt}\n${limited ? "SOLO tienes una selección parcial de segmentos. Avisa de la cobertura limitada y no concluyas que algo no aparece en el vídeo completo. Si no hay evidencia suficiente, indícalo." : "Tienes la transcripción completa."}`,
  });
  return { answer, limited, matched: selection.matched };
}
