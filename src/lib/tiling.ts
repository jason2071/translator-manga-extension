// Pure helpers for webtoon / long-strip tiling. Kept dependency-free and
// DOM-free so the boundary logic can be unit-tested.

export interface Chunk {
  sy: number;
  sh: number;
}

/** A very tall image (webtoon strip) vs a normal comic page. */
export function isTall(naturalW: number, naturalH: number, ratio = 2.5): boolean {
  return naturalH > naturalW * ratio;
}

/** Fixed chunk height in natural px — clamped so chunks are ~one screen tall
 *  regardless of strip width. Fixed boundaries => stable cache keys on re-scroll. */
export function chunkHeight(naturalW: number): number {
  return Math.min(2000, Math.max(900, Math.round(naturalW * 1.4)));
}

/** Tile [0, naturalH) into contiguous, non-overlapping chunks aligned to fixed
 *  boundaries. The last chunk is clipped to the image height. */
export function planVerticalChunks(naturalW: number, naturalH: number): Chunk[] {
  const h = chunkHeight(naturalW);
  const out: Chunk[] = [];
  for (let sy = 0; sy < naturalH; sy += h) {
    out.push({ sy, sh: Math.min(h, naturalH - sy) });
  }
  return out;
}
