// The translate scope: a draggable + resizable fixed rectangle. Only images
// overlapping it get translated. Stored per-hostname as viewport fractions.

import type { ScopeBox } from '../lib/types';

let boxEl: HTMLDivElement;
let scope: ScopeBox = { x: 0.1, y: 0.1, w: 0.5, h: 0.7 };
let drawMode = false;
let changeCb: (() => void) | null = null;

const storageKey = () => `scope:${location.hostname}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const px = () => ({ W: window.innerWidth, H: window.innerHeight });

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export async function initScope(): Promise<void> {
  const stored = await chrome.storage.local.get(storageKey());
  const saved = stored[storageKey()] as ScopeBox | undefined;
  if (saved) scope = saved;
  buildBox();
  applyScope();
  window.addEventListener('resize', applyScope, { passive: true });
}

function buildBox(): void {
  boxEl = document.createElement('div');
  boxEl.id = '__mt_scope';
  Object.assign(boxEl.style, {
    position: 'fixed',
    border: '2px dashed #ff3d7f',
    borderRadius: '4px',
    background: 'rgba(255,61,127,0.05)',
    zIndex: '2147483645',
    display: 'none',
    pointerEvents: 'none',
    boxSizing: 'border-box',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.textContent = 'Translate scope — drag to move · dots to resize · Alt+Shift+S to close';
  Object.assign(label.style, {
    position: 'absolute',
    top: '-24px',
    left: '0',
    fontSize: '11px',
    background: '#ff3d7f',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'system-ui,sans-serif',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  boxEl.appendChild(label);

  addHandles();
  enableMove();
  document.documentElement.appendChild(boxEl);
}

function addHandles(): void {
  for (const h of HANDLES) {
    const el = document.createElement('div');
    el.dataset.handle = h;
    Object.assign(el.style, {
      position: 'absolute',
      width: '14px',
      height: '14px',
      background: '#ff3d7f',
      border: '2px solid #fff',
      borderRadius: '50%',
      pointerEvents: 'auto',
      cursor: `${h}-resize`,
      ...handlePos(h),
    } as Partial<CSSStyleDeclaration>);
    el.addEventListener('pointerdown', (e) => startResize(e, h));
    boxEl.appendChild(el);
  }
}

function handlePos(h: string): Partial<CSSStyleDeclaration> {
  const c: Partial<CSSStyleDeclaration> = {};
  const edge = '-8px';
  const mid = 'calc(50% - 7px)';
  if (h.includes('n')) c.top = edge;
  else if (h.includes('s')) c.bottom = edge;
  else c.top = mid;
  if (h.includes('w')) c.left = edge;
  else if (h.includes('e')) c.right = edge;
  else c.left = mid;
  return c;
}

function applyScope(): void {
  const { W, H } = px();
  boxEl.style.left = `${scope.x * W}px`;
  boxEl.style.top = `${scope.y * H}px`;
  boxEl.style.width = `${scope.w * W}px`;
  boxEl.style.height = `${scope.h * H}px`;
}

async function persist(): Promise<void> {
  await chrome.storage.local.set({ [storageKey()]: scope });
}

function enableMove(): void {
  boxEl.addEventListener('pointerdown', (e) => {
    if (!drawMode) return;
    if ((e.target as HTMLElement).dataset.handle) return; // resize handles handle themselves
    e.preventDefault();
    const { W, H } = px();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...scope };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / W;
      const dy = (ev.clientY - startY) / H;
      scope.x = clamp(orig.x + dx, 0, 1 - scope.w);
      scope.y = clamp(orig.y + dy, 0, 1 - scope.h);
      applyScope();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void persist();
      changeCb?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function startResize(e: PointerEvent, h: string): void {
  if (!drawMode) return;
  e.preventDefault();
  e.stopPropagation();
  const { W, H } = px();
  const startX = e.clientX;
  const startY = e.clientY;
  const orig = { ...scope };
  const minW = 40 / W;
  const minH = 40 / H;

  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - startX) / W;
    const dy = (ev.clientY - startY) / H;
    let { x, y, w, h: hh } = orig;
    if (h.includes('e')) w = clamp(orig.w + dx, minW, 1 - orig.x);
    if (h.includes('s')) hh = clamp(orig.h + dy, minH, 1 - orig.y);
    if (h.includes('w')) {
      const nx = clamp(orig.x + dx, 0, orig.x + orig.w - minW);
      w = orig.w + (orig.x - nx);
      x = nx;
    }
    if (h.includes('n')) {
      const ny = clamp(orig.y + dy, 0, orig.y + orig.h - minH);
      hh = orig.h + (orig.y - ny);
      y = ny;
    }
    scope = { x, y, w, h: hh };
    applyScope();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    void persist();
    changeCb?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ---- public API ----

export function toggleDrawMode(): void {
  drawMode = !drawMode;
  boxEl.style.display = drawMode ? 'block' : 'none';
  boxEl.style.pointerEvents = drawMode ? 'auto' : 'none';
}

/** Viewport-space rect (CSS px) of the current scope. */
export function getScopeRect() {
  const { W, H } = px();
  const left = scope.x * W;
  const top = scope.y * H;
  const width = scope.w * W;
  const height = scope.h * H;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

export function onScopeChange(cb: () => void): void {
  changeCb = cb;
}

export async function resetScope(): Promise<void> {
  scope = { x: 0.1, y: 0.1, w: 0.5, h: 0.7 };
  applyScope();
  await persist();
  changeCb?.();
}
