'use client';

import type { NextPage } from 'next';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Viewer, manifestUrlAtom, type InfoTab, type ViewerShown, type ViewerTarget } from 'iiif-kasane';
// Also show 3D Scenes (three.js and the rest load only when a 3D item is opened)
import 'iiif-kasane/scene';
import ManifestInput from '@/components/Input';
import ManifestParamWatcher from '@/components/ManifestParamWatcher';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { containersOf, convertToV4, fetchManifest, manifestFromParams } from 'iiif-kasane/core';
import { HIDDEN_VIEWER_TABS, OTHER_VIEWS_TAB, viewerTabOf } from '@/lib/viewerTabs';
import { puzzleFromParams } from '@/lib/puzzleLink';
import { PushedLocations, locationKey } from '@/lib/pushedLocations';
import { otherViewsPanel, type CompareTarget } from '@/components/OtherViewsPanel';
import { LocalImageError, filesFromDataTransfer, isLocalManifestUrl, openLocalImages } from '@/lib/localImage';

/** Whether a drag carries files (not text or a link, which the viewer handles itself). */
const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

// Only receives, from the place the viewer keeps at the bottom left (renderActions), whether the shown item can go
// to the compare page. It draws nothing. On a Canvas without candidates it is no longer rendered, and resets to null.
function CompareReport({ target, onChange }: { target: number | null; onChange: (c: CompareTarget) => void }) {
  useEffect(() => {
    onChange(target === null ? null : { selectedIndex: target });
    return () => onChange(null);
  }, [target, onChange]);
  return null;
}

// /viewer?iiif-content=...&tab=... (?manifest=... is read too): the viewer itself is the package's Viewer.
// This page only reads and writes the URL and holds the header, the footer and the input.
const ViewerContent: NextPage = () => {
  // The Header reads the same value (the download link etc.), so it is in the site's store
  const [manifestUrl, setManifestUrl] = useAtom(manifestUrlAtom);
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const to = useTranslations('OtherViews');
  // Whether the map, the gallery and the 3D browse can take the item is worked out in the "Other views" tab from the
  // manifest shown now (an entry of a Collection, once opened).
  // When the shown model or image has two or more candidates, the Canvas / Scene index for the compare page (the viewer reports it)
  const [compare, setCompare] = useState<CompareTarget>(null);
  // The puzzle opened by ?puzzle=<page>&grid=<pieces>. The page's Canvas id is known once the manifest is read
  const puzzleParam = searchParams?.get('puzzle') ?? null;
  const gridParam = searchParams?.get('grid') ?? null;
  const puzzleLink = useMemo(() => {
    const params = new URLSearchParams();
    if (puzzleParam !== null) params.set('puzzle', puzzleParam);
    if (gridParam !== null) params.set('grid', gridParam);
    return puzzleFromParams(params);
  }, [puzzleParam, gridParam]);
  const [canvasIds, setCanvasIds] = useState<string[]>([]);
  const puzzleCanvasId = puzzleLink ? canvasIds[puzzleLink.index] : undefined;
  const puzzle = useMemo(
    () => (puzzleLink && puzzleCanvasId ? { canvasId: puzzleCanvasId, size: puzzleLink.size } : null),
    [puzzleLink, puzzleCanvasId],
  );
  const puzzleTarget = useMemo<ViewerTarget | undefined>(
    () => (puzzleCanvasId ? { canvasId: puzzleCanvasId } : undefined),
    [puzzleCanvasId],
  );
  const tl = useTranslations('LocalImage');
  // Local images (opened only in this tab, not sent to a server)
  const isLocal = isLocalManifestUrl(manifestUrl);
  const [local, setLocal] = useState({ name: '', count: 0, skipped: 0 });
  const [fileError, setFileError] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const [dragging, setDragging] = useState(false);

  // Open local images. Not written to the address bar (a blob: URL cannot be read after a reload, nor shared).
  // The arguments of the item open before are removed, and the text reading (inference) tab is opened.
  // Several images are sorted by name into one manifest
  const openFiles = useCallback(
    async (files: File[]) => {
      setFileError('');
      try {
        const opened = await openLocalImages(files, (done, total) => {
          // not shown for a single image, which takes no time
          if (total > 1) setFileStatus(tl('reading', { done, total }));
        });
        setLocal({ name: opened.label, count: opened.count, skipped: opened.skipped.length });
        setManifestUrl(opened.manifestUrl);
        router.replace('?tab=inference');
      } catch (e) {
        setFileError(tl(e instanceof LocalImageError ? e.reason : 'decode'));
      } finally {
        setFileStatus('');
      }
    },
    [router, setManifestUrl, tl],
  );
  // Read when the page opens, and when a link on the entry screen changes the item in the URL
  // The Collections walked through to reach the item (?collection=, top first), kept with the item they belong to
  // so that no render pairs a new item with the old Collections (that would read the item again)
  // (first render: from the address, so that a client navigation to a deep link does not read the item without its Collections first)
  const [collections, setCollections] = useState<{ of: string | null; urls: string[] }>(() => ({
    of: manifestFromParams(new URLSearchParams(searchParams?.toString() ?? '')),
    urls: searchParams?.getAll('collection') ?? [],
  }));
  const readUrl = useCallback(
    (manifestParam: string | null, collectionParams: string[] = []) => {
      if (!manifestParam) return;
      setManifestUrl(manifestParam);
      setCollections({ of: manifestParam, urls: collectionParams });
    },
    [setManifestUrl],
  );
  const collection = collections.of === manifestUrl ? collections.urls : undefined;

  // The reader opened an entry of a Collection, or went back: write where that is into the address bar, so that
  // the link opens it (and the browser's Back returns to the place before). The arguments of the item left
  // (canvas, pos, puzzle, ...) are dropped; only the tab stays. The viewer takes the new URL over without reading again.
  const pushed = useRef(new PushedLocations());
  const selfBack = useRef(false);
  useEffect(() => {
    // the browser's own Back / Forward: keep the list of entries in step (our own Back is counted already)
    const onPop = () => {
      if (selfBack.current) {
        selfBack.current = false;
        return;
      }
      pushed.current.browsed(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const handleShownChange = useCallback(
    (shown: ViewerShown) => {
      if (shown.origin === 'content') return;
      const params = new URLSearchParams();
      params.set('iiif-content', shown.url);
      for (const c of shown.collections) params.append('collection', c);
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab) params.set('tab', tab);
      const next = `?${params.toString()}`;
      const here = window.location.search;
      if (locationKey(next) === locationKey(here)) return;
      if (shown.origin === 'back') {
        // The viewer's own Back. When the entry before is exactly that place, the history's Back goes there (no
        // new entry; the browser's Back then continues from there). Else the current entry is replaced:
        // pushing would grow the history and the browser's Back would walk forward through the places just left.
        if (pushed.current.takeIfPrevious(next)) {
          selfBack.current = true;
          window.setTimeout(() => (selfBack.current = false), 1000);
          router.back();
        } else router.replace(next);
        return;
      }
      pushed.current.push(here);
      router.push(next);
    },
    [router],
  );

  // the Canvas ids of the item in the URL, read only for a puzzle link (?puzzle=)
  const wantsCanvasIds = !!puzzleLink;
  useEffect(() => {
    setCanvasIds([]);
    if (!manifestUrl || !wantsCanvasIds) return;
    let cancelled = false;
    fetchManifest(manifestUrl)
      .then((raw) => {
        if (cancelled || !raw) return;
        setCanvasIds(containersOf(convertToV4(raw)).map((c) => c.id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, wantsCanvasIds]);

  // When the puzzle is closed, remove the link's arguments (so that a reload or going back does not open it again)
  const closePuzzleLink = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('puzzle') && !params.has('grid')) return;
    params.delete('puzzle');
    params.delete('grid');
    router.replace(`?${params.toString()}`);
  }, [router]);

  // Compare, map, 3D gallery, 3D browse and the puzzle are reached from the "Other views" tab on the right
  const otherViewsLabel = to('tab');
  const panels = useMemo(
    () =>
      // Local images cannot be passed by URL to the other pages (compare, map, 3D), so no "Other views"
      manifestUrl && !isLocal
        ? [
            otherViewsPanel(
              { manifestUrl, compare, puzzle, onPuzzleClose: closePuzzleLink },
              otherViewsLabel,
            ),
          ]
        : [],
    [manifestUrl, isLocal, compare, puzzle, closePuzzleLink, otherViewsLabel],
  );

  const tabParam = searchParams?.get('tab');
  // Opened from a puzzle link: open the "Other views" tab, where the puzzle is
  const tab = viewerTabOf(tabParam) ?? (puzzleLink ? OTHER_VIEWS_TAB : undefined);

  const handleTabChange = (next: InfoTab) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', next);
    // add to the history and update the URL
    pushed.current.push(window.location.search);
    router.push(`?${params.toString()}`);
  };

  return (
    // With the viewer open, h-dvh fixes the height to the screen (on phones 100vh is taller than the visible area by the
    // browser's toolbar, which hides the bottom). The entry screen uses min-h-dvh and scrolls as a page: with a fixed
    // height the footer takes the room on phones and squeezes the input out of sight
    <div
      className={`flex flex-col relative ${manifestUrl ? 'h-dvh' : 'min-h-dvh'}`}
      // An image dropped anywhere on the screen is opened. Dragged text or links (reordering inside the viewer etc.) are left alone
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void filesFromDataTransfer(e.dataTransfer).then((files) => {
          if (files.length) void openFiles(files);
        });
      }}
    >
      <Suspense fallback={null}>
        <ManifestParamWatcher onChange={readUrl} />
      </Suspense>
      <Header compact />
      {manifestUrl && isLocal && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs border-b border-[var(--ds-border)] bg-[var(--ds-surface-2)] text-[var(--ds-fg)]"
          role="status"
        >
          <span className="flex-1 min-w-0">
            {local.count > 1 ? tl('bannerMany', { name: local.name, count: local.count }) : tl('banner', { name: local.name })}
            {local.skipped > 0 && ` ${tl('skipped', { count: local.skipped })}`}
          </span>
          {tab !== 'inference' && (
            <button type="button" className="underline text-[var(--ds-primary)]" onClick={() => handleTabChange('inference')}>
              {tl('readText')}
            </button>
          )}
        </div>
      )}
      {manifestUrl && fileError && (
        <div className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 border-b border-[var(--ds-border)]" role="alert">
          {fileError}
        </div>
      )}
      <main className={`flex-1 flex relative ${manifestUrl ? 'overflow-hidden' : ''}`}>
        {manifestUrl ? (
          <Viewer
            iiifContent={manifestUrl}
            collection={collection}
            onShownChange={handleShownChange}
            locale={locale === 'en' ? 'en' : 'ja'}
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            tab={tab}
            onTabChange={handleTabChange}
            panels={panels}
            hidePanels={HIDDEN_VIEWER_TABS}
            target={puzzleTarget}
            // a closed right panel draws nothing, so it is open when the page comes from a puzzle link
            panelOpen={puzzleLink ? true : undefined}
            // nothing is drawn at the bottom left: only whether there are candidates, passed to the compare of "Other views"
            renderActions={({ hasChoices, selectedIndex }) => (
              <CompareReport target={hasChoices ? selectedIndex : null} onChange={setCompare} />
            )}
          />
        ) : (
          <div className="w-full flex px-4 py-8">
            {/* The entry screen: centered when there is room, else the page scrolls. Up to 768px wide, close to the top page */}
            <div className="m-auto w-full max-w-3xl">
              <ManifestInput
                onSubmit={(url: string) => readUrl(url)}
                onOpenFile={(files) => void openFiles(files)}
                fileError={fileError}
                fileStatus={fileStatus}
              />
            </div>
          </div>
        )}
      </main>
      {!manifestUrl && <Footer />}
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--ds-primary)] bg-[var(--ds-bg)]/80 text-sm font-medium text-[var(--ds-primary)]">
          {tl('dropHere')}
        </div>
      )}
    </div>
  );
};

const ViewerContentWithSuspense: NextPage = () => (
  <Suspense fallback={null}>
    <ViewerContent />
  </Suspense>
);

export default ViewerContentWithSuspense;
