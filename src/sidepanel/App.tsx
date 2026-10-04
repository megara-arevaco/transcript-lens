import { useEffect, useRef, useState } from "react";
import type { Transcript } from "../shared/types";
import {
  defaults,
  loadSettings,
  saveSettings,
  type Settings,
} from "../settings/storage";
import { presets } from "../analysis/presets";
import { estimateTokens, formatTranscript } from "../analysis/transcript";
import { analyzeLongTranscript } from "../analysis/chunking";
import { askVideo } from "../analysis/questions";
import {
  activeVideo,
  getTranscript,
  seekTo,
  type VideoTarget,
} from "./messaging";
import { TimestampText } from "./TimestampText";

type Status =
  | "idle"
  | "detecting"
  | "found"
  | "unavailable"
  | "analyzing"
  | "complete"
  | "error";
const labels: Record<Status, string> = {
  idle: "Abre un vídeo para empezar",
  detecting: "Detectando transcripción…",
  found: "Transcripción encontrada",
  unavailable: "Transcripción no disponible",
  analyzing: "Generando análisis…",
  complete: "Análisis completo",
  error: "No se pudo completar la operación",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Se produjo un error inesperado.";
export function App() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [transcript, setTranscript] = useState<Transcript>();
  const [target, setTarget] = useState<VideoTarget>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [tab, setTab] = useState<"transcript" | "analysis">("analysis");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<
    { question: string; answer: string; limited: boolean; matched: boolean }[]
  >([]);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const windowId = useRef<number>(chrome.windows.WINDOW_ID_CURRENT);
  const busy = status === "detecting" || status === "analyzing";

  async function detect() {
    const run = ++generation.current;
    controller.current?.abort();
    setTranscript(undefined);
    setTarget(undefined);
    setResult("");
    setAnswers([]);
    setProgress("");
    setError("");
    setNotice("");
    setStatus("detecting");
    try {
      const nextTarget = await activeVideo(windowId.current);
      const nextTranscript = await getTranscript(nextTarget);
      if (run !== generation.current) return;
      setTarget(nextTarget);
      setTranscript(nextTranscript);
      setStatus("found");
    } catch (e) {
      if (run === generation.current) {
        setError(errorText(e));
        setStatus("unavailable");
      }
    }
  }
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [saved, win] = await Promise.all([
          loadSettings(),
          chrome.windows.getCurrent(),
        ]);
        if (disposed) return;
        windowId.current = win.id ?? chrome.windows.WINDOW_ID_CURRENT;
        setSettings(saved);
        setShowSettings(!saved.apiKey);
        setReady(true);
        await detect();
      } catch (e) {
        if (!disposed) {
          setError(errorText(e));
          setStatus("error");
        }
      }
    })();
    const invalidate = () => {
      generation.current++;
      controller.current?.abort();
      setTranscript(undefined);
      setTarget(undefined);
      setResult("");
      setAnswers([]);
      setProgress("");
      setError("");
      setStatus("idle");
    };
    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (info.windowId === windowId.current) invalidate();
    };
    const onUpdated = (
      _id: number,
      change: { url?: string },
      updated: chrome.tabs.Tab,
    ) => {
      if (updated.active && updated.windowId === windowId.current && change.url)
        invalidate();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      disposed = true;
      generation.current++;
      controller.current?.abort();
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  async function persist() {
    if (
      !settings.model.trim() ||
      !Number.isFinite(settings.inputTokenBudget) ||
      !Number.isInteger(settings.inputTokenBudget) ||
      !Number.isFinite(settings.maxOutputTokens) ||
      !Number.isInteger(settings.maxOutputTokens) ||
      settings.inputTokenBudget < 2000 ||
      settings.inputTokenBudget > 200000 ||
      settings.maxOutputTokens < 256 ||
      settings.maxOutputTokens > 16000
    ) {
      setError(
        "Indica un modelo, un presupuesto entre 2.000 y 200.000 y una salida entre 256 y 16.000 tokens.",
      );
      return false;
    }
    try {
      await saveSettings({
        ...settings,
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
      });
      setNotice("Configuración guardada en este navegador.");
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }
  async function analyze() {
    if (!transcript || !target || controller.current) return;
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      setError("Introduce tu API key de OpenRouter.");
      return;
    }
    const preset =
      presets.find((p) => p.id === settings.presetId) ?? presets[0]!;
    const prompt =
      preset.id === "custom" ? settings.customPrompt.trim() : preset.userPrompt;
    if (!prompt) {
      setError("Escribe un prompt personalizado.");
      return;
    }
    const run = generation.current;
    const abort = new AbortController();
    // Acquire before storage awaits so repeated clicks cannot start a second request.
    controller.current = abort;
    if (
      !(await persist()) ||
      run !== generation.current ||
      abort.signal.aborted
    ) {
      if (controller.current === abort) controller.current = null;
      return;
    }
    setError("");
    setNotice("");
    setStatus("analyzing");
    setShowSettings(false);
    setTab("analysis");
    try {
      const answer = await analyzeLongTranscript({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        transcript,
        prompt,
        systemPrompt: preset.systemPrompt,
        inputTokenBudget: settings.inputTokenBudget,
        onProgress: (message) => {
          if (run === generation.current) setProgress(message);
        },
        maxOutputTokens: settings.maxOutputTokens,
        signal: abort.signal,
      });
      if (run === generation.current) {
        setResult(answer);
        setAnswers([]);
        setStatus("complete");
        setProgress("");
      }
    } catch (e) {
      if (run === generation.current) {
        setError(errorText(e));
        setStatus("error");
      }
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }
  async function ask() {
    if (
      !transcript ||
      !result ||
      !question.trim() ||
      busy ||
      controller.current
    )
      return;
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      setError("Introduce tu API key de OpenRouter.");
      return;
    }
    const run = generation.current;
    const abort = new AbortController();
    // Acquire before storage awaits so repeated clicks cannot start a second request.
    controller.current = abort;
    if (
      !(await persist()) ||
      run !== generation.current ||
      abort.signal.aborted
    ) {
      if (controller.current === abort) controller.current = null;
      return;
    }
    const asked = question.trim();
    setError("");
    setNotice("");
    setStatus("analyzing");
    setProgress("Respondiendo a tu pregunta…");
    try {
      const answer = await askVideo({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        transcript,
        question: asked,
        prompt: asked,
        inputTokenBudget: settings.inputTokenBudget,
        maxOutputTokens: settings.maxOutputTokens,
        signal: abort.signal,
      });
      if (run === generation.current) {
        setAnswers((previous) => [...previous, { question: asked, ...answer }]);
        setQuestion("");
        setStatus("complete");
        setProgress("");
      }
    } catch (e) {
      if (run === generation.current) {
        setError(errorText(e));
        setStatus("error");
        setProgress("");
      }
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }
  function seek(seconds: number) {
    if (target)
      void seekTo(target, seconds).catch((e) => setError(errorText(e)));
  }
  return (
    <main>
      <header>
        <strong>Transcript Lens</strong>
        <button
          className="secondary"
          onClick={() => setShowSettings(!showSettings)}
          aria-expanded={showSettings}
        >
          Configuración
        </button>
      </header>
      <h1>{transcript?.title || "Analiza un vídeo de YouTube"}</h1>
      <p className="status" role="status" aria-live="polite">
        {status === "analyzing" && progress ? progress : labels[status]}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {showSettings && (
        <section className="settings" aria-label="Configuración">
          <h2>OpenRouter</h2>
          <label>
            API key
            <input
              disabled={busy}
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) =>
                setSettings({ ...settings, apiKey: e.target.value })
              }
              placeholder="sk-or-…"
            />
          </label>
          <p className="hint">
            La clave se guarda localmente. Al analizar se envía el transcript a
            OpenRouter con el modelo elegido.
          </p>
          <label>
            Presupuesto de entrada (tokens aproximados)
            <input
              disabled={busy}
              type="number"
              min="2000"
              max="200000"
              value={settings.inputTokenBudget}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  inputTokenBudget: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Límite de salida (tokens)
            <input
              disabled={busy}
              type="number"
              min="256"
              max="16000"
              value={settings.maxOutputTokens}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxOutputTokens: Number(e.target.value),
                })
              }
            />
          </label>
          <button
            disabled={!ready || busy}
            onClick={() => {
              setError("");
              void persist();
            }}
          >
            Guardar configuración
          </button>
        </section>
      )}
      <button
        className="secondary refresh"
        disabled={!ready || busy}
        onClick={() => void detect()}
      >
        Obtener transcripción
      </button>
      {transcript && (
        <>
          <p className="hint">
            {transcript.segments.length} segmentos · ~
            {estimateTokens(formatTranscript(transcript)).toLocaleString("es")}{" "}
            tokens · {transcript.videoId}
          </p>
          {transcript.warnings?.map((w) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
          <nav aria-label="Contenido">
            <button
              aria-pressed={tab === "transcript"}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
            <button
              aria-pressed={tab === "analysis"}
              onClick={() => setTab("analysis")}
            >
              Analysis
            </button>
          </nav>
          <label>
            Acción
            <select
              aria-label="Acción"
              value={settings.presetId}
              disabled={busy}
              onChange={(e) =>
                setSettings({ ...settings, presetId: e.target.value })
              }
            >
              {presets.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modelo de OpenRouter
            <input
              list="model-examples"
              value={settings.model}
              disabled={busy}
              onChange={(e) =>
                setSettings({ ...settings, model: e.target.value })
              }
              placeholder="proveedor/modelo"
            />
          </label>
          <datalist id="model-examples">
            <option value="openrouter/auto" />
          </datalist>
          {settings.presetId === "custom" && (
            <label>
              Prompt personalizado
              <textarea
                rows={4}
                value={settings.customPrompt}
                disabled={busy}
                onChange={(e) =>
                  setSettings({ ...settings, customPrompt: e.target.value })
                }
              />
            </label>
          )}
          <button
            className="primary"
            disabled={busy || !ready}
            onClick={() => void analyze()}
          >
            {status === "analyzing" ? "Analizando…" : "Analyze"}
          </button>
          <p className="hint">
            Los vídeos largos requieren varias peticiones a OpenRouter y pueden
            tener mayor coste.
          </p>
          {status === "analyzing" && (
            <button
              className="secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancelar
            </button>
          )}
          <section
            className="output"
            aria-label={tab === "transcript" ? "Transcripción" : "Análisis"}
          >
            {tab === "transcript" ? (
              <div className="segments">
                {transcript.segments.map((s, i) => (
                  <p key={i}>
                    <button
                      className="timestamp"
                      onClick={() => seek(s.startSeconds)}
                    >
                      {s.timestamp}
                    </button>{" "}
                    {s.text}
                  </p>
                ))}
              </div>
            ) : result ? (
              <TimestampText text={result} onSeek={seek} />
            ) : (
              <p className="hint">
                Elige una acción y pulsa Analyze. Las referencias con timestamps
                permitirán saltar al vídeo.
              </p>
            )}
          </section>
          {result && (
            <section
              className="questions"
              aria-label="Preguntas sobre el vídeo"
            >
              <h2>Ask this video</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <label>
                  Pregunta
                  <textarea
                    rows={2}
                    disabled={busy}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="¿Qué evidencia utiliza el autor?"
                  />
                </label>
                <button type="submit" disabled={busy || !question.trim()}>
                  Ask
                </button>
              </form>
              {answers.map((entry, i) => (
                <article key={i}>
                  <h3>{entry.question}</h3>
                  {entry.limited && (
                    <p className="warning">
                      Respuesta basada en una selección parcial{" "}
                      {entry.matched
                        ? "por coincidencias de texto."
                        : "de muestras repartidas; no se encontraron coincidencias de texto."}
                    </p>
                  )}
                  <TimestampText text={entry.answer} onSeek={seek} />
                </article>
              ))}
              <p className="hint">
                Cada pregunta es independiente; no se envía el historial de
                conversación.
              </p>
            </section>
          )}
        </>
      )}
      <footer>Solo se utilizan los subtítulos existentes de YouTube.</footer>
    </main>
  );
}
