import type { ProviderId, Settings, Stats } from '../lib/types';
import { PROVIDERS, getProvider } from '../lib/providers';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const CUSTOM = '__custom__';

// The currently chosen model slug (source of truth; select + custom input are views).
let chosenModel = '';

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

// Build the model <select> from `models`, keeping `chosenModel` selectable even
// if the live list doesn't contain it, plus a "Custom…" escape hatch.
function setModelOptions(models: string[]): void {
  const sel = $('modelSelect') as HTMLSelectElement;
  const list = [...new Set(models)];
  if (chosenModel && !list.includes(chosenModel)) list.unshift(chosenModel);

  sel.innerHTML = '';
  for (const m of list) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    sel.appendChild(o);
  }
  const custom = document.createElement('option');
  custom.value = CUSTOM;
  custom.textContent = '✎ Custom model…';
  sel.appendChild(custom);

  sel.value = chosenModel && list.includes(chosenModel) ? chosenModel : list[0] ?? CUSTOM;
  if (sel.value !== CUSTOM) chosenModel = sel.value;
  syncCustomInput(false);
}

function syncCustomInput(focus: boolean): void {
  const sel = $('modelSelect') as HTMLSelectElement;
  const input = $('model') as HTMLInputElement;
  const isCustom = sel.value === CUSTOM;
  input.style.display = isCustom ? 'block' : 'none';
  if (isCustom) {
    input.value = chosenModel;
    if (focus) input.focus();
  }
}

function currentSettings(): Settings {
  return {
    provider: ($('provider') as HTMLSelectElement).value as ProviderId,
    apiKey: ($('key') as HTMLInputElement).value.trim(),
    model: chosenModel,
    enabled: ($('enabled') as HTMLInputElement).checked,
    maxCropDim: 900,
  };
}

// Populate static suggestions instantly, then replace with the live list.
async function refreshModels(): Promise<void> {
  const s = currentSettings();
  const p = getProvider(s.provider);
  setModelOptions(p.suggestedModels);
  $('keyHint').textContent = 'Key format: ' + p.keyHint;

  setStatus('Loading models…');
  try {
    const models = await p.listModels(s);
    if (models.length) {
      // if the current slug isn't actually available, jump to a real one
      if (!models.includes(chosenModel)) {
        chosenModel = models[0];
        await save();
      }
      setModelOptions(models);
      setStatus(`${models.length} models available`);
    } else {
      setStatus('No usable models found — install one (e.g. ollama pull llava) or use Custom.');
    }
  } catch (e: any) {
    setStatus(`Model list unavailable (${e?.message ?? e}) — using suggestions.`);
  }
}

async function load(): Promise<void> {
  fillProviders();
  const stored = (await chrome.storage.local.get('settings')).settings as Settings | undefined;
  const provider: ProviderId = stored?.provider ?? 'openrouter';
  ($('provider') as HTMLSelectElement).value = provider;
  ($('key') as HTMLInputElement).value = stored?.apiKey ?? '';
  chosenModel = stored?.model ?? getProvider(provider).defaultModel;
  ($('enabled') as HTMLInputElement).checked = stored?.enabled ?? true;
  await refreshStats();
  void refreshModels();
}

async function save(): Promise<void> {
  const s = currentSettings();
  s.model = s.model || getProvider(s.provider).defaultModel;
  chosenModel = s.model;
  await chrome.storage.local.set({ settings: s });
}

async function onProviderChange(): Promise<void> {
  const provider = ($('provider') as HTMLSelectElement).value as ProviderId;
  chosenModel = getProvider(provider).defaultModel; // slugs are provider-specific
  await save();
  await refreshModels();
}

function onModelSelect(): void {
  const sel = $('modelSelect') as HTMLSelectElement;
  if (sel.value === CUSTOM) {
    syncCustomInput(true);
    return;
  }
  chosenModel = sel.value;
  syncCustomInput(false);
  void save();
}

function onCustomInput(): void {
  chosenModel = ($('model') as HTMLInputElement).value.trim();
  void save();
}

async function onKeyChange(): Promise<void> {
  await save();
  await refreshModels();
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
$('key').addEventListener('change', onKeyChange);
$('modelSelect').addEventListener('change', onModelSelect);
$('model').addEventListener('input', onCustomInput);
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
