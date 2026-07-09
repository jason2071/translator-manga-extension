// Vision translate call: one image in, structured bubbles out (OCR + Thai
// translation in a single request). Provider-agnostic — the endpoint/auth/body
// come from lib/providers; only prompt building and JSON parsing live here.

import type { Bubble, Settings } from './types';
import { getProvider } from './providers';

function buildPrompt(glossary: Record<string, string>): string {
  const glossaryLines = Object.entries(glossary)
    .map(([k, v]) => `- ${k} => ${v}`)
    .join('\n');
  const hasGlossary = Object.keys(glossary).length > 0;
  return [
    'You are an OCR + translation engine for comics (manga / manhwa / manhua).',
    'The image is a crop from a comic page. Find EVERY region that contains text:',
    'speech bubbles, narration boxes, captions, sound effects, AND game-style',
    'system/status windows (light text on dark or coloured panels, e.g. "SKILL',
    'LEVEL HAS INCREASED"). Include stylized onomatopoeia / sound effects drawn',
    'over the artwork, in ANY language, even when the dialogue is in another.',
    'For each region return an object with:',
    '- "bbox": [x, y, w, h] normalized to THIS image, each 0..1, origin top-left.',
    '- "source_text": the exact original text.',
    '- "source_lang": ISO 639-1 code of the detected language (ja, ko, zh, en, ...).',
    '- "translation_th": a natural, fluent Thai translation.',
    hasGlossary ? `Keep these translations consistent (source => Thai):\n${glossaryLines}` : '',
    'Respond with ONLY a JSON object: {"bubbles": [ ... ]}. No markdown, no prose.',
    'If there is no text, respond with {"bubbles": []}.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function translateImage(
  base64Png: string,
  settings: Settings,
  glossary: Record<string, string>,
): Promise<Bubble[]> {
  const provider = getProvider(settings.provider);
  const { url, headers, body } = provider.buildRequest(base64Png, buildPrompt(glossary), settings);

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (provider.id === 'ollama' && res.status === 403) {
      throw new Error(
        'Ollama 403 — the extension origin is blocked. Restart Ollama with OLLAMA_ORIGINS=* (see README).',
      );
    }
    throw new Error(`${provider.label} ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return parseBubbles(provider.extractContent(json));
}

/** Pull every complete, balanced {...} object (at any nesting depth) out of a
 *  string, tolerating strings/escapes. Complete inner objects survive even when
 *  an outer wrapper is truncated — the key to salvaging cut-off model output. */
function extractObjects(text: string): any[] {
  const objs: any[] = [];
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push(i);
    else if (ch === '}') {
      const start = stack.pop();
      if (start !== undefined) {
        try {
          objs.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* skip malformed fragment */
        }
      }
    }
  }
  return objs;
}

function collectRaw(text: string): any[] {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any)?.bubbles)) return (data as any).bubbles;
    if (data && typeof data === 'object') return [data];
  } catch {
    /* fall through to salvage */
  }
  const objs = extractObjects(text);
  // Prefer complete {bubbles:[...]} wrappers; otherwise use bubble-like objects
  // (handles a truncated wrapper by keeping its complete inner bubbles).
  const wrappers = objs.filter((o) => Array.isArray(o?.bubbles));
  if (wrappers.length) return wrappers.flatMap((o) => o.bubbles);
  return objs.filter((o) => o && (Array.isArray(o.bbox) || typeof o.translation_th === 'string'));
}

/** Tolerant parser: unwraps code fences, whole-parses, then salvages objects. */
export function parseBubbles(content: string): Bubble[] {
  let text = (content ?? '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const raw = collectRaw(text);
  // Only a total absence of any parseable JSON is a real failure (retryable).
  if (raw.length === 0 && text.length > 0 && !/[[{]/.test(text)) {
    throw new Error('Malformed JSON from model');
  }

  return raw
    .filter(
      (b) =>
        b &&
        Array.isArray(b.bbox) &&
        b.bbox.length === 4 &&
        typeof b.translation_th === 'string',
    )
    .map((b) => ({
      bbox: [Number(b.bbox[0]), Number(b.bbox[1]), Number(b.bbox[2]), Number(b.bbox[3])] as [
        number,
        number,
        number,
        number,
      ],
      source_text: String(b.source_text ?? ''),
      source_lang: String(b.source_lang ?? ''),
      translation_th: String(b.translation_th ?? ''),
    }))
    .filter((b) => b.translation_th.trim().length > 0 && b.bbox.every((n) => Number.isFinite(n)));
}
