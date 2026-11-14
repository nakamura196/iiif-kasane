'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { ContainerInfo, ImageRegion } from '../../core';
import {
  contentStateJson,
  dragLink,
  encodeShareState,
  shareManifestUrl,
  viewerLinkWith,
} from '../../core/features/_share';
import { BUTTON } from '../common/buttonClasses';
import { CopyButton } from '../common/CopyButton';
import { useTranslations } from '../env';
import { viewReaderAtom } from '../inference/viewState';
import { usePlayback, type Playback } from '../playback';
import type { Panel, PanelContext } from './types';

// Share "this page, this area, this time": the IIIF Content State (JSON and encoded), a link to this viewer,
// and a link to drag into another IIIF viewer. The building is in core/features/_share.ts.
// The area and the time are read when the reader asks (checks the box, presses the update button, copies, drags),
// not continuously, so the text does not change under the reader's hands.

const AREA =
  'w-full rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-2 py-1 font-mono text-xs text-[var(--ds-fg)]';

const hasMedia = (c: ContainerInfo, kinds: string[]): boolean =>
  c.painting.some((p) => p.options.some((o) => kinds.includes(o.kind)));

const pageUrl = (): string | undefined => (typeof window === 'undefined' ? undefined : window.location.href);

// Hands the newest playback to a ref. The playback changes about four times a second while a video plays; this part
// renders nothing, so only it re-renders and the tab (the text fields) does not.
function PlaybackProbe({ onPlayback }: { onPlayback: (p: Playback) => void }) {
  const playback = usePlayback();
  useEffect(() => {
    onPlayback(playback);
  });
  return null;
}

function Check({
  id,
  checked,
  disabled = false,
  label,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

interface InnerProps {
  container: ContainerInfo;
  manifestUrl: string;
}

// Kept per Canvas (the parent gives a key): turning the page forgets the area and the time of the old one.
function ShareInner({ container, manifestUrl }: InnerProps) {
  const t = useTranslations('Share');
  const uid = useId();
  const playbackRef = useRef<Playback | null>(null);
  const viewReader = useAtomValue(viewReaderAtom);
  const [withPage, setWithPage] = useState(true);
  const [withRegion, setWithRegion] = useState(false);
  const [withTime, setWithTime] = useState(false);
  const [region, setRegion] = useState<ImageRegion | null>(null);
  const [time, setTime] = useState<number | null>(null);

  const canvasId = container.id;
  const isImage = container.kind === 'Canvas' && hasMedia(container, ['Image']);
  const isTimed = container.kind === 'Timeline' || hasMedia(container, ['Video', 'Audio']);
  const reader = viewReader && viewReader.canvasId === canvasId ? viewReader : null;

  const readRegion = (): ImageRegion | null => {
    const r = reader ? reader.read() : null;
    setRegion(r);
    return r;
  };
  const readTime = (): number => {
    const p = playbackRef.current;
    const now = p?.mediaRef.current?.currentTime ?? p?.currentTime ?? 0;
    setTime(now);
    return now;
  };

  const build = (r: ImageRegion | null, tm: number | null) => {
    const json = contentStateJson({
      manifestUrl,
      canvasId: withPage ? canvasId : undefined,
      canvasType: container.kind,
      canvasSize: { w: container.width, h: container.height },
      region: withPage && withRegion && isImage && r ? r : undefined,
      time: withPage && withTime && isTimed && tm !== null ? tm : undefined,
    });
    const encoded = encodeShareState(json);
    return { json, encoded, drag: dragLink(manifestUrl, encoded), viewer: viewerLinkWith(pageUrl() ?? '', encoded) };
  };
  // What is shown uses the values read last. Copying and dragging read the newest ones first.
  const shownState = build(region, time);
  const freshState = () => build(withRegion ? readRegion() : region, withTime ? readTime() : time);

  return (
    <div className="p-3 space-y-3 text-[var(--ds-fg)]" data-testid="share-panel">
      {isTimed && <PlaybackProbe onPlayback={(p) => (playbackRef.current = p)} />}
      <p className="text-xs">{t('hint')}</p>
      <div className="space-y-1.5">
        <Check id={`${uid}-page`} checked={withPage} onChange={setWithPage} label={t('includePage')} />
        {isImage && (
          <div className="flex flex-wrap items-center gap-2">
            <Check
              id={`${uid}-region`}
              checked={withRegion}
              onChange={(v) => {
                setWithRegion(v);
                if (v) readRegion();
              }}
              label={t('includeRegion')}
              disabled={!withPage || !reader}
            />
            {withRegion && (
              <button type="button" className={BUTTON} onClick={readRegion}>
                {t('updateRegion')}
              </button>
            )}
          </div>
        )}
        {isTimed && (
          <div className="flex flex-wrap items-center gap-2">
            <Check
              id={`${uid}-time`}
              checked={withTime}
              onChange={(v) => {
                setWithTime(v);
                if (v) readTime();
              }}
              label={withTime && time !== null ? t('includeTime', { time: time.toFixed(1) }) : t('includeTimeNow')}
              disabled={!withPage}
            />
            {withTime && (
              <button type="button" className={BUTTON} onClick={readTime}>
                {t('updateTime')}
              </button>
            )}
          </div>
        )}
      </div>

      <section className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${uid}-json`} className="text-xs font-semibold">
            {t('jsonLabel')}
          </label>
          <CopyButton text={() => freshState().json} label={t('copyJson')} />
        </div>
        <textarea id={`${uid}-json`} readOnly wrap="off" rows={10} value={shownState.json} className={AREA} onFocus={(e) => e.currentTarget.select()} />
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${uid}-encoded`} className="text-xs font-semibold">
            {t('encodedLabel')}
          </label>
          <CopyButton text={() => freshState().encoded} label={t('copyEncoded')} />
        </div>
        <textarea id={`${uid}-encoded`} readOnly rows={3} value={shownState.encoded} className={`${AREA} break-all`} onFocus={(e) => e.currentTarget.select()} />
      </section>

      {shownState.viewer && (
        <section className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">{t('viewerLink')}</span>
          <CopyButton text={() => freshState().viewer ?? ''} label={t('copyViewerLink')} />
        </section>
      )}

      <section className="space-y-1">
        <div className="text-xs font-semibold">{t('dragLabel')}</div>
        <a
          href={shownState.drag}
          draggable
          title={t('dragHint')}
          onDragStart={(e) => {
            const link = freshState().drag;
            e.dataTransfer.setData('text/uri-list', link);
            e.dataTransfer.setData('text/plain', link);
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

function ShareTab({ container, shown }: PanelContext) {
  const t = useTranslations('Share');
  const manifestUrl = shown && container ? shareManifestUrl(shown, container.id, pageUrl()) : null;
  if (!container || !manifestUrl) return <div className="p-4 text-sm text-[var(--ds-fg)]">{t('unavailable')}</div>;
  return <ShareInner key={container.id} container={container} manifestUrl={manifestUrl} />;
}

export const sharePanel: Panel = {
  id: 'share',

  order: 120,
  // Not for a local image (blob:), a curation whose Canvas has no source manifest, or anything else other viewers cannot open
  available: ({ container, shown }) => !!container && !!shown && shareManifestUrl(shown, container.id, pageUrl()) !== null,
  Component: ShareTab,
};
