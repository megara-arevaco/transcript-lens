import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
let context: BrowserContext;
let profile: string;
let youtube: Page;
let panel: Page;
let requests: {
  messages: { role: string; content: string }[];
  model: string;
}[];
test.beforeEach(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "transcript-e2e-"));
  const extensionPath = path.resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({
      path: "tests/fixtures/watch.html",
      contentType: "text/html",
    }),
  );
  requests = [];
  await context.route(
    "https://openrouter.ai/api/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        json: {
          choices: [
            {
              message: {
                content:
                  "Resumen ejecutivo\n[0:10] El vídeo explica el aprendizaje.\nConclusión basada en el transcript.",
              },
              finish_reason: "stop",
            },
          ],
        },
      });
    },
  );
  youtube = await context.newPage();
  await youtube.goto("https://www.youtube.com/watch?v=e2eVideo001");
  panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await youtube.bringToFront();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
});
test.afterEach(async () => {
  await context?.close();
  await fs.rm(profile, { recursive: true, force: true });
});
test("vertical slice: transcript, storage, OpenRouter y seek por messaging", async () => {
  await expect(
    panel.getByText("Transcripción encontrada", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(panel.getByText(/30 segmentos/)).toBeVisible();
  await panel.getByLabel("API key", { exact: true }).fill("sk-or-e2e-secret");
  await panel.getByLabel("Modelo de OpenRouter").fill("test/model");
  await panel.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    panel.getByText("Análisis completo", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.model).toBe("test/model");
  expect(requests[0]?.messages[1]?.content).toContain("[4:50]");
  await panel.getByRole("button", { name: "Saltar a [0:10]" }).click();
  await expect
    .poll(() =>
      youtube
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBe(10);
  const keyLeaked = await youtube.evaluate(() =>
    document.documentElement.textContent?.includes("sk-or-e2e-secret"),
  );
  expect(keyLeaked).toBe(false);
  const cdp = await context.newCDPSession(youtube);
  const worlds: { id: number; origin: string; name: string }[] = [];
  cdp.on("Runtime.executionContextCreated", ({ context: world }) =>
    worlds.push(world),
  );
  await cdp.send("Runtime.enable");
  const isolated = worlds.find((world) =>
    world.origin.startsWith("chrome-extension://"),
  );
  expect(isolated).toBeDefined();
  const access = await cdp.send("Runtime.evaluate", {
    contextId: isolated!.id,
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => { try { const data = await chrome.storage.local.get('settings'); return Boolean(data.settings?.apiKey); } catch { return false; } })()`,
  });
  expect(access.result.value).toBe(false);
  await cdp.detach();
  await panel.screenshot({
    path: "test-results/panel-analysis.png",
    fullPage: true,
  });

  await panel.reload();
  await expect(
    panel.getByText("Transcripción encontrada", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await panel
    .getByRole("button", { name: "Configuración", exact: true })
    .click();
  await expect(panel.getByLabel("API key", { exact: true })).toHaveValue(
    "sk-or-e2e-secret",
  );
});
async function configure() {
  await expect(
    panel.getByText("Transcripción encontrada", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await panel.getByLabel("API key", { exact: true }).fill("sk-or-e2e-secret");
  await panel.getByLabel("Modelo de OpenRouter").fill("test/model");
}
test("presets, prompt personalizado y preguntas independientes", async () => {
  await configure();
  await panel.getByLabel("Acción", { exact: true }).selectOption("custom");
  await panel
    .getByLabel("Prompt personalizado")
    .fill("Explica la evidencia y las limitaciones.");
  await panel.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    panel.getByText("Análisis completo", { exact: true }),
  ).toBeVisible();
  expect(requests[0]?.messages[1]?.content).toContain("Explica la evidencia");
  await panel
    .getByLabel("Pregunta", { exact: true })
    .fill("¿Qué evidencia utiliza?");
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "¿Qué evidencia utiliza?" }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]?.messages[1]?.content).toContain(
    "Tienes la transcripción completa.",
  );
});
test("clave inválida: error útil y recuperación", async () => {
  await configure();
  await context.route(
    "https://openrouter.ai/api/v1/chat/completions",
    (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: 401, message: "Invalid key" } },
      }),
  );
  await panel.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Clave de OpenRouter inválida",
  );
  await expect(
    panel.getByRole("button", { name: "Analyze", exact: true }),
  ).toBeEnabled();
});
test("transcript moderno virtualizado: acumulación, deduplicación y scroll restaurado", async () => {
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({
      path: "tests/fixtures/modern.html",
      contentType: "text/html",
    }),
  );
  await youtube.goto("https://www.youtube.com/watch?v=modernVideo");
  await panel.getByRole("button", { name: "Obtener transcripción" }).click();
  await expect(panel.getByText(/80 segmentos/)).toBeVisible({ timeout: 30000 });
  await panel.getByRole("button", { name: "Transcript", exact: true }).click();
  await expect(panel.locator(".segments p")).toHaveCount(80);
  expect(await youtube.locator("#scroll").evaluate((e) => e.scrollTop)).toBe(0);
  await expect(
    panel.getByText("Idea 79, evidencia y aprendizaje.", { exact: false }),
  ).toBeVisible();
});
test("vídeo sin transcript: fallback manual y sin peticiones externas", async () => {
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><title>Sin subtítulos</title><body><video></video></body></html>",
    }),
  );
  await youtube.goto("https://www.youtube.com/watch?v=noTranscript");
  await panel.getByRole("button", { name: "Obtener transcripción" }).click();
  await expect(
    panel.getByText("Transcripción no disponible", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(panel.getByRole("alert")).toContainText("Mostrar transcripción");
  expect(requests).toHaveLength(0);
});
test("transcript largo: chunks, síntesis y búsqueda textual para preguntas", async () => {
  await configure();
  // Expand the existing native transcript, then re-extract through real messaging.
  await youtube.evaluate(() =>
    document.querySelectorAll(".segment-text").forEach((e, i) => {
      e.textContent =
        `Tema ${i}. ` +
        (i === 25
          ? "Evidencia especial volcanes. "
          : "Aprendizaje y conceptos. "
        ).repeat(30);
    }),
  );
  await panel.getByRole("button", { name: "Obtener transcripción" }).click();
  await expect(
    panel.getByText("Transcripción encontrada", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await panel.getByLabel("Presupuesto de entrada").fill("2000");
  await panel.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    panel.getByText("Análisis completo", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(requests.length).toBeGreaterThan(2);
  expect(requests.at(-1)?.messages[1]?.content).toContain("ANÁLISIS PARCIALES");
  const count = requests.length;
  await panel
    .getByLabel("Pregunta", { exact: true })
    .fill("¿Qué dice sobre volcanes?");
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    panel.getByText(/Respuesta basada en una selección parcial/),
  ).toBeVisible();
  expect(requests).toHaveLength(count + 1);
  expect(requests.at(-1)?.messages[1]?.content).toContain(
    "Evidencia especial volcanes.",
  );
  expect(requests.at(-1)?.messages[1]?.content).toContain(
    "SOLO tienes una selección parcial",
  );
});
test("navegación de YouTube descarta un análisis pendiente", async () => {
  await configure();
  let received = false;
  await context.route(
    "https://openrouter.ai/api/v1/chat/completions",
    async (route) => {
      received = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route
        .fulfill({
          json: {
            choices: [
              {
                message: { content: "Resultado del vídeo anterior" },
                finish_reason: "stop",
              },
            ],
          },
        })
        .catch(() => undefined);
    },
  );
  await panel.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect.poll(() => received).toBe(true);
  await youtube.evaluate(() =>
    history.pushState({}, "", "/watch?v=anotherVideo"),
  );
  await expect(
    panel.getByRole("heading", { name: "Analiza un vídeo de YouTube" }),
  ).toBeVisible();
  await expect(panel.getByText("Resultado del vídeo anterior")).toHaveCount(0);
});

test("doble clic solo envía una petición de análisis", async () => {
  await configure();
  await panel
    .getByRole("button", { name: "Analyze", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    panel.getByText("Análisis completo", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
});
