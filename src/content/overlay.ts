// Renders translated bubbles as fixed-position boxes over each image and keeps
// them anchored as the page scrolls / reflows.

import type { Bubble, CropRegion } from '../lib/types';

interface RenderItem {
  img: HTMLImageElement;
  region: CropRegion;
  bubbles: Bubble[];
  boxes: HTMLElement[];
}

let root: HTMLDivElement;
const items: RenderItem[] = [];
let showOriginal = false;

type NatRect = [number, number, number, number]; // x, y, w, h in image natural px

export function bubbleNatRect(region: CropRegion, b: Bubble): NatRect {
  return [
    region.sx + b.bbox[0] * region.sw,
    region.sy + b.bbox[1] * region.sh,
    b.bbox[2] * region.sw,
    b.bbox[3] * region.sh,
  ];
}

// Overlap as a fraction of the smaller box — catches the same bubble detected in
// two overlapping crops (chunk boundaries / re-scans) so it isn't drawn twice.
export function overlapFraction(a: NatRect, b: NatRect): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const minArea = Math.min(a[2] * a[3], b[2] * b[3]) || 1;
  return inter / minArea;
}

function existingRectsFor(img: HTMLImageElement): NatRect[] {
  const out: NatRect[] = [];
  for (const it of items) {
    if (it.img !== img) continue;
    for (const b of it.bubbles) out.push(bubbleNatRect(it.region, b));
  }
  return out;
}

export function initOverlay(): void {
  root = document.createElement('div');
  root.id = '__mt_overlay_root';
  Object.assign(root.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    zIndex: '2147483646',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.documentElement.appendChild(root);
}

export function renderBubbles(img: HTMLImageElement, region: CropRegion, bubbles: Bubble[]): void {
  // drop bubbles that overlap something already drawn on this image
  const existing = existingRectsFor(img);
  const fresh = bubbles.filter((b) => {
    const r = bubbleNatRect(region, b);
    if (existing.some((e) => overlapFraction(r, e) > 0.5)) return false;
    existing.push(r);
    return true;
  });
  if (!fresh.length) return;

  const boxes = fresh.map((b) => {
    const el = document.createElement('div');
    el.className = '__mt_bubble';
    Object.assign(el.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      background: '#ffffff',
      color: '#111',
      // no border: a white box merges cleanly into a white speech bubble
      border: 'none',
      borderRadius: '4px',
      padding: '1px 3px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      fontFamily: '"Noto Sans Thai","Sarabun",system-ui,sans-serif',
      lineHeight: '1.15',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      pointerEvents: 'auto',
      cursor: 'default',
    } as Partial<CSSStyleDeclaration>);
    el.textContent = b.translation_th;
    el.title = b.source_text; // hover shows the original
    root.appendChild(el);
    return el;
  });
  const item: RenderItem = { img, region, bubbles: fresh, boxes };
  items.push(item);
  positionItem(item);
}

function positionItem(item: RenderItem): void {
  const { img, region, bubbles, boxes } = item;
  if (!img.isConnected) {
    boxes.forEach((b) => (b.style.display = 'none'));
    return;
  }
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || img.naturalWidth === 0) return;
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;

  // Models return a tight bbox around the glyphs; pad it slightly so the fill
  // covers the text without swallowing the surrounding artwork.
  const PAD = 0.06;
  bubbles.forEach((b, i) => {
    const el = boxes[i];
    const bx = region.sx + b.bbox[0] * region.sw;
    const by = region.sy + b.bbox[1] * region.sh;
    const bw = b.bbox[2] * region.sw;
    const bh = b.bbox[3] * region.sh;
    let left = rect.left + bx * scaleX;
    let top = rect.top + by * scaleY;
    let width = Math.max(8, bw * scaleX);
    let height = Math.max(8, bh * scaleY);

    // pad, then clamp inside the image so we never cover neighbouring panels
    const padX = width * PAD;
    const padY = height * PAD;
    left = Math.max(rect.left, left - padX);
    top = Math.max(rect.top, top - padY);
    width = Math.min(rect.right - left, width + padX * 2);
    height = Math.min(rect.bottom - top, height + padY * 2);

    // hide if fully outside the viewport (cheap cull)
    const offscreen = top + height < 0 || top > window.innerHeight;
    Object.assign(el.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      display: showOriginal || offscreen ? 'none' : 'flex',
    });
    if (!offscreen && !showOriginal) fitFont(el, width, height);
  });
}

/** Shrink font until the Thai text fits the box. */
function fitFont(el: HTMLElement, w: number, h: number): void {
  let size = Math.max(8, Math.min(h * 0.5, 22));
  el.style.fontSize = `${size}px`;
  let guard = 0;
  while ((el.scrollHeight > h + 1 || el.scrollWidth > w + 1) && size > 7 && guard < 24) {
    size -= 1;
    el.style.fontSize = `${size}px`;
    guard++;
  }
}

export function repositionAll(): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].img.isConnected) {
      items[i].boxes.forEach((b) => b.remove());
      items.splice(i, 1);
    } else {
      positionItem(items[i]);
    }
  }
}

export function clearOverlays(): void {
  items.forEach((it) => it.boxes.forEach((b) => b.remove()));
  items.length = 0;
}

export function toggleOriginal(): void {
  showOriginal = !showOriginal;
  repositionAll();
}
