// Standalone unit tests for the pure logic (no Chrome/DOM needed).
// Run: npx esbuild tests/unit.ts --bundle --platform=node --format=esm --outfile=tests/_unit.mjs && node tests/_unit.mjs

import { parseBubbles } from '../src/lib/openrouter';
import { hashString, urlRegionKey, dHash, normalizeText } from '../src/lib/hash';
import { isTall, chunkHeight, planVerticalChunks } from '../src/lib/tiling';
import { PROVIDERS, getProvider } from '../src/lib/providers';
import { bubbleNatRect, overlapFraction } from '../src/content/overlay';
import type { Settings } from '../src/lib/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.error(`  FAIL ${name} ${extra}`);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(name, JSON.stringify(a) === JSON.stringify(b), `\n    got ${JSON.stringify(a)}\n    exp ${JSON.stringify(b)}`);
}

console.log('parseBubbles');
{
  const objForm = parseBubbles(
    '{"bubbles":[{"bbox":[0.1,0.2,0.3,0.4],"source_text":"こんにちは","source_lang":"ja","translation_th":"สวัสดี"}]}',
  );
  eq('object form length', objForm.length, 1);
  eq('object form bbox', objForm[0].bbox, [0.1, 0.2, 0.3, 0.4]);
  eq('object form th', objForm[0].translation_th, 'สวัสดี');

  const arrForm = parseBubbles('[{"bbox":[0,0,1,1],"source_text":"x","source_lang":"ja","translation_th":"ก"}]');
  eq('array form length', arrForm.length, 1);

  const fenced = parseBubbles(
    '```json\n{"bubbles":[{"bbox":[0,0,0.5,0.5],"source_text":"a","source_lang":"en","translation_th":"ข"}]}\n```',
  );
  eq('fenced length', fenced.length, 1);

  const prosey = parseBubbles(
    'Here is the result:\n{"bubbles":[{"bbox":[0,0,0.5,0.5],"source_text":"a","source_lang":"en","translation_th":"ค"}]}\nDone.',
  );
  eq('prose-wrapped length', prosey.length, 1);

  const empty = parseBubbles('{"bubbles":[]}');
  eq('empty length', empty.length, 0);

  const filtered = parseBubbles(
    '{"bubbles":[{"bbox":[0,0,1],"translation_th":"bad"},{"bbox":[0,0,1,1],"source_text":"","source_lang":"ja","translation_th":""},{"bbox":[0.1,0.1,0.2,0.2],"source_text":"ok","source_lang":"ja","translation_th":"ดี"}]}',
  );
  eq('filters invalid bbox / empty translation', filtered.length, 1);
  eq('kept the good one', filtered[0].translation_th, 'ดี');

  let threw = false;
  try {
    parseBubbles('this is not json at all');
  } catch {
    threw = true;
  }
  ok('malformed JSON throws', threw);
}

console.log('hashString / urlRegionKey');
{
  const h1 = hashString('https://cdn.example.com/page1.png');
  const h2 = hashString('https://cdn.example.com/page1.png');
  const h3 = hashString('https://cdn.example.com/page2.png');
  ok('deterministic', h1 === h2);
  ok('distinct inputs differ', h1 !== h3);
  ok('8 hex chars', /^[0-9a-f]{8}$/.test(h1), `got ${h1}`);

  const k = urlRegionKey('https://x/p.png', { sx: 10.6, sy: 20.4, sw: 100, sh: 200 });
  eq('urlRegionKey rounds region', k.endsWith(':11,20,100,200'), true);
  const kSame = urlRegionKey('https://x/p.png', { sx: 11, sy: 20, sw: 100, sh: 200 });
  ok('same rounded region → same key', k === kSame);
}

console.log('dHash');
{
  // left half black, right half white → deterministic 64-bit hash, 16 hex chars
  const w = 9;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x < w / 2 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const hash = dHash({ data, width: w, height: h } as ImageData);
  ok('dHash 16 hex chars', /^[0-9a-f]{16}$/.test(hash), `got ${hash}`);
  const hash2 = dHash({ data, width: w, height: h } as ImageData);
  ok('dHash deterministic', hash === hash2);
}

console.log('normalizeText');
{
  eq('collapse whitespace', normalizeText('  a\n  b\t c '), 'a b c');
  ok('same text after norm matches', normalizeText('こんにちは ') === normalizeText(' こんにちは'));
}

console.log('\n--- bbox → page mapping (overlay math) ---');
{
  // Replicate the exact arithmetic in overlay.positionItem for a known case.
  const region = { sx: 100, sy: 50, sw: 400, sh: 300 };
  const bubble = { bbox: [0.25, 0.5, 0.5, 0.25] as [number, number, number, number] };
  const naturalW = 800;
  const naturalH = 600;
  const rect = { left: 10, top: 20, width: 400, height: 300 }; // displayed at half size
  const scaleX = rect.width / naturalW; // 0.5
  const scaleY = rect.height / naturalH; // 0.5
  const bx = region.sx + bubble.bbox[0] * region.sw; // 100 + 100 = 200
  const by = region.sy + bubble.bbox[1] * region.sh; // 50 + 150 = 200
  const bw = bubble.bbox[2] * region.sw; // 200
  const bh = bubble.bbox[3] * region.sh; // 75
  eq('mapped left', rect.left + bx * scaleX, 10 + 100);
  eq('mapped top', rect.top + by * scaleY, 20 + 100);
  eq('mapped width', bw * scaleX, 100);
  eq('mapped height', bh * scaleY, 37.5);
}

console.log('\n--- webtoon tiling ---');
{
  ok('paged image not tall', !isTall(800, 1200));
  ok('long strip is tall', isTall(800, 12000));
  ok('square not tall', !isTall(1000, 1000));

  eq('chunkHeight clamps small width up to 900', chunkHeight(300), 900);
  eq('chunkHeight clamps large width down to 2000', chunkHeight(3000), 2000);
  eq('chunkHeight scales mid width', chunkHeight(1000), 1400);

  // full coverage, no gaps, no overlap, last chunk clipped
  const W = 800;
  const H = 12000; // chunkHeight(800)=1120 -> 11 chunks (10*1120 + 800)
  const chunks = planVerticalChunks(W, H);
  const ch = chunkHeight(W);
  eq('chunk count', chunks.length, Math.ceil(H / ch));
  eq('first chunk starts at 0', chunks[0].sy, 0);
  ok(
    'chunks are contiguous (no gap/overlap)',
    chunks.every((c, i) => (i === 0 ? c.sy === 0 : c.sy === chunks[i - 1].sy + chunks[i - 1].sh)),
  );
  eq('coverage sums to full height', chunks.reduce((s, c) => s + c.sh, 0), H);
  eq('last chunk clipped to remainder', chunks[chunks.length - 1].sh, H - (chunks.length - 1) * ch);
  ok('all chunk heights <= chunkHeight', chunks.every((c) => c.sh <= ch));

  // stability: identical inputs -> identical boundaries (=> stable cache keys)
  eq('deterministic boundaries', planVerticalChunks(W, H), planVerticalChunks(W, H));
}

console.log('\n--- overlay dedupe geometry ---');
{
  // bbox is normalized to the crop; map to absolute natural px
  const region = { sx: 100, sy: 50, sw: 400, sh: 300 };
  const b = (x: number, y: number, w: number, h: number) => ({
    bbox: [x, y, w, h] as [number, number, number, number],
    source_text: 's',
    source_lang: 'ja',
    translation_th: 'ก',
  });
  eq('nat rect mapping', bubbleNatRect(region, b(0.25, 0.5, 0.5, 0.25)), [200, 200, 200, 75]);

  const A: [number, number, number, number] = [0, 0, 100, 100];
  eq('identical boxes fully overlap', overlapFraction(A, [0, 0, 100, 100]), 1);
  ok('90% shifted overlap counts as duplicate', overlapFraction(A, [10, 10, 100, 100]) > 0.5);
  eq('disjoint boxes do not overlap', overlapFraction(A, [200, 200, 50, 50]), 0);
  ok('small box inside big box = full overlap of the small one', overlapFraction(A, [10, 10, 20, 20]) === 1);
}

console.log('\n--- provider request builders ---');
{
  const b64 = 'AAAA';
  const prompt = 'do it';
  const mk = (p: string, model: string): Settings => ({ provider: p as any, apiKey: 'KEY', model, enabled: true, maxCropDim: 900 });

  const orr = PROVIDERS.openrouter.buildRequest(b64, prompt, mk('openrouter', 'google/gemini-2.5-flash'));
  ok('openrouter url', orr.url.includes('openrouter.ai'));
  ok('openrouter bearer', orr.headers.Authorization === 'Bearer KEY');
  ok('openrouter disables reasoning', (orr.body as any).reasoning?.enabled === false);
  ok('openrouter sends image_url data uri', (orr.body as any).messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));

  const oai = PROVIDERS.openai.buildRequest(b64, prompt, mk('openai', 'gpt-4o-mini'));
  ok('openai url', oai.url.includes('api.openai.com'));
  ok('openai has NO reasoning field (would 400)', (oai.body as any).reasoning === undefined);

  const ant = PROVIDERS.anthropic.buildRequest(b64, prompt, mk('anthropic', 'claude-3-5-haiku-latest'));
  ok('anthropic url', ant.url.includes('api.anthropic.com'));
  ok('anthropic x-api-key', ant.headers['x-api-key'] === 'KEY');
  ok('anthropic version header', ant.headers['anthropic-version'] === '2023-06-01');
  ok('anthropic browser-access header', ant.headers['anthropic-dangerous-direct-browser-access'] === 'true');
  ok('anthropic base64 image source', (ant.body as any).messages[0].content[1].source.data === b64);

  const gem25 = PROVIDERS.gemini.buildRequest(b64, prompt, mk('gemini', 'gemini-2.5-flash'));
  ok('gemini url has model', gem25.url.includes('gemini-2.5-flash:generateContent'));
  ok('gemini api key header', gem25.headers['x-goog-api-key'] === 'KEY');
  ok('gemini inline_data', (gem25.body as any).contents[0].parts[1].inline_data.data === b64);
  ok('gemini 2.5 disables thinking', (gem25.body as any).generationConfig.thinkingConfig?.thinkingBudget === 0);

  const gem20 = PROVIDERS.gemini.buildRequest(b64, prompt, mk('gemini', 'gemini-2.0-flash'));
  ok('gemini 2.0 omits thinkingConfig (would error)', (gem20.body as any).generationConfig.thinkingConfig === undefined);

  const olm = PROVIDERS.ollama.buildRequest(b64, prompt, mk('ollama', 'llama3.2-vision'));
  ok('ollama local url', olm.url.includes('localhost:11434/api/chat'));
  ok('ollama needs no key', PROVIDERS.ollama.requiresKey === false);
  ok('ollama raw base64 images (no data prefix)', (olm.body as any).messages[0].images[0] === b64);
  ok('ollama forces json format', (olm.body as any).format === 'json');
  ok('cloud providers require a key', PROVIDERS.openrouter.requiresKey && PROVIDERS.gemini.requiresKey);

  ok('unknown provider falls back to openrouter', getProvider('bogus' as any).id === 'openrouter');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
