// Vision-provider registry. Each provider knows how to build its own request
// (endpoint + auth + body), pull the text content out of its response, and list
// the models actually available to the user. The translate layer stays
// provider-agnostic; parsing the JSON of bubbles is shared.

import type { ProviderId, Settings } from './types';

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  defaultModel: string;
  suggestedModels: string[];
  keyHint: string;
  /** false for local providers (Ollama) that need no API key. */
  requiresKey: boolean;
  buildRequest(base64Png: string, prompt: string, settings: Settings): ProviderRequest;
  extractContent(json: any): string;
  /** Fetch the live model list for this provider. Throws on failure; callers
   *  fall back to suggestedModels. */
  listModels(settings: Settings): Promise<string[]>;
}

// --- OpenAI-compatible shape (shared by OpenRouter + OpenAI) ---
function openaiMessages(prompt: string, base64: string) {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      ],
    },
  ];
}
function openaiExtract(json: any): string {
  return json?.choices?.[0]?.message?.content ?? '';
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'google/gemini-2.5-flash',
    suggestedModels: [
      'google/gemini-2.5-flash',
      'google/gemini-2.5-flash-lite',
      'anthropic/claude-3.5-haiku',
      'openai/gpt-4o-mini',
      'openai/gpt-4o',
    ],
    keyHint: 'sk-or-v1-…  (openrouter.ai/keys)',
    requiresKey: true,
    buildRequest: (b64, prompt, s) => ({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${s.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/manga-realtime-translator',
        'X-Title': 'Manga Realtime Translator',
      },
      body: {
        model: s.model,
        messages: openaiMessages(prompt, b64),
        response_format: { type: 'json_object' },
        temperature: 0.2,
        reasoning: { enabled: false },
      },
    }),
    extractContent: openaiExtract,
    // public endpoint, key optional; keep only vision-capable models
    listModels: async (s) => {
      const j = await getJson(
        'https://openrouter.ai/api/v1/models',
        s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {},
      );
      return (j.data ?? [])
        .filter((m: any) => (m.architecture?.input_modalities ?? []).includes('image'))
        .map((m: any) => m.id)
        .sort();
    },
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o'],
    keyHint: 'sk-…  (platform.openai.com/api-keys)',
    requiresKey: true,
    buildRequest: (b64, prompt, s) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
      body: {
        model: s.model,
        messages: openaiMessages(prompt, b64),
        response_format: { type: 'json_object' },
        temperature: 0.2,
      },
    }),
    extractContent: openaiExtract,
    listModels: async (s) => {
      if (!s.apiKey) throw new Error('API key required to list models');
      const j = await getJson('https://api.openai.com/v1/models', {
        Authorization: `Bearer ${s.apiKey}`,
      });
      // the list has no vision flag; keep the GPT-4o/4.1/5 families that see images
      return (j.data ?? [])
        .map((m: any) => m.id)
        .filter((id: string) => /gpt-4o|gpt-4\.1|gpt-5|o\d/.test(id))
        .sort();
    },
  },

  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-3-5-haiku-latest',
    suggestedModels: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    keyHint: 'sk-ant-…  (console.anthropic.com)',
    requiresKey: true,
    buildRequest: (b64, prompt, s) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: {
        model: s.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
            ],
          },
        ],
      },
    }),
    extractContent: (json) =>
      Array.isArray(json?.content)
        ? json.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('')
        : '',
    listModels: async (s) => {
      if (!s.apiKey) throw new Error('API key required to list models');
      const j = await getJson('https://api.anthropic.com/v1/models?limit=100', {
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      });
      return (j.data ?? []).map((m: any) => m.id);
    },
  },

  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    keyHint: 'AIza…  (aistudio.google.com/apikey)',
    requiresKey: true,
    buildRequest: (b64, prompt, s) => {
      const generationConfig: any = { responseMimeType: 'application/json', temperature: 0.2 };
      if (/2\.5/.test(s.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`,
        headers: { 'x-goog-api-key': s.apiKey, 'Content-Type': 'application/json' },
        body: {
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: b64 } }] }],
          generationConfig,
        },
      };
    },
    extractContent: (json) => {
      const parts = json?.candidates?.[0]?.content?.parts;
      return Array.isArray(parts) ? parts.map((p: any) => p.text ?? '').join('') : '';
    },
    listModels: async (s) => {
      if (!s.apiKey) throw new Error('API key required to list models');
      const j = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        'x-goog-api-key': s.apiKey,
      });
      return (j.models ?? [])
        .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''))
        .filter((id: string) => id.includes('gemini'));
    },
  },

  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    defaultModel: 'llama3.2-vision',
    suggestedModels: ['llama3.2-vision', 'llava', 'minicpm-v', 'qwen2.5vl'],
    keyHint: 'no key — run Ollama locally; set OLLAMA_ORIGINS=* so the extension can reach it',
    requiresKey: false,
    buildRequest: (b64, prompt, s) => ({
      url: 'http://localhost:11434/api/chat',
      headers: { 'Content-Type': 'application/json' },
      body: {
        model: s.model,
        messages: [{ role: 'user', content: prompt, images: [b64] }],
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
      },
    }),
    extractContent: (json) => json?.message?.content ?? '',
    // the actual models installed on this machine
    listModels: async () => {
      const j = await getJson('http://localhost:11434/api/tags');
      return (j.models ?? []).map((m: any) => m.name).filter(Boolean).sort();
    },
  },
};

export function getProvider(id: ProviderId): ProviderMeta {
  return PROVIDERS[id] ?? PROVIDERS.openrouter;
}
