'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// The worker file is copied to public/ at build time (scripts/copy-maplibre-worker.mjs)
maplibregl.setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/maplibre/maplibre-gl-worker.mjs`);
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import {
  geoFeatureIdOf,
  geoFeatureLinksOf,
  geoFeatureTagsOf,
  type GeoFeature,
  type GeorefMapView,
  type LngLat,
} from 'iiif-kasane/core';
import { BASEMAPS, basemapOf, type BasemapId } from './basemaps';
import { searchPlaces, type PlaceResult } from './placeSearch';

/** 地図に重ねる画像（絵図・古地図）。corners は左上・右上・右下・左下の経度・緯度。 */
export interface MapImageOverlay {
  url: string;
  corners: LngLat[];
}

interface MapViewProps {
  features: GeoFeature[];
  selectedId: string | null;
  onFeatureClick: (id: string) => void;
  overlay?: MapImageOverlay | null;
  /** 開いたときの縮尺と中心（URL の mapZoom・mapLat・mapLng）。無ければすべての地点が収まる縮尺にする。 */
  initialView?: GeorefMapView;
  /** 印を立てる地点（URL の lat・lng）。 */
  focus?: { lat: number; lng: number };
  /** 開いたときに選んである地点。initialView があるときは、そこへは飛ばない。 */
  initialSelectedId?: string | null;
  /** 地図を動かし終えるたびに呼ぶ。 */
  onViewChange?: (view: GeorefMapView) => void;
  /** 近い地点を 1 つにまとめて件数を出すか（URL の clustering）。既定は出す。 */
  clustering?: boolean;
  /** これが変わったら、すべての地点が収まる縮尺に合わせ直す（地点の付いた Canvas を切り替えたとき）。 */
  fitKey?: string;
}

const OVERLAY_SOURCE = 'georef-overlay';
const OVERLAY_LAYER = 'georef-overlay';
const POINTS_SOURCE = 'georef-points';
const SELECTED_SOURCE = 'georef-selected';
const CLUSTERS_LAYER = 'georef-clusters';
const CLUSTER_COUNT_LAYER = 'georef-cluster-count';
const POINT_LAYER = 'georef-point';
const SELECTED_LAYER = 'georef-selected';
const POINT_LAYERS = [CLUSTERS_LAYER, CLUSTER_COUNT_LAYER, POINT_LAYER, SELECTED_LAYER];
const POINT_COLOR = '#3b82f6';
const SELECTED_COLOR = '#ef4444';
// まとめる距離（画面の px）と、まとめるのをやめる縮尺。geo.ldas.jp は 50 と 14 だが、
// 14 では近い建物どうしが重なって押し分けられないので、もっと寄るまでまとめる
const CLUSTER_RADIUS = 50;
const CLUSTER_MAX_ZOOM = 19;
// 同じ場所の地点の一覧に出す上限
const CLUSTER_LIST_MAX = 100;

// 「全体を表示」ボタン。手で拡大・移動したあと、すべてのピンが収まる縮尺に戻す。
// 拡大・縮小のボタン（NavigationControl）と同じ見た目の枠に入れる
class FitAllControl implements maplibregl.IControl {
  private container?: HTMLDivElement;
  constructor(private readonly label: string, private readonly onFit: () => void) {}
  onAdd() {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = this.label;
    button.setAttribute('aria-label', this.label);
    // 四隅の括弧（全体に合わせる）の印
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="margin:auto;display:block" aria-hidden="true">' +
      '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    button.addEventListener('click', this.onFit);
    container.appendChild(button);
    this.container = container;
    return container;
  }
  onRemove() {
    this.container?.remove();
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default function MapView({
  features,
  selectedId,
  onFeatureClick,
  overlay,
  initialView,
  focus,
  initialSelectedId,
  onViewChange,
  clustering = true,
  fitKey,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // 地点の上を通ったときの名前と、同じ場所の地点の一覧
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const listPopupRef = useRef<maplibregl.Popup | null>(null);
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const t = useTranslations('GeoRef');
  const mapReadyRef = useRef(false);
  const featuresRef = useRef(features);
  const selectedIdRef = useRef(selectedId);
  const onFeatureClickRef = useRef(onFeatureClick);

  // Refsを最新の値で更新
  featuresRef.current = features;
  selectedIdRef.current = selectedId;
  onFeatureClickRef.current = onFeatureClick;
  const onViewChangeRef = useRef(onViewChange);
  const clusteringRef = useRef(clustering);
  clusteringRef.current = clustering;

  // 今の縮尺と中心。地図を作り直したとき（テーマ・言語の切り替え）もここから始める
  const viewRef = useRef<GeorefMapView | null>(initialView ?? null);
  // 縮尺と中心が決まっているか（URL で与えられた、または人が動かした）。決まっていれば自動で全体に合わせない
  const keepViewRef = useRef(Boolean(initialView));
  // URL で縮尺と中心が決まっているときは、開いたときの選択（URL の id）へは飛ばない。
  // 地点は地図より後に読み込まれるので、最初に選ばれた地点で見分ける
  const initialSelectedIdRef = useRef(initialSelectedId);
  const firstSelectionRef = useRef(true);
  const hasInitialView = useRef(Boolean(initialView));
  const focusRef = useRef(focus);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
    initialSelectedIdRef.current = initialSelectedId;
  });

  // 背景地図。切り替えたら地図を作り直す（縮尺と中心・地点・重ねた画像は引き継ぐ）
  const [basemap, setBasemap] = useState<BasemapId>('standard');
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // 地名検索。選んだ場所には印を立てる（地図を作り直しても立て直す）
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[] | null>(null);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState(false);
  const placeAbortRef = useRef<AbortController | null>(null);
  const placeRef = useRef<PlaceResult | null>(null);
  const placeMarkerRef = useRef<maplibregl.Marker | null>(null);
  // 現在地が取れなかったとき（許可されなかった・時間切れ）に出す
  const [geolocateError, setGeolocateError] = useState(false);

  const showPlace = () => {
    const m = map.current;
    const place = placeRef.current;
    placeMarkerRef.current?.remove();
    placeMarkerRef.current = null;
    if (!m || !place) return;
    placeMarkerRef.current = new maplibregl.Marker({ color: '#f97316' })
      .setLngLat([place.lng, place.lat])
      .setPopup(new maplibregl.Popup({ closeOnClick: false, maxWidth: '240px' }).setText(place.name))
      .addTo(m)
      .togglePopup();
  };

  const runPlaceSearch = async () => {
    placeAbortRef.current?.abort();
    const q = placeQuery.trim();
    if (!q) {
      setPlaceResults(null);
      return;
    }
    const ac = new AbortController();
    placeAbortRef.current = ac;
    setPlaceSearching(true);
    setPlaceError(false);
    try {
      const results = await searchPlaces(q, locale, ac.signal);
      if (!ac.signal.aborted) setPlaceResults(results);
    } catch {
      if (!ac.signal.aborted) {
        setPlaceResults(null);
        setPlaceError(true);
      }
    } finally {
      if (!ac.signal.aborted) setPlaceSearching(false);
    }
  };

  const selectPlace = (place: PlaceResult) => {
    placeRef.current = place;
    setPlaceResults(null);
    keepViewRef.current = true;
    showPlace();
    map.current?.flyTo({ center: [place.lng, place.lat], zoom: 15, duration: 1000 });
  };

  // 重ねた画像の表示と濃さ。地図を作り直しても（テーマ・言語の切り替え）引き継ぐ
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const overlayRef = useRef(overlay);
  const overlayStateRef = useRef({ visible: overlayVisible, opacity: overlayOpacity });
  overlayRef.current = overlay;
  overlayStateRef.current = { visible: overlayVisible, opacity: overlayOpacity };

  // 画像を地図に貼る。四隅を指定すると、地図ライブラリがその間を埋めて描く。
  // 地点の層より下に入れ、地点は画像より常に手前に出す
  const syncOverlay = () => {
    const m = map.current;
    if (!m || !mapReadyRef.current) return;
    const current = overlayRef.current;
    if (m.getLayer(OVERLAY_LAYER)) m.removeLayer(OVERLAY_LAYER);
    if (m.getSource(OVERLAY_SOURCE)) m.removeSource(OVERLAY_SOURCE);
    if (!current) return;
    m.addSource(OVERLAY_SOURCE, {
      type: 'image',
      url: current.url,
      coordinates: current.corners as [LngLat, LngLat, LngLat, LngLat],
    });
    const { visible, opacity } = overlayStateRef.current;
    m.addLayer({
      id: OVERLAY_LAYER,
      type: 'raster',
      source: OVERLAY_SOURCE,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
    }, m.getLayer(CLUSTERS_LAYER) ? CLUSTERS_LAYER : undefined);
  };

  // 言語コードをOpenMapTiles形式に変換
  const getMapLanguage = (loc: string) => {
    switch (loc) {
      case 'ja': return 'ja';
      case 'en': return 'en';
      default: return 'en';
    }
  };

  // 地点を地図の層として描く（HTML の印を 1 つずつ置くと、数千件で動かすたびに重くなる）。
  // 近い地点は 1 つの円にまとめて件数を出す（clustering）。まとめは地図ライブラリが別スレッドで数える。
  // 選んだ地点は、まとまりに隠れないよう、別の層で一番上に赤く描く
  const pointsData = (): GeoJSON.FeatureCollection<GeoJSON.Point> => {
    const all = featuresRef.current;
    return {
      type: 'FeatureCollection',
      features: all.flatMap((feature, idx) => {
        // Web Mercator投影で表示できない座標（緯度±85度超）をスキップ
        const [, lat] = feature.geometry.coordinates;
        if (lat > 85 || lat < -85) return [];
        return [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: feature.geometry.coordinates },
          properties: { fid: geoFeatureIdOf(feature, idx) },
        }];
      }),
    };
  };
  const selectedData = (): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
    type: 'FeatureCollection',
    features: pointsData().features.filter((f) => f.properties?.fid === selectedIdRef.current),
  });

  const addPointLayers = () => {
    const m = map.current;
    if (!m || !mapReadyRef.current) return;
    for (const id of POINT_LAYERS) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of [POINTS_SOURCE, SELECTED_SOURCE]) if (m.getSource(id)) m.removeSource(id);
    m.addSource(POINTS_SOURCE, {
      type: 'geojson',
      data: pointsData(),
      cluster: clusteringRef.current,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });
    m.addSource(SELECTED_SOURCE, { type: 'geojson', data: selectedData() });
    m.addLayer({
      id: CLUSTERS_LAYER,
      type: 'circle',
      source: POINTS_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': POINT_COLOR,
        'circle-opacity': 0.9,
        // 件数が多いほど大きく
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 17, 100, 21, 1000, 25],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
      },
    });
    m.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: POINTS_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        // 背景地図のスタイルが配っている字体（れきちずは LINE Seed JP しか無い）
        'text-font': basemapOf(basemapRef.current).labelFont,
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
    m.addLayer({
      id: POINT_LAYER,
      type: 'circle',
      source: POINTS_SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': POINT_COLOR,
        'circle-radius': 9,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
      },
    });
    m.addLayer({
      id: SELECTED_LAYER,
      type: 'circle',
      source: SELECTED_SOURCE,
      paint: {
        'circle-color': SELECTED_COLOR,
        'circle-radius': 10,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
      },
    });    // 地点の層を描いたことの目印（計測と試験で、描き終えたかを見分けるため。地点は要素を持たない）
    mapContainer.current?.setAttribute('data-georef-map-points', '');
  };

  // 地点が変わったら描き直し、全体が見える縮尺に合わせる
  const updatePoints = () => {
    const m = map.current;
    if (!m || !mapReadyRef.current) return;
    const source = m.getSource<maplibregl.GeoJSONSource>(POINTS_SOURCE);
    if (source) {
      source.setData(pointsData());
      m.getSource<maplibregl.GeoJSONSource>(SELECTED_SOURCE)?.setData(selectedData());
    } else {
      addPointLayers();
    }
    fitAll(0, true);
  };

  // リンクの種類の名前。知らない種類はそのまま出す（geo.ldas.jp と同じ）
  const linkLabel = (type: string): string => {
    const key = `linkType.${type}`;
    return t.has(key) ? t(key) : type;
  };

  // 地点の上に出す名前・画像・タグ・リンク
  const popupHtml = (feature: GeoFeature) => {
    const isDark = resolvedTheme === 'dark';
    const title = feature.properties.title;
    const thumbnail = feature.depictions?.[0]?.['@id'];
    const altNames = feature.names?.filter(n => n.toponym !== title).map(n => n.toponym).join(', ');
    const thumbnailHtml = thumbnail
      ? `<div style="width: 100%; max-width: 150px; margin-bottom: 8px; border-radius: 4px; overflow: hidden;">
          <img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(title)}" style="width: 100%; height: auto; display: block;" onerror="this.parentElement.style.display='none'" />
        </div>`
      : '';
    const altNamesHtml = altNames
      ? `<div style="font-size: 12px; color: ${isDark ? '#9ca3af' : '#6b7280'}; margin-top: 4px;">${escapeHtml(altNames)}</div>`
      : '';
    const tags = geoFeatureTagsOf(feature);
    const tagsHtml = tags.length > 0
      ? `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">${tags
          .map((tag) => `<span style="font-size: 11px; padding: 1px 6px; border-radius: 9999px; background-color: ${isDark ? '#374151' : '#e5e7eb'};">${escapeHtml(tag)}</span>`)
          .join('')}</div>`
      : '';
    const links = geoFeatureLinksOf(feature);
    const linksHtml = links.length > 0
      ? `<div style="margin-top: 8px; font-size: 12px;">${links
          .map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" style="color: ${isDark ? '#60a5fa' : '#2563eb'}; text-decoration: underline;">${escapeHtml(linkLabel(link.type))}</a>`)
          .join(' | ')}</div>`
      : '';
    return `<div style="padding: 8px; background-color: ${isDark ? '#1f2937' : '#ffffff'}; color: ${isDark ? '#f3f4f6' : '#111827'}; border-radius: 4px;">
        ${thumbnailHtml}
        <div style="font-weight: bold;">${escapeHtml(title)}</div>
        ${altNamesHtml}
        ${tagsHtml}
        ${linksHtml}
      </div>`;
  };

  const featureById = (fid: string): GeoFeature | undefined => {
    const all = featuresRef.current;
    const idx = all.findIndex((f, i) => geoFeatureIdOf(f, i) === fid);
    return idx < 0 ? undefined : all[idx];
  };

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const closePopup = () => {
    cancelClose();
    activePopupRef.current?.remove();
    activePopupRef.current = null;
  };
  // 印から外れても少し待つ。その間にポップアップへ乗れば閉じない（中のリンクを押せるように）
  const closePopupSoon = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(closePopup, 300);
  };
  const pinnedRef = useRef(false);
  const closeList = () => {
    listPopupRef.current?.remove();
    listPopupRef.current = null;
  };

  // 同じ場所の地点のまとまり。一番寄っても分かれないので、名前の一覧を出して選ばせる
  const showClusterList = (lngLat: maplibregl.LngLatLike, fids: string[]) => {
    const m = map.current;
    if (!m) return;
    closePopup();
    closeList();
    const isDark = resolvedTheme === 'dark';
    const items = fids
      .map((fid) => ({ fid, title: featureById(fid)?.properties.title ?? fid }))
      .map(({ fid, title }) =>
        `<li><button type="button" data-fid="${escapeHtml(fid)}" style="display:block;width:100%;text-align:left;padding:4px 8px;border-radius:4px;cursor:pointer">${escapeHtml(title)}</button></li>`)
      .join('');
    const popup = new maplibregl.Popup({ offset: 20, closeButton: true, closeOnClick: true, maxWidth: '240px', className: isDark ? 'dark-popup' : '' })
      .setLngLat(lngLat)
      .setHTML(
        `<ul style="max-height:240px;overflow-y:auto;margin:0;padding:4px 0;list-style:none;background-color:${isDark ? '#1f2937' : '#ffffff'};color:${isDark ? '#f3f4f6' : '#111827'}">${items}</ul>`
      )
      .addTo(m);
    popup.getElement().addEventListener('click', (e) => {
      const fid = (e.target as HTMLElement).closest<HTMLElement>('[data-fid]')?.dataset.fid;
      if (!fid) return;
      popup.remove();
      onFeatureClickRef.current(fid);
    });
    listPopupRef.current = popup;
  };

  // 地点・まとまりを押したとき、上を通ったとき。層ごとに受けると重なった層で 2 回届くので、一番上の 1 つだけを見る
  const handleMapClick = async (e: maplibregl.MapMouseEvent) => {
    const m = map.current;
    if (!m || !m.getLayer(POINT_LAYER)) return;
    const hit = m.queryRenderedFeatures(e.point, { layers: [SELECTED_LAYER, POINT_LAYER, CLUSTERS_LAYER] })[0];
    if (!hit || hit.layer.id === CLUSTERS_LAYER) closePopup();
    if (!hit) return;
    if (hit.layer.id !== CLUSTERS_LAYER) {
      const fid = String(hit.properties.fid);
      closeList();
      // 押した地点のポップアップは、閉じるボタンか地図の別の所を押すまで残す（タッチの画面でもリンクを押せるように）
      const feature = featureById(fid);
      if (feature) openFeaturePopup(feature, true);
      onFeatureClickRef.current(fid);
      return;
    }
    const source = m.getSource<maplibregl.GeoJSONSource>(POINTS_SOURCE);
    if (!source) return;
    const clusterId = Number(hit.properties.cluster_id);
    const center = (hit.geometry as GeoJSON.Point).coordinates as [number, number];
    const zoom = await source.getClusterExpansionZoom(clusterId);
    // まとめる上限の縮尺を超えないと分かれない（同じ場所の地点）なら、一覧を出す
    if (zoom > CLUSTER_MAX_ZOOM) {
      const leaves = await source.getClusterLeaves(clusterId, CLUSTER_LIST_MAX, 0);
      showClusterList(center, leaves.map((l) => String(l.properties?.fid)));
      return;
    }
    keepViewRef.current = true;
    m.easeTo({ center, zoom, duration: 500 });
  };

  const hoveredRef = useRef<string | null>(null);
  const handleMapHover = (e: maplibregl.MapMouseEvent) => {
    const m = map.current;
    if (!m || !m.getLayer(POINT_LAYER)) return;
    const hit = m.queryRenderedFeatures(e.point, { layers: [SELECTED_LAYER, POINT_LAYER, CLUSTERS_LAYER] })[0];
    m.getCanvas().style.cursor = hit ? 'pointer' : '';
    const fid = hit && hit.layer.id !== CLUSTERS_LAYER ? String(hit.properties.fid) : null;
    if (fid === hoveredRef.current) return;
    hoveredRef.current = fid;
    const feature = fid ? featureById(fid) : undefined;
    if (!feature) {
      if (!pinnedRef.current) closePopupSoon();
      return;
    }
    openFeaturePopup(feature, false);
  };

  // 地点の名前・タグ・リンクのポップアップ。pinned は押して開いたもの（閉じるボタンを付け、印から外れても消さない）
  const openFeaturePopup = (feature: GeoFeature, pinned: boolean) => {
    const m = map.current;
    if (!m) return;
    closePopup();
    pinnedRef.current = pinned;
    const popup = new maplibregl.Popup({
      offset: 14,
      closeButton: pinned,
      closeOnClick: false,
      className: resolvedTheme === 'dark' ? 'dark-popup' : '',
      maxWidth: '200px'
    })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(popupHtml(feature))
      .addTo(m);
    popup.on('close', () => {
      if (activePopupRef.current === popup) {
        activePopupRef.current = null;
        pinnedRef.current = false;
      }
    });
    const el = popup.getElement();
    el.addEventListener('mouseenter', cancelClose);
    el.addEventListener('mouseleave', () => {
      if (pinnedRef.current) return;
      hoveredRef.current = null;
      closePopupSoon();
    });
    activePopupRef.current = popup;
  };
  const handleMapClickRef = useRef(handleMapClick);
  handleMapClickRef.current = handleMapClick;
  const handleMapHoverRef = useRef(handleMapHover);
  handleMapHoverRef.current = handleMapHover;

  // すべてのピンが収まるように合わせる（地球儀なら大陸の規模、街なら通りの規模になる）。
  // ピンが 1 つ・ごく近いときに寄りすぎないよう、上限は建物が見える程度。
  // 開いたときと、「全体を表示」ボタンを押したときに使う
  // 自動で合わせるとき（auto）は、縮尺と中心が決まっていれば何もしない。
  // 地点を選んであれば、全体の縮尺のまま、その地点を中心にする
  const fitAll = (duration = 600, auto = false) => {
    const currentFeatures = featuresRef.current;
    if (!map.current || currentFeatures.length === 0) return;
    if (auto && keepViewRef.current) return;
    // 「全体を表示」を押したら、以後は自動で合わせない
    if (!auto) keepViewRef.current = true;
    const bounds = new maplibregl.LngLatBounds();
    currentFeatures.forEach(f => bounds.extend(f.geometry.coordinates));
    // 画像を重ねているときは、画像の全体も収める
    overlayRef.current?.corners.forEach(c => bounds.extend(c));
    map.current.fitBounds(bounds, { padding: 50, maxZoom: 17, duration });
    const selected = auto
      ? currentFeatures.find((f, idx) => geoFeatureIdOf(f, idx) === selectedIdRef.current)
      : undefined;
    if (selected) {
      map.current.jumpTo({ center: selected.geometry.coordinates, zoom: Math.max(map.current.getZoom(), 4) });
    }
  };
  const fitAllRef = useRef(fitAll);
  fitAllRef.current = fitAll;

  useEffect(() => {
    if (!mapContainer.current) return;

    const lang = getMapLanguage(locale);

    // 既存のマップを削除
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    // 標準は OpenFreeMap のベクタータイル（多言語対応）。ほかは basemaps.ts
    const base = basemapOf(basemap);
    const styleUrl = base.style(resolvedTheme === 'dark');

    const start = viewRef.current;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: start ? [start.lng, start.lat] : [0, 30],
      zoom: start ? start.zoom : 1,
      attributionControl: { compact: base.collapseAttribution || undefined },
    });

    // 動かし終えたら、縮尺と中心を覚えて知らせる（URL に書く）。
    // 人が動かしたら（操作の元になったイベントがあれば）、以後は自動で合わせない。
    // 地図が枠の大きさに合わせて自分で動いたとき（狭い画面で開いたときなど）は数えない
    const reportView = () => {
      const m = map.current;
      if (!m) return;
      const c = m.getCenter();
      viewRef.current = { zoom: m.getZoom(), lat: c.lat, lng: c.lng };
      onViewChangeRef.current?.(viewRef.current);
    };
    map.current.on('click', (e) => void handleMapClickRef.current(e));
    map.current.on('mousemove', (e) => handleMapHoverRef.current(e));
    // 地図の外へ出たとき。ポップアップの上へ移ったときもここに来るので、すぐには閉じない
    map.current.on('mouseout', () => {
      hoveredRef.current = null;
      if (!pinnedRef.current) closePopupSoon();
    });
    map.current.on('moveend', (e) => {
      if (e.originalEvent) keepViewRef.current = true;
      reportView();
    });

    // URL の lat・lng の地点に印を立て、座標を出しておく
    const focus = focusRef.current;
    if (focus) {
      new maplibregl.Marker({ color: '#f97316' })
        .setLngLat([focus.lng, focus.lat])
        .setPopup(new maplibregl.Popup({ closeOnClick: false }).setText(`${t('coordinates')}: ${focus.lat.toFixed(6)}, ${focus.lng.toFixed(6)}`))
        .addTo(map.current)
        .togglePopup();
    }

    map.current.addControl(new maplibregl.NavigationControl());
    map.current.addControl(new FitAllControl(t('fitAll'), () => fitAllRef.current()));
    // 現在地。押すと、いる場所に青い点を出して寄る（地図ライブラリの部品）
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000 },
      fitBoundsOptions: { maxZoom: 15 },
    });
    geolocate.on('geolocate', () => {
      keepViewRef.current = true;
      setGeolocateError(false);
    });
    geolocate.on('error', () => setGeolocateError(true));
    map.current.addControl(geolocate);
    showPlace();

    // スタイル読み込み後に言語を設定してマーカーを追加
    map.current.on('load', () => {
      if (!map.current) return;

      const style = map.current.getStyle();
      if (!style || !style.layers) return;

      // テキストラベルのレイヤーを探して言語を変更
      if (base.localizeLabels) style.layers.forEach((layer) => {
        if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
          const textField = layer.layout['text-field'];
          if (textField && typeof textField === 'object') {
            // name:ja, name:en などの形式で言語を指定
            map.current!.setLayoutProperty(
              layer.id,
              'text-field',
              ['coalesce', ['get', `name:${lang}`], ['get', 'name']]
            );
          }
        }
      });

      // 出典の長い地図（れきちず）は、出典を「i」のボタンに畳む（下の「画像を重ねる」に重なるため）
      if (base.collapseAttribution) {
        mapContainer.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      }

      mapReadyRef.current = true;
      // 開いたときの縮尺と中心も URL に書く（動かさなければ moveend が来ないため）
      reportView();

      // マップ準備完了後に地点と画像を追加
      addPointLayers();
      syncOverlay();
      fitAll(0, true);
    });

    return () => {
      mapReadyRef.current = false;
      map.current?.remove();
      map.current = null;
    };
  }, [locale, resolvedTheme, basemap]);

  // 地点が変わったら描き直す
  useEffect(() => {
    updatePoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features]);

  // まとめる・まとめないを切り替える
  useEffect(() => {
    const source = map.current?.getSource<maplibregl.GeoJSONSource>(POINTS_SOURCE);
    if (!source || !mapReadyRef.current) return;
    listPopupRef.current?.remove();
    listPopupRef.current = null;
    void source.setClusterOptions({ cluster: clustering, clusterRadius: CLUSTER_RADIUS, clusterMaxZoom: CLUSTER_MAX_ZOOM });
  }, [clustering]);

  // 重ねる画像が変わったら貼り直し、全体が見える縮尺に戻す
  useEffect(() => {
    syncOverlay();
    fitAll(0, true);
  }, [overlay?.url, overlay?.corners]);

  // 別の Canvas に切り替えたら、手で動かした後でも、その地点が収まる縮尺に合わせ直す。
  // 読み込みで最初の Canvas が決まったとき（未定 → id）は切り替えではないので、URL の縮尺と中心を残す
  const fitKeyRef = useRef(fitKey);
  useEffect(() => {
    if (fitKeyRef.current === fitKey) return;
    const first = fitKeyRef.current === undefined;
    fitKeyRef.current = fitKey;
    if (first) return;
    keepViewRef.current = false;
    fitAll(600, true);
  }, [fitKey]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mapReadyRef.current || !m.getLayer(OVERLAY_LAYER)) return;
    m.setLayoutProperty(OVERLAY_LAYER, 'visibility', overlayVisible ? 'visible' : 'none');
    m.setPaintProperty(OVERLAY_LAYER, 'raster-opacity', overlayOpacity);
  }, [overlayVisible, overlayOpacity]);

  // 選んだ地点を赤く描く
  useEffect(() => {
    if (mapReadyRef.current) map.current?.getSource<maplibregl.GeoJSONSource>(SELECTED_SOURCE)?.setData(selectedData());

    if (selectedId && firstSelectionRef.current) {
      firstSelectionRef.current = false;
      if (hasInitialView.current && selectedId === initialSelectedIdRef.current) return;
    }

    // Fly to selected marker
    if (selectedId) {
      const feature = features.find((f, idx) => geoFeatureIdOf(f, idx) === selectedId);
      if (feature && map.current) {
        keepViewRef.current = true;
        // 選んだピンへ移る。今より引かない（全体に合わせた拡大のまま、中心だけ動かす）
        map.current.flyTo({
          center: feature.geometry.coordinates,
          zoom: Math.max(map.current.getZoom(), 4),
          duration: 1000
        });
      }
    }
  }, [selectedId, features]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      {/* 地名検索と背景地図。右上の拡大・縮小のボタンの左に置く（左上の「地図」の札は避ける） */}
      <div className="absolute top-2.5 right-12 left-20 z-10 flex flex-wrap items-start justify-end gap-2 pointer-events-none text-sm">
        <div className="relative w-56 max-w-full pointer-events-auto">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void runPlaceSearch();
            }}
            className="flex rounded-md bg-white/95 dark:bg-gray-800/95 shadow"
          >
            <input
              type="search"
              value={placeQuery}
              onChange={(e) => {
                setPlaceQuery(e.target.value);
                if (!e.target.value) setPlaceResults(null);
              }}
              placeholder={t('placeSearch')}
              aria-label={t('placeSearch')}
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-gray-900 dark:text-gray-100 outline-none"
            />
            <button
              type="submit"
              title={t('placeSearch')}
              aria-label={t('placeSearch')}
              className="px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          </form>
          {(placeSearching || placeError || placeResults) && (
            <div className="absolute mt-1 w-full max-h-72 overflow-y-auto rounded-md bg-white dark:bg-gray-800 shadow text-gray-800 dark:text-gray-100">
              {placeSearching ? (
                <p className="px-3 py-2 text-gray-500 dark:text-gray-400">{t('placeSearching')}</p>
              ) : placeError ? (
                <p className="px-3 py-2 text-red-600 dark:text-red-400">{t('placeSearchFailed')}</p>
              ) : placeResults && placeResults.length === 0 ? (
                <p className="px-3 py-2 text-gray-500 dark:text-gray-400">{t('noResults')}</p>
              ) : (
                <>
                  <ul>
                    {placeResults?.map((p, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => selectPlace(p)}
                          className="block w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <span className="block break-words">{p.name}</span>
                          {p.type && <span className="block text-xs text-gray-500 dark:text-gray-400">{p.type}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-gray-200 dark:border-gray-700 px-3 py-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {t('placeSearchCredit')}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        <select
          value={basemap}
          onChange={(e) => setBasemap(e.target.value as BasemapId)}
          aria-label={t('basemap')}
          title={t('basemap')}
          className="pointer-events-auto rounded-md bg-white/95 dark:bg-gray-800/95 px-2 py-1.5 shadow text-gray-900 dark:text-gray-100"
        >
          {BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {t(b.labelKey)}
            </option>
          ))}
        </select>
      </div>
      {geolocateError && (
        <div role="alert" className="absolute bottom-8 right-2 z-10 flex items-center gap-2 rounded-md bg-white/95 dark:bg-gray-800/95 px-3 py-2 shadow text-sm text-red-600 dark:text-red-400">
          {t('geolocateFailed')}
          <button type="button" onClick={() => setGeolocateError(false)} aria-label={t('close')} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            ×
          </button>
        </div>
      )}
      {overlay && (
        <div className="absolute bottom-8 left-2 z-10 flex items-center gap-2 rounded-md bg-white/90 dark:bg-gray-800/90 px-3 py-2 shadow text-sm text-gray-700 dark:text-gray-200">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={overlayVisible}
              onChange={(e) => setOverlayVisible(e.target.checked)}
            />
            {t('overlayImage')}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={overlayOpacity}
            disabled={!overlayVisible}
            onChange={(e) => setOverlayOpacity(Number(e.target.value))}
            aria-label={t('overlayOpacity')}
            title={t('overlayOpacity')}
            className="w-24 disabled:opacity-40"
          />
        </div>
      )}
    </div>
  );
}
