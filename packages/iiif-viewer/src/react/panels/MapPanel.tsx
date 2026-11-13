'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  fitMapView,
  mapBoundsOf,
  mapPlacesOf,
  panBy,
  tilesFor,
  toFrame,
  zoomAround,
  type MapPlace,
  type MapShape,
  type MapView,
} from '../../core';
import { manifestAtom } from '../atoms';
import { navRequestAtom, nextSeq, useManifestSwitch } from '../displays/structureState';
import { useLocale, useTranslations } from '../env';
import type { Panel, PanelContext } from './types';

// 場所（navPlace・GeoJSON の注釈）を地図に載せるタブ。地図の部品は使わず、
// OpenStreetMap のタイル画像を並べ、その上に SVG で場所を描く（パッケージを軽く保つため）。
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const HEIGHT = 260;

const pathOf = (s: MapShape, view: MapView, w: number, h: number): string => {
  const pt = (p: [number, number]) => toFrame(p, view, w, h).map((v) => v.toFixed(1)).join(',');
  if (s.kind === 'line') return `M${s.coords.map(pt).join('L')}`;
  if (s.kind === 'polygon') return s.rings.map((r) => `M${r.map(pt).join('L')}Z`).join('');
  return '';
};

const dateOf = (iso: string, locale: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(t);
  } catch {
    return iso;
  }
};

function MapPanel({ manifest, container }: PanelContext) {
  const t = useTranslations('Map');
  const locale = useLocale();
  const fromAtom = useAtomValue(manifestAtom);
  const m = manifest ?? fromAtom;
  const setRequest = useSetAtom(navRequestAtom);
  const { open } = useManifestSwitch();
  const places = useMemo(() => mapPlacesOf(m, locale), [m, locale]);
  const bounds = useMemo(() => mapBoundsOf(places), [places]);
  const current = container?.id;

  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // 手で動かした地図の位置。資料が替わる（bounds が変わる）までは、これを使う。
  // 手で動かすまでは、幅に合わせて、すべての場所が収まる位置を毎回計算する
  const [manual, setManual] = useState<{ bounds: typeof bounds; view: MapView } | null>(null);
  const [picked, setPicked] = useState<{ bounds: typeof bounds; key: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fitted = useMemo(() => (bounds && width > 0 ? fitMapView(bounds, width, HEIGHT, 40) : null), [bounds, width]);
  const view = manual && manual.bounds === bounds ? manual.view : fitted;
  const setView = (v: MapView) => setManual({ bounds, view: v });
  const fitAll = () => setManual(null);
  const selected = picked && picked.bounds === bounds ? picked.key : null;
  const setSelected = (key: string) => setPicked({ bounds, key });

  // ホイールの受け手は一度だけ登録するので、今の値は ref で渡す
  const latest = useRef({ view, bounds });
  useEffect(() => {
    latest.current = { view, bounds };
  });

  // ホイールで拡大・縮小。ページのスクロールを止めるため、passive: false で受ける
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { view: v, bounds: b } = latest.current;
      if (!v) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = Math.max(-1, Math.min(1, -e.deltaY * 0.004));
      setManual({ bounds: b, view: zoomAround(v, delta, [e.clientX - r.left, e.clientY - r.top], r.width, HEIGHT) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const choose = async (p: MapPlace) => {
    setSelected(p.key);
    setFailed(null);
    if (p.scope === 'item' && p.resourceId) {
      if ((await open(p.resourceId, true)) === 'failed') setFailed(p.key);
      return;
    }
    if (p.containerId && p.containerId !== current) setRequest({ seq: nextSeq(), target: { canvasId: p.containerId } });
  };

  const focus = (p: MapPlace) => {
    if (width > 0) setView(fitMapView(p.bbox, width, HEIGHT, 40));
    void choose(p);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !view) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setView(panBy(view, dx, dy));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // ドラッグのあとに来る click を、場所の選択として扱わない
    if (drag.current?.moved) setTimeout(() => (drag.current = null));
    else drag.current = null;
  };
  const onShapeClick = (p: MapPlace) => {
    if (drag.current?.moved) return;
    void choose(p);
  };

  const isActive = (p: MapPlace) => p.key === selected || (!!current && p.containerId === current);
  // 選んだもの・今のページのものを上に描く
  const ordered = [...places].sort((a, b) => Number(isActive(a)) - Number(isActive(b)));
  const tiles = view && width > 0 ? tilesFor(view, width, HEIGHT, TILE_URL) : [];
  const btn =
    'w-7 h-7 flex items-center justify-center bg-white/90 dark:bg-gray-800/90 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-700 text-sm';

  return (
    <div className="space-y-2">
      <div
        ref={frame}
        className="relative overflow-hidden rounded border border-gray-200 dark:border-gray-700 bg-[#aad3df] select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label={t('map')}
      >
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            className="absolute max-w-none pointer-events-none"
            style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
          />
        ))}
        {view && width > 0 && (
          <svg className="absolute inset-0" width={width} height={HEIGHT}>
            {ordered.map((p) => {
              const active = isActive(p);
              const color = active ? '#dc2626' : '#2563eb';
              return (
                <g
                  key={p.key}
                  className="cursor-pointer"
                  onClick={() => onShapeClick(p)}
                  stroke={color}
                  fill={color}
                >
                  <title>{[p.label, p.ownerLabel].filter(Boolean).join(' — ')}</title>
                  {p.shapes.map((s, i) => {
                    if (s.kind === 'point') {
                      const [x, y] = toFrame(s.coords, view, width, HEIGHT);
                      return <circle key={i} cx={x} cy={y} r={active ? 7 : 6} strokeWidth={2} stroke="#fff" />;
                    }
                    return (
                      <path
                        key={i}
                        d={pathOf(s, view, width, HEIGHT)}
                        fillOpacity={s.kind === 'polygon' ? (active ? 0.3 : 0.18) : 0}
                        strokeWidth={active ? 3 : 2}
                        fillRule="evenodd"
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
        <div className="absolute top-2 right-2 flex flex-col" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className={`${btn} rounded-t`} aria-label={t('zoomIn')} title={t('zoomIn')}
            onClick={() => view && setView(zoomAround(view, 1, [width / 2, HEIGHT / 2], width, HEIGHT))}>
            +
          </button>
          <button type="button" className={`${btn} border-t-0`} aria-label={t('zoomOut')} title={t('zoomOut')}
            onClick={() => view && setView(zoomAround(view, -1, [width / 2, HEIGHT / 2], width, HEIGHT))}>
            −
          </button>
          <button type="button" className={`${btn} border-t-0 rounded-b`} aria-label={t('fitAll')} title={t('fitAll')}
            onClick={fitAll}>
            ⤢
          </button>
        </div>
        <div className="absolute bottom-0 right-0 px-1 text-[10px] leading-4 bg-white/80 text-gray-700" onPointerDown={(e) => e.stopPropagation()}>
          ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">
            OpenStreetMap
          </a>
        </div>
      </div>

      <ul className="space-y-1">
        {places.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => focus(p)}
              aria-current={isActive(p) ? 'true' : undefined}
              className={`w-full text-left rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
                isActive(p) ? 'bg-red-50 dark:bg-red-900/30' : ''
              }`}
            >
              <div className="text-gray-900 dark:text-gray-100 break-words">{p.label || p.ownerLabel || t('untitled')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 break-words">
                {[
                  t(`scope_${p.scope}`) + (p.ownerLabel && p.label ? `: ${p.ownerLabel}` : ''),
                  p.navDate && dateOf(p.navDate, locale),
                  p.target && `${t('region')} ${p.target.replace(/^#/, '')}`,
                  failed === p.key && t('openError'),
                ]
                  .filter(Boolean)
                  .join(' ・ ')}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const mapPanel: Panel = {
  id: 'map',
  order: 45,
  available: ({ manifest }) => mapPlacesOf(manifest, 'en').length > 0,
  Component: MapPanel,
};
