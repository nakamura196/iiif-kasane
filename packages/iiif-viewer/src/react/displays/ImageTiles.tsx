'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  probeServiceOf,
  substituteLayer,
  type AuthProbeRef,
  canvasRectToLayer,
  imageInfoUrl,
  imageRequestUrl,
  intersect,
  parseImageInfo,
  placementOf,
  resolveRegion,
  singleImageUrl,
  tileSchemeOf,
  tilesForView,
  type ImageInfo,
  type ImageLayer,
  type ImageServiceRef,
  type ImageRegion,
} from '../../core';
import { useAuth } from '../auth/authStore';
import { useLocale, useTranslations } from '../env';
import { rotatePoint, type StageInfo } from './ImageView';

// Image API の深いズーム。info.json から「どの大きさの画像を、どの範囲だけ」取るかを決め、
// 見えている範囲のタイルだけを <img> で並べる（依存なし・CSS の位置指定だけ）。

interface LoadedInfo {
  info: ImageInfo | null;
  json: unknown;
}

// Keyed by URL and login epoch: after a login the info.json is fetched again.
const infoCache = new Map<string, Promise<LoadedInfo>>();

// info.json goes without cookies: servers with Auth 2.0 answer it with CORS `*` (refused with cookies),
// and some answer 401 with the full info.json in the body (Wellcome Collection), so that body is used too.
// The tiles are <img> and carry the cookies the access service set.
const loadInfo = (service: ImageServiceRef, withAuth: boolean, epoch: number): Promise<LoadedInfo> => {
  const url = imageInfoUrl(service);
  const key = `${url}#${withAuth ? epoch : 0}${withAuth ? 'c' : ''}`;
  let p = infoCache.get(key);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok || (withAuth && r.status === 401) ? r.json() : null))
      .then((json) => ({ info: parseImageInfo(json), json }))
      .catch(() => ({ info: null, json: null }));
    infoCache.set(key, p);
  }
  return p;
};

type InfoState = { status: 'none' | 'loading' | 'error' } | { status: 'ready'; info: ImageInfo; json: unknown };

function useImageInfo(service: ImageServiceRef | undefined, withAuth: boolean, epoch: number): InfoState {
  const key = service ? `${imageInfoUrl(service)}#${withAuth ? epoch : 0}${withAuth ? 'c' : ''}` : null;
  const [res, setRes] = useState<{ key: string; info: ImageInfo | null; json: unknown } | null>(null);
  useEffect(() => {
    if (!service || !key) return;
    let cancelled = false;
    loadInfo(service, withAuth, epoch).then((r) => {
      if (!cancelled) setRes({ key, ...r });
    });
    return () => {
      cancelled = true;
    };
    // `service` is identified by its info.json URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return { status: 'none' };
  // keep drawing the previous info while a reload is under way
  if (res?.key !== key) return res?.info ? { status: 'ready', info: res.info, json: res.json } : { status: 'loading' };
  return res.info ? { status: 'ready', info: res.info, json: res.json } : { status: 'error' };
}

// A cache-busting query for the images fetched again after a login (they may have come back degraded before).
const bust = (url: string, epoch: number) => (epoch > 0 ? `${url}${url.includes('?') ? '&' : '?'}_auth=${epoch}` : url);

const pct = (v: number) => `${v * 100}%`;

/**
 * One painted image, placed on the Canvas (its target, or the whole Canvas), turned by its rotation.
 * With an Image API service the sharpest tiles for the view are drawn over a small base image.
 */
export default function ImageLayerView({
  layer: given,
  canvasWidth,
  canvasHeight,
  stage,
  opacity = 1,
  onFailed,
  onLoaded,
}: {
  layer: ImageLayer;
  canvasWidth: number;
  canvasHeight: number;
  stage: StageInfo;
  /** 0 to 1 (the Layers tab). */
  opacity?: number;
  onFailed?: () => void;
  /** The image (the base image or one of its tiles) was read: clears an earlier failure, e.g. before signing in. */
  onLoaded?: () => void;
}) {
  const t = useTranslations('Viewer');
  const locale = useLocale();
  // the probe the manifest declares; an info.json may declare one too (read once its first fetch is back)
  const [infoProbe, setInfoProbe] = useState<AuthProbeRef | undefined>();
  const probe = given.auth ?? infoProbe;
  const auth = useAuth(probe, locale);
  const epoch = auth?.state.epoch ?? 0;
  // the probe's `location` (status 30x) replaces the image; its `substitute` (status 401, e.g. a
  // degraded copy) stands in for it until the user is let in
  const allowed = auth?.state.phase === 'ok';
  const location = allowed ? auth?.state.location : auth?.state.substitute;
  const layer = useMemo(() => (location ? substituteLayer(given, location) : given), [given, location]);
  const state = useImageInfo(layer.service, !!probe, epoch);
  const infoJson = state.status === 'ready' ? state.json : undefined;
  useEffect(() => {
    // (not from a substitute's info.json: it is another resource, usually without a probe)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!given.auth && infoJson && !location) setInfoProbe(probeServiceOf(infoJson, locale));
  }, [given.auth, infoJson, locale, location]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // the base image whose `full` request failed and is asked again as pixels (see below)
  const [retriedBase, setRetriedBase] = useState<string | null>(null);
  const hidden = !!auth && !allowed && !location;

  if (state.status === 'loading') {
    return (
      <div className="absolute inset-0 grid place-items-center text-sm text-[var(--ds-fg)]">{t('imageLoading')}</div>
    );
  }

  const info = state.status === 'ready' ? state.info : null;
  const srcW = info?.width ?? layer.width;
  const srcH = info?.height ?? layer.height;
  const target: ImageRegion = layer.target ?? { x: 0, y: 0, w: canvasWidth, h: canvasHeight };

  // the shown part of the source image, and where it sits on the Canvas
  const quarter = layer.rotation % 180 !== 0;
  const region: ImageRegion =
    srcW && srcH
      ? resolveRegion(layer.regionSpec, srcW, srcH)
      : { x: 0, y: 0, w: quarter ? target.h : target.w, h: quarter ? target.w : target.h };
  const place = placementOf(region, target, layer.rotation, layer.mirror);
  const placedW = place.rw * place.k;
  const placedH = place.rh * place.k;

  const turn = `${layer.rotation ? `rotate(${layer.rotation}deg)` : ''}${layer.mirror ? ' scaleX(-1)' : ''}`.trim();
  const frame = {
    position: 'absolute' as const,
    left: pct((place.cx - placedW / 2) / canvasWidth),
    top: pct((place.cy - placedH / 2) / canvasHeight),
    width: pct(placedW / canvasWidth),
    height: pct(placedH / canvasHeight),
    overflow: 'hidden' as const,
    ...(opacity < 1 ? { opacity } : {}),
    ...(turn ? { transform: turn, transformOrigin: 'center center' } : {}),
    // not allowed yet (or still asking): some servers send the image anyway (Wellcome's content
    // advisory), so blur it until the user agrees, as the server's own viewer hides it
    ...(hidden ? { filter: 'blur(24px)' } : {}),
  };

  // no usable service: the image as the manifest gives it
  if (!info || !layer.service) {
    const own = bust(layer.url, epoch);
    if (failedUrl === own) return null;
    return (
      <div style={frame} data-auth-blurred={hidden || undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bust(layer.url, epoch)}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full"
          onLoad={onLoaded}
          onError={() => {
            setFailedUrl(own);
            onFailed?.();
          }}
        />
      </div>
    );
  }

  const service = layer.service;
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const screenPerCanvas = (stage.stageW / canvasWidth) * stage.scale;
  const screenPerSource = screenPerCanvas * place.k * dpr;
  const fullRegion = region.x === 0 && region.y === 0 && region.w === info.width && region.h === info.height;

  // the base image: the whole shown region, small
  const baseWidth = Math.min(region.w, Math.max(256, Math.ceil(region.w * place.k * (stage.stageW / canvasWidth) * dpr)), 1024);
  const fullBase = fullRegion ? singleImageUrl(service, info, baseWidth) : null;
  // Some servers (e.g. the National Archives of Japan) answer 403 to the keyword `full` but serve the
  // same area given as pixels. When the `full` base image fails, ask once more with the explicit region.
  const retrying = fullBase !== null && retriedBase === fullBase;
  const base = fullBase === null
    ? imageRequestUrl(service, region, baseWidth)
    : retrying
      ? imageRequestUrl(service, { x: 0, y: 0, w: info.width, h: info.height }, baseWidth)
      : fullBase;

  // tiles for what is visible now
  let tiles: ReturnType<typeof tilesForView> = [];
  const scheme = tileSchemeOf(info);
  if (scheme && stage.boxW > 0 && stage.stageW > 0) {
    const toCanvas = canvasWidth / stage.stageW;
    // the box seen from the stage: its centre turned back, and the bounds of the turned box
    const seen = (v: { scale: number; tx: number; ty: number }) => {
      const [cx, cy] = rotatePoint(-v.tx / v.scale, -v.ty / v.scale, -(stage.rotation ?? 0));
      const r = ((stage.rotation ?? 0) * Math.PI) / 180;
      const c = Math.abs(Math.cos(r));
      const sn = Math.abs(Math.sin(r));
      const hw = (stage.boxW * c + stage.boxH * sn) / 2 / v.scale;
      const hh = (stage.boxW * sn + stage.boxH * c) / 2 / v.scale;
      return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
    };
    let { x0, x1, y0, y1 } = seen(stage);
    // While gliding sideways at about the same zoom (a slide along a scroll), also load what the glide
    // passes over, so that the picture does not turn blurry on the way. Not for long jumps (too many tiles).
    const from = stage.from;
    if (from && Math.abs(Math.log2(from.scale / stage.scale)) < 1) {
      const a = seen(from);
      const w = Math.max(x1, a.x1) - Math.min(x0, a.x0);
      const h = Math.max(y1, a.y1) - Math.min(y0, a.y0);
      if (w * h <= (x1 - x0) * (y1 - y0) * 4) {
        x0 = Math.min(x0, a.x0);
        x1 = Math.max(x1, a.x1);
        y0 = Math.min(y0, a.y0);
        y1 = Math.max(y1, a.y1);
      }
    }
    x0 += stage.stageW / 2;
    x1 += stage.stageW / 2;
    y0 += stage.stageH / 2;
    y1 += stage.stageH / 2;
    const visibleCanvas: ImageRegion = { x: x0 * toCanvas, y: y0 * toCanvas, w: (x1 - x0) * toCanvas, h: (y1 - y0) * toCanvas };
    const local = canvasRectToLayer(place, visibleCanvas);
    const visible = intersect({ x: local.x + region.x, y: local.y + region.y, w: local.w, h: local.h }, region);
    if (visible) {
      tiles = tilesForView(service, info, scheme, screenPerSource, visible);
    }
  }

  return (
    <div style={frame} data-auth-blurred={hidden || undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bust(base, epoch)}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full"
        onLoad={onLoaded}
        onError={() => {
          if (fullBase !== null && !retrying) setRetriedBase(fullBase);
          else if (failedUrl !== base) onFailed?.();
        }}
      />
      {tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${tile.key}:${epoch}`}
          src={bust(tile.url, epoch)}
          alt=""
          draggable={false}
          className="absolute"
          style={{
            left: pct((tile.x - region.x) / region.w),
            top: pct((tile.y - region.y) / region.h),
            width: pct(tile.w / region.w),
            height: pct(tile.h / region.h),
          }}
          // a tile drawn means the image is there, even if the small base image failed
          onLoad={onLoaded}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ))}
    </div>
  );
}

/** The images of a Canvas, drawn in painting order. `onBaseFailed`: the first (bottom) image could not be read. */
export function ImageLayers({
  layers,
  canvasWidth,
  canvasHeight,
  stage,
  onBaseFailed,
}: {
  layers: ImageLayer[];
  canvasWidth: number;
  canvasHeight: number;
  stage: StageInfo;
  onBaseFailed?: () => void;
}) {
  return layers.map((l, i) => (
    <ImageLayerView
      key={`${i}:${l.url}`}
      layer={l}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
      stage={stage}
      onFailed={i === 0 ? onBaseFailed : undefined}
    />
  ));
}
