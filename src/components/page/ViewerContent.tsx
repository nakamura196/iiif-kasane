'use client';

import type { NextPage } from 'next';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Viewer, manifestUrlAtom, type InfoTab } from '@nakamura196/iiif-viewer';
import ManifestInput from '@/components/Input';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { convertToV4, fetchManifest, manifestFromParams, parseManifestV4 } from '@nakamura196/iiif-viewer/core';
import { HIDDEN_VIEWER_TABS, viewerTabOf } from '@/lib/viewerTabs';
import { canOpenInGallery } from '@/lib/gallery';
import { otherViewsPanel, type CompareTarget } from '@/components/OtherViewsPanel';

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
  // 表示中の模型か画像に候補が 2 つ以上あれば、比較のページに渡す Canvas / Scene の番号（ビューアが知らせる）
  const [compare, setCompare] = useState<CompareTarget>(null);

  useEffect(() => {
    const manifestParam = manifestFromParams(new URLSearchParams(window.location.search));
    if (manifestParam) setManifestUrl(manifestParam);
  }, [setManifestUrl]);

  useEffect(() => {
    setHasGeoCanvas(false);
    setGalleryOk(false);
    if (!manifestUrl) return;
    let cancelled = false;
    fetchManifest(manifestUrl)
      .then((raw) => {
        if (cancelled || !raw) return;
        // 2D の Canvas か、3D の Scene に位置情報（georeferencing）がある
        const { geoCanvasId, geoFeatures } = parseManifestV4(convertToV4(raw));
        setHasGeoCanvas(!!geoCanvasId || geoFeatures.length > 0);
        setGalleryOk(canOpenInGallery(raw));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  // 比較・地図・3D の美術館とパズルへは、右の「ほかの表示」タブから行く
  const otherViewsLabel = to('tab');
  const panels = useMemo(
    () =>
      manifestUrl
        ? [otherViewsPanel({ manifestUrl, hasGeo: hasGeoCanvas, galleryOk, compare }, otherViewsLabel)]
        : [],
    [manifestUrl, hasGeoCanvas, galleryOk, compare, otherViewsLabel],
  );

  const tabParam = searchParams?.get('tab');
  const tab = viewerTabOf(tabParam);

  const handleTabChange = (next: InfoTab) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', next);
    // 履歴に追加して URL を更新
    router.push(`?${params.toString()}`);
  };

  return (
    // h-dvh: スマホではブラウザのツールバーの分だけ 100vh が見える範囲より高く、下端が隠れるため
    <div className="flex flex-col h-dvh">
      <Header compact />
      <main className="flex-1 flex overflow-hidden relative">
        {manifestUrl ? (
          <Viewer
            iiifContent={manifestUrl}
            locale={locale === 'en' ? 'en' : 'ja'}
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            tab={tab}
            onTabChange={handleTabChange}
            panels={panels}
            hidePanels={HIDDEN_VIEWER_TABS}
            // 左下には何も出さず、候補があるかだけを受け取って「ほかの表示」タブの比較に渡す
            renderActions={({ hasChoices, selectedIndex }) => (
              <CompareReport target={hasChoices ? selectedIndex : null} onChange={setCompare} />
            )}
          />
        ) : (
          <div className="w-full h-full overflow-y-auto flex px-4 py-8">
            {/* 入口の画面。中身が画面より高いときは上から並べてスクロールさせ（真ん中寄せだと上が切れる）、幅はトップに近い 768px まで */}
            <div className="m-auto w-full max-w-3xl">
              <ManifestInput onSubmit={(url: string) => setManifestUrl(url)} />
            </div>
          </div>
        )}
      </main>
      {!manifestUrl && <Footer />}
    </div>
  );
};

const ViewerContentWithSuspense: NextPage = () => (
  <Suspense fallback={null}>
    <ViewerContent />
  </Suspense>
);

export default ViewerContentWithSuspense;
