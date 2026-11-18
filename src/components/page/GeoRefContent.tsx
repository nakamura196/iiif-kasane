'use client';

import type { NextPage } from 'next';
import { Suspense } from 'react';
import { annotationsAtom, manifestUrlAtom, selectedAnnotationIdAtom } from 'iiif-kasane';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { fetchManifest } from 'iiif-kasane/core';
import { manifestAtom } from 'iiif-kasane';
import { AuthPrompt, GeoImageView, useAuthStates, useCanvasImages } from 'iiif-kasane';
import { CanvasComponent } from 'iiif-kasane/scene';
import ManifestInput from '@/components/Input';
import ManifestParamWatcher from '@/components/ManifestParamWatcher';
import RotationControl from '@/components/map/RotationControl';
import Header from '@/components/Header';
import { Link } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site';
import { USE_CASES, hrefOf } from '@/lib/usecases';
import MapView, { type MapImageOverlay } from '@/components/map/MapView';
import { authorizedUrl, convertToV4, probeServiceOf } from 'iiif-kasane/core';
import {
  parseManifestV4,
  geoAnnotations,
  geoFeaturesNamedBy,
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
} from 'iiif-kasane/core';
import { AnnotationCard } from 'iiif-kasane';
import { SidePanel, rightsPanel } from 'iiif-kasane';
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
} from 'iiif-kasane/core';

// Helper that gets the attribution from the manifest
const getAttribution = (manifest: Record<string, unknown>, locale: string): string | undefined => {
  const requiredStatement = manifest.requiredStatement as {
    value?: Record<string, string[]>;
  } | undefined;
  if (!requiredStatement?.value) return undefined;
  const value = requiredStatement.value;
  return value[locale]?.[0] || value['en']?.[0] || value['none']?.[0] || Object.values(value)[0]?.[0];
};

// URL of the image to overlay on the map. If an Image API is available, request a size large enough for the map (up to 4096 px on the long side).
// The original image can be tens of thousands of px, which is too heavy and exceeds browser limits
const OVERLAY_MAX = 4096;
const overlayUrlOf = (layer: ImageLayer): string => {
  if (!layer.service) return layer.url;
  const size = Math.min(OVERLAY_MAX, Math.max(layer.width ?? OVERLAY_MAX, layer.height ?? OVERLAY_MAX));
  const quality = layer.service.version === 1 ? 'native' : 'default';
  return `${layer.service.id}/full/!${size},${size}/0/${quality}.jpg`;
};

// Interval for writing the view state back to the URL. Avoids rewriting it many times while the map or image is being moved
const URL_WRITE_DELAY = 500;

// The id in the URL is the feature id in geo.ldas.jp. It can differ from the Kasane point name (@id comes first), so look up by both
const featureIdFromParam = (features: GeoFeature[], id: string): string | undefined => {
  const idx = features.findIndex((f, i) => f.id === id || geoFeatureIdOf(f, i) === id);
  return idx < 0 ? undefined : geoFeatureIdOf(features[idx], idx);
};

// Pair of an image point and a map point (image point x, y and map longitude, latitude)
const pairsOf = (features: GeoFeature[]) =>
  features.map((f) => ({
    x: f.properties.resourceCoords[0],
    y: f.properties.resourceCoords[1],
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

// Examples listed on the entry screen: use cases that open the map and image view, and tagged Canvases moved from geo.ldas.jp
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
  // When the points are attached to an image (e-zu, old map), show that Canvas instead of 3D
  const [geoCanvasId, setGeoCanvasId] = useState<string | undefined>(undefined);
  const geoCanvas = useCanvasImages(geoCanvasId ? manifestUrl : null, geoCanvasId);
  const [attribution, setAttribution] = useState<string | undefined>(undefined);
  const [annotations, setAnnotations] = useAtom(annotationsAtom);
  const [selectedAnnotationId, setSelectedAnnotationId] = useAtom(selectedAnnotationIdAtom);
  const [geoFeatures, setGeoFeatures] = useState<GeoFeature[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Tags selected in the list (keep points that have any of them)
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // All Canvases that have points (as in geo.ldas.jp, view them one at a time)
  const [geoCanvases, setGeoCanvases] = useState<GeoCanvas[]>([]);
  // The image zoom and center in the URL are used only for the Canvas that is open on load
  const [useUrlImageView, setUseUrlImageView] = useState(true);
  const annotationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // View state read from the URL on load (parameters have the same names as in geo.ldas.jp)
  const [urlState, setUrlState] = useState<GeorefUrlState | null>(null);
  // Image rotation (degrees, counterclockwise is positive). Same value as rotation in the URL
  const [rotation, setRotation] = useState(0);
  // Whether to rotate so north is up near a point when it is selected on the map or list. Same as autoRotateOnSelect in the URL
  const [autoRotateOnSelect, setAutoRotateOnSelect] = useState(false);
  // Whether to merge nearby points into one and show the count (both map and image). Same as clustering in the URL. Default is to merge
  const [clustering, setClustering] = useState(true);
  // Whether to show point marks on the image. Same as annotations in the URL. Turning it off leaves the map marks and the list unchanged
  const [showImageMarks, setShowImageMarks] = useState(true);
  // What to show in the right panel (point list or license). Same as search and license in the URL
  const [sideTab, setSideTab] = useState<GeorefSideTab>('list');

  // Read on load, and when the document in the URL changes via an entry link
  const readUrl = useCallback(() => {
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

  // Write the view state back to the URL (without adding history entries). Batched, and written after movement stops
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

  // Show the license tab only when the manifest has an attribution or a license (same as the viewer's license tab)
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
      // If there are two or more Canvases with points, open the one given by canvas in the URL
      const canvases = geoCanvasId ? geoCanvasesOf(manifest, locale) : [];
      // As in the viewer, either a number (from 1, the position in the manifest) or an id is accepted
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
      const listed = geoAnnotations(geoFeatures, annotations);
      setAnnotations(listed);
      // the map names a place as the list does (in the page language)
      setGeoFeatures(geoFeaturesNamedBy(geoFeatures, listed));
      geoFeatures = geoFeaturesNamedBy(geoFeatures, listed);
      // Select the point given by id in the URL
      const id = urlState?.id;
      const selected = id ? featureIdFromParam(geoFeatures, id) : undefined;
      if (selected) setSelectedAnnotationId(selected);
    });
  }, [manifestUrl, urlState, setManifest, setAnnotations, setSelectedAnnotationId, locale]);

  const handleManifestSubmit = async (manifestUrl: string) => {
    setManifestUrl(manifestUrl);
    // Make sure that sharing the URL opens the same thing even when it was opened from the input field
    const params = new URLSearchParams(window.location.search);
    params.set('iiif-content', manifestUrl);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  };

  // Write the selected point to id in the URL. To match geo.ldas.jp links, use the feature id when it has one
  useEffect(() => {
    if (geoFeatures.length === 0) return;
    const idx = geoFeatures.findIndex((f, i) => geoFeatureIdOf(f, i) === selectedAnnotationId);
    writeParams({ id: idx < 0 ? null : (geoFeatures[idx].id ?? geoFeatureIdOf(geoFeatures[idx], idx)) });
  }, [selectedAnnotationId, geoFeatures, writeParams]);

  // Pairs of image points and map points
  const georefPairs = useMemo(() => pairsOf(geoFeatures), [geoFeatures]);
  // Rotation that puts north up. Only available when there are two or more points
  const autoRotation = useMemo(() => northUpRotation(georefPairs), [georefPairs]);

  // On load, if the URL has no rotation, rotate so north is up (same as geo.ldas.jp). Only once per document
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

  // Overlay the image on the map. Compute the four corners from the control points (first-order polynomial, when there are three or more control points).
  // Only when the Canvas has a single image covering the whole of it (partial images and rotation are not handled)
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

  // Switch to another Canvas. Use that Canvas's points, list and image orientation, and write it to canvas in the URL
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
    // As on load, rotate so north is up (do not rotate when there are fewer than two points)
    changeRotation(northUpRotation(pairsOf(c.features)) ?? 0);
    writeParams({ canvas: index === 0 ? null : c.id, zoom: null, centerX: null, centerY: null });
  };

  // Filtering of the list. Numbers and notes are looked up in the order before filtering
  const tagFacets = useMemo(() => georefTagFacets(annotations), [annotations]);
  const visibleIndices = useMemo(
    () => filterGeorefFeatures(geoFeatures, annotations, { query: searchQuery, tags: tagFilter }),
    [geoFeatures, annotations, searchQuery, tagFilter]
  );
  const filtering = searchQuery.trim() !== '' || tagFilter.length > 0;
  const toggleTag = (tag: string) =>
    setTagFilter((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  // When selected from a mark on the image. Do not rotate the image (the mark was clicked in the current orientation)
  const handleFeatureClick = (id: string) => {
    setSelectedAnnotationId(id);
  };

  // When selected from the map or list. If the switch is on, rotate so north is up near that point (same as geo.ldas.jp)
  const handleFeatureSelect = (id: string) => {
    setSelectedAnnotationId(id);
    if (!autoRotateOnSelect) return;
    const idx = geoFeatures.findIndex((f, i) => geoFeatureIdOf(f, i) === id);
    const r = idx < 0 ? null : localNorthUpRotation(georefPairs, idx);
    if (r !== null) changeRotation(r);
  };

  // Scroll to the selected annotation
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
      <Suspense fallback={null}>
        <ManifestParamWatcher onChange={readUrl} />
      </Suspense>
      <Header />
      <main className="flex-1 flex overflow-hidden">
        {/* Create the map and image only after the URL has been read (to pass the zoom and center on load) */}
        {manifestUrl && urlState ? (
          <div className="flex flex-col lg:flex-row w-full h-full">
            {/* Map */}
            <div className="flex-1 min-h-0 lg:h-full lg:flex-[2] relative border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700">
              <MapView
                toolbar={
                  <>
                    <div className="whitespace-nowrap bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('map')}
                    </div>
                    {/* applies to both the map and the image */}
                    <label className="flex items-center gap-1.5 whitespace-nowrap cursor-pointer bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={clustering} onChange={(e) => changeClustering(e.target.checked)} />
                      {t('clustering')}
                    </label>
                  </>
                }
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
              {/* Wraps onto a second row on a narrow pane; each pill keeps its text on one line */}
              <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center gap-2 pointer-events-none whitespace-nowrap [&>*]:pointer-events-auto">
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
              {/* When there are two or more Canvases with points, switch between previous and next */}
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
            {/* The search=1 and license=1 links of geo.ldas.jp open the panel and show it even if it is collapsed */}
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
                  {/* Filter by tag (most frequent first; each click adds or removes it) */}
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
                      // The content (description, image, tags, references) is shown with the same card as the list in the 3D view
                      const annotation = annotations[index];
                      if (!annotation) return null;
                      const wikipediaLink = feature.links?.find(link => link.type === 'primaryTopicOf')?.identifier;
                      const altNames = feature.names?.filter(name => name.toponym !== feature.properties.title);
                      // ID column of the geo.ldas.jp list (points can be searched by ID too)
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
                          {/* Place name aliases and Wikipedia are only in georef features (Linked Places format) */}
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
            {/* Entry screen. When the content is taller than the screen, lay it out from the top and scroll (centering would cut off the top). The width goes up to 768px, close to the top page */}
            <div className="m-auto w-full max-w-3xl">
              <ManifestInput
                onSubmit={handleManifestSubmit}
                title={t('entryTitle')}
                description={t('entryDescription')}
                useCases={GEOREF_USE_CASES}
              >
                {/* So that people forwarded from geo.ldas.jp can tell what this screen is and how to use it */}
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
