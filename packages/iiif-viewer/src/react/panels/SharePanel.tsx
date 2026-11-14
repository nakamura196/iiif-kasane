'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { ContainerInfo, ImageRegion } from '../../core';
import { contentStateJson, dragLink, encodeShareState, viewerLinkWith } from '../../core/features/_share';
import { useTranslations } from '../env';
import { viewReaderAtom } from '../inference/viewState';
import { usePlayback } from '../playback';
import type { Panel, PanelContext } from './types';

// Share "this page, this area, this time": the IIIF Content State (JSON and encoded), a link to this viewer,
// and a link to drag into another IIIF viewer. The building is in core/features/_share.ts.

const BUTTON =
  'px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent';
const AREA =
  'w-full rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-2 py-1 font-mono text-xs text-[var(--ds-fg)]';

const hasMedia = (c: ContainerInfo, kinds: string[]): boolean =>
  c.painting.some((p) => p.options.some((o) => kinds.includes(o.kind)));

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('Share');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Do nothing where the clipboard is unavailable
    }
  };
  return (
    <button type="button" className={BUTTON} onClick={copy} aria-label={label}>
      {copied ? t('copied') : t('copy')}
    </button>
  );
}

function ShareTab({ container, shown }: PanelContext) {
  const t = useTranslations('Share');
  const uid = useId();
  const playback = usePlayback();
  const viewReader = useAtomValue(viewReaderAtom);
  const [withPage, setWithPage] = useState(true);
  const [withRegion, setWithRegion] = useState(false);
  const [withTime, setWithTime] = useState(false);
  const [region, setRegion] = useState<ImageRegion | null>(null);

  const canvasId = container?.id;
  const isImage = !!container && container.kind === 'Canvas' && hasMedia(container, ['Image']);
  const isTimed = !!container && (container.kind === 'Timeline' || hasMedia(container, ['Video', 'Audio']));
  const reader = viewReader && viewReader.canvasId === canvasId ? viewReader : null;

  // The visible area is read from the image while the box is checked. It changes as the reader pans and zooms.
  const reading = withPage && withRegion && isImage && !!reader;
  useEffect(() => {
    if (!reading || !reader) return;
    const read = () => {
      const r = reader.read();
      setRegion((old) => (old && old.x === r.x && old.y === r.y && old.w === r.w && old.h === r.h ? old : r));
    };
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, [reading, reader]);

  const manifestUrl = shown?.url;
  const json = useMemo(
    () =>
      manifestUrl
        ? contentStateJson({
            manifestUrl,
            canvasId: withPage ? canvasId : undefined,
            region: withPage && withRegion && isImage && reader && region ? region : undefined,
            time: withPage && withTime && isTimed ? playback.currentTime : undefined,
          })
        : '',
    [manifestUrl, canvasId, withPage, withRegion, withTime, isImage, isTimed, reader, region, playback.currentTime],
  );
  if (!manifestUrl || !container) return <div className="p-4 text-sm text-[var(--ds-fg)]">{t('unavailable')}</div>;

  const encoded = encodeShareState(json);
  const viewerLink = typeof window === 'undefined' ? null : viewerLinkWith(window.location.href, encoded);
  const drag = dragLink(manifestUrl, encoded);

  const check = (id: string, checked: boolean, set: (v: boolean) => void, label: string, disabled = false) => (
    <label className="flex items-center gap-2 text-sm" htmlFor={`${uid}-${id}`}>
      <input id={`${uid}-${id}`} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="p-3 space-y-3 text-[var(--ds-fg)]" data-testid="share-panel">
      <p className="text-xs">{t('hint')}</p>
      <div className="space-y-1.5">
        {check('page', withPage, setWithPage, t('includePage'))}
        {isImage && check('region', withRegion, setWithRegion, t('includeRegion'), !withPage || !reader)}
        {isTimed && check('time', withTime, setWithTime, t('includeTime', { time: playback.currentTime.toFixed(1) }), !withPage)}
      </div>

      <section className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${uid}-json`} className="text-xs font-semibold">
            {t('jsonLabel')}
          </label>
          <CopyButton text={json} label={t('copyJson')} />
        </div>
        <textarea id={`${uid}-json`} readOnly wrap="off" rows={10} value={json} className={AREA} onFocus={(e) => e.currentTarget.select()} />
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${uid}-encoded`} className="text-xs font-semibold">
            {t('encodedLabel')}
          </label>
          <CopyButton text={encoded} label={t('copyEncoded')} />
        </div>
        <textarea id={`${uid}-encoded`} readOnly rows={3} value={encoded} className={`${AREA} break-all`} onFocus={(e) => e.currentTarget.select()} />
      </section>

      <section className="flex flex-wrap items-center gap-2">
        {viewerLink && (
          <>
            <span className="text-xs font-semibold">{t('viewerLink')}</span>
            <CopyButton text={viewerLink} label={t('copyViewerLink')} />
          </>
        )}
      </section>

      <section className="space-y-1">
        <div className="text-xs font-semibold">{t('dragLabel')}</div>
        <a
          href={drag}
          draggable
          title={t('dragHint')}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/uri-list', drag);
            e.dataTransfer.setData('text/plain', drag);
            e.dataTransfer.effectAllowed = 'copyLink';
          }}
          onClick={(e) => e.preventDefault()}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--ds-border)] px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab"
          data-testid="share-drag"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <rect x="2" y="2" width="3" height="12" rx="1" />
            <rect x="6.5" y="2" width="3" height="12" rx="1" />
            <rect x="11" y="2" width="3" height="12" rx="1" />
          </svg>
          <span>{t('dragIcon')}</span>
        </a>
        <p className="text-xs">{t('dragHint')}</p>
      </section>
    </div>
  );
}

export const sharePanel: Panel = {
  id: 'share',

  order: 120,
  available: ({ container, shown }) => !!container && !!shown?.url,
  Component: ShareTab,
};
