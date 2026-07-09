// Shared types across background / content / popup.

/** A translate scope, stored as fractions of the viewport (0..1) so it
 *  survives window resizes. Persisted per hostname. */
export interface ScopeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle in the source image's *natural* pixel coordinates. */
export interface CropRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** One detected text region: bubble, caption, or sound effect.
 *  `bbox` is [x, y, w, h] normalized (0..1) to the crop that was sent. */
export interface Bubble {
  bbox: [number, number, number, number];
  source_text: string;
  source_lang: string;
  translation_th: string;
}

/** L1 cache value: the full translation result for one image region. */
export interface ImageResult {
  imgKey: string;
  bubbles: Bubble[];
  ts: number;
}

export type ProviderId = 'openrouter' | 'openai' | 'anthropic' | 'gemini';

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  model: string;
  enabled: boolean;
  /** Max width/height (px) of a crop before it is downscaled for the API. */
  maxCropDim: number;
}

export interface Stats {
  requests: number;
  cacheHits: number;
}

// ---- messaging ----

export interface TranslateImageMsg {
  type: 'TRANSLATE_IMAGE';
  src: string;
  region: CropRegion;
  imgKey: string;
  /** Natural size of the <img> as measured in-page (to correct srcset mismatches). */
  natW: number;
  natH: number;
  /** Viewport-space rect (CSS px) of the region, for the captureVisibleTab fallback. */
  captureRect: { x: number; y: number; w: number; h: number };
  devicePixelRatio: number;
}

export type ContentToBg =
  | TranslateImageMsg
  | { type: 'GET_SETTINGS' }
  | { type: 'CLEAR_CACHE' }
  | { type: 'GET_STATS' };

export interface TranslateResponse {
  bubbles?: Bubble[];
  error?: string;
  cached?: boolean;
}
