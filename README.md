# Transcript Lens

A Chrome Manifest V3 extension for analyzing YouTube videos using the transcripts YouTube already provides. The MVP does not extract audio, use Whisper, or require a backend: it retrieves timestamped segments from the page, sends them to OpenRouter from an extension context, and displays the results in Chrome's Side Panel.

## Features

- Chrome Side Panel with a transcript, analysis presets, a configurable model, and questions about the video.
- Transcript extraction encapsulated in `src/transcript/extract.ts`, using YouTube transcript components and structural selectors rather than the visible "Show transcript" label.
- Segments containing `text`, `timestamp`, and `startSeconds`.
- An independent OpenRouter client in `src/analysis/openrouter.ts`.
- Simple chunking for long transcripts and a final synthesis of partial analyses.
- Basic text search for `Ask this video` when the full transcript does not fit.
- Clickable timestamps in the transcript and responses such as `[12:43]`, with video seeking through Chrome messaging.
- API key, model, and preferences saved in `chrome.storage.local`.

## Requirements

- Node.js 20 or later.
- Chrome 116 or later.
- An OpenRouter API key.

## Local installation

```bash
npm install
npm run build
```

The build produces a ready-to-load extension in `dist/`.

## Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project's `dist` directory.
5. Open a YouTube video with available captions or a transcript.
6. Click the `Transcript Lens` extension icon to open the Side Panel.

If YouTube was already open before you loaded or updated the extension, reload the video page so Chrome can inject the new content script.

## Configure OpenRouter

The extension's interface currently includes Spanish labels. The instructions below retain those labels so you can find the corresponding controls.

1. Create or copy your API key in OpenRouter.
2. In the panel, open `Configuración` (Settings).
3. Paste your key into `API key`.
4. Enter a model ID, for example:

```text
openrouter/auto
openai/gpt-4o-mini
anthropic/claude-3.5-sonnet
google/gemini-flash-1.5
```

This version does not fetch the model list dynamically. It uses the `https://openrouter.ai/api/v1/chat/completions` endpoint with `Authorization: Bearer <token>` and `Content-Type: application/json`, following OpenRouter's documentation.

## Usage

1. Open a YouTube video.
2. Open the Side Panel using the extension icon.
3. Click `Obtener transcripción` (Get transcript) if it is not detected automatically.
4. Review the `Transcript` tab.
5. Choose an action:
   - `Summary`
   - `Deep analysis`
   - `Key ideas`
   - `Learn`
   - `Custom prompt`
6. Click `Analyze`.
7. Click timestamps such as `[0:10]` to jump to that point in the video.
8. After an initial analysis, use `Ask this video` for independent questions.

## Architecture

- `public/manifest.json`: Manifest V3 and minimal permissions for the Side Panel, storage, YouTube, and OpenRouter.
- `src/background/index.ts`: configures Side Panel behavior and restricts access to `chrome.storage.local`.
- `src/content/index.ts`: runs on YouTube, extracts the transcript, and handles requests to seek the `<video>` to a given time.
- `src/transcript/extract.ts`: DOM strategy for opening or reusing the native transcript, scrolling programmatically, collecting segments, and deduplicating them.
- `src/sidepanel/*`: React UI, detection state, settings, analysis, questions, and interactive timestamps.
- `src/settings/storage.ts`: reads and writes local preferences with storage access restricted to `TRUSTED_CONTEXTS`.
- `src/analysis/*`: presets, transcript formatting, OpenRouter client, chunking, and text selection for questions.
- `src/shared/*`: shared types and utilities.

The API key is never injected into the YouTube page. It is stored in `chrome.storage.local`, restricted to trusted extension contexts, and used from the Side Panel, which is an extension page.

## Transcript extraction

The current strategy attempts to:

1. Detect an already-open transcript panel.
2. Open the transcript section in the video description using YouTube component selectors.
3. Wait for segments to appear.
4. Find legacy and modern transcript rows.
5. Scroll through the virtualized container, if present.
6. Deduplicate by `startSeconds + text`.
7. Restore the panel and page scroll positions.

The MVP uses the transcript rendered by YouTube in the DOM. This keeps the implementation simple and avoids audio processing or undocumented API calls, but depends on YouTube's changing page structure. The extraction logic is encapsulated so it can be replaced with another strategy later.

## Long videos

`inputTokenBudget` controls the approximate input budget. If the full transcript fits, it is sent in one request. Otherwise:

1. The transcript is split at segment boundaries, without cutting segments in half.
2. Each chunk is analyzed.
3. The partial analyses are combined in a final request.

Token estimation uses a simple character-based heuristic and may differ from the model's actual tokenizer.

## Validation

```bash
npm run build
npm run test:e2e
```

The E2E tests use Playwright with the extension loaded in Chromium, local YouTube fixtures, and mocked OpenRouter responses. They cover the complete initial flow, presets, custom prompts, API errors, virtualized transcripts, videos without transcripts, chunking, questions, and navigation during a pending analysis.

If Playwright's browser is not installed:

```bash
npx playwright install chromium
npm run test:e2e
```

## Known limitations

- YouTube may change its internal components or classes, requiring updates to `src/transcript/extract.ts`.
- Some videos do not offer a transcript, or its availability depends on language, restrictions, or session state.
- DOM extraction may take longer for very long transcripts because it must scroll through the virtualized panel.
- Context selection for questions about long transcripts uses basic text matching, without embeddings.
- There is no remote history or synchronization between browsers.
- Model IDs are configured manually.
- Estimated costs are not checked before sending multiple chunks to OpenRouter.

## Recommended next improvements

- Add a language selector when YouTube offers multiple transcripts.
- Improve detection of automatically generated versus manual captions.
- Save recent analyses by `videoId` with local expiration.
- Add streaming responses from OpenRouter.
- Improve context selection for questions with stronger lexical scoring.
- Add a button to copy or export transcripts and analyses.
- Investigate an alternative strategy based on caption data exposed by YouTube, while keeping the DOM fallback.
