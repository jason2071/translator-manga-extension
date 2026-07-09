// Content bootstrap: wire scope + observer + overlay, keep overlays anchored on
// scroll/resize, and handle commands from the popup.

import { initScope, onScopeChange, resetScope, toggleDrawMode } from './scope';
import { clearProcessed, initObserver, rescan } from './observer';
import { clearOverlays, initOverlay, repositionAll, toggleOriginal } from './overlay';

let rafPending = false;
function scheduleReposition(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    repositionAll();
  });
}

async function main(): Promise<void> {
  // After an extension reload, this stale content script's chrome.* calls reject
  // with "Extension context invalidated". Silence that noise (a page reload
  // replaces this script with the new build).
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String((e.reason && e.reason.message) || e.reason || '');
    if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(msg)) {
      e.preventDefault();
    }
  });

  initOverlay();
  await initScope();
  initObserver();

  // Redrawing the scope invalidates what should be translated.
  onScopeChange(() => {
    clearProcessed();
    clearOverlays();
    rescan();
  });

  // capture:true also catches scrolling inner containers used by some readers.
  window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });
  // catch lazy-loaded layout shifts that fire no scroll/resize
  setInterval(scheduleReposition, 600);

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg?.type) {
      case 'TOGGLE_DRAW':
        toggleDrawMode();
        break;
      case 'RESET_SCOPE':
        void resetScope();
        break;
      case 'RERUN':
        clearProcessed();
        clearOverlays();
        rescan();
        break;
      case 'TOGGLE_ORIGINAL':
        toggleOriginal();
        break;
    }
  });

  // Alt+Shift+S toggles the scope editor
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      toggleDrawMode();
    }
  });
}

void main();
