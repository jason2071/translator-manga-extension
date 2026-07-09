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
    'The image is a crop from a comic page. Find every region that contains text:',
    'speech bubbles, narration boxes, captions, and sound effects.',
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

/** Tolerant parser: unwraps code fences, falls back to the first JSON block. */
export function parseBubbles(content: string): Bubble[] {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (!m) throw new Error('Malformed JSON from model');
    data = JSON.parse(m[0]);
  }

  const arr: any[] = Array.isArray(data) ? data : ((data as any)?.bubbles ?? []);
  return arr
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
