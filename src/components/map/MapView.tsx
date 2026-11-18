'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/** Image to overlay on the map (e-zu, old map). corners are the longitude and latitude of top-left, top-right, bottom-right, bottom-left. */
export interface MapImageOverlay {
  url: string;
  corners: LngLat[];
}

interface MapViewProps {
  features: GeoFeature[];
  selectedId: string | null;
  onFeatureClick: (id: string) => void;
  overlay?: MapImageOverlay | null;
  /** Zoom and center on load (mapZoom, mapLat, mapLng in the URL). If absent, use a zoom that fits all points. */
  initialView?: GeorefMapView;
  /** Points to mark (lat, lng in the URL). */
  focus?: { lat: number; lng: number };
  /** Point selected on load. When initialView is given, do not fly to it. */
  initialSelectedId?: string | null;
  /** Called every time the map stops moving. */
  onViewChange?: (view: GeorefMapView) => void;
  /** Whether to merge nearby points into one and show the count (clustering in the URL). Default is to show. */
  clustering?: boolean;
  /** When this changes, refit to a zoom that fits all points (when switching between Canvases that have points). */
  fitKey?: string;
  /** Controls placed at the top left, in the same row as the place search (they wrap together on a narrow map). */
  toolbar?: ReactNode;
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
// Merge distance (screen px) and the zoom at which merging stops. geo.ldas.jp uses 50 and 14, but
// at 14 nearby buildings overlap and cannot be told apart, so keep merging until zoomed in further
const CLUSTER_RADIUS = 50;
const CLUSTER_MAX_ZOOM = 19;
// Upper limit of entries in the list of points at the same place
const CLUSTER_LIST_MAX = 100;

// "Show all" button. After zooming or panning by hand, return to the zoom that fits all pins.
// Put it in a frame that looks the same as the zoom buttons (NavigationControl)
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
    // Mark of four corner brackets (fit to all)
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
  toolbar,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // Name shown when hovering over a point, and the list of points at the same place
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const listPopupRef = useRef<maplibregl.Popup | null>(null);
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const t = useTranslations('GeoRef');
  const mapReadyRef = useRef(false);
  const featuresRef = useRef(features);
  const selectedIdRef = useRef(selectedId);
  const onFeatureClickRef = useRef(onFeatureClick);

  // Update the refs with the latest values
  featuresRef.current = features;
  selectedIdRef.current = selectedId;
  onFeatureClickRef.current = onFeatureClick;
  const onViewChangeRef = useRef(onViewChange);
  const clusteringRef = useRef(clustering);
  clusteringRef.current = clustering;

  // Current zoom and center. Also used as the starting point when the map is rebuilt (theme or language switch)
  const viewRef = useRef<GeorefMapView | null>(initialView ?? null);
  // Whether zoom and center are fixed (given by the URL, or moved by the user). If so, do not fit to all automatically
  const keepViewRef = useRef(Boolean(initialView));
  // When the URL fixes the zoom and center, do not fly to the selection on load (id in the URL).
  // Points are loaded after the map, so tell by the point that was selected first
  const initialSelectedIdRef = useRef(initialSelectedId);
  const firstSelectionRef = useRef(true);
  const hasInitialView = useRef(Boolean(initialView));
  const focusRef = useRef(focus);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
    initialSelectedIdRef.current = initialSelectedId;
  });

  // Base map. Rebuild the map when it is switched (zoom and center, points and overlaid image are carried over)
  const [basemap, setBasemap] = useState<BasemapId>('standard');
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // Place name search. Mark the selected place (re-add it when the map is rebuilt)
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[] | null>(null);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState(false);
  const placeAbortRef = useRef<AbortController | null>(null);
  const placeRef = useRef<PlaceResult | null>(null);
  const placeMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Shown when the current location could not be obtained (not permitted, or timed out)
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

  // Visibility and opacity of the overlaid image. Carried over even when the map is rebuilt (theme or language switch)
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const overlayRef = useRef(overlay);
  const overlayStateRef = useRef({ visible: overlayVisible, opacity: overlayOpacity });
  overlayRef.current = overlay;
  overlayStateRef.current = { visible: overlayVisible, opacity: overlayOpacity };

  // Put the image on the map. Given the four corners, the map library fills in and draws between them.
  // Insert it below the points layer, so that points are always drawn in front of the image
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

  // Convert the language code to OpenMapTiles format
  const getMapLanguage = (loc: string) => {
    switch (loc) {
      case 'ja': return 'ja';
      case 'en': return 'en';
      default: return 'en';
    }
  };

  // Draw points as map layers (placing HTML marks one by one gets slower on every move with thousands of points).
  // Merge nearby points into one circle and show the count (clustering). The map library counts the merge in a separate thread.
  // The selected point is drawn in red on top in a separate layer, so that it is not hidden in a cluster
  const pointsData = (): GeoJSON.FeatureCollection<GeoJSON.Point> => {
    const all = featuresRef.current;
    return {
      type: 'FeatureCollection',
      features: all.flatMap((feature, idx) => {
        // Skip coordinates that cannot be shown in the Web Mercator projection (latitude beyond ±85 degrees)
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
        // Larger as the count grows
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
        // Fonts served by the base map style (Rekichizu only has LINE Seed JP)
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
    });    // Marker that the points layer has been drawn (so that measurement and tests can tell it is finished. Points have no elements)
    mapContainer.current?.setAttribute('data-georef-map-points', '');
  };

  // When points change, redraw and fit to a zoom that shows everything
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

  // Names of link types. Unknown types are shown as they are (same as geo.ldas.jp)
  const linkLabel = (type: string): string => {
    const key = `linkType.${type}`;
    return t.has(key) ? t(key) : type;
  };

  // Name, image, tags and links shown above a point
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
  // Wait a little even after leaving the mark. If the pointer moves onto the popup in that time, it does not close (so the links inside can be clicked)
  const closePopupSoon = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(closePopup, 300);
  };
  const pinnedRef = useRef(false);
  const closeList = () => {
    listPopupRef.current?.remove();
    listPopupRef.current = null;
  };

  // A group of points at the same place. They do not separate even at maximum zoom, so show a list of names to choose from
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

  // When a point or cluster is clicked or hovered. Listening per layer would fire twice for overlapping layers, so look only at the topmost one
  const handleMapClick = async (e: maplibregl.MapMouseEvent) => {
    const m = map.current;
    if (!m || !m.getLayer(POINT_LAYER)) return;
    const hit = m.queryRenderedFeatures(e.point, { layers: [SELECTED_LAYER, POINT_LAYER, CLUSTERS_LAYER] })[0];
    if (!hit || hit.layer.id === CLUSTERS_LAYER) closePopup();
    if (!hit) return;
    if (hit.layer.id !== CLUSTERS_LAYER) {
      const fid = String(hit.properties.fid);
      closeList();
      // Keep the popup of a clicked point until the close button or another place on the map is pressed (so links can be clicked on touch screens too)
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
    // If it does not separate until the merge-limit zoom is exceeded (points at the same place), show the list
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

  // Popup with point name, tags and links. pinned means opened by a click (has a close button and is not removed when leaving the mark)
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

  // Fit so that all pins are visible (at globe scale it is continent scale, for a town it is street scale).
  // The upper limit is about where buildings are visible, so it does not zoom in too much when there is one pin or they are very close.
  // Used on load and when the "Show all" button is pressed
  // When fitting automatically (auto), do nothing if the zoom and center are fixed.
  // If a point is selected, keep the overall zoom and center on that point
  const fitAll = (duration = 600, auto = false) => {
    const currentFeatures = featuresRef.current;
    if (!map.current || currentFeatures.length === 0) return;
    if (auto && keepViewRef.current) return;
    // Once "Show all" is pressed, do not fit automatically afterwards
    if (!auto) keepViewRef.current = true;
    const bounds = new maplibregl.LngLatBounds();
    currentFeatures.forEach(f => bounds.extend(f.geometry.coordinates));
    // When an image is overlaid, also fit the whole image
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

    // Remove the existing map
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    // The default is OpenFreeMap vector tiles (multilingual). Others are in basemaps.ts
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

    // When movement ends, remember the zoom and center and report them (written to the URL).
    // If the user moved the map (an event that originated the operation exists), do not fit automatically afterwards.
    // Do not count moves the map made itself to fit the frame size (e.g. when opened on a narrow screen)
    const reportView = () => {
      const m = map.current;
      if (!m) return;
      const c = m.getCenter();
      viewRef.current = { zoom: m.getZoom(), lat: c.lat, lng: c.lng };
      onViewChangeRef.current?.(viewRef.current);
    };
    map.current.on('click', (e) => void handleMapClickRef.current(e));
    map.current.on('mousemove', (e) => handleMapHoverRef.current(e));
    // When the pointer leaves the map. Moving onto the popup also comes here, so do not close right away
    map.current.on('mouseout', () => {
      hoveredRef.current = null;
      if (!pinnedRef.current) closePopupSoon();
    });
    map.current.on('moveend', (e) => {
      if (e.originalEvent) keepViewRef.current = true;
      reportView();
    });

    // Mark the point given by lat and lng in the URL and show its coordinates
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
    // Current location. When pressed, show a blue dot at the place and move there (a map library component)
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

    // After the style loads, set the language and add markers
    map.current.on('load', () => {
      if (!map.current) return;

      const style = map.current.getStyle();
      if (!style || !style.layers) return;

      // Find the text label layers and change the language
      if (base.localizeLabels) style.layers.forEach((layer) => {
        if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
          const textField = layer.layout['text-field'];
          if (textField && typeof textField === 'object') {
            // Specify the language in a form such as name:ja or name:en
            map.current!.setLayoutProperty(
              layer.id,
              'text-field',
              ['coalesce', ['get', `name:${lang}`], ['get', 'name']]
            );
          }
        }
      });

      // Fold the credits into the "i" button when they are shown compact (always for a basemap with
      // long credits such as rekichizu, and on a narrow map), so they do not cover "Overlay image" below.
      const attrib = mapContainer.current?.querySelector('.maplibregl-ctrl-attrib');
      if (base.collapseAttribution || attrib?.classList.contains('maplibregl-compact')) {
        attrib?.classList.remove('maplibregl-compact-show');
      }

      mapReadyRef.current = true;
      // Also write the zoom and center on load to the URL (moveend does not fire if the map is not moved)
      reportView();

      // After the map is ready, add points and the image
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

  // When points change, redraw
  useEffect(() => {
    updatePoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features]);

  // Switch between merging and not merging
  useEffect(() => {
    const source = map.current?.getSource<maplibregl.GeoJSONSource>(POINTS_SOURCE);
    if (!source || !mapReadyRef.current) return;
    listPopupRef.current?.remove();
    listPopupRef.current = null;
    void source.setClusterOptions({ cluster: clustering, clusterRadius: CLUSTER_RADIUS, clusterMaxZoom: CLUSTER_MAX_ZOOM });
  }, [clustering]);

  // When the overlaid image changes, re-add it and return to a zoom that shows everything
  useEffect(() => {
    syncOverlay();
    fitAll(0, true);
  }, [overlay?.url, overlay?.corners]);

  // When switching to another Canvas, refit to a zoom that fits its points, even after a manual move.
  // When the first Canvas is decided by loading (undetermined to id) it is not a switch, so keep the zoom and center from the URL
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

  // Draw the selected point in red
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
        // Move to the selected pin. Do not zoom out from the current level (keep the overall-fit zoom and only move the center)
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
      {/* The toolbar on the left, then the place search and the basemap to the left of the zoom buttons.
          One wrapping row: on a narrow map the search moves to the next line instead of covering the toolbar. */}
      <div className="absolute top-4 right-12 left-4 z-10 flex flex-wrap items-start gap-2 pointer-events-none text-sm">
        {toolbar && <div className="flex flex-wrap items-center gap-2 pointer-events-auto">{toolbar}</div>}
        <div className="ml-auto flex min-w-0 flex-[1_1_20rem] items-start justify-end gap-2">
        <div className="relative min-w-40 max-w-56 flex-1 pointer-events-auto">
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
          className="pointer-events-auto shrink-0 rounded-md bg-white/95 dark:bg-gray-800/95 px-2 py-1.5 shadow text-gray-900 dark:text-gray-100"
        >
          {BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {t(b.labelKey)}
            </option>
          ))}
        </select>
        </div>
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
