# Manga Realtime Translator

Chrome (MV3) extension that overlays **Thai** translations on manga / manhwa / manhua
**as you scroll**. Text lives inside images, so it OCRs + translates each panel with a
Vision LLM (via OpenRouter) and caches everything so nothing is translated twice.

## Features

- **Draw a translate scope** — a resizable box over the reading column. Only images
  inside it are translated, so headers, footers, sidebars, and page edges are ignored.
  The box is remembered per website.
- **No re-translation on re-scroll** — each image region is cached in IndexedDB (L1),
  keyed by both URL and a content hash. Scrolling back = instant, zero API calls.
- **Translation memory (L2)** — identical source text reuses its stored Thai
  translation without a new API call, and recurring terms/names/SFX stay consistent
  via an auto-built glossary fed back into the prompt.
- **Overlay on the bubble** — the Thai text is drawn on top of the original bubble,
  auto-fit to the box. Hover a bubble to see the original; toggle all on/off.
- **Pick your provider + model** — OpenRouter, OpenAI, Anthropic (Claude),
  Google Gemini, or **Ollama (local, no key / no cost)**. Choose in the popup; each
  ships a suggested-model list but any vision model slug works. Default
  `OpenRouter · google/gemini-2.5-flash` (cheap + fast + strong multilingual OCR).
  For Ollama, run a local vision model (`ollama run llama3.2-vision`) and start the
  server with `OLLAMA_ORIGINS=*` so the extension can reach `localhost:11434`.
- **Webtoon aware** — long vertical strips are tiled into fixed chunks and
  translated progressively as you scroll; paged manga uses the full scope box.

## Setup

```bash
npm install
npm run build      # outputs an unpacked extension to dist/
```

Then load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select the `dist/` folder

For live development with HMR: `npm run dev` (still load `dist/` once, crxjs reloads it).

## Usage

1. Click the extension icon → pick a **provider**, paste that provider's **API key**
   (the popup shows the key format + where to get it), pick a **model**, keep
   **enabled** checked.
2. Open a manga page. Click **Draw scope** (or press `Alt+Shift+S`), drag the pink box
   over the reading area, then press `Alt+Shift+S` again to close the editor.
3. Scroll. Bubbles inside the box get Thai overlays. Content outside the box is untouched.
4. Popup buttons: **Re-translate** (force a re-run), **Show / hide** (toggle overlays vs
   originals), **Reset scope**, **Clear cache**. The footer shows API-call vs cache-hit counts.

## How it works

```
content script                     background service worker
──────────────                     ─────────────────────────
IntersectionObserver               fetch(src)  ← cross-origin, no canvas taint
  └ img ∩ scope → region  ── msg ─▶ OffscreenCanvas crop + downscale + dHash
                                    ├ L1 hit (url / content hash) → return, no API
                                    └ miss → OpenRouter vision (OCR + Thai JSON)
                                         └ L2 TM reuse + glossary → cache L1 + L2
overlay boxes  ◀────── bubbles ────┘
  └ re-anchored on scroll/resize
```

The background worker refetches images by URL so it can read their pixels (a content
script can't, because third-party manga CDNs taint the canvas). If a refetch is blocked
(403 hotlink protection) or the reader paints to a `<canvas>`, it falls back to
`chrome.tabs.captureVisibleTab()` and crops the on-screen region.

## Notes / limits

- The API key is stored locally in `chrome.storage.local` and the extension calls
  OpenRouter directly — fine for personal use, no backend.
- Cost is bounded: only visible images inside the scope are processed, deduped by key,
  and short-circuited by cache before any network call. Crops are downscaled before sending.
- Bubbles cut at the scope edge translate as a new region once fully scrolled in.
