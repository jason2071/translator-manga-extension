// Feeds a REAL google/gemini-2.5-flash response (captured live via OpenRouter)
// through the extension's parser to prove the end-to-end output contract holds.
import { parseBubbles } from '../src/lib/openrouter';

// verbatim model output — note it arrived wrapped in ```json fences
const realResponse = '```json\n{\n  "bubbles": [\n    {\n      "bbox": [0.1, 0.1, 0.4, 0.1],\n      "source_text": "おはよう、元気？",\n      "source_lang": "ja",\n      "translation_th": "อรุณสวัสดิ์ สบายดีไหม?"\n    },\n    {\n      "bbox": [0.5, 0.7, 0.45, 0.1],\n      "source_text": "うん、大丈夫だよ！",\n      "source_lang": "ja",\n      "translation_th": "อืม, ไม่เป็นไร!"\n    }\n  ]\n}\n```';

const bubbles = parseBubbles(realResponse);
let fail = 0;
const assert = (name: string, cond: boolean) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fail++;
};

assert('parsed 2 bubbles from fenced live output', bubbles.length === 2);
assert('bubble 1 lang ja', bubbles[0].source_lang === 'ja');
assert('bubble 1 Thai present', bubbles[0].translation_th === 'อรุณสวัสดิ์ สบายดีไหม?');
assert('bubble 2 Thai present', bubbles[1].translation_th === 'อืม, ไม่เป็นไร!');
assert('all bboxes are 4 finite numbers', bubbles.every((b) => b.bbox.length === 4 && b.bbox.every(Number.isFinite)));

console.log(bubbles.length ? `\n${JSON.stringify(bubbles, null, 2)}` : '');
console.log(fail ? `\n${fail} FAILED` : '\nlive contract OK');
if (fail) process.exit(1);
