# Transcript Lens

Extensión Chrome Manifest V3 para analizar vídeos de YouTube usando la transcripción que YouTube ya ofrece. El MVP no extrae audio, no usa Whisper y no necesita backend: obtiene segmentos con timestamp desde la página, los manda a OpenRouter desde un contexto de extensión y muestra el resultado en el Side Panel.

## Qué incluye

- Side Panel de Chrome con transcript, presets de análisis, modelo configurable y preguntas sobre el vídeo.
- Extracción encapsulada en `src/transcript/extract.ts`, basada en componentes de transcript de YouTube y selectores estructurales, no en el texto visible "Show transcript".
- Segmentos con `text`, `timestamp` y `startSeconds`.
- Cliente OpenRouter independiente en `src/analysis/openrouter.ts`.
- Chunking sencillo para transcripts largos y síntesis final de análisis parciales.
- Búsqueda textual básica para `Ask this video` cuando el transcript no cabe entero.
- Timestamps clicables en el transcript y en respuestas tipo `[12:43]`, con salto al vídeo mediante messaging.
- API key, modelo y preferencias guardadas en `chrome.storage.local`.

## Requisitos

- Node.js 20 o superior.
- Chrome 116 o superior.
- Una API key de OpenRouter.

## Instalación local

```bash
npm install
npm run build
```

El build deja la extensión lista en `dist/`.

## Cargar la extensión en Chrome

1. Abre `chrome://extensions`.
2. Activa `Developer mode`.
3. Pulsa `Load unpacked`.
4. Selecciona la carpeta `dist` de este proyecto.
5. Abre un vídeo de YouTube con subtítulos o transcript disponible.
6. Pulsa el icono de `Transcript Lens`; se abrirá el Side Panel.

Si ya tenías YouTube abierto antes de cargar o actualizar la extensión, recarga la página del vídeo para que Chrome inyecte el content script nuevo.

## Configurar OpenRouter

1. Crea o copia tu API key en OpenRouter.
2. En el panel, abre `Configuración`.
3. Pega la key en `API key`.
4. Indica un modelo, por ejemplo:

```text
openrouter/auto
openai/gpt-4o-mini
anthropic/claude-3.5-sonnet
google/gemini-flash-1.5
```

La extensión no descarga dinámicamente la lista de modelos en esta versión. El endpoint usado es `https://openrouter.ai/api/v1/chat/completions` con `Authorization: Bearer <token>` y `Content-Type: application/json`, según la documentación de OpenRouter.

## Uso

1. Abre un vídeo de YouTube.
2. Abre el Side Panel desde el icono de la extensión.
3. Pulsa `Obtener transcripción` si no se detecta automáticamente.
4. Revisa la pestaña `Transcript`.
5. Elige una acción:
   - `Summary`
   - `Deep analysis`
   - `Key ideas`
   - `Learn`
   - `Custom prompt`
6. Pulsa `Analyze`.
7. Haz clic en timestamps como `[0:10]` para saltar a ese momento del vídeo.
8. Tras un análisis inicial, usa `Ask this video` para preguntas independientes.

## Arquitectura

- `public/manifest.json`: Manifest V3, permisos mínimos para Side Panel, storage, YouTube y OpenRouter.
- `src/background/index.ts`: configura el comportamiento del Side Panel y restringe el acceso a `chrome.storage.local`.
- `src/content/index.ts`: vive en YouTube, extrae transcript y ejecuta `seekTo(seconds)` sobre el `<video>`.
- `src/transcript/extract.ts`: estrategia DOM para abrir o reutilizar el transcript nativo, hacer scroll programático, acumular segmentos y deduplicar.
- `src/sidepanel/*`: React UI, estado de detección, settings, análisis, preguntas y timestamps interactivos.
- `src/settings/storage.ts`: lectura/escritura de preferencias locales con `setAccessLevel('TRUSTED_CONTEXTS')`.
- `src/analysis/*`: presets, formateo del transcript, cliente OpenRouter, chunking y selección textual para preguntas.
- `src/shared/*`: tipos y utilidades compartidas.

La API key no se inyecta en la página de YouTube. Se guarda en `chrome.storage.local` restringido a contextos confiables y se usa desde el Side Panel, que es una página de la extensión.

## Extracción del transcript

La estrategia actual intenta:

1. Detectar un panel de transcript ya abierto.
2. Abrir el bloque de transcript de la descripción del vídeo usando selectores de componentes de YouTube.
3. Esperar a que aparezcan segmentos.
4. Buscar filas antiguas y modernas de transcript.
5. Hacer scroll sobre el contenedor virtualizado si existe.
6. Deduplicar por `startSeconds + text`.
7. Restaurar el scroll del panel y de la página.

Tradeoff elegido para el MVP: usar el transcript renderizado por YouTube desde el DOM. Es más simple y evita tocar audio o APIs internas no documentadas, pero depende de la estructura cambiante de YouTube. La lógica está encapsulada para poder reemplazarla por otra estrategia más adelante.

## Vídeos largos

`inputTokenBudget` controla el presupuesto aproximado de entrada. Si el transcript completo cabe, se manda entero. Si no cabe:

1. Se divide por segmentos, sin cortar segmentos por la mitad.
2. Se analiza cada chunk.
3. Se combinan los análisis parciales en una petición final.

La estimación usa una heurística simple por caracteres, así que puede diferir del tokenizador real del modelo.

## Validación

```bash
npm run build
npm run test:e2e
```

Los E2E usan Playwright con la extensión cargada en Chromium, fixtures locales de YouTube y OpenRouter mockeado. Cubren el vertical slice, presets, prompt custom, errores de API, transcript virtualizado, vídeos sin transcript, chunking, preguntas y navegación durante un análisis pendiente.

Si Playwright no tiene navegador instalado:

```bash
npx playwright install chromium
npm run test:e2e
```

## Limitaciones conocidas

- YouTube puede cambiar sus componentes o clases internas; si ocurre, habrá que actualizar `src/transcript/extract.ts`.
- Algunos vídeos no ofrecen transcript o lo ocultan por idioma, restricciones o estado de sesión.
- La extracción DOM puede tardar en transcripts muy largos porque necesita recorrer el panel virtualizado.
- La selección de fragmentos para preguntas largas usa coincidencia textual básica, sin embeddings.
- No hay historial remoto ni sincronización entre navegadores.
- La lista de modelos es manual.
- No se valida el coste estimado antes de mandar múltiples chunks a OpenRouter.

## Siguientes mejoras recomendadas

- Añadir un selector de idioma cuando YouTube ofrezca varios transcripts.
- Detectar mejor subtítulos generados automáticamente frente a manuales.
- Guardar análisis recientes por `videoId` con expiración local.
- Añadir streaming de respuestas desde OpenRouter.
- Mejorar la selección de contexto para preguntas con scoring lexical más sólido.
- Añadir un botón para copiar/exportar transcript y análisis.
- Investigar una estrategia alternativa basada en datos de captions expuestos por YouTube, manteniendo el fallback DOM.
