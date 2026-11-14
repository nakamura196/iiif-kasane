// Get the image to give a model: not the tiles on screen, but the Canvas's image again, at a size that suits the
// model. With the IIIF Image API it is asked for at a width; without, the image itself. The pixels are read, so the
// image server must allow reading from another origin (CORS), the same condition as for the viewer's display.
import {
  canvasImagesOf,
  imageInfoUrl,
  imageRegionOfBox,
  imageRequestUrl,
  imageToCanvasOf,
  parseImageInfo,
  rawCanvasOf,
  regionToCanvasOf,
  singleImageUrl,
  tileSchemeOf,
  tilesForRegion,
  type ContainerInfo,
  type ImageInfo,
  type ImageLayer,
  type ImageRegion,
  type ImageToCanvas,
  type ManifestV4,
} from '../../core';

export class SourceImageError extends Error {
  constructor(
    public readonly reason: 'noImage' | 'unsupported' | 'fetch' | 'emptyView' | 'tooLarge',
    /**
     * For 'fetch': the HTTP status when the server answered, and how long it asked us to wait (Retry-After) before
     * trying again; `network` when the request itself failed. A refusal without CORS headers reaches the page as such
     * a network error, with no status. Retry-After is only readable from another origin when the server exposes it
     * (Access-Control-Expose-Headers), so it is often missing.
     */
    public readonly detail: { status?: number; retryAfterMs?: number; network?: boolean } = {},
  ) {
    super(reason);
  }
}

/** The request itself failed (no answer the page may read). */
class NetworkError extends Error {}

const request = async (url: string, init?: RequestInit) => {
  try {
    return await fetch(url, init);
  } catch {
    throw new NetworkError('network');
  }
};

/** An HTTP answer that was not ok (kept so a run over every page can tell a busy server from a missing image). */
class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
  ) {
    super(`HTTP ${status}`);
  }
}

/** Retry-After in milliseconds (seconds or an HTTP date); undefined when missing or unreadable. */
export const retryAfterMsOf = (value: string | null, now = Date.now()): number | undefined => {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
};

const httpErrorOf = (res: Response) => new HttpError(res.status, retryAfterMsOf(res.headers.get('Retry-After')));

/** Statuses that mean "too many requests now, ask again later". */
export const isBusyStatus = (status: number | undefined) => status === 429 || status === 503;

const fetchError = (e: unknown) =>
  new SourceImageError(
    'fetch',
    e instanceof HttpError ? { status: e.status, retryAfterMs: e.retryAfterMs } : e instanceof NetworkError ? { network: true } : {},
  );

/** The first image painted on the Canvas (the base layer). */
export const baseImageLayerOf = (manifest: ManifestV4 | null | undefined, container: ContainerInfo | undefined): ImageLayer | undefined => {
  if (!container || container.kind !== 'Canvas') return undefined;
  const images = canvasImagesOf(rawCanvasOf(manifest, container.id));
  for (const p of images.paintings) for (const o of p.options) if (o.kind === 'Image' && o.layer) return o.layer;
  return undefined;
};

/**
 * The image's info.json, or null without one. With `busyFails`, a busy answer (429, 503) throws instead of giving
 * null: the callers fall back to the whole image, which asks a busy server for even more.
 */
const infoOf = async (layer: ImageLayer, busyFails = false): Promise<ImageInfo | null> => {
  if (!layer.service) return null;
  const res = await request(imageInfoUrl(layer.service));
  if (busyFails && isBusyStatus(res.status)) throw httpErrorOf(res);
  return res.ok ? parseImageInfo(await res.json()) : null;
};

const fetchBitmap = async (url: string): Promise<ImageBitmap> => {
  const res = await request(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw httpErrorOf(res);
  return createImageBitmap(await res.blob());
};

/** The bitmap at most `longSide` on the long side (closes the one given when it makes a smaller one). */
const shrink = async (bitmap: ImageBitmap, longSide: number): Promise<ImageBitmap> => {
  const k = longSide / Math.max(bitmap.width, bitmap.height);
  if (k >= 1) return bitmap;
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const small = await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  bitmap.close();
  return small;
};

/** The image URL at most `longSide` on the long side (IIIF Image API when there is one). Also used by the puzzle. */
export const sourceImageUrl = async (layer: ImageLayer, longSide: number, busyFails = false): Promise<string> => {
  const info = await infoOf(layer, busyFails);
  if (!layer.service || !info) return layer.url;
  const k = Math.min(1, longSide / Math.max(info.width, info.height));
  const width = Math.max(1, Math.round(info.width * k));
  if (info.level >= 1) return imageRequestUrl(layer.service, 'full', width);
  return singleImageUrl(layer.service, info, width);
};

/**
 * The image to give a model (at most `longSide` on the long side), and how its pixels map to the Canvas. With
 * `busyFails` (the run over every page, which asks again later), a busy info.json fails instead of falling back to
 * the whole image.
 */
export const loadSourceImage = async (
  layer: ImageLayer,
  container: ContainerInfo,
  longSide: number,
  { busyFails = false }: { busyFails?: boolean } = {},
): Promise<{ bitmap: ImageBitmap; map: ImageToCanvas; url: string }> => {
  // Cropped or rotated images: putting the results back is not supported (refuse first)
  if (!imageToCanvasOf(layer, container, 1, 1)) throw new SourceImageError('unsupported');
  let url: string;
  let bitmap: ImageBitmap;
  try {
    url = await sourceImageUrl(layer, longSide, busyFails);
    // When the server sent it larger, shrink it here
    bitmap = await shrink(await fetchBitmap(url), longSide);
  } catch (e) {
    throw fetchError(e);
  }
  const map = imageToCanvasOf(layer, container, bitmap.width, bitmap.height);
  if (!map) {
    bitmap.close();
    throw new SourceImageError('unsupported');
  }
  return { bitmap, map, url };
};

/** Static tiles of `region` at one scale factor, put together into one bitmap (region / scale factor in size). */
const joinTiles = async (
  region: ImageRegion,
  scaleFactor: number,
  tiles: { x: number; y: number; w: number; h: number; url: string }[],
): Promise<ImageBitmap> => {
  const out = new OffscreenCanvas(Math.max(1, Math.round(region.w / scaleFactor)), Math.max(1, Math.round(region.h / scaleFactor)));
  const g = out.getContext('2d');
  if (!g) throw new Error('2d');
  const parts = await Promise.all(tiles.map(async (t) => ({ t, bitmap: await fetchBitmap(t.url) })));
  for (const { t, bitmap } of parts) {
    g.drawImage(bitmap, (t.x - region.x) / scaleFactor, (t.y - region.y) / scaleFactor, t.w / scaleFactor, t.h / scaleFactor);
    bitmap.close();
  }
  return createImageBitmap(out);
};

/**
 * Like `loadSourceImage`, for the part of the image under `box` (Canvas coordinates, for example the part on
 * screen). The region comes from the Image API when the service can cut regions (level 1 and up), from its static
 * tiles put together (level 0), or cut out of the whole image.
 */
export const loadSourceRegion = async (
  layer: ImageLayer,
  container: ContainerInfo,
  box: ImageRegion,
  longSide: number,
): Promise<{ bitmap: ImageBitmap; map: ImageToCanvas; url: string }> => {
  if (!imageToCanvasOf(layer, container, 1, 1)) throw new SourceImageError('unsupported');
  const target = layer.target ?? { x: 0, y: 0, w: container.width ?? 0, h: container.height ?? 0 };
  if (!(target.w > 0) || !(target.h > 0)) throw new SourceImageError('unsupported');

  let info: ImageInfo | null = null;
  try {
    info = await infoOf(layer);
  } catch {
    info = null;
  }
  const scheme = info ? tileSchemeOf(info) : null;
  let bitmap: ImageBitmap;
  let region: ImageRegion | null;
  let url: string;
  let width: number;
  let height: number;
  if (layer.service && info && (info.level >= 1 || scheme)) {
    width = info.width;
    height = info.height;
    region = imageRegionOfBox(box, target, width, height);
    if (!region) throw new SourceImageError('emptyView');
    if (info.level >= 1) {
      const k = Math.min(1, longSide / Math.max(region.w, region.h));
      url = imageRequestUrl(layer.service, region, Math.max(1, Math.round(region.w * k)));
      try {
        bitmap = await fetchBitmap(url);
      } catch {
        throw new SourceImageError('fetch');
      }
    } else {
      const picked = tilesForRegion(layer.service, info, scheme!, region, longSide);
      if (!picked) throw new SourceImageError('tooLarge');
      url = picked.tiles[0]?.url ?? layer.service.id;
      try {
        bitmap = await joinTiles(region, picked.scaleFactor, picked.tiles);
      } catch {
        throw new SourceImageError('fetch');
      }
    }
  } else {
    // A server that cannot cut regions, or a plain image: cut from the largest image there is
    url = layer.service && info ? singleImageUrl(layer.service, info, info.width) : layer.url;
    let whole: ImageBitmap;
    try {
      whole = await fetchBitmap(url);
    } catch {
      throw new SourceImageError('fetch');
    }
    width = whole.width;
    height = whole.height;
    region = imageRegionOfBox(box, target, width, height);
    if (!region) {
      whole.close();
      throw new SourceImageError('emptyView');
    }
    bitmap = await createImageBitmap(whole, region.x, region.y, region.w, region.h);
    whole.close();
  }
  bitmap = await shrink(bitmap, longSide);
  return { bitmap, map: regionToCanvasOf(region, target, width, height, bitmap.width, bitmap.height), url };
};
