// Service worker: request queue, cross-origin image refetch + crop, OpenRouter
// call, and cache orchestration (L1 image results + L2 translation memory).

import type {
  Bubble,
  ContentToBg,
  CropRegion,
  ImageResult,
  Settings,
  Stats,
  TranslateImageMsg,
  TranslateResponse,
} from '../lib/types';
import { dHash } from '../lib/hash';
import {
  clearAll,
  getGlossary,
  getImageResult,
  getTM,
  putImageResult,
  putTM,
} from '../lib/cache';
import { translateImage } from '../lib/openrouter';
import { getProvider } from '../lib/providers';

const DEFAULT_SETTINGS: Settings = {
  provider: 'openrouter',
  apiKey: '',
  model: 'google/gemini-2.5-flash',
  enabled: true,
  maxCropDim: 900,
};

async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
}

// ---- concurrency limiter (cap simultaneous LLM/crop work) ----
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    return () => {
      this.active--;
      this.queue.shift()?.();
    };
  }
}
const sem = new Semaphore(3);

const stats: Stats = { requests: 0, cacheHits: 0 };

// ---- image acquisition + crop ----

async function fetchBitmap(src: string): Promise<ImageBitmap> {
  const resp = await fetch(src, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`REFETCH_FAILED ${resp.status}`);
  const blob = await resp.blob();
  return createImageBitmap(blob);
}

async function canvasToBase64(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Crop `region` (natural px) out of `bitmap`, downscale to `maxDim`, and return
 *  the PNG base64 plus a content dHash. */
async function cropBitmap(
  bitmap: ImageBitmap,
  region: CropRegion,
  maxDim: number,
): Promise<{ base64: string; hash: string }> {
  const sx = Math.max(0, Math.min(Math.round(region.sx), bitmap.width - 1));
  const sy = Math.max(0, Math.min(Math.round(region.sy), bitmap.height - 1));
  const sw = Math.max(1, Math.min(Math.round(region.sw), bitmap.width - sx));
  const sh = Math.max(1, Math.min(Math.round(region.sh), bitmap.height - sy));

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = new OffscreenCanvas(dw, dh);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);

  // content hash from a tiny 9x8 grayscale
  const hc = new OffscreenCanvas(9, 8);
  const hctx = hc.getContext('2d')!;
  hctx.drawImage(canvas, 0, 0, 9, 8);
  const hash = dHash(hctx.getImageData(0, 0, 9, 8));

  const base64 = await canvasToBase64(canvas);
  return { base64, hash };
}

/** Fallback for canvas/background-image readers or CDNs that block hotlinking:
 *  screenshot the visible tab and crop the on-screen rect. */
async function cropFromCapture(
  windowId: number,
  rectCss: { x: number; y: number; w: number; h: number },
  dpr: number,
  maxDim: number,
): Promise<{ base64: string; hash: string }> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const region: CropRegion = {
    sx: rectCss.x * dpr,
    sy: rectCss.y * dpr,
    sw: rectCss.w * dpr,
    sh: rectCss.h * dpr,
  };
  return cropBitmap(bitmap, region, maxDim);
}

// ---- main translate flow ----

async function handleTranslate(
  msg: TranslateImageMsg,
  sender: chrome.runtime.MessageSender,
): Promise<TranslateResponse> {
  const settings = await getSettings();
  if (!settings.enabled) return { bubbles: [] };

  // L1 by url-region key — the re-scroll short-circuit, before any network call.
  const l1 = await getImageResult(msg.imgKey);
  if (l1) {
    stats.cacheHits++;
    return { bubbles: l1.bubbles, cached: true };
  }

  if (getProvider(settings.provider).requiresKey && !settings.apiKey) return { error: 'NO_API_KEY' };

  const release = await sem.acquire();
  try {
    // Acquire the crop (refetch primary, captureVisibleTab fallback).
    let crop: { base64: string; hash: string };
    try {
      const bitmap = await fetchBitmap(msg.src);
      let region = msg.region;
      // Correct srcset mismatches: the refetched file may differ in size from
      // the <img> the content script measured.
      if (msg.natW && bitmap.width && Math.abs(bitmap.width - msg.natW) > 2) {
        const s = bitmap.width / msg.natW;
        region = { sx: region.sx * s, sy: region.sy * s, sw: region.sw * s, sh: region.sh * s };
      }
      crop = await cropBitmap(bitmap, region, settings.maxCropDim);
    } catch (e) {
      if (msg.captureRect && sender.tab?.windowId != null) {
        crop = await cropFromCapture(
          sender.tab.windowId,
          msg.captureRect,
          msg.devicePixelRatio || 1,
          settings.maxCropDim,
        );
      } else {
        throw e;
      }
    }

    // L1 by content hash — same panel under a different URL.
    const hashKey = 'h:' + crop.hash;
    const byHash = await getImageResult(hashKey);
    if (byHash) {
      await putImageResult(msg.imgKey, byHash);
      stats.cacheHits++;
      return { bubbles: byHash.bubbles, cached: true };
    }

    // Translate (one retry on malformed JSON / transient error).
    const glossary = await getGlossary();
    let bubbles: Bubble[];
    try {
      bubbles = await translateImage(crop.base64, settings, glossary);
    } catch {
      bubbles = await translateImage(crop.base64, settings, glossary);
    }
    stats.requests++;

    // L2 reuse: identical source text reuses its stored Thai; otherwise store it.
    for (const b of bubbles) {
      if (!b.source_text) continue;
      const tm = await getTM(b.source_text);
      if (tm) b.translation_th = tm.th;
      else await putTM(b.source_text, b.translation_th, b.source_lang);
    }

    const result: ImageResult = { imgKey: msg.imgKey, bubbles, ts: Date.now() };
    await putImageResult(msg.imgKey, result);
    await putImageResult(hashKey, result);
    return { bubbles };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  } finally {
    release();
  }
}

chrome.runtime.onMessage.addListener((msg: ContentToBg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'TRANSLATE_IMAGE':
        sendResponse(await handleTranslate(msg, sender));
        break;
      case 'GET_SETTINGS':
        sendResponse(await getSettings());
        break;
      case 'CLEAR_CACHE':
        await clearAll();
        stats.requests = 0;
        stats.cacheHits = 0;
        sendResponse({ ok: true });
        break;
      case 'GET_STATS':
        sendResponse(stats);
        break;
      default:
        sendResponse({ error: 'unknown message' });
    }
  })();
  return true; // async response
});
