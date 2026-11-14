'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  aboutOf,
  canvasImagesOf,
  imageInfoUrl,
  isLayerVisible,
  labelIn,
  layerItemsOf,
  orderLayers,
  parseImageInfo,
  rawCanvasOf,
  safeAboutUrl,
  type ImageInfo,
  type ImageLayer,
  type LayerItem,
  type MediaKind,
} from '../../core';
import {
  canCutRegion,
  downloadFileName,
  downloadSizesOf,
  extensionOf,
  isPlainLayer,
  regionSize,
  visibleDownloadRegion,
  type DownloadRegion,
} from '../../core/features/_download';
import { layerOrderAtom, layerSettingsAtom, manifestAtom } from '../atoms';
import { useLocale, useTranslations, type Translator } from '../env';
import { viewReaderAtom } from '../inference/viewState';
import type { Panel, PanelContext } from './types';

// Save what the shown page holds: an image (the whole, or the part on screen, at a chosen size, through the IIIF Image
// API when the image has a service), or the media file of a video, audio or 3D model. What is offered comes from
// core/features/download.ts, which only gives URLs the image server promises to serve.

const BUTTON =
  'px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent';
const PRIMARY =
  'px-3 py-1.5 rounded text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600';
const LINK = 'text-blue-600 dark:text-blue-400 hover:underline break-words';

function CopyButton({ url, t }: { url: string; t: Translator }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state !== 'copied') return;
    const id = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <>
      <button type="button" className={BUTTON} onClick={copy}>
        {state === 'copied' ? t('copied') : t('copy')}
      </button>
      {state === 'failed' && <span className="basis-full text-xs text-amber-700 dark:text-amber-400">{t('copyFailed')}</span>}
    </>
  );
}

// The download button, the address of the file (to copy), and what happened. The file is fetched here and saved under a
// readable name; when the browser may not read it (the server does not allow it, or needs a login), the address is
// opened in a new tab instead, and the reader is told.
function DownloadAction({ url, fileName, t }: { url: string; fileName: string; t: Translator }) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'tab'>('idle');
  const save = async () => {
    setState('busy');
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setState('saved');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
      setState('tab');
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} onClick={save} disabled={state === 'busy'} data-testid="download-save">
          {state === 'busy' ? t('saving') : t('save')}
        </button>
      </div>
      <div role="status" aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
        {state === 'saved' && t('saved', { name: fileName })}
        {state === 'tab' && (
          <span className="text-amber-700 dark:text-amber-400">
            {t('openedInTab')}{' '}
            <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>
              {url}
            </a>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400" htmlFor="download-url">
          {t('url')}
        </label>
        <input
          id="download-url"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1.5 py-0.5 text-xs"
          data-testid="download-url"
        />
        <CopyButton url={url} t={t} />
      </div>
    </div>
  );
}

const Heading = ({ children }: { children: string }) => (
  <div className="text-sm text-gray-500 dark:text-gray-400">{children}</div>
);

type InfoState = { status: 'loading' } | { status: 'failed' } | { status: 'ok'; info: ImageInfo };

// One image: whole or visible area, and a size.
function ImageDownload({
  layer,
  containerId,
  canvas,
  name,
  t,
}: {
  layer: ImageLayer;
  containerId: string;
  canvas: { width?: number; height?: number };
  name: string;
  t: Translator;
}) {
  const service = layer.service;
  const plain = isPlainLayer(layer);
  const useService = !!service && plain;
  const [info, setInfo] = useState<InfoState>({ status: 'loading' });
  const [mode, setMode] = useState<'full' | 'view'>('full');
  const [view, setView] = useState<DownloadRegion | 'missed' | null>(null);
  const [sizeId, setSizeId] = useState('max');
  const reader = useAtomValue(viewReaderAtom);
  const liveReader = reader?.canvasId === containerId ? reader : null;

  useEffect(() => {
    if (!useService || !service) return;
    const ac = new AbortController();
    fetch(imageInfoUrl(service), { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        const parsed = parseImageInfo(json);
        setInfo(parsed ? { status: 'ok', info: parsed } : { status: 'failed' });
      })
      .catch(() => {
        if (!ac.signal.aborted) setInfo({ status: 'failed' });
      });
    return () => ac.abort();
  }, [service, useService]);

  const okInfo = info.status === 'ok' ? info.info : null;
  const cut = okInfo ? canCutRegion(okInfo) : false;

  const readView = () => {
    if (!okInfo || !liveReader) return;
    const region = visibleDownloadRegion(liveReader.read(), layer, canvas, okInfo);
    setView(region ?? 'missed');
    setSizeId('max');
  };

  const region: DownloadRegion | null = mode === 'full' ? 'full' : view && view !== 'missed' ? view : null;
  const sizes = useMemo(
    () => (useService && service && okInfo && region ? downloadSizesOf(service, okInfo, region) : []),
    [useService, service, okInfo, region],
  );
  const picked = sizes.find((s) => s.id === sizeId) ?? sizes[sizes.length - 1];

  // Without a usable service (or without its information): the image file the manifest links
  if (!useService || info.status === 'failed') {
    return (
      <div className="space-y-2">
        {service && !plain && <p className="text-xs text-gray-600 dark:text-gray-300">{t('plainOnly')}</p>}
        {service && plain && <p className="text-xs text-gray-600 dark:text-gray-300">{t('infoFailed')}</p>}
        <Heading>{t('imageFile')}</Heading>
        <DownloadAction key={layer.url} url={layer.url} fileName={downloadFileName(name, undefined, undefined, extensionOf(layer.url, undefined, 'jpg'))} t={t} />
      </div>
    );
  }
  if (!okInfo) return <p className="text-xs text-gray-500">{t('loadingInfo')}</p>;

  const area = region ? regionSize(region, okInfo) : null;
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="text-sm text-gray-500 dark:text-gray-400">{t('area')}</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="download-area"
            checked={mode === 'full'}
            onChange={() => {
              setMode('full');
              setSizeId('max');
            }}
          />
          {t('whole')}
        </label>
        <label className={`flex items-center gap-2 ${!cut || !liveReader ? 'opacity-50' : ''}`}>
          <input
            type="radio"
            name="download-area"
            checked={mode === 'view'}
            disabled={!cut || !liveReader}
            onChange={() => {
              setMode('view');
              readView();
            }}
          />
          {t('visible')}
        </label>
        {!cut && <p className="text-xs text-gray-600 dark:text-gray-300">{t('noCrop')}</p>}
        {mode === 'view' && (
          <div className="space-y-1 pl-6">
            {view === 'missed' && <p className="text-xs text-amber-700 dark:text-amber-400">{t('viewMissed')}</p>}
            {area && <p className="text-xs text-gray-600 dark:text-gray-300">{t('areaPixels', { w: Math.round(area.width), h: Math.round(area.height) })}</p>}
            <button type="button" className={BUTTON} onClick={readView}>
              {t('reread')}
            </button>
          </div>
        )}
      </fieldset>

      {sizes.length > 0 && picked && region && (
        <>
          <fieldset className="space-y-1">
            <legend className="text-sm text-gray-500 dark:text-gray-400">{t('size')}</legend>
            {sizes.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="radio" name="download-size" checked={s.id === picked.id} onChange={() => setSizeId(s.id)} />
                <span>{t('sizeOption', { w: s.width, h: s.height })}</span>
                {s.max && <span className="text-xs text-gray-500 dark:text-gray-400">{t('sizeMax')}</span>}
              </label>
            ))}
          </fieldset>
          <DownloadAction
            key={picked.url}
            url={picked.url}
            fileName={downloadFileName(name, region, picked, 'jpg')}
            t={t}
          />
        </>
      )}
    </div>
  );
}

const MEDIA_LABEL: Record<MediaKind, string> = { Image: 'imageFile', Video: 'video', Audio: 'audio', Model: 'model' };

function DownloadTab({ container, manifest }: PanelContext) {
  const t = useTranslations('Download');
  const locale = useLocale();
  const fromAtom = useAtomValue(manifestAtom);
  const m = manifest ?? fromAtom;
  const settings = useAtomValue(layerSettingsAtom);
  const order = useAtomValue(layerOrderAtom)[container?.id ?? ''];
  const [layerId, setLayerId] = useState<string | null>(null);

  const images = useMemo(
    () => (container?.kind === 'Canvas' ? canvasImagesOf(rawCanvasOf(m, container.id)) : null),
    [m, container],
  );
  const items = useMemo(() => layerItemsOf(images?.paintings ?? []), [images]);
  // The layers on screen now, the one in front first (all of them when none is shown)
  const candidates: LayerItem[] = useMemo(() => {
    const shown = orderLayers(items, order).filter((it) => isLayerVisible(it, settings)).reverse();
    return shown.length > 0 ? shown : items;
  }, [items, order, settings]);
  const current = candidates.find((it) => it.id === layerId) ?? candidates[0];

  const about = useMemo(() => aboutOf(m, container?.id, locale), [m, container?.id, locale]);
  if (!container) return null;
  const scope = about?.container;
  const statement = scope?.requiredStatement ?? about?.manifest.requiredStatement;
  const rights = scope?.rights ?? about?.manifest.rights;
  const rightsHref = rights ? safeAboutUrl(rights.url) : '';

  const containerName = labelIn(container.label, locale) || labelIn(m?.label, locale) || 'image';
  const layerName = (it: LayerItem) => labelIn(it.label, locale) || t('layerN', { n: items.indexOf(it) + 1 });
  const media = container.painting.flatMap((p) =>
    p.options.filter((o) => o.kind !== 'Image').map((o) => ({ o, label: labelIn(o.label, locale) || labelIn(p.label, locale) })),
  );

  if (!current && media.length === 0) return <div className="p-3 text-sm text-gray-500">{t('nothing')}</div>;

  return (
    <div className="p-3 space-y-4 text-sm">
      <p className="text-xs text-gray-600 dark:text-gray-300">{t('hint')}</p>

      {current && images && (
        <section className="space-y-3">
          {candidates.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">{t('layer')}</span>
              <select
                className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1.5 py-1"
                value={current.id}
                onChange={(e) => setLayerId(e.target.value)}
              >
                {candidates.map((it) => (
                  <option key={it.id} value={it.id}>
                    {layerName(it)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ImageDownload
            key={`${container.id}|${current.id}`}
            layer={current.layer}
            containerId={container.id}
            canvas={{ width: images.width, height: images.height }}
            name={candidates.length > 1 ? `${containerName}_${layerName(current)}` : containerName}
            t={t}
          />
        </section>
      )}

      {media.map(({ o, label }, i) => (
        <section key={`${o.url}|${i}`} className="space-y-1.5">
          <Heading>{label ? `${t(MEDIA_LABEL[o.kind])}: ${label}` : t(MEDIA_LABEL[o.kind])}</Heading>
          <DownloadAction url={o.url} fileName={downloadFileName(label || containerName, undefined, undefined, extensionOf(o.url, o.format))} t={t} />
        </section>
      ))}

      {(statement || rights) && (
        <section className="space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2 text-xs text-gray-600 dark:text-gray-300">
          {statement && (
            <div>
              {statement.label && <span className="font-medium">{statement.label}: </span>}
              {statement.values.join(' ')}
            </div>
          )}
          {rights && (
            <div>
              <span className="font-medium">{t('rights')}: </span>
              {rightsHref ? (
                <a href={rightsHref} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {rights.label}
                </a>
              ) : (
                rights.label
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export const downloadPanel: Panel = {
  id: 'download',
  order: 105,
  available: ({ container }) => !!container && container.painting.some((p) => p.options.some((o) => !!o.url)),
  Component: (ctx) => <DownloadTab {...ctx} />,
};
