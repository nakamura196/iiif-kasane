'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Puzzle, canPlayPuzzle, type Panel, type PanelContext, type ShownManifest } from 'iiif-kasane';
import { Link } from '@/i18n/routing';
import { containersOf, contentParam } from 'iiif-kasane/core';
import { puzzleQuery } from '@/lib/puzzleLink';
import { OTHER_VIEWS_TAB } from '@/lib/viewerTabs';
import {
  GALLERY_LIMITS,
  GALLERY_LOOKS,
  GALLERY_MODES,
  GALLERY_QUALITIES,
  canOpenInGallery,
  galleryQuery,
  type GalleryLook,
  type GalleryMode,
  type GalleryQuality,
} from '@/lib/gallery';
import { BROWSE_LAYOUTS, browseQuery, canOpenInBrowse, type BrowseLayout } from '@/lib/browse';

// The "Other views" tab of the right panel: opens the shown item in Kasane's other pages (compare, map, 3D gallery).
// These were buttons at the bottom left of the viewer, moved to a tab because they covered pictures and video.
// Compare is offered only when the shown model or image has two or more candidates (a Choice).
// The gallery is opened after choosing the walk mode, interior, quality and count (all /gallery/ URL arguments).
// The puzzle was a tab of the viewer, moved here (it is not a reading tool). Unlike the others it opens in place,
// not on another page, so it is last.
// Every link and its visibility follow the manifest shown now: after an entry of a Collection is opened, that entry.

const BUTTON =
  'inline-block px-3 py-1.5 rounded text-sm text-white bg-blue-600 hover:bg-blue-700 no-underline';
const SELECT = 'rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1 py-0.5 text-xs';

/** When the compare page can take it: the index of the shown Canvas / Scene. null when it cannot. */
export type CompareTarget = { selectedIndex: number } | null;

interface Props {
  /** The iiif-content of the page; the links use the shown manifest's URL when the viewer knows it. */
  manifestUrl: string;
  compare: CompareTarget;
  /** The puzzle opened from a link (?puzzle=): the Canvas id and the number of pieces. */
  puzzle?: { canvasId: string; size: number } | null;
  /** The puzzle was closed (to remove the link's arguments). */
  onPuzzleClose?: () => void;
}

interface Targets {
  hasGeo: boolean;
  galleryOk: boolean;
  browseOk: boolean;
}

// what the shown manifest can be opened in; worked out once per shown manifest (georeferencing was found when it was shown)
const NONE: Targets = { hasGeo: false, galleryOk: false, browseOk: false };
const targetsCache = new WeakMap<ShownManifest, Targets>();
function targetsOf({ shown }: PanelContext): Targets {
  if (!shown) return NONE;
  let t = targetsCache.get(shown);
  if (!t) {
    t = { hasGeo: shown.hasGeo, galleryOk: canOpenInGallery(shown.raw), browseOk: canOpenInBrowse(shown.raw) };
    targetsCache.set(shown, t);
  }
  return t;
}

function OtherViews({
  manifestUrl: pageUrl,
  compare,
  puzzle,
  onPuzzleClose,
  ctx,
}: Props & { ctx: PanelContext }) {
  const t = useTranslations('OtherViews');
  const tb = useTranslations('Browse');
  // page indexes count in the shown manifest (the entry of a Collection, if one is open), so links use its URL
  const manifestUrl = ctx.shown?.url ?? pageUrl;
  const { hasGeo, galleryOk, browseOk } = targetsOf(ctx);
  const [browseLayout, setBrowseLayout] = useState<BrowseLayout>('table');
  const [mode, setMode] = useState<GalleryMode>('orbit');
  const [look, setLook] = useState<GalleryLook>('standard');
  const [quality, setQuality] = useState<GalleryQuality>('auto');
  const [limit, setLimit] = useState<number>(0);

  return (
    <div className="p-3 space-y-5 text-sm">
      {compare && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('compareHeading')}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">{t('compareHint')}</p>
          <Link
            href={`/compare?${contentParam(manifestUrl)}${compare.selectedIndex > 0 ? `&canvas=${compare.selectedIndex}` : ''}`}
            className={BUTTON}
          >
            {t('open')}
          </Link>
        </section>
      )}
      {hasGeo && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('mapHeading')}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">{t('mapHint')}</p>
          <Link href={`/georef?${contentParam(manifestUrl)}`} className={BUTTON}>
            {t('open')}
          </Link>
        </section>
      )}
      {browseOk && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('browseHeading')}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">{t('browseHint')}</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 text-xs">
            <label htmlFor="browse-layout">{t('layout')}</label>
            <select id="browse-layout" className={SELECT} value={browseLayout} onChange={(e) => setBrowseLayout(e.target.value as BrowseLayout)}>
              {BROWSE_LAYOUTS.map((l) => (
                <option key={l} value={l}>
                  {tb(`layouts.${l}`)}
                </option>
              ))}
            </select>
          </div>
          <Link href={`/browse?${browseQuery(manifestUrl, { layout: browseLayout })}`} className={BUTTON}>
            {t('view')}
          </Link>
        </section>
      )}
      {galleryOk && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('galleryHeading')}</h3>
          <p className="text-xs text-gray-600 dark:text-gray-300">{t('galleryHint')}</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
            <label htmlFor="gallery-mode">{t('mode')}</label>
            <select id="gallery-mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as GalleryMode)}>
              {GALLERY_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`modes.${m}`)}
                </option>
              ))}
            </select>
            <label htmlFor="gallery-look">{t('look')}</label>
            <select id="gallery-look" className={SELECT} value={look} onChange={(e) => setLook(e.target.value as GalleryLook)}>
              {GALLERY_LOOKS.map((l) => (
                <option key={l} value={l}>
                  {t(`looks.${l}`)}
                </option>
              ))}
            </select>
            <label htmlFor="gallery-quality">{t('quality')}</label>
            <select
              id="gallery-quality"
              className={SELECT}
              value={quality}
              onChange={(e) => setQuality(e.target.value as GalleryQuality)}
            >
              {GALLERY_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {t(`qualities.${q}`)}
                </option>
              ))}
            </select>
            <label htmlFor="gallery-limit">{t('limit')}</label>
            <select id="gallery-limit" className={SELECT} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={0}>{t('limitDefault')}</option>
              {GALLERY_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {t('limitOption', { n })}
                </option>
              ))}
            </select>
          </div>
          <Link href={`/gallery?${galleryQuery(manifestUrl, { mode, look, quality, limit })}`} className={BUTTON}>
            {t('view')}
          </Link>
        </section>
      )}
      {canPlayPuzzle(ctx) && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('puzzleHeading')}</h3>
          <Puzzle
            {...ctx}
            className="space-y-3"
            autoStart={puzzle && puzzle.canvasId === ctx.container?.id ? puzzle.size : undefined}
            shareUrl={(size) => puzzleShareUrl(manifestUrl, ctx, size)}
            onClose={onPuzzleClose}
          />
        </section>
      )}
    </div>
  );
}

// A link that opens the puzzle of the shown page, built on the URL of the page open now (/ja/viewer etc., with the locale)
const puzzleShareUrl = (manifestUrl: string, ctx: PanelContext, size: number) => {
  const index = Math.max(0, containersOf(ctx.manifest).findIndex((c) => c.id === ctx.container?.id));
  return `${window.location.origin}${window.location.pathname}?${puzzleQuery(manifestUrl, index, size)}`;
};

/** Shown when the item can go to the compare page, the map or the gallery, or the image can be a puzzle. */
export const otherViewsPanel = (props: Props, label: string): Panel => ({
  id: OTHER_VIEWS_TAB,
  // after the puzzle (110), rightmost
  order: 120,
  label,
  available: (ctx) => {
    const t = targetsOf(ctx);
    return !!props.compare || t.hasGeo || t.galleryOk || t.browseOk || canPlayPuzzle(ctx);
  },
  Component: (ctx) => <OtherViews {...props} ctx={ctx} />,
});
