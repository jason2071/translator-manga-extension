// Dependency-free hashing helpers used for cache keys and text normalization.

import type { CropRegion } from './types';

/** FNV-1a 32-bit string hash -> 8-char hex. Used for URL-based keys. */
export function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Content-script cache key for an image region (no pixel access available). */
export function urlRegionKey(src: string, region: CropRegion): string {
  const r = `${Math.round(region.sx)},${Math.round(region.sy)},${Math.round(region.sw)},${Math.round(region.sh)}`;
  return `${hashString(src)}:${r}`;
}

/** Perceptual difference hash (dHash) from a 9x8 grayscale ImageData -> 16 hex
 *  chars (64 bits). Lets the same drawn panel served from a different URL still
 *  hit L1. Expects imageData sized exactly 9x8. */
export function dHash(imageData: ImageData): string {
  const { data, width, height } = imageData;
  let bits = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const j = (y * width + x + 1) * 4;
      const left = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const right = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
      bits += left > right ? '1' : '0';
    }
  }
  let hex = '';
  for (let k = 0; k < bits.length; k += 4) {
    hex += parseInt(bits.slice(k, k + 4).padEnd(4, '0'), 2).toString(16);
  }
  return hex;
}

/** Normalize source text for translation-memory exact matching. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
