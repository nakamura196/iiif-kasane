// image: 画像まわりの読み取り（React に依存しない）。この機能の担当だけがこのファイルを書く。
//
// Canvas に描かれた画像（Image API の service・回転・領域・合成・Choice）、
// placeholderCanvas / accompanyingCanvas、サムネイル、画像を含む注釈を、
// 元の（Presentation 3 のままの）Canvas から読む。
// ここで読むのは「表示に要る情報」だけで、画面の組み立ては react/displays/ImageCanvasDisplay.tsx が行う。

import { probeServiceOf, type AuthProbeRef, type AuthSubstitute } from './auth';

type Json = Record<string, unknown>;

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
};

export interface ImageRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageServiceRef {
  /** Base URL of the Image API service (without a trailing slash). */
  id: string;
  version: 1 | 2 | 3;
}

/** One image painted on a Canvas. */
export interface ImageLayer {
  url: string;
  service?: ImageServiceRef;
  /** Pixel size of the source image, as the manifest says. */
  width?: number;
  height?: number;
  /** Sub-rectangle of the source image (Image API `region`: "x,y,w,h", "pct:...", "square"). */
  regionSpec?: string;
  /** Where the image goes on the Canvas, in Canvas units. Absent: the whole Canvas. */
  target?: ImageRegion;
  /** Clockwise degrees (Image API `rotation`), and whether it is mirrored first. */
  rotation: number;
  mirror: boolean;
  /** Annotations that belong to this image only (Image body `annotations`). */
  annotations: ImageAnnotation[];
  /** The AuthProbeService2 of the image (IIIF Authorization Flow 2.0), when the manifest declares one. */
  auth?: AuthProbeRef;
}

/** An annotation drawn as a box on the image. Image bodies and text are what the box shows. */
export interface ImageAnnotation {
  id: string;
  text: string;
  /** URLs of Image bodies (a picture put in an annotation). */
  images: string[];
  /** Canvas units. */
  region: ImageRegion;
}

export type PaintingKind = 'Image' | 'Video' | 'Audio' | 'Model';

export interface PaintingOption {
  kind: PaintingKind;
  url: string;
  label?: unknown;
  /** Present for kind "Image". */
  layer?: ImageLayer;
}

export interface CanvasPainting {
  /** The same id that `containersOf` gives to the painting (used to remember a Choice). */
  id: string;
  label: unknown;
  options: PaintingOption[];
}

export interface CompanionImage {
  layer: ImageLayer;
  width?: number;
  height?: number;
}

export interface CanvasImages {
  id: string;
  /** The Canvas size. When the Canvas has none, the size of the first image. */
  width?: number;
  height?: number;
  paintings: CanvasPainting[];
  /** Annotations of the Canvas that hold an Image body (recipe 0377). */
  annotations: ImageAnnotation[];
  placeholder?: CompanionImage;
  accompanying?: CompanionImage;
  /** URL of a thumbnail the Canvas declares. */
  thumbnail?: string;
}

// ---------------------------------------------------------------- services

const serviceOf = (resource: Json): ImageServiceRef | undefined => {
  const candidates = [...asList(resource.service), ...asList(resource.services)];
  for (const raw of candidates) {
    if (!isObj(raw)) continue;
    const id = str(raw.id) ?? str(raw['@id']);
    if (!id) continue;
    const type = str(raw.type) ?? str(raw['@type']) ?? '';
    const context = asList(raw['@context']).filter((c): c is string => typeof c === 'string').join(' ');
    const profile = asList(raw.profile).filter((p): p is string => typeof p === 'string').join(' ');
    let version: 1 | 2 | 3 | undefined;
    if (/ImageService3/i.test(type) || /image\/3/.test(context)) version = 3;
    else if (/ImageService2/i.test(type) || /image\/2/.test(context) || /image\/2/.test(profile)) version = 2;
    else if (/ImageService1/i.test(type) || /image\/1|image-api\/1/.test(context + profile)) version = 1;
    else if (/ImageService/i.test(type) || type === '') version = raw['@id'] ? 2 : 3;
    if (!version) continue;
    return { id: id.replace(/\/+$/, ''), version };
  }
  return undefined;
};

/** The layer with the resource an AuthProbeResult2 `location` points to (a substitute image). */
export const substituteLayer = (layer: ImageLayer, location: AuthSubstitute): ImageLayer => {
  const { service: _old, auth: _auth, ...rest } = layer;
  void _old;
  void _auth;
  const service = location.serviceId ? { id: location.serviceId, version: layer.service?.version ?? 3 } : undefined;
  return { ...rest, url: location.id, ...(service ? { service: service as ImageServiceRef } : {}) };
};

// A service id found in an Image API request URL ({id}/{region}/{size}/{rotation}/{quality}.{format}),
// for bodies that do not declare a service.
export const serviceFromImageUrl = (url: string): string | undefined => {
  const m = /^(.*)\/[^/]+\/[^/]+\/(?:!?\d+(?:\.\d+)?)\/(?:default|native|color|gray|bitonal)\.[a-z]+$/i.exec(url);
  return m ? m[1] : undefined;
};

// ---------------------------------------------------------------- regions

/** "xywh=10,20,30,40" (also "xywh=pixel:..."); the numbers only when the unit is pixels. */
export const parseImageXywh = (value: string, canvas?: { width?: number; height?: number }): ImageRegion | undefined => {
  const m = /xywh=(pixel:|percent:)?\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (!m) return undefined;
  const [x, y, w, h] = [m[2], m[3], m[4], m[5]].map(Number);
  if (m[1] === 'percent:') {
    if (!canvas?.width || !canvas?.height) return undefined;
    return { x: (x / 100) * canvas.width, y: (y / 100) * canvas.height, w: (w / 100) * canvas.width, h: (h / 100) * canvas.height };
  }
  return { x, y, w, h };
};

/** Resolve an Image API `region` against the source image size. */
export const resolveRegion = (spec: string | undefined, width: number, height: number): ImageRegion => {
  const full = { x: 0, y: 0, w: width, h: height };
  if (!spec || spec === 'full' || spec === 'max') return full;
  if (spec === 'square') {
    const s = Math.min(width, height);
    return { x: Math.floor((width - s) / 2), y: Math.floor((height - s) / 2), w: s, h: s };
  }
  const pct = spec.startsWith('pct:');
  const parts = (pct ? spec.slice(4) : spec).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return full;
  let [x, y, w, h] = parts;
  if (pct) [x, y, w, h] = [(x / 100) * width, (y / 100) * height, (w / 100) * width, (h / 100) * height];
  x = Math.min(Math.max(x, 0), width);
  y = Math.min(Math.max(y, 0), height);
  w = Math.min(w, width - x);
  h = Math.min(h, height - y);
  return w > 0 && h > 0 ? { x, y, w, h } : full;
};

/** Image API `rotation`: "90", "!270", "22.5". */
export const parseRotation = (value: unknown): { rotation: number; mirror: boolean } => {
  const s = typeof value === 'number' ? String(value) : str(value) ?? '0';
  const mirror = s.startsWith('!');
  const n = Number(mirror ? s.slice(1) : s);
  const deg = Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
  return { rotation: deg, mirror };
};

// "transform: rotate(90deg) ..." in a CssStylesheet value: only the rotate() angle is read
// (the rest of the transform is what the Image API selector version computes from the Canvas).
export const rotationFromCss = (css: string, styleClass: string | undefined): number | undefined => {
  const rules = css.split('}');
  for (const rule of rules) {
    const [selector, body] = rule.split('{');
    if (!body) continue;
    if (styleClass && !selector.split(',').some((s) => s.trim() === `.${styleClass}`)) continue;
    const m = /rotate\(\s*(-?[\d.]+)\s*(deg|turn|rad)?\s*\)/.exec(body);
    if (!m) continue;
    const v = Number(m[1]);
    const deg = m[2] === 'turn' ? v * 360 : m[2] === 'rad' ? (v * 180) / Math.PI : v;
    return ((deg % 360) + 360) % 360;
  }
  return undefined;
};

// ---------------------------------------------------------------- targets

interface Target {
  region?: ImageRegion;
  /** The id of the thing targeted (a Canvas, or an image service). */
  source?: string;
  selector?: Json;
}

const targetOf = (raw: unknown, canvas: { width?: number; height?: number }): Target => {
  if (typeof raw === 'string') {
    const [source] = raw.split('#');
    return { source, region: parseImageXywh(raw, canvas) };
  }
  if (!isObj(raw)) return {};
  const src = raw.source;
  const sourceId = typeof src === 'string' ? src : isObj(src) ? str(src.id) : isObj(asList(src)[0]) ? str((asList(src)[0] as Json).id) : undefined;
  const out: Target = { source: sourceId?.split('#')[0] };
  const selector = asList(raw.selector).find(isObj);
  if (selector) {
    out.selector = selector;
    const value = str(selector.value);
    if (value) out.region = parseImageXywh(value, canvas);
  }
  const id = str(raw.id);
  if (!out.region && id) out.region = parseImageXywh(id, canvas);
  if (!out.source && id) out.source = id.split('#')[0];
  return out;
};

// ---------------------------------------------------------------- bodies

const kindOf = (type: unknown): PaintingKind | null => {
  switch (type) {
    case 'Image':
      return 'Image';
    case 'Video':
      return 'Video';
    case 'Audio':
    case 'Sound':
      return 'Audio';
    case 'Model':
      return 'Model';
    default:
      return null;
  }
};

const textOf = (body: Json): string => {
  const v = body.value;
  if (typeof v === 'string') return v;
  return '';
};

// Annotations in `annotations` pages of a resource (a Canvas, or an Image body).
// Only the ones that show something on the image: a TextualBody and / or an Image body.
const annotationsOn = (
  pages: unknown,
  canvas: { width?: number; height?: number },
  place: (target: Target) => ImageRegion | undefined,
  needImage: boolean,
): ImageAnnotation[] => {
  const out: ImageAnnotation[] = [];
  for (const page of asList(pages)) {
    for (const raw of asList(isObj(page) ? page.items : undefined)) {
      if (!isObj(raw)) continue;
      const bodies = asList(raw.body).filter(isObj);
      const images = bodies.filter((b) => b.type === 'Image').map((b) => str(b.id)).filter((u): u is string => !!u);
      if (needImage && images.length === 0) continue;
      const text = bodies.map(textOf).filter(Boolean).join('\n');
      if (!text && images.length === 0) continue;
      const region = place(targetOf(raw.target, canvas));
      if (!region) continue;
      out.push({ id: String(raw.id ?? `annotation-${out.length}`), text, images, region });
    }
  }
  return out;
};

const layerOf = (
  body: Json,
  annotation: Json | undefined,
  canvas: { width?: number; height?: number },
): ImageLayer | null => {
  let source = body;
  let rotation = 0;
  let mirror = false;
  let regionSpec: string | undefined;
  let imageApiSizeDims: { w: number; h: number } | undefined;

  if (body.type === 'SpecificResource') {
    const s = body.source;
    const first = asList(s)[0];
    if (typeof first === 'string') source = { id: first, type: 'Image' };
    else if (isObj(first)) source = first;
    else return null;
    for (const sel of asList(body.selector).filter(isObj)) {
      if (sel.type !== 'ImageApiSelector') continue;
      if (sel.rotation != null) ({ rotation, mirror } = parseRotation(sel.rotation));
      const region = str(sel.region);
      if (region && region !== 'full') regionSpec = region;
      const size = /^\^?(\d+),(\d+)$/.exec(str(sel.size) ?? '');
      if (size) imageApiSizeDims = { w: Number(size[1]), h: Number(size[2]) };
    }
    // recipe 0040 (CSS version): a stylesheet on the Annotation rotates the body by its class
    const css = isObj(annotation?.stylesheet) ? str((annotation?.stylesheet as Json).value) : undefined;
    const styleClass = str(body.styleClass);
    if (css && styleClass && rotation === 0) rotation = rotationFromCss(css, styleClass) ?? 0;
  }

  if (source.type !== 'Image') return null;
  const url = str(source.id) ?? str(source['@id']);
  if (!url) return null;

  const declared = serviceOf(source);
  const guessed = !declared ? serviceFromImageUrl(url) : undefined;
  const layer: ImageLayer = {
    url,
    rotation,
    mirror,
    annotations: [],
    ...(declared ? { service: declared } : guessed ? { service: { id: guessed, version: 3 as const } } : {}),
    ...(regionSpec ? { regionSpec } : {}),
  };
  const auth = probeServiceOf(source);
  if (auth) layer.auth = auth;
  const w = num(source.width);
  const h = num(source.height);
  if (w !== undefined) layer.width = w;
  if (h !== undefined) layer.height = h;

  // where on the Canvas: `#xywh=` of the Annotation's target
  const target = targetOf(annotation?.target, canvas);
  if (target.region) layer.target = target.region;

  // annotations of this image (recipe 0326): their regions are in the pixels of the image
  // (at the selector's `size` when it gives one)
  const own = annotationsOn(
    source.annotations,
    canvas,
    (t) => {
      const r = t.region ?? parseSelectorRegion(t.selector);
      if (!r) return undefined;
      const dims = parseSelectorSize(t.selector) ?? imageApiSizeDims ?? (layer.width && layer.height ? { w: layer.width, h: layer.height } : undefined);
      if (!dims) return undefined;
      const base = layer.target ?? { x: 0, y: 0, w: canvas.width ?? dims.w, h: canvas.height ?? dims.h };
      return {
        x: base.x + (r.x / dims.w) * base.w,
        y: base.y + (r.y / dims.h) * base.h,
        w: (r.w / dims.w) * base.w,
        h: (r.h / dims.h) * base.h,
      };
    },
    false,
  );
  layer.annotations = own;
  return layer;
};

const parseSelectorRegion = (selector: Json | undefined): ImageRegion | undefined => {
  if (!selector || selector.type !== 'ImageApiSelector') return undefined;
  const m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(str(selector.region) ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : undefined;
};

const parseSelectorSize = (selector: Json | undefined): { w: number; h: number } | undefined => {
  const m = /^\^?(\d+),(\d+)$/.exec(str(selector?.size) ?? '');
  return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
};

const optionOf = (
  body: Json,
  annotation: Json,
  canvas: { width?: number; height?: number },
): PaintingOption | null => {
  const inner = body.type === 'SpecificResource' ? asList(body.source).find(isObj) ?? body : body;
  const kind = kindOf(inner.type);
  if (!kind) return null;
  const url = str(inner.id) ?? str(inner['@id']);
  if (!url) return null;
  const option: PaintingOption = { kind, url, label: body.label ?? inner.label };
  if (kind === 'Image') {
    const layer = layerOf(body, annotation, canvas);
    if (!layer) return null;
    option.layer = layer;
  }
  return option;
};

const hasMotivation = (anno: Json, m: string) => asList(anno.motivation).includes(m);

const paintingsOf = (
  canvas: Json,
  size: { width?: number; height?: number },
): CanvasPainting[] => {
  const out: CanvasPainting[] = [];
  for (const page of asList(canvas.items)) {
    for (const rawAnno of asList(isObj(page) ? page.items : undefined)) {
      if (!isObj(rawAnno) || !hasMotivation(rawAnno, 'painting')) continue;
      const bodies = asList(rawAnno.body).filter(isObj);
      bodies.forEach((body, j) => {
        const isChoice = body.type === 'Choice';
        const options = (isChoice ? asList(body.items).filter(isObj) : [body])
          .map((b) => optionOf(b, rawAnno, size))
          .filter((o): o is PaintingOption => o !== null);
        if (options.length === 0) return;
        const annoId = String(rawAnno.id ?? `painting-${out.length}`);
        out.push({
          id: bodies.length > 1 ? `${annoId}#body-${j}` : annoId,
          label: isChoice ? body.label : options[0].label,
          options,
        });
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------- thumbnails

/**
 * A URL to show for a `thumbnail` value: a size the service lists when it has `sizes`
 * (level 0 services serve only those), otherwise a request of `height` pixels, otherwise the
 * thumbnail's own URL.
 */
export const thumbnailUrlOf = (thumbnail: unknown, height = 160): string | undefined => {
  for (const raw of asList(thumbnail)) {
    if (typeof raw === 'string') return raw;
    if (!isObj(raw)) continue;
    const own = str(raw.id) ?? str(raw['@id']);
    const service = serviceOf(raw);
    if (service) {
      const svc = asList(raw.service).filter(isObj).find((s) => asList(s.sizes).length > 0);
      const sizes = svc ? asList(svc.sizes).filter(isObj) : [];
      const best = sizes
        .map((s) => ({ w: num(s.width) ?? 0, h: num(s.height) ?? 0 }))
        .filter((s) => s.w > 0 && s.h > 0)
        .sort((a, b) => a.h - b.h)
        .find((s) => s.h >= height);
      if (best) return `${service.id}/full/${best.w},${service.version === 3 ? best.h : ''}/0/${service.version === 1 ? 'native' : 'default'}.jpg`;
      // a thumbnail that already is a small image of the service: use it as it is
      const h = num(raw.height);
      if (own && h !== undefined && h <= height * 3) return own;
    }
    if (own) return own;
  }
  return undefined;
};

/** A small image of a painted layer (when the Canvas declares no thumbnail). */
export const layerThumbnailUrl = (layer: ImageLayer, height = 160): string => {
  if (!layer.service) return layer.url;
  const q = layer.service.version === 1 ? 'native' : 'default';
  const region = layer.regionSpec ?? 'full';
  return `${layer.service.id}/${region}/,${height}/0/${q}.jpg`;
};

// ---------------------------------------------------------------- canvas

const companionOf = (raw: unknown): CompanionImage | undefined => {
  const canvas = asList(raw).find(isObj);
  if (!canvas) return undefined;
  const w = num(canvas.width);
  const h = num(canvas.height);
  const size = { width: w, height: h };
  for (const p of paintingsOf(canvas, size)) {
    for (const o of p.options) {
      if (o.kind === 'Image' && o.layer) return { layer: o.layer, width: w ?? o.layer.width, height: h ?? o.layer.height };
    }
  }
  return undefined;
};

/** One of the candidates of the painting is an image. */
export const paintsImage = (p: CanvasPainting): boolean => p.options.some((o) => o.kind === 'Image');

/** The image painting a comparison uses (and the viewer links to): the first one with two or more candidates. */
export const imageChoiceOf = (images: CanvasImages | undefined): CanvasPainting | undefined =>
  images?.paintings.find((p) => paintsImage(p) && p.options.length > 1);

/** The images drawn: one candidate per painting (`indexOf` picks it, clamped), in painting order. */
export const chosenLayersOf = (paintings: CanvasPainting[], indexOf: (p: CanvasPainting) => number): ImageLayer[] =>
  paintings
    .map((p) => p.options[Math.min(Math.max(indexOf(p), 0), p.options.length - 1)]?.layer)
    .filter((l): l is ImageLayer => !!l);

/** Width of the sharpest source image; it decides how far one can zoom in. */
export const detailWidthOf = (layers: ImageLayer[]): number | undefined =>
  Math.max(0, ...layers.map((l) => l.width ?? 0)) || undefined;

/** What a Canvas (as in the source manifest) paints and shows around its painting. */
export const canvasImagesOf = (canvas: unknown): CanvasImages => {
  const c = (isObj(canvas) ? canvas : {}) as Json;
  const width = num(c.width);
  const height = num(c.height);
  const size = { width, height };
  const paintings = paintingsOf(c, size);

  const out: CanvasImages = { id: String(c.id ?? ''), paintings, annotations: [] };
  if (width !== undefined && height !== undefined) {
    out.width = width;
    out.height = height;
  } else {
    // no Canvas size: the first image is what the Canvas is made of
    const first = paintings.flatMap((p) => p.options).find((o) => o.kind === 'Image' && o.layer?.width && o.layer.height);
    if (first?.layer) {
      const rotated = first.layer.rotation % 180 !== 0;
      out.width = rotated ? first.layer.height : first.layer.width;
      out.height = rotated ? first.layer.width : first.layer.height;
    }
  }

  out.annotations = annotationsOn(
    c.annotations,
    { width: out.width, height: out.height },
    (t) => t.region ?? (out.width && out.height ? { x: 0, y: 0, w: out.width, h: out.height } : undefined),
    true,
  );
  out.placeholder = companionOf(c.placeholderCanvas);
  out.accompanying = companionOf(c.accompanyingCanvas);
  out.thumbnail = thumbnailUrlOf(c.thumbnail);
  return out;
};

// ---------------------------------------------------------------- Image API info.json

export interface ImageInfo {
  width: number;
  height: number;
  version: 1 | 2 | 3;
  /** Compliance level 0 / 1 / 2 (0 when unknown: only the listed sizes are safe). */
  level: number;
  tiles: { width: number; height: number; scaleFactors: number[] }[];
  sizes: { width: number; height: number }[];
  /** The largest image the server gives (`maxWidth` / `maxHeight` / `maxArea`), when it says so. */
  maxWidth?: number;
  maxHeight?: number;
  maxArea?: number;
}

export const parseImageInfo = (json: unknown): ImageInfo | null => {
  if (!isObj(json)) return null;
  const width = num(json.width);
  const height = num(json.height);
  if (!width || !height) return null;
  const context = asList(json['@context']).filter((c): c is string => typeof c === 'string').join(' ');
  const version: 1 | 2 | 3 = /image\/3/.test(context) ? 3 : /image\/2/.test(context) ? 2 : /image\/1|image-api\/1/.test(context) ? 1 : json['@id'] ? 2 : 3;

  const profiles = asList(json.profile);
  const profileText = profiles.filter((p): p is string => typeof p === 'string').join(' ');
  const level = Number(/level\s*([012])/.exec(profileText)?.[1] ?? (profileText.includes('compliance.html#level') ? profileText.slice(-1) : 0));
  const profileObj = profiles.find(isObj);
  // v2: extra features may lift a level 0 service (regionByPx etc.) but we stay on the declared level.

  const tiles = asList(json.tiles)
    .filter(isObj)
    .map((t) => {
      const tw = num(t.width) ?? 0;
      return {
        width: tw,
        height: num(t.height) ?? tw,
        scaleFactors: asList(t.scaleFactors).map(Number).filter((n) => Number.isFinite(n) && n >= 1),
      };
    })
    .filter((t) => t.width > 0 && t.scaleFactors.length > 0);

  const sizes = [...asList(json.sizes), ...(isObj(profileObj) ? asList(profileObj.sizes) : [])]
    .filter(isObj)
    .map((s) => ({ width: num(s.width) ?? 0, height: num(s.height) ?? 0 }))
    .filter((s) => s.width > 0 && s.height > 0)
    .sort((a, b) => a.width - b.width);

  // v3 puts the limits on the info.json, v2 on the profile object
  const limit = (k: string) => num(json[k]) ?? (isObj(profileObj) ? num(profileObj[k]) : undefined);
  const maxWidth = limit('maxWidth');
  const maxHeight = limit('maxHeight') ?? maxWidth;
  const maxArea = limit('maxArea');
  return {
    width,
    height,
    version,
    level: Number.isFinite(level) ? level : 0,
    tiles,
    sizes,
    ...(maxWidth ? { maxWidth } : {}),
    ...(maxHeight ? { maxHeight } : {}),
    ...(maxArea ? { maxArea } : {}),
  };
};

export const imageInfoUrl = (service: ImageServiceRef): string => `${service.id}/info.json`;

// ---------------------------------------------------------------- tiles

export interface Tile {
  key: string;
  /** Source-image pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
}

const quality = (version: 1 | 2 | 3) => (version === 1 ? 'native' : 'default');

/** `{id}/{region}/{size}/0/default.jpg` for a region of the source in source pixels. */
export const imageRequestUrl = (
  service: ImageServiceRef,
  region: ImageRegion | 'full',
  outWidth: number,
  outHeight?: number,
): string => {
  const r = region === 'full' ? 'full' : `${Math.round(region.x)},${Math.round(region.y)},${Math.round(region.w)},${Math.round(region.h)}`;
  const size = service.version === 3 && outHeight ? `${outWidth},${outHeight}` : `${outWidth},`;
  return `${service.id}/${r}/${size}/0/${quality(service.version)}.jpg`;
};

/** The tile grid the service offers: its `tiles`, or 512 px tiles at powers of two when it can cut regions. */
export const tileSchemeOf = (info: ImageInfo): { width: number; height: number; scaleFactors: number[] } | null => {
  if (info.tiles.length > 0) return info.tiles[0];
  if (info.level < 1) return null;
  const longest = Math.max(info.width, info.height);
  const factors: number[] = [];
  for (let f = 1; longest / f > 512; f *= 2) factors.push(f);
  factors.push(factors.length ? factors[factors.length - 1] * 2 : 1);
  return { width: 512, height: 512, scaleFactors: factors };
};

/** The scale factor to request: the coarsest one that still has at least one source pixel per screen pixel. */
export const pickScaleFactor = (scaleFactors: number[], screenPxPerSourcePx: number): number => {
  const sorted = [...scaleFactors].sort((a, b) => a - b);
  const want = screenPxPerSourcePx > 0 ? 1 / screenPxPerSourcePx : 1;
  let pick = sorted[0];
  for (const f of sorted) if (f <= want) pick = f;
  return pick;
};

/** How many tiles of one scale factor cover `visible` (source pixels). */
const tileCountOf = (info: ImageInfo, scheme: { width: number; height: number }, scaleFactor: number, visible: ImageRegion): number => {
  const spanW = scheme.width * scaleFactor;
  const spanH = scheme.height * scaleFactor;
  const cols = Math.min(Math.ceil(info.width / spanW) - 1, Math.floor((visible.x + visible.w) / spanW)) - Math.max(0, Math.floor(visible.x / spanW)) + 1;
  const rows = Math.min(Math.ceil(info.height / spanH) - 1, Math.floor((visible.y + visible.h) / spanH)) - Math.max(0, Math.floor(visible.y / spanH)) + 1;
  return Math.max(0, cols) * Math.max(0, rows);
};

/**
 * The tiles to draw for a view: those of `pickScaleFactor`, or of a coarser factor when they would be more
 * than `limit` (a large screen showing a large image whole). Cutting the list instead would leave the
 * bottom of the view without tiles.
 */
export const tilesForView = (
  service: ImageServiceRef,
  info: ImageInfo,
  scheme: { width: number; height: number; scaleFactors: number[] },
  screenPxPerSourcePx: number,
  visible: ImageRegion,
  limit = 150,
): Tile[] => {
  let sf = pickScaleFactor(scheme.scaleFactors, screenPxPerSourcePx);
  for (const f of [...scheme.scaleFactors].sort((a, b) => a - b)) {
    if (f > sf && tileCountOf(info, scheme, sf, visible) > limit) sf = f;
  }
  const merged = mergedScheme(info, scheme);
  if (merged && tileCountOf(info, scheme, sf, visible) > MERGE_ABOVE) return tilesCovering(service, info, merged, sf, visible, limit, 'm');
  return tilesCovering(service, info, scheme, sf, visible, limit);
};

/** Below this many tiles the view comes in one round of the 6 requests a browser makes at a time. */
const MERGE_ABOVE = 6;

/**
 * Each request asks for 2 x 2 of the declared tiles at once, when the server can cut any region (level 1
 * or above) and the larger image stays within 1024 px and the server's limits. A slow server spends most of
 * a request before it starts to answer, so a quarter of the requests brings the same pixels sooner
 * (measured on the University of Tokyo's server: 72 tiles 4.5-5.0 s, 18 merged tiles 2.9 s; docs/notes/load-time.md).
 */
export const mergedScheme = (
  info: ImageInfo,
  scheme: { width: number; height: number },
): { width: number; height: number } | null => {
  if (info.level < 1) return null;
  const width = scheme.width * 2;
  const height = scheme.height * 2;
  if (width > 1024 || height > 1024) return null;
  if (info.maxWidth && width > info.maxWidth) return null;
  if (info.maxHeight && height > info.maxHeight) return null;
  if (info.maxArea && width * height > info.maxArea) return null;
  return { width, height };
};

/** Tiles of one scale factor that cover `visible` (source pixels). At most `limit` tiles. */
export const tilesCovering = (
  service: ImageServiceRef,
  info: ImageInfo,
  scheme: { width: number; height: number },
  scaleFactor: number,
  visible: ImageRegion,
  limit = 150,
  /** Marks the keys of merged tiles, so that they do not stand for the declared tiles of the same place. */
  keyPrefix = '',
): Tile[] => {
  const spanW = scheme.width * scaleFactor;
  const spanH = scheme.height * scaleFactor;
  const x0 = Math.max(0, Math.floor(visible.x / spanW));
  const y0 = Math.max(0, Math.floor(visible.y / spanH));
  const x1 = Math.min(Math.ceil(info.width / spanW) - 1, Math.floor((visible.x + visible.w) / spanW));
  const y1 = Math.min(Math.ceil(info.height / spanH) - 1, Math.floor((visible.y + visible.h) / spanH));
  const out: Tile[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const x = tx * spanW;
      const y = ty * spanH;
      const w = Math.min(spanW, info.width - x);
      const h = Math.min(spanH, info.height - y);
      if (w <= 0 || h <= 0) continue;
      const outW = Math.ceil(w / scaleFactor);
      out.push({
        key: `${keyPrefix}${scaleFactor}/${tx}/${ty}`,
        x,
        y,
        w,
        h,
        url: imageRequestUrl(service, { x, y, w, h }, outW),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
};

/**
 * One image of the service for a level 0 service (or when it has no tiles): the smallest listed
 * size that is at least `neededWidth` wide, else the largest, else the whole image.
 */
export const singleImageUrl = (service: ImageServiceRef, info: ImageInfo, neededWidth: number): string => {
  if (info.sizes.length === 0) return imageRequestUrl(service, 'full', info.level >= 1 ? Math.min(info.width, Math.max(neededWidth, 256)) : info.width);
  const pick = info.sizes.find((s) => s.width >= neededWidth) ?? info.sizes[info.sizes.length - 1];
  return imageRequestUrl(service, 'full', pick.width, pick.height);
};

// ---------------------------------------------------------------- placement

/** Size of the bounding box of a w x h rectangle turned by `degrees`. */
export const rotatedBounds = (w: number, h: number, degrees: number): { w: number; h: number } => {
  const r = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
};

export interface Placement {
  /** Centre on the Canvas. */
  cx: number;
  cy: number;
  /** Canvas units per source pixel. */
  k: number;
  /** Size of the shown region of the source, in source pixels. */
  rw: number;
  rh: number;
  rotation: number;
  mirror: boolean;
}

/** Where a layer's (rotated) region goes on the Canvas: fitted into its target, or the whole Canvas. */
export const placementOf = (
  region: ImageRegion,
  target: ImageRegion,
  rotation: number,
  mirror: boolean,
): Placement => {
  const b = rotatedBounds(region.w, region.h, rotation);
  const k = Math.min(target.w / b.w, target.h / b.h);
  return { cx: target.x + target.w / 2, cy: target.y + target.h / 2, k, rw: region.w, rh: region.h, rotation, mirror };
};

/** A rectangle on the Canvas, as source pixels of the layer's region (the bounding box of its corners). */
export const canvasRectToLayer = (p: Placement, rect: ImageRegion): ImageRegion => {
  const r = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ]) {
    const dx = px - p.cx;
    const dy = py - p.cy;
    let lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    if (p.mirror) lx = -lx;
    xs.push(lx / p.k + p.rw / 2);
    ys.push(ly / p.k + p.rh / 2);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** The part of `a` that is inside `b`; null when they do not meet. */
export const intersect = (a: ImageRegion, b: ImageRegion): ImageRegion | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
};
