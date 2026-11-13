'use client';

import type { NextPage } from 'next';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Viewer, manifestUrlAtom, type InfoTab, type ViewerTarget } from 'iiif-kasane';
// 3D の Scene も表示する（three.js などは 3D を開いたときだけ読み込まれる）
import 'iiif-kasane/scene';
import ManifestInput from '@/components/Input';
import ManifestParamWatcher from '@/components/ManifestParamWatcher';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { containersOf, convertToV4, fetchManifest, parseManifestV4 } from 'iiif-kasane/core';
import { HIDDEN_VIEWER_TABS, OTHER_VIEWS_TAB, viewerTabOf } from '@/lib/viewerTabs';
import { puzzleFromParams } from '@/lib/puzzleLink';
import { canOpenInGallery } from '@/lib/gallery';
import { canOpenInBrowse } from '@/lib/browse';
import { otherViewsPanel, type CompareTarget } from '@/components/OtherViewsPanel';
import { LocalImageError, filesFromDataTransfer, isLocalManifestUrl, openLocalImages } from '@/lib/localImage';

/** Whether a drag carries files (not text or a link, which the viewer handles itself). */
const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

// ビューアが左下に置く場所（renderActions）から、比較に渡せるかを受け取るだけの部品。何も描かない。
// 候補の無い Canvas に移ると呼ばれなくなる（外される）ので、そのとき null に戻す。
function CompareReport({ target, onChange }: { target: number | null; onChange: (c: CompareTarget) => void }) {
  useEffect(() => {
    onChange(target === null ? null : { selectedIndex: target });
    return () => onChange(null);
  }, [target, onChange]);
  return null;
}

// /viewer?iiif-content=...&tab=...（?manifest=... も読む）: ビューア本体はパッケージの Viewer。
// ここでは URL の読み書きと、ヘッダー・フッター・入力欄だけを持つ。
const ViewerContent: NextPage = () => {
  // Header も同じ値（ダウンロードのリンクなど）を読むので、サイト側の store に持つ
  const [manifestUrl, setManifestUrl] = useAtom(manifestUrlAtom);
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const to = useTranslations('OtherViews');
  // 地図と並べて見られる位置情報（Canvas または Scene の georeferencing）があるか
  const [hasGeoCanvas, setHasGeoCanvas] = useState(false);
  // 画像を含み、3D の美術館（/gallery/）の壁に掛けられるか
  const [galleryOk, setGalleryOk] = useState(false);
  // Collection か、Canvas が 2 つ以上ある Manifest で、3D の一覧（/browse/）に渡せるか
  const [browseOk, setBrowseOk] = useState(false);
  // 表示中の模型か画像に候補が 2 つ以上あれば、比較のページに渡す Canvas / Scene の番号（ビューアが知らせる）
  const [compare, setCompare] = useState<CompareTarget>(null);
  // ?puzzle=<ページ>&grid=<マスの数> で開いたときのパズル。ページの Canvas の id はマニフェストを読んでから決まる
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
  // 手元の画像（サーバに送らず、このタブの中だけで開いたもの）
  const isLocal = isLocalManifestUrl(manifestUrl);
  const [local, setLocal] = useState({ name: '', count: 0, skipped: 0 });
  const [fileError, setFileError] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const [dragging, setDragging] = useState(false);

  // 手元の画像を開く。アドレス欄には書かない（blob: の URL は再読み込みすると読めず、共有もできないため）。
  // 開いていた資料の引数は外し、文字の読み取り（推論）のタブで開く
  // 複数の画像は名前順に並べ、1 冊のマニフェストにする
  const openFiles = useCallback(
    async (files: File[]) => {
      setFileError('');
      try {
        const opened = await openLocalImages(files, (done, total) => {
          // 1 枚だけのときは一瞬で終わるので出さない
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
  // 開いたとき、また入口の事例のリンクで URL の資料が変わったときに読む
  const readUrl = useCallback(
    (manifestParam: string | null) => {
      if (manifestParam) setManifestUrl(manifestParam);
    },
    [setManifestUrl],
  );

  useEffect(() => {
    setHasGeoCanvas(false);
    setGalleryOk(false);
    setBrowseOk(false);
    setCanvasIds([]);
    if (!manifestUrl) return;
    let cancelled = false;
    fetchManifest(manifestUrl)
      .then((raw) => {
        if (cancelled || !raw) return;
        // 2D の Canvas か、3D の Scene に位置情報（georeferencing）がある
        const v4 = convertToV4(raw);
        const { geoCanvasId, geoFeatures } = parseManifestV4(v4);
        setCanvasIds(containersOf(v4).map((c) => c.id));
        setHasGeoCanvas(!!geoCanvasId || geoFeatures.length > 0);
        setGalleryOk(canOpenInGallery(raw));
        setBrowseOk(canOpenInBrowse(raw));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  // パズルを閉じたら、リンクの引数を外す（再読み込みや戻る操作で、また開かないように）
  const closePuzzleLink = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('puzzle') && !params.has('grid')) return;
    params.delete('puzzle');
    params.delete('grid');
    router.replace(`?${params.toString()}`);
  }, [router]);

  // 比較・地図・3D の美術館・3D の一覧とパズルへは、右の「ほかの表示」タブから行く
  const otherViewsLabel = to('tab');
  const panels = useMemo(
    () =>
      // 手元の画像は、ほかのページ（比較・地図・3D）へ URL で渡せないので「ほかの表示」を出さない
      manifestUrl && !isLocal
        ? [
            otherViewsPanel(
              { manifestUrl, hasGeo: hasGeoCanvas, galleryOk, browseOk, compare, puzzle, onPuzzleClose: closePuzzleLink },
              otherViewsLabel,
            ),
          ]
        : [],
    [manifestUrl, isLocal, hasGeoCanvas, galleryOk, browseOk, compare, puzzle, closePuzzleLink, otherViewsLabel],
  );

  const tabParam = searchParams?.get('tab');
  // パズルのリンクで開いたときは、パズルのある「ほかの表示」タブを開く
  const tab = viewerTabOf(tabParam) ?? (puzzleLink ? OTHER_VIEWS_TAB : undefined);

  const handleTabChange = (next: InfoTab) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', next);
    // 履歴に追加して URL を更新
    router.push(`?${params.toString()}`);
  };

  return (
    // ビューアを開いたら h-dvh で画面の高さに固定する（スマホではブラウザのツールバーの分だけ 100vh が見える範囲より高く、下端が隠れるため）。
    // 入口の画面は min-h-dvh にしてページごとスクロールさせる。高さを固定すると、スマホではフッターが場所を取り、入口の欄が押しつぶされて見えなくなる
    <div
      className={`flex flex-col relative ${manifestUrl ? 'h-dvh' : 'min-h-dvh'}`}
      // 画面のどこに画像を落としても開く。文字やリンクのドラッグ（ビューアの中の並べ替えなど）には手を出さない
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
            locale={locale === 'en' ? 'en' : 'ja'}
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            tab={tab}
            onTabChange={handleTabChange}
            panels={panels}
            hidePanels={HIDDEN_VIEWER_TABS}
            target={puzzleTarget}
            // 閉じた右パネルは中身を描かないので、パズルのリンクで開いたときは開いておく
            panelOpen={puzzleLink ? true : undefined}
            // 左下には何も出さず、候補があるかだけを受け取って「ほかの表示」タブの比較に渡す
            renderActions={({ hasChoices, selectedIndex }) => (
              <CompareReport target={hasChoices ? selectedIndex : null} onChange={setCompare} />
            )}
          />
        ) : (
          <div className="w-full flex px-4 py-8">
            {/* 入口の画面。画面に余裕があれば真ん中に置き、足りなければページごとスクロールする。幅はトップに近い 768px まで */}
            <div className="m-auto w-full max-w-3xl">
              <ManifestInput
                onSubmit={(url: string) => setManifestUrl(url)}
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
