'use client';

import type { NextPage } from 'next';
import { Suspense } from 'react';
import { annotationsAtom, manifestUrlAtom, selectedAnnotationIdAtom } from '@nakamura196/iiif-viewer';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { fetchManifest } from '@nakamura196/iiif-viewer/core';
import { manifestAtom } from '@nakamura196/iiif-viewer';
import { AuthPrompt, CanvasComponent, GeoImageView, useAuthStates, useCanvasImages } from '@nakamura196/iiif-viewer';
import ManifestInput from '@/components/Input';
import RotationControl from '@/components/map/RotationControl';
import Header from '@/components/Header';
import { Link } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site';
import { USE_CASES, hrefOf } from '@/lib/usecases';
import MapView, { type MapImageOverlay } from '@/components/map/MapView';
import { authorizedUrl, convertToV4, probeServiceOf } from '@nakamura196/iiif-viewer/core';
import {
  parseManifestV4,
  geoAnnotations,
  geoCanvasesOf,
  geoFeatureBoxOf,
  geoFeatureIdOf,
  overlayCorners,
  filterGeorefFeatures,
  georefTagFacets,
  labelIn,
  type GeoCanvas,
  type GeoFeature,
  type ImageLayer,
} from '@nakamura196/iiif-viewer/core';
import { AnnotationCard } from '@nakamura196/iiif-viewer';
import { SidePanel, rightsPanel } from '@nakamura196/iiif-viewer';
import { useTranslations, useLocale } from 'next-intl';
import {
  annotationsParams,
  applyGeorefPatch,
  autoRotateOnSelectParams,
  clusteringParams,
  contentParam,
  imageViewParams,
  localNorthUpRotation,
  manifestFromParams,
  mapViewParams,
  northUpRotation,
  normalizeAngle,
  readGeorefParams,
  rotationParams,
  sideTabParams,
  type GeorefImageView,
  type GeorefMapView,
  type GeorefParamPatch,
  type GeorefSideTab,
  type GeorefUrlState,
} from '@nakamura196/iiif-viewer/core';

// マニフェストからattributionを取得するヘルパー関数
const getAttribution = (manifest: Record<string, unknown>, locale: string): string | undefined => {
  const requiredStatement = manifest.requiredStatement as {
    value?: Record<string, string[]>;
  } | undefined;
  if (!requiredStatement?.value) return undefined;
  const value = requiredStatement.value;
  return value[locale]?.[0] || value['en']?.[0] || value['none']?.[0] || Object.values(value)[0]?.[0];
};

// 地図に重ねる画像の URL。Image API があれば、地図に貼るのに足りる大きさ（長辺 4096 px まで）で取る。
// 元の画像は数万 px になることがあり、そのままでは重く、ブラウザの上限も超える
const OVERLAY_MAX = 4096;
const overlayUrlOf = (layer: ImageLayer): string => {
  if (!layer.service) return layer.url;
  const size = Math.min(OVERLAY_MAX, Math.max(layer.width ?? OVERLAY_MAX, layer.height ?? OVERLAY_MAX));
  const quality = layer.service.version === 1 ? 'native' : 'default';
  return `${layer.service.id}/full/!${size},${size}/0/${quality}.jpg`;
};

// 表示の状態を URL に書き戻す間隔。地図や画像を動かしている間に、何度も書き換えないようにする
const URL_WRITE_DELAY = 500;

// URL の id は geo.ldas.jp では地物の id。Kasane の地点の名前（@id が先）と違うときがあるので、両方で引く
const featureIdFromParam = (features: GeoFeature[], id: string): string | undefined => {
  const idx = features.findIndex((f, i) => f.id === id || geoFeatureIdOf(f, i) === id);
  return idx < 0 ? undefined : geoFeatureIdOf(features[idx], idx);
};

// 画像と地図の組（画像の地点 x, y と地図の経度・緯度）
const pairsOf = (features: GeoFeature[]) =>
  features.map((f) => ({
    x: f.properties.resourceCoords[0],
    y: f.properties.resourceCoords[1],
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

// 入口に並べる例: 地図と画像の画面で開くユースケースと、geo.ldas.jp から移したタグ付きの Canvas
const GEOREF_USE_CASES = USE_CASES.filter((u) => u.open.page === 'georef');
const TAGGED_CANVAS_HREF = hrefOf({ page: 'georef', manifest: `${SITE_URL}/manifests/geo-hongo-canvas-tags.json` });

const GeoRefContent: NextPage = () => {
  const t = useTranslations('GeoRef');
  const locale = useLocale();
  const [manifestUrl, setManifestUrl] = useAtom(manifestUrlAtom);
  const [manifest, setManifest] = useAtom(manifestAtom);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelBody, setModelBody] = useState<unknown>(undefined);
  // A model behind IIIF Auth 2.0 (an AuthProbeService2 on the Model) is loaded only once the probe lets
  // the user in, as in the 3D viewer; an unprotected one keeps its plain URL.
  const probes = useMemo(() => [modelBody ? probeServiceOf(modelBody, locale) : undefined], [modelBody, locale]);
  const [authState] = useAuthStates(probes, locale);
  const glbUrl = modelUrl ? authorizedUrl(modelUrl, authState) : null;
  // 地点が画像（絵図・古地図）に付いているときは、その Canvas を 3D の代わりに出す
  const [geoCanvasId, setGeoCanvasId] = useState<string | undefined>(undefined);
  const geoCanvas = useCanvasImages(geoCanvasId ? manifestUrl : null, geoCanvasId);
  const [attribution, setAttribution] = useState<string | undefined>(undefined);
  const [annotations, setAnnotations] = useAtom(annotationsAtom);
  const [selectedAnnotationId, setSelectedAnnotationId] = useAtom(selectedAnnotationIdAtom);
  const [geoFeatures, setGeoFeatures] = useState<GeoFeature[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  // 一覧で選んでいるタグ（どれかを持つ地点を残す）
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // 地点の付いた Canvas すべて（geo.ldas.jp と同じく、1 つずつ切り替えて見る）
  const [geoCanvases, setGeoCanvases] = useState<GeoCanvas[]>([]);
  // URL の画像の拡大率・中心は、開いたときの Canvas にだけ使う
  const [useUrlImageView, setUseUrlImageView] = useState(true);
  const annotationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 開いたときの URL から読んだ表示の状態（geo.ldas.jp と同じ名前の引数）
  const [urlState, setUrlState] = useState<GeorefUrlState | null>(null);
  // 画像の回転（度、反時計回りが正）。URL の rotation と同じ値
  const [rotation, setRotation] = useState(0);
  // 地図か一覧で地点を選んだら、その近くで北が上になるよう回すか。URL の autoRotateOnSelect と同じ
  const [autoRotateOnSelect, setAutoRotateOnSelect] = useState(false);
  // 近い地点を 1 つにまとめて件数を出すか（地図と画像の両方）。URL の clustering と同じ。既定はまとめる
  const [clustering, setClustering] = useState(true);
  // 画像に地点の印を出すか。URL の annotations と同じ。切っても地図の印と一覧はそのまま
  const [showImageMarks, setShowImageMarks] = useState(true);
  // 右の欄で出すもの（地点の一覧か権利）。URL の search・license と同じ
  const [sideTab, setSideTab] = useState<GeorefSideTab>('list');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = readGeorefParams(params, manifestFromParams(params));
    setUrlState(state);
    if (state.rotation !== undefined) setRotation(state.rotation);
    if (state.autoRotateOnSelect) setAutoRotateOnSelect(true);
    if (state.clustering === false) setClustering(false);
    if (state.annotations === false) setShowImageMarks(false);
    if (state.sideTab) setSideTab(state.sideTab);
    if (!state.manifest) return;
    setManifestUrl(state.manifest);
  }, [setManifestUrl]);

  // 表示の状態を URL に書き戻す（履歴は増やさない）。まとめて、動きが止まってから書く
  const pendingPatch = useRef<GeorefParamPatch>({});
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeParams = useCallback((patch: GeorefParamPatch) => {
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      const search = applyGeorefPatch(window.location.search, pendingPatch.current);
      pendingPatch.current = {};
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
    }, URL_WRITE_DELAY);
  }, []);
  useEffect(() => () => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
  }, []);
  const handleMapViewChange = useCallback((v: GeorefMapView) => writeParams(mapViewParams(v)), [writeParams]);
  const handleImageViewChange = useCallback((v: GeorefImageView) => writeParams(imageViewParams(v)), [writeParams]);
  const changeRotation = useCallback(
    (deg: number) => {
      const r = normalizeAngle(deg);
      setRotation(r);
      writeParams(rotationParams(r));
    },
    [writeParams]
  );
  const changeAutoRotateOnSelect = useCallback(
    (on: boolean) => {
      setAutoRotateOnSelect(on);
      writeParams(autoRotateOnSelectParams(on));
    },
    [writeParams]
  );

  const changeClustering = useCallback(
    (on: boolean) => {
      setClustering(on);
      writeParams(clusteringParams(on));
    },
    [writeParams]
  );

  const changeShowImageMarks = useCallback(
    (on: boolean) => {
      setShowImageMarks(on);
      writeParams(annotationsParams(on));
    },
    [writeParams]
  );

  const changeSideTab = useCallback(
    (tab: GeorefSideTab) => {
      setSideTab(tab);
      writeParams(sideTabParams(tab));
    },
    [writeParams]
  );

  // 権利のタブは、マニフェストに出典表記かライセンスがあるときだけ出す（ビューアの権利のタブと同じ）
  const hasRights = useMemo(() => !!manifest && rightsPanel.available({ manifest }), [manifest]);
  const shownSideTab: GeorefSideTab = sideTab === 'rights' && hasRights ? 'rights' : 'list';

  useEffect(() => {
    if (!manifestUrl) return;

    fetchManifest(manifestUrl).then((raw) => {
      if (!raw) return;
      const manifest = convertToV4(raw);
      const parsed = parseManifestV4(manifest, undefined, locale);
      const { modelUrl, modelBody, annotations } = parsed;
      let { geoFeatures, geoCanvasId } = parsed;
      // 地点の付いた Canvas が 2 つ以上あれば、URL の canvas のものを開く
      const canvases = geoCanvasId ? geoCanvasesOf(manifest, locale) : [];
      // ビューアと同じく、番号（1 から。マニフェストの何枚目か）でも id でもよい
      const want = urlState?.canvas;
      const wantId = want && /^\d+$/.test(want) ? manifest.items?.[Number(want) - 1]?.id : want;
      const fromUrl = canvases.find((c) => c.id === wantId);
      if (fromUrl) {
        geoFeatures = fromUrl.features;
        geoCanvasId = fromUrl.id;
      }
      setModelUrl(modelUrl);
      setModelBody(modelBody);
      setGeoCanvases(canvases);
      setGeoCanvasId(geoCanvasId);
      setManifest(manifest);
      setAttribution(getAttribution(manifest as unknown as Record<string, unknown>, locale));
      setAnnotations(geoAnnotations(geoFeatures, annotations));
      setGeoFeatures(geoFeatures);
      // URL の id の地点を選んでおく
      const id = urlState?.id;
      const selected = id ? featureIdFromParam(geoFeatures, id) : undefined;
      if (selected) setSelectedAnnotationId(selected);
    });
  }, [manifestUrl, urlState, setManifest, setAnnotations, setSelectedAnnotationId, locale]);

  const handleManifestSubmit = async (manifestUrl: string) => {
    setManifestUrl(manifestUrl);
    // 入力欄から開いたときも、URL を共有すれば同じものが開くようにする
    const params = new URLSearchParams(window.location.search);
    params.set('iiif-content', manifestUrl);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  };

  // 選んでいる地点を URL の id に書く。geo.ldas.jp のリンクと揃えるため、地物に id があればそれを使う
  useEffect(() => {
    if (geoFeatures.length === 0) return;
    const idx = geoFeatures.findIndex((f, i) => geoFeatureIdOf(f, i) === selectedAnnotationId);
    writeParams({ id: idx < 0 ? null : (geoFeatures[idx].id ?? geoFeatureIdOf(geoFeatures[idx], idx)) });
  }, [selectedAnnotationId, geoFeatures, writeParams]);

  // 画像の地点と地図の地点の組
  const georefPairs = useMemo(() => pairsOf(geoFeatures), [geoFeatures]);
  // 北が上になる回転。地点が 2 つ以上あるときだけ求まる
  const autoRotation = useMemo(() => northUpRotation(georefPairs), [georefPairs]);

  // 開いたとき、URL に rotation が無ければ北が上になるよう回す（geo.ldas.jp と同じ）。1 つの資料につき 1 回だけ
  const autoRotatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!urlState || urlState.rotation !== undefined || autoRotation === null || !manifestUrl) return;
    if (autoRotatedFor.current === manifestUrl) return;
    autoRotatedFor.current = manifestUrl;
    changeRotation(autoRotation);
  }, [urlState, autoRotation, manifestUrl, changeRotation]);

  const imagePoints = useMemo(
    () =>
      geoFeatures.map((f, idx) => {
        const box = geoFeatureBoxOf(f);
        return {
          id: geoFeatureIdOf(f, idx),
          title: f.properties.title,
          x: f.properties.resourceCoords[0],
          y: f.properties.resourceCoords[1],
          ...(box ? { box } : {}),
        };
      }),
    [geoFeatures]
  );

  // 画像を地図に重ねる。対応点から四隅の位置を求める（1 次の多項式、対応点が 3 つ以上のとき）。
  // Canvas に画像が 1 枚だけ全面に貼られている場合に限る（一部に貼った画像や回転は扱わない）
  const mapOverlay = useMemo((): MapImageOverlay | null => {
    const paintings = geoCanvas?.paintings ?? [];
    const layer = paintings.length === 1 ? paintings[0].options[0]?.layer : undefined;
    const width = geoCanvas?.width ?? layer?.width;
    const height = geoCanvas?.height ?? layer?.height;
    if (!layer || layer.target || layer.regionSpec || layer.rotation || layer.mirror || !width || !height) return null;
    const corners = overlayCorners(
      geoFeatures.map((f) => ({
        resource: [f.properties.resourceCoords[0], f.properties.resourceCoords[1]],
        geo: f.geometry.coordinates,
      })),
      width,
      height
    );
    return corners ? { url: overlayUrlOf(layer), corners } : null;
  }, [geoCanvas, geoFeatures]);

  // 別の Canvas に切り替える。地点・一覧・画像の向きをその Canvas のものにし、URL の canvas に書く
  const geoCanvasIndex = geoCanvases.findIndex((c) => c.id === geoCanvasId);
  const showGeoCanvas = (index: number) => {
    const c = geoCanvases[index];
    if (!c || c.id === geoCanvasId) return;
    setGeoCanvasId(c.id);
    setGeoFeatures(c.features);
    setAnnotations(geoAnnotations(c.features, []));
    setSelectedAnnotationId(null);
    setTagFilter([]);
    setUseUrlImageView(false);
    // 開いたときと同じく、北が上になるよう回す（地点が 2 つ未満なら回さない）
    changeRotation(northUpRotation(pairsOf(c.features)) ?? 0);
    writeParams({ canvas: index === 0 ? null : c.id, zoom: null, centerX: null, centerY: null });
  };

  // 一覧の絞り込み。番号と注記は絞り込む前の並びで引く
  const tagFacets = useMemo(() => georefTagFacets(annotations), [annotations]);
  const visibleIndices = useMemo(
    () => filterGeorefFeatures(geoFeatures, annotations, { query: searchQuery, tags: tagFilter }),
    [geoFeatures, annotations, searchQuery, tagFilter]
  );
  const filtering = searchQuery.trim() !== '' || tagFilter.length > 0;
  const toggleTag = (tag: string) =>
    setTagFilter((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  // 画像の印から選んだとき。画像は回さない（見ている向きのまま印を押したので）
  const handleFeatureClick = (id: string) => {
    setSelectedAnnotationId(id);
  };

  // 地図か一覧から選んだとき。スイッチが入っていれば、その地点の近くで北が上になるよう回す（geo.ldas.jp と同じ）
  const handleFeatureSelect = (id: string) => {
    setSelectedAnnotationId(id);
    if (!autoRotateOnSelect) return;
    const idx = geoFeatures.findIndex((f, i) => geoFeatureIdOf(f, i) === id);
    const r = idx < 0 ? null : localNorthUpRotation(georefPairs, idx);
    if (r !== null) changeRotation(r);
  };

  // 選択されたアノテーションにスクロール
  useEffect(() => {
    if (selectedAnnotationId) {
      const element = annotationRefs.current.get(selectedAnnotationId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedAnnotationId]);

  return (
    <div className="flex flex-col h-dvh">
      <Header />
      <main className="flex-1 flex overflow-hidden">
        {/* URL を読み終えてから地図と画像を作る（開いたときの縮尺・中心を渡すため） */}
        {manifestUrl && urlState ? (
          <div className="flex flex-col lg:flex-row w-full h-full">
            {/* Map */}
            <div className="flex-1 min-h-0 lg:h-full lg:flex-[2] relative border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700">
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <div className="bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('map')}
                </div>
                {/* 地図と画像の両方に効く */}
                <label className="flex items-center gap-1.5 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={clustering} onChange={(e) => changeClustering(e.target.checked)} />
                  {t('clustering')}
                </label>
              </div>
              <MapView
                features={geoFeatures}
                selectedId={selectedAnnotationId}
                onFeatureClick={handleFeatureSelect}
                overlay={mapOverlay}
                initialView={urlState?.map}
                focus={urlState?.focus}
                initialSelectedId={urlState?.id ? featureIdFromParam(geoFeatures, urlState.id) : null}
                onViewChange={handleMapViewChange}
                clustering={clustering}
                fitKey={geoCanvasId}
              />
            </div>
            {/* 3D Viewer, or the georeferenced picture */}
            <div className="flex-1 min-h-0 lg:h-full lg:flex-[2] relative bg-gray-100 dark:bg-gray-900 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700">
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <div className="bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm font-medium text-gray-700 dark:text-gray-300">
                  {geoCanvasId ? t('image') : t('viewer3d')}
                </div>
                {/* back to the ordinary viewer, at the Canvas shown here */}
                <Link
                  href={`/viewer?${contentParam(manifestUrl)}${geoCanvasId ? `&canvas=${encodeURIComponent(geoCanvasId)}` : ''}`}
                  className="bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t('openInViewer')}
                </Link>
                {geoCanvas && (
                  <label className="flex items-center gap-1.5 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={showImageMarks} onChange={(e) => changeShowImageMarks(e.target.checked)} />
                    {t('showImageMarks')}
                  </label>
                )}
                {geoCanvas && (
                  <RotationControl
                    rotation={rotation}
                    onChange={changeRotation}
                    northUp={autoRotation}
                    autoRotateOnSelect={autoRotateOnSelect}
                    onAutoRotateOnSelectChange={changeAutoRotateOnSelect}
                  />
                )}
              </div>
              {geoCanvas && (
                <GeoImageView
                  key={geoCanvasId}
                  canvas={geoCanvas}
                  points={imagePoints}
                  selectedId={selectedAnnotationId}
                  onSelect={handleFeatureClick}
                  initialView={useUrlImageView ? urlState?.image : undefined}
                  onViewChange={handleImageViewChange}
                  rotation={rotation}
                  clustering={clustering}
                  showMarkers={showImageMarks}
                />
              )}
              {/* 地点の付いた Canvas が 2 つ以上あるとき、前後に切り替える */}
              {geoCanvases.length > 1 && geoCanvasIndex >= 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-white dark:bg-gray-800 rounded-full shadow px-1 py-1 text-sm text-gray-700 dark:text-gray-300">
                  <button
                    type="button"
                    onClick={() => showGeoCanvas(geoCanvasIndex - 1)}
                    disabled={geoCanvasIndex === 0}
                    aria-label={t('prevCanvas')}
                    title={t('prevCanvas')}
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    ‹
                  </button>
                  <span className="px-1 max-w-[16rem] truncate" title={labelIn(geoCanvases[geoCanvasIndex].label, locale)}>
                    {geoCanvasIndex + 1} / {geoCanvases.length}
                    {labelIn(geoCanvases[geoCanvasIndex].label, locale) && (
                      <span className="ml-2 text-gray-500 dark:text-gray-400">{labelIn(geoCanvases[geoCanvasIndex].label, locale)}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => showGeoCanvas(geoCanvasIndex + 1)}
                    disabled={geoCanvasIndex === geoCanvases.length - 1}
                    aria-label={t('nextCanvas')}
                    title={t('nextCanvas')}
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    ›
                  </button>
                </div>
              )}
              {glbUrl && (
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                    </div>
                  }
                >
                  <CanvasComponent glbUrl={glbUrl} attribution={attribution} />
                </Suspense>
              )}
              {modelUrl && <AuthPrompt />}
            </div>
            {/* Annotations */}
            {/* geo.ldas.jp の search=1・license=1 のリンクは、欄を畳んでいても開いて出す */}
            <SidePanel breakpoint="lg" className="bg-white dark:bg-gray-800 flex flex-col" openOnStart={!!urlState.sideTab}>
              {hasRights && (
                <div role="tablist" className="flex gap-1 px-4 pr-10 pt-2 border-b border-gray-200 dark:border-gray-700">
                  {(['list', 'rights'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={shownSideTab === tab}
                      onClick={() => changeSideTab(tab)}
                      className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${
                        shownSideTab === tab
                          ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-medium'
                          : 'border-transparent text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
                      }`}
                    >
                      {tab === 'list' ? t('annotations') : t('rights')}
                    </button>
                  ))}
                </div>
              )}
              {shownSideTab === 'rights' && manifest ? (
                <div className="flex-1 overflow-y-auto">
                  <rightsPanel.Component manifest={manifest} />
                </div>
              ) : (
                <>
                <div className="sticky top-0 bg-white dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700 z-10">
                  <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('annotations')} ({filtering ? `${visibleIndices.length} / ${geoFeatures.length}` : geoFeatures.length})
                  </h2>
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('searchPlaceholder')}
                      className="w-full px-3 py-1.5 pl-8 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <svg
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {/* タグで絞り込む（件数の多い順。押すたびに入れる・外す） */}
                  {tagFacets.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto" role="group" aria-label={t('filterByTag')}>
                      {tagFacets.map(({ value, count }) => {
                        const on = tagFilter.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleTag(value)}
                            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                              on
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            {value} ({count})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {visibleIndices
                    .map((index) => ({ feature: geoFeatures[index], index }))
                    .map(({ feature, index }) => {
                      // 中身（説明・画像・タグ・参照）は 3D の画面の一覧と同じカードで出す
                      const annotation = annotations[index];
                      if (!annotation) return null;
                      const wikipediaLink = feature.links?.find(link => link.type === 'primaryTopicOf')?.identifier;
                      const altNames = feature.names?.filter(name => name.toponym !== feature.properties.title);
                      // geo.ldas.jp の一覧の ID の列（ID でも探せる）
                      const featureId = feature.id ?? feature['@id'];
                      return (
                        <AnnotationCard
                          key={annotation.id}
                          annotation={annotation}
                          number={index + 1}
                          selected={selectedAnnotationId === annotation.id}
                          onSelect={handleFeatureSelect}
                          cardRef={(el) => {
                            if (el) annotationRefs.current.set(annotation.id, el);
                          }}
                        >
                          {featureId && (
                            <div className="mt-2 pl-9 text-xs text-gray-400 dark:text-gray-500 truncate" title={featureId}>
                              ID: {featureId}
                            </div>
                          )}
                          {/* 地名の別名と Wikipedia は、georef の地物（Linked Places 形式）だけが持つ */}
                          {altNames && altNames.length > 0 && (
                            <div className="mt-2 pl-9 text-xs text-gray-500 dark:text-gray-400">
                              {altNames.map(n => n.toponym).join(', ')}
                            </div>
                          )}
                          {wikipediaLink && (
                            <div className="mt-1 pl-9">
                              <a
                                href={wikipediaLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-blue-500 dark:text-blue-400 hover:underline"
                              >
                                Wikipedia
                              </a>
                            </div>
                          )}
                        </AnnotationCard>
                      );
                    })}
                  {geoFeatures.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                      {t('noAnnotations')}
                    </p>
                  )}
                  {geoFeatures.length > 0 && visibleIndices.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                      {t('noResults')}
                    </p>
                  )}
                </div>
                </>
              )}
            </SidePanel>
          </div>
        ) : (
          <div className="w-full h-full overflow-y-auto flex px-4 py-8">
            {/* 入口の画面。中身が画面より高いときは上から並べてスクロールさせ（真ん中寄せだと上が切れる）、幅はトップに近い 768px まで */}
            <div className="m-auto w-full max-w-3xl">
              <ManifestInput
                onSubmit={handleManifestSubmit}
                title={t('entryTitle')}
                description={t('entryDescription')}
                useCases={GEOREF_USE_CASES}
              >
                {/* geo.ldas.jp から転送されて来た人が、何の画面かと使い方を分かるように */}
                <div className="text-left text-sm text-[var(--ds-fg)] space-y-6">
                  <section>
                    <h3 className="font-medium mb-2">{t('entryHowTo')}</h3>
                    <ul className="list-disc pl-5 space-y-1 text-[var(--ds-fg-muted)]">
                      <li>{t('entryHowTo1')}</li>
                      <li>{t('entryHowTo2')}</li>
                      <li>{t('entryHowTo3')}</li>
                    </ul>
                    <p className="mt-3 text-[var(--ds-fg-muted)]">{t('entryMoved')}</p>
                  </section>
                  <section>
                    <h3 className="font-medium mb-2">{t('entrySamples')}</h3>
                    <Link href={TAGGED_CANVAS_HREF} className="text-[var(--ds-primary)] hover:underline">
                      {t('entrySampleTags')}
                    </Link>
                    <p className="text-xs text-[var(--ds-fg-muted)]">{t('entrySampleTagsNote')}</p>
                  </section>
                </div>
              </ManifestInput>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default GeoRefContent;
