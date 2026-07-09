// Scroll-driven scanner. Two modes per image:
//   - paged manga (normal aspect): translate the scope∩image region once.
//   - webtoon / long-strip (very tall): tile vertically into fixed chunks and
//     translate each as it scrolls through the viewport. The scope acts as a
//     horizontal band only (crop left/right margins); the full height is read.
// Chunk boundaries are fixed in natural px, so re-scrolling reuses the cache.

import type { CropRegion, TranslateResponse } from '../lib/types';
import { urlRegionKey } from '../lib/hash';
import { isTall, planVerticalChunks } from '../lib/tiling';
import { getScopeRect } from './scope';
import { renderBubbles } from './overlay';

const MIN_IMG = 120; // px — ignore icons / sprites
const MIN_REGION = 24; // px — ignore slivers
const CHUNK_MARGIN = 300; // px — prefetch chunks this far outside the viewport

const processed = new Set<string>();
const inflight = new Set<string>();

let io: IntersectionObserver;
let mo: MutationObserver;
let scanTimer: number | undefined;

export function initObserver(): void {
  // IO just tells us when images enter the neighbourhood; scanning does the work.
  io = new IntersectionObserver(scheduleScan, {
    root: null,
    rootMargin: `${CHUNK_MARGIN}px 0px`,
    threshold: 0,
  });
  observeAll();
  mo = new MutationObserver(() => {
    observeAll();
    scheduleScan();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', scheduleScan, { passive: true, capture: true });
  window.addEventListener('resize', scheduleScan, { passive: true });
}

function observeAll(): void {
  document.querySelectorAll('img').forEach((img) => io.observe(img));
}

function scheduleScan(): void {
  clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scanVisible, 150);
}

export function rescan(): void {
  observeAll();
  scanVisible();
}

export function clearProcessed(): void {
  processed.clear();
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function scanVisible(): void {
  const scope = getScopeRect() as Rect;
  document.querySelectorAll('img').forEach((img) => evaluateImage(img as HTMLImageElement, scope));
}

function evaluateImage(img: HTMLImageElement, scope: Rect): void {
  if (!img.isConnected || !img.complete) return;
  if (img.naturalWidth < MIN_IMG || img.naturalHeight < MIN_IMG) return;

  const rect = img.getBoundingClientRect() as unknown as Rect;
  if (rect.width === 0 || rect.height === 0) return;

  // horizontal scope band (applies to both modes): crop left/right margins
  const ol = Math.max(rect.left, scope.left);
  const or = Math.min(rect.right, scope.right);
  if (or - ol < MIN_REGION) return; // this column is outside the scope

  const scaleX = img.naturalWidth / rect.width;
  const scaleY = img.naturalHeight / rect.height;
  const sxNat = Math.max(0, Math.round((ol - rect.left) * scaleX));
  const swNat = Math.round((or - ol) * scaleX);

  if (isTall(img.naturalWidth, img.naturalHeight)) {
    // webtoon: tile the full height; process only chunks near the viewport.
    for (const { sy: syNat, sh: shNat } of planVerticalChunks(img.naturalWidth, img.naturalHeight)) {
      if (shNat < MIN_REGION) continue;
      const top = rect.top + syNat / scaleY;
      const bottom = rect.top + (syNat + shNat) / scaleY;
      if (bottom < -CHUNK_MARGIN || top > window.innerHeight + CHUNK_MARGIN) continue;
      enqueue(img, { sx: sxNat, sy: syNat, sw: swNat, sh: shNat });
    }
  } else {
    // paged / sliced panel: translate the FULL image height once (scope filters
    // horizontally + acts as an on/off gate). Using the whole height keeps the
    // cache key independent of scroll position, so a panel scrolling through the
    // scope isn't re-translated into overlapping boxes.
    enqueue(img, { sx: sxNat, sy: 0, sw: swNat, sh: img.naturalHeight });
  }
}

async function enqueue(img: HTMLImageElement, region: CropRegion): Promise<void> {
  const src = img.currentSrc || img.src;
  const key = urlRegionKey(src, region);
  if (processed.has(key) || inflight.has(key)) return;
  inflight.add(key);

  // viewport-space rect for the captureVisibleTab fallback
  const rect = img.getBoundingClientRect();
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;
  const captureRect = {
    x: rect.left + region.sx * scaleX,
    y: rect.top + region.sy * scaleY,
    w: region.sw * scaleX,
    h: region.sh * scaleY,
  };

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'TRANSLATE_IMAGE',
      src,
      region,
      imgKey: key,
      natW: img.naturalWidth,
      natH: img.naturalHeight,
      captureRect,
      devicePixelRatio: window.devicePixelRatio,
    })) as TranslateResponse | undefined;

    if (res?.bubbles?.length) renderBubbles(img, region, res.bubbles);
    if (res && !res.error) processed.add(key);
    else if (res?.error) console.warn('[MangaTranslator]', res.error);
  } catch (e) {
    console.debug('[MangaTranslator] translate failed', e);
  } finally {
    inflight.delete(key);
  }
}
