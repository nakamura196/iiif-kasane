'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  aboutOf,
  canvasImagesOf,
  isLayerVisible,
  labelIn,
  layerItemsOf,
  orderLayers,
  probeServiceOf,
  rawCanvasOf,
  safeAboutUrl,
  substituteLayer,
  type AuthProbeRef,
  type ImageLayer,
  type LayerItem,
  type MediaKind,
} from '../../core';
import {
  canCutRegion,
  downloadFileName,
  downloadSizesOf,
  extensionOf,
  fetchCredentialsOf,
  isPlainLayer,
  regionSize,
  visibleDownloadRegion,
  type DownloadRegion,
} from '../../core/features/_download';
import { layerOrderAtom, layerSettingsAtom, manifestAtom } from '../atoms';
import { BUTTON } from '../common/buttonClasses';
import { CopyButton } from '../common/CopyButton';
import { useAuth } from '../auth/authStore';
import { useImageInfo } from '../displays/ImageTiles';
import { useLocale, useTranslations, type Translator } from '../env';
import { viewReaderAtom } from '../inference/viewState';
import { MetadataList } from './SafeHtml';
import type { Panel, PanelContext } from './types';

// Save what the shown page holds: an image (the whole, or the part on screen, at a chosen size, through the IIIF Image
// API when the image has a service), or the media file of a video, audio or 3D model. What is offered comes from
// core/features/_download.ts, which only gives URLs the image server promises to serve.

const PRIMARY =
  'px-3 py-1.5 rounded text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600';
const LINK = 'text-blue-600 dark:text-blue-400 hover:underline break-words';

// The download button, the address of the file (to copy), and what happened. The file is fetched here and saved under a
// readable name. When that fails, nothing is opened for the reader (a window opened after the wait is blocked as a
// popup, and cannot be detected): the message says why, with a link the reader clicks to open the file in the browser.
type Failure = { status: number } | { network: true };

function DownloadAction({
  url,
  retryUrl,
  credentials,
  fileName,
  t,
}: {
  url: string;
  /** The same image with the whole image given as pixels, asked when the server refuses `url` (some refuse `full`). */
  retryUrl?: string;
  credentials: 'include' | 'omit';
  fileName: string;
  t: Translator;
}) {
  const urlId = useId();
  const [state, setState] = useState<{ phase: 'idle' | 'busy' | 'saved' } | { phase: 'failed'; failure: Failure }>({ phase: 'idle' });
  const save = async () => {
    setState({ phase: 'busy' });
    let blob: Blob;
    try {
      const ask = (u: string) => fetch(u, { mode: 'cors', credentials });
      let res = await ask(url);
      if (!res.ok && retryUrl && retryUrl !== url) res = await ask(retryUrl);
      if (!res.ok) {
        setState({ phase: 'failed', failure: { status: res.status } });
        return;
      }
      // the body can fail too (the connection drops half way): that is a failure, not a button stuck on "Downloading"
      blob = await res.blob();
    } catch {
      // no answer the page may read: the server does not allow it (CORS), or the network is down
      setState({ phase: 'failed', failure: { network: true } });
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    setState({ phase: 'saved' });
  };
  const failure = state.phase === 'failed' ? state.failure : null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} onClick={save} disabled={state.phase === 'busy'} data-testid="download-save">
          {state.phase === 'busy' ? t('saving') : t('save')}
        </button>
      </div>
      <div role="status" aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
        {state.phase === 'saved' && t('saved', { name: fileName })}
        {failure && (
          <span className="text-amber-700 dark:text-amber-400" data-testid="download-failed">
            {'network' in failure
              ? t('failedNetwork')
              : failure.status === 401 || failure.status === 403
                ? t('failedAccess', { status: failure.status })
                : t('failedHttp', { status: failure.status })}{' '}
            <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>
              {t('openFile')}
            </a>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400" htmlFor={urlId}>
          {t('url')}
        </label>
        <input
          id={urlId}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1.5 py-0.5 text-xs"
          data-testid="download-url"
        />
        <CopyButton text={url} />
      </div>
    </div>
  );
}

const Heading = ({ children }: { children: string }) => (
  <div className="text-sm text-gray-500 dark:text-gray-400">{children}</div>
);

// One image: whole or visible area, and a size.
function ImageDownload({
  layer: given,
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
  const [mode, setMode] = useState<'full' | 'view'>('full');
  const [view, setView] = useState<DownloadRegion | 'missed' | null>(null);
  const [sizeId, setSizeId] = useState('max');
  const groupId = useId();
  const reader = useAtomValue(viewReaderAtom);
  const liveReader = reader?.canvasId === containerId ? reader : null;

  // The same resolution the display makes (ImageTiles): the probe is the manifest's, else the one the info.json declares;
  // once allowed, the probe's `location` replaces the image; until then its `substitute` (a degraded copy) stands in.
  const locale = useLocale();
  const [infoProbe, setInfoProbe] = useState<AuthProbeRef | undefined>();
  const probe = given.auth ?? infoProbe;
  const auth = useAuth(probe, locale);
  const epoch = auth?.state.epoch ?? 0;
  const allowed = auth?.state.phase === 'ok';
  const location = allowed ? auth?.state.location : auth?.state.substitute;
  const layer = useMemo(() => (location ? substituteLayer(given, location) : given), [given, location]);
  const degraded = !!auth && !allowed && !!location;
  const locked = !!auth && !allowed && !location;
  const service = layer.service;
  const plain = isPlainLayer(layer);
  // Locked: nothing of the protected original is offered
  const useService = !!service && plain && !locked;
  // The image information comes from the display's loader (shared cache), which also reads the 401-with-body answer of
  // Auth 2.0 servers.
  const info = useImageInfo(useService ? service : undefined, !!probe, epoch);
  const infoJson = info.status === 'ready' ? info.json : undefined;
  useEffect(() => {
    // not from a substitute's info.json: it is another resource, usually without a probe
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!given.auth && infoJson && !location) setInfoProbe(probeServiceOf(infoJson, locale));
  }, [given.auth, infoJson, location, locale]);
  const credentials = fetchCredentialsOf(probe, allowed);
  const okInfo = info.status === 'ready' ? info.info : null;
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

  // Nothing of the protected original while access is not granted
  if (locked) {
    return <p className="text-xs text-amber-700 dark:text-amber-400">{auth?.state.phase === 'probing' ? t('loadingInfo') : t('authLocked')}</p>;
  }
  // Without a usable service (or without its information), or a level 0 server that lists no size it may give (a limit
  // cuts the whole image, and a resize it does not have): the image file the manifest links
  const capped = !!okInfo && mode === 'full' && sizes.length === 0;
  if (!useService || info.status === 'error' || capped) {
    return (
      <div className="space-y-2">
        {degraded && <p className="text-xs text-amber-700 dark:text-amber-400">{t('degraded')}</p>}
        {capped && <p className="text-xs text-gray-600 dark:text-gray-300">{t('capped')}</p>}
        {service && !plain && <p className="text-xs text-gray-600 dark:text-gray-300">{t('plainOnly')}</p>}
        {service && plain && info.status === 'error' && <p className="text-xs text-gray-600 dark:text-gray-300">{t('infoFailed')}</p>}
        <Heading>{t('imageFile')}</Heading>
        <DownloadAction key={layer.url} url={layer.url} credentials={credentials} fileName={downloadFileName(name, undefined, undefined, extensionOf(layer.url, undefined, 'jpg'))} t={t} />
      </div>
    );
  }
  if (!okInfo) return <p className="text-xs text-gray-500">{t('loadingInfo')}</p>;

  const area = region ? regionSize(region, okInfo) : null;
  return (
    <div className="space-y-3">
      {degraded && <p className="text-xs text-amber-700 dark:text-amber-400">{t('degraded')}</p>}
      <fieldset className="space-y-1">
        <legend className="text-sm text-gray-500 dark:text-gray-400">{t('area')}</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`${groupId}-area`}
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
            name={`${groupId}-area`}
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
                <input type="radio" name={`${groupId}-size`} checked={s.id === picked.id} onChange={() => setSizeId(s.id)} />
                <span>{t('sizeOption', { w: s.width, h: s.height })}</span>
                {s.max && <span className="text-xs text-gray-500 dark:text-gray-400">{t('sizeMax')}</span>}
              </label>
            ))}
          </fieldset>
          <DownloadAction
            key={picked.url}
            url={picked.url}
            retryUrl={picked.retryUrl}
            credentials={credentials}
            fileName={downloadFileName(name, region, picked, 'jpg')}
            t={t}
          />
        </>
      )}
    </div>
  );
}

const MEDIA_LABEL: Record<MediaKind, string> = { Image: 'imageFile', Video: 'video', Audio: 'audio', Model: 'model' };

function DownloadTab({ container, manifest, shown }: PanelContext) {
  const t = useTranslations('Download');
  const locale = useLocale();
  const fromAtom = useAtomValue(manifestAtom);
  const m = manifest ?? fromAtom;
  const settings = useAtomValue(layerSettingsAtom);
  const order = useAtomValue(layerOrderAtom)[container?.id ?? ''];
  const [layerId, setLayerId] = useState<string | null>(null);

  // The images of the shown Canvas, read from the manifest as served (the same JSON the display reads), not from the
  // converted one and not from what the display last wrote, which may be another Canvas. Which of them are on screen
  // comes from the Layers settings.
  const raw = shown?.raw ?? m;
  const images = useMemo(() => (container?.kind === 'Canvas' ? canvasImagesOf(rawCanvasOf(raw, container.id)) : null), [raw, container]);
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

      {current && container && images && (
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
            canvas={{ width: container.width ?? images.width, height: container.height ?? images.height }}
            name={candidates.length > 1 ? `${containerName}_${layerName(current)}` : containerName}
            t={t}
          />
        </section>
      )}

      {media.map(({ o, label }, i) => (
        <section key={`${o.url}|${i}`} className="space-y-1.5">
          <Heading>{label ? `${t(MEDIA_LABEL[o.kind])}: ${label}` : t(MEDIA_LABEL[o.kind])}</Heading>
          <DownloadAction url={o.url} credentials="omit" fileName={downloadFileName(label || containerName, undefined, undefined, extensionOf(o.url, o.format))} t={t} />
        </section>
      ))}

      {(statement || rights) && (
        <section className="space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2 text-xs text-gray-600 dark:text-gray-300">
          {statement && (
            <div>
              {statement.label && <div className="font-medium">{statement.label}</div>}
              <MetadataList items={[{ ...statement, label: '' }]} />
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
