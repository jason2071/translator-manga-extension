import type { ProviderId, Settings, Stats } from '../lib/types';
import { PROVIDERS, getProvider } from '../lib/providers';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function fillProviders(): void {
  const sel = $('provider') as HTMLSelectElement;
  sel.innerHTML = '';
  Object.values(PROVIDERS).forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  });
}

function fillModels(providerId: ProviderId): void {
  const dl = $('models') as HTMLDataListElement;
  dl.innerHTML = '';
  const p = getProvider(providerId);
  p.suggestedModels.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    dl.appendChild(o);
  });
  $('keyHint').textContent = 'Key format: ' + p.keyHint;
}

async function load(): Promise<void> {
  fillProviders();
  const stored = (await chrome.storage.local.get('settings')).settings as Settings | undefined;
  const provider: ProviderId = stored?.provider ?? 'openrouter';
  ($('provider') as HTMLSelectElement).value = provider;
  fillModels(provider);
  ($('key') as HTMLInputElement).value = stored?.apiKey ?? '';
  ($('model') as HTMLInputElement).value = stored?.model ?? getProvider(provider).defaultModel;
  ($('enabled') as HTMLInputElement).checked = stored?.enabled ?? true;
  await refreshStats();
}

async function save(): Promise<void> {
  const provider = ($('provider') as HTMLSelectElement).value as ProviderId;
  const settings: Settings = {
    provider,
    apiKey: ($('key') as HTMLInputElement).value.trim(),
    model: ($('model') as HTMLInputElement).value.trim() || getProvider(provider).defaultModel,
    enabled: ($('enabled') as HTMLInputElement).checked,
    maxCropDim: 900,
  };
  await chrome.storage.local.set({ settings });
}

// Switching provider swaps model suggestions and resets the slug to that
// provider's default (slugs are provider-specific and not interchangeable).
function onProviderChange(): void {
  const provider = ($('provider') as HTMLSelectElement).value as ProviderId;
  fillModels(provider);
  ($('model') as HTMLInputElement).value = getProvider(provider).defaultModel;
  void save();
}

function setStatus(msg: string): void {
  $('status').textContent = msg;
}

async function sendToTab(type: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('No active tab.');
    return;
  }
  const url = tab.url ?? '';
  if (/^(chrome|edge|about|chrome-extension|view-source|https:\/\/chrome\.google\.com\/webstore|https:\/\/chromewebstore\.google\.com)/.test(url)) {
    setStatus('This page type blocks extensions. Open a normal website.');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
    setStatus('');
  } catch {
    try {
      const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
      await new Promise((r) => setTimeout(r, 200));
      await chrome.tabs.sendMessage(tab.id, { type });
      setStatus('');
    } catch {
      setStatus('Could not reach the page — reload it (F5) and try again.');
    }
  }
}

async function refreshStats(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({ type: 'GET_STATS' })) as Stats | undefined;
  $('stats').textContent = `API calls: ${stats?.requests ?? 0}  ·  cache hits: ${stats?.cacheHits ?? 0}`;
}

// wire up
$('provider').addEventListener('change', onProviderChange);
(['key', 'model'] as const).forEach((id) => $(id).addEventListener('change', save));
$('enabled').addEventListener('change', save);
$('draw').addEventListener('click', () => sendToTab('TOGGLE_DRAW'));
$('reset').addEventListener('click', () => sendToTab('RESET_SCOPE'));
$('rerun').addEventListener('click', () => sendToTab('RERUN'));
$('toggleOrig').addEventListener('click', () => sendToTab('TOGGLE_ORIGINAL'));
$('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
  await refreshStats();
});

void load();
