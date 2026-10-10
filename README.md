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

## Usability and readiness review

**Review date:** October 10, 2026

**Status:** Functional MVP for personal or technical use; further work is needed before it is ready for a general audience.

### Recommended name

**Rewind** (an English adaptation of *Rebobina*) — *Understand the video and jump back to the exact second.* The name connects summaries to timestamps and is more memorable than “Transcript Lens”. Trademark, domain, and store-name availability have not been checked. The code and manifest still use “Transcript Lens”; this proposal has not been adopted.

### Results

The build and all **8 E2E tests** pass. The tests cover transcript extraction with fixtures, analysis, questions, timestamps, long videos, navigation, and API errors. This validates the controlled technical workflow, but does not demonstrate compatibility with every real YouTube page or every OpenRouter model.

The core feature is implemented. To make the product easy and safe to use, the main priorities are guiding initial setup, explaining possible costs, and validating extraction on real videos.

### Usability score

| Heuristic | Score | Observation |
|---|---:|---|
| Visibility of system status | 3/4 | Reports detection, analysis, and errors; progress on long analyses could be clearer. |
| Match with the user's language | 2/4 | Mixes Spanish, English, and technical terms such as “OpenRouter” and “model ID”. |
| User control and freedom | 3/4 | Users can cancel and switch videos, but results are not retained when navigating. |
| Consistency | 2/4 | The interface alternates between Spanish and English labels. |
| Error prevention | 2/4 | Validates some limits, but does not verify the key or model or warn about cost. |
| Recognition rather than recall | 2/4 | Presets are visible; users must know or look up a model ID. |
| Flexibility and efficiency | 3/4 | Includes presets, custom prompts, questions, and timestamps; history and export are missing. |
| Aesthetic and minimalist design | 3/4 | The panel is clear and readable, but still generic. |
| Help users recover from errors | 3/4 | Many errors offer a way forward; retrying is still manual. |
| Help and documentation | 2/4 | A README and some inline guidance are available, but contextual onboarding is missing. |
| **Total** | **25/40** | **Acceptable:** a solid technical foundation, with important improvements needed for non-technical users. |

### Priorities before a wider release

1. **[P1] Guide first-time setup.** Explain how to create and configure an OpenRouter key, suggest a recommended model, and add a connection test before analysis. The model field only suggests `openrouter/auto`; users currently need to understand and configure an ID manually.
2. **[P1] Explain scope and potential cost.** Long videos may require multiple requests and a synthesis step. Before starting, show the model, approximate transcript size, and number of requests; allow users to limit or confirm long operations. Cost depends on the model, and token counts are approximate.
3. **[P1] Validate compatibility with real YouTube pages.** Extraction depends on YouTube's internal components, which can change. Test real videos with manual and automatic captions, different languages, and account restrictions. Clearly explain that a transcript must be available and that only the standard `youtube.com/watch` route is supported for now.
4. **[P2] Keep and export results.** Results disappear when switching videos; there is no history or way to copy or download the transcript and analysis. Local history by `videoId`, with deletion or expiration, plus copy and download options would prevent lost work and repeated requests.
5. **[P2] Finalize the brand, language, and release readiness.** Adopt or drop “Rewind”, make interface labels consistent, add icons for the extension listing, and prepare a privacy policy explaining local storage and transcript sharing with OpenRouter.

### Strengths

- The main workflow is implemented: transcript retrieval, analysis, questions, and timestamp navigation.
- Timestamps let users compare answers with the corresponding moment in the original video.
- The key is stored locally with access restricted to trusted contexts and is never injected into the YouTube page.
- The automatic interface detector found no issues in `src/sidepanel/App.tsx`. This does not replace accessibility or real-world compatibility testing.

### Cognitive load and accessibility

Cognitive load is **moderate**: users must understand technical terms and configure an external service before they get value. On the positive side, the panel has a clear hierarchy, and the custom prompt appears only when selected.

Fields have labels, focus is visible, and some states are communicated through ARIA. A complete screen-reader and WCAG review is still needed; functional tests are not a substitute.

### Suggested next steps

- Prioritize onboarding and configuration checks.
- Add cost transparency and limits for long videos.
- Test extraction against a matrix of real videos and keep the fixtures as regression tests.
- Then implement local history, export, and the final brand and interface language.
