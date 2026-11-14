// Underscore name: not in the generated list of core/features, so it is not part of the package's public API.
// download: what the Download tab offers for an image, and the Image API URLs for it (no React, no DOM).
//
// An image with an Image API service can be fetched whole or by region, at several sizes. What is offered depends on
// what the server can serve, so that no URL is offered that would answer 404:
// - `sizes` listed: those sizes (a level 0 service serves nothing else except the whole image at full size).
// - no `sizes`, level 1 or 2: a few computed sizes, never above maxWidth / maxHeight / maxArea.
// - level 0 and no `sizes` (a static tile store): only the whole image at full size, by keyword. No region, no resize.
// An image without a service is the file itself.
import { imageRequestUrl, type ImageInfo, type ImageLayer, type ImageRegion, type ImageServiceRef } from './image';
import { largestRequestUrl } from './_imageUrl';
import { imageRegionOfBox } from './inference/region';

/** The whole image, or a rectangle of it in pixels of the image (not of the Canvas). */
export type DownloadRegion = 'full' | ImageRegion;

export interface DownloadSize {
  /** `max` for the largest the server gives, else the width (unique in a list). */
  id: string;
  width: number;
  height: number;
  url: string;
  max: boolean;
  /**
   * The same image asked with the whole image given as pixels (`0,0,W,H`) instead of the keyword `full`, for servers
   * that refuse `full` (the National Archives of Japan answers 403): the display asks again this way too. Level 1 and up.
   */
  retryUrl?: string;
}

/** Long sides tried when the service lists no sizes (only those below the long side of the region are used). */
export const COMPUTED_LONG_SIDES = [256, 512, 1024, 2048, 4096] as const;

/** Whether the layer is the plain image of its service (not cropped, turned or mirrored by the manifest). */
export const isPlainLayer = (layer: Pick<ImageLayer, 'regionSpec' | 'rotation' | 'mirror'>): boolean =>
  (!layer.regionSpec || layer.regionSpec === 'full') && layer.rotation % 360 === 0 && !layer.mirror;

/** Whether the server can cut a region (level 1 and up). A level 0 service serves whole images only. */
export const canCutRegion = (info: ImageInfo): boolean => info.level >= 1;

/** Shrinks `width` x `height` to the limits of the server (keeping the shape); unchanged when it fits. */
export const limitedSize = (width: number, height: number, info: Pick<ImageInfo, 'maxWidth' | 'maxHeight' | 'maxArea'>): { width: number; height: number } => {
  let k = 1;
  if (info.maxWidth) k = Math.min(k, info.maxWidth / width);
  if (info.maxHeight) k = Math.min(k, info.maxHeight / height);
  if (info.maxArea) k = Math.min(k, Math.sqrt(info.maxArea / (width * height)));
  if (k >= 1) return { width, height };
  return { width: Math.max(1, Math.floor(width * k)), height: Math.max(1, Math.floor(height * k)) };
};

/**
 * The part of the image under `box` (Canvas coordinates) as a region of the image in its own pixels, clamped to the
 * image. `target` is where the image sits on the Canvas (the whole Canvas when absent). 'full' when the box takes in
 * the whole image; null when it misses the image or the Canvas has no size.
 */
export const visibleDownloadRegion = (
  box: ImageRegion,
  layer: Pick<ImageLayer, 'target'>,
  canvas: { width?: number; height?: number },
  info: Pick<ImageInfo, 'width' | 'height'>,
): DownloadRegion | null => {
  const target = layer.target ?? (canvas.width && canvas.height ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : undefined);
  if (!target || !(target.w > 0) || !(target.h > 0)) return null;
  const r = imageRegionOfBox(box, target, info.width, info.height);
  if (!r) return null;
  return r.x === 0 && r.y === 0 && r.w === info.width && r.h === info.height ? 'full' : r;
};

/** The pixel size of a region (the whole image when 'full'). */
export const regionSize = (region: DownloadRegion, info: Pick<ImageInfo, 'width' | 'height'>): { width: number; height: number } =>
  region === 'full' ? { width: info.width, height: info.height } : { width: region.w, height: region.h };

/** The whole image as a pixel region (what a server that refuses the keyword `full` accepts). */
const wholeRegion = (info: Pick<ImageInfo, 'width' | 'height'>): ImageRegion => ({ x: 0, y: 0, w: info.width, h: info.height });

/**
 * The sizes to offer for `region`, smallest first, the largest last (id `max`). Empty when the server cannot serve
 * the region (level 0 cannot cut). Every URL is one the service promises to serve.
 */
export const downloadSizesOf = (service: ImageServiceRef, info: ImageInfo, region: DownloadRegion): DownloadSize[] => {
  if (!canCutRegion(info)) return region === 'full' ? level0SizesOf(service, info) : [];
  const full = regionSize(region, info);
  const rw = Math.round(full.width);
  const rh = Math.round(full.height);
  const max = limitedSize(rw, rh, info);
  const out: DownloadSize[] = [];

  const push = (width: number, height: number, url: string, retryUrl?: string) => {
    if (width >= max.width || out.some((s) => s.width === width)) return;
    out.push({ id: String(width), width, height, url, max: false, ...(retryUrl ? { retryUrl } : {}) });
  };
  if (region === 'full' && info.sizes.length > 0) {
    for (const s of info.sizes) push(s.width, s.height, imageRequestUrl(service, 'full', s.width, s.height), imageRequestUrl(service, wholeRegion(info), s.width, s.height));
  } else {
    const long = Math.max(rw, rh);
    for (const side of COMPUTED_LONG_SIDES) {
      if (side >= long) break;
      const k = side / long;
      const small = limitedSize(Math.max(1, Math.round(rw * k)), Math.max(1, Math.round(rh * k)), info);
      push(
        small.width,
        small.height,
        imageRequestUrl(service, region, small.width),
        region === 'full' ? imageRequestUrl(service, wholeRegion(info), small.width) : undefined,
      );
    }
  }
  out.sort((a, b) => a.width - b.width);

  // The largest the server gives: the keyword when nothing cuts it, else its size as pixels (a level 1 or 2 server
  // takes any width)
  const limited = max.width !== rw || max.height !== rh;
  const asked = (r: DownloadRegion | ImageRegion) => (service.version === 3 || !limited ? largestRequestUrl(service, r) : imageRequestUrl(service, r, max.width));
  out.push({ id: 'max', width: max.width, height: max.height, url: asked(region), max: true, ...(region === 'full' ? { retryUrl: asked(wholeRegion(info)) } : {}) });
  return out;
};

// Level 0 serves only the sizes it lists and the whole image at its own size. A width that is not listed (`full/<w>,`)
// is a resize, which it does not have, so it is never asked for, not even when a limit cuts the full size.
const level0SizesOf = (service: ImageServiceRef, info: ImageInfo): DownloadSize[] => {
  const out: DownloadSize[] = [];
  for (const s of [...info.sizes].sort((a, b) => a.width - b.width)) {
    if (out.some((o) => o.width === s.width)) continue;
    out.push({ id: String(s.width), width: s.width, height: s.height, url: imageRequestUrl(service, 'full', s.width, s.height), max: false });
  }
  const full = out.find((s) => s.width === info.width && s.height === info.height);
  const allowed = limitedSize(info.width, info.height, info);
  // The full size is the listed one when the server lists it; else the keyword, if no limit cuts it
  if (!full && allowed.width === info.width && allowed.height === info.height) {
    out.push({ id: 'max', width: info.width, height: info.height, url: largestRequestUrl(service, 'full'), max: true });
  } else if (out.length > 0) {
    out[out.length - 1] = { ...out[out.length - 1], id: 'max', max: true };
  }
  return out;
};

/** Characters a file name cannot hold (or that make a shell or a browser trip), and runs of spaces. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\s]+/g;

/** `<label>_<region>_<width>x<height>.<ext>`; the label is cut to 60 characters. */
export const downloadFileName = (
  label: string,
  region: DownloadRegion | undefined,
  size: { width: number; height: number } | undefined,
  ext: string,
): string => {
  // Cut by code points (a character outside the BMP, like 𠮷, is two UTF-16 units), then trim what the cut left at the ends
  const slug = Array.from(label.normalize('NFKC').replace(UNSAFE, '_')).slice(0, 60).join('').replace(/^[_.]+|[_.]+$/g, '') || 'image';
  const parts = [slug];
  if (region) parts.push(region === 'full' ? 'full' : `region-${Math.round(region.x)}-${Math.round(region.y)}-${Math.round(region.w)}-${Math.round(region.h)}`);
  if (size) parts.push(`${Math.round(size.width)}x${Math.round(size.height)}`);
  return `${parts.join('_')}.${ext.replace(/^\./, '') || 'bin'}`;
};

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/tiff': 'tif',
  'image/jp2': 'jp2',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
};

/** The file extension from a media type, else from the last part of the URL path, else `fallback`. */
export const extensionOf = (url: string, format?: string, fallback = 'bin'): string => {
  const byType = format ? EXT_BY_TYPE[format.split(';')[0].trim().toLowerCase()] : undefined;
  if (byType) return byType;
  const path = url.split(/[?#]/)[0];
  const m = /\.([a-z0-9]{2,5})$/i.exec(path.slice(path.lastIndexOf('/') + 1));
  return m ? m[1].toLowerCase() : fallback;
};

/**
 * Whether the file is fetched with the reader's cookies. Only for an image the Auth 2.0 access service let in (its cookie
 * decides), and cross-origin that needs a server that allows credentials; everything else goes without cookies.
 */
export const fetchCredentialsOf = (probe: { access: unknown[] } | undefined, allowed: boolean): 'include' | 'omit' =>
  probe && probe.access.length > 0 && allowed ? 'include' : 'omit';
