'use client';

import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  isLayerVisible,
  isVideoLayer,
  layerCountOf,
  labelIn,
  layerOpacity,
  layerThumbnailUrl,
  moveLayer,
  orderLayers,
  playbackGroups,
  playbackSettings,
  playbackStepCount,
  type PlaybackDirection,
  type LayerItem,
} from '../../core';
import {
  canvasLayersAtom,
  layerOrderAtom,
  layerPlaybackAtom,
  layerPlaybackOptionsAtom,
  layerSettingsAtom,
} from '../atoms';
import { videoLayersPlayingAtom, videoLayersSoundAtom } from '../displays/videoLayerState';
import { useLocale, useTranslations } from '../env';
import type { Panel, PanelContext } from './types';

// 重なった画像（合成の画像・Choice の候補）を 1 枚ずつ、表示・非表示、不透明度、重ね順で操作する。
// 一覧は上が手前（画像編集ソフトのレイヤーと同じ向き）。重ね順はドラッグか ▲▼ で変える。
// Mirador の Layers パネルと同じ操作をそろえた。
// ▶ で、表示中の画像を手前から 1 枚ずつ隠していく（起こし絵図をめくるように見せる）。
// 再生の状態はタブの外（atom）にあり、タイマーは画像の表示が動かす。別のタブに移っても続く。

const BUTTON =
  'shrink-0 grid place-items-center w-7 h-7 rounded text-[var(--ds-fg)] hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent';

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M3 3l18 18" />}
    </svg>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4.5v15l12-7.5z" />}
    </svg>
  );
}

// 再生の間隔（秒）
const INTERVALS = [0.5, 1, 1.5, 2, 3, 5];

function LayersTab({ container }: PanelContext) {
  const t = useTranslations('Layers');
  const locale = useLocale();
  const current = useAtomValue(canvasLayersAtom);
  const [settings, setSettings] = useAtom(layerSettingsAtom);
  const [orders, setOrders] = useAtom(layerOrderAtom);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [playback, setPlayback] = useAtom(layerPlaybackAtom);
  const [{ seconds, loop, direction }, setOptions] = useAtom(layerPlaybackOptionsAtom);
  const playing = playback && playback.canvasId === container?.id ? playback : null;
  const [videosPlaying, setVideosPlaying] = useAtom(videoLayersPlayingAtom);
  const [videoSound, setVideoSound] = useAtom(videoLayersSoundAtom);

  if (!container || !current || current.canvasId !== container.id) {
    return <div className="p-4 text-sm text-[var(--ds-fg)]">{t('loading')}</div>;
  }
  const canvasId = container.id;
  const items = current.items;
  const bottomFirst = orderLayers(items, orders[canvasId]);
  const ids = bottomFirst.map((it) => it.id);
  const topFirst = bottomFirst.slice().reverse();
  const number = new Map(items.map((it, i) => [it.id, i + 1]));
  const nameOf = (it: LayerItem) => labelIn(it.label, locale) || t('layerN', { n: number.get(it.id) ?? 0 });

  const patch = (id: string, change: { visible?: boolean; opacity?: number }) =>
    setSettings((s) => ({ ...s, [id]: { ...s[id], ...change } }));
  const moveTo = (id: string, to: number) => setOrders((o) => ({ ...o, [canvasId]: moveLayer(ids, id, to) }));
  const reset = () => {
    setPlayback(null);
    setSettings((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !items.some((it) => it.id === k))));
    setOrders((o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== canvasId)));
  };
  const showAll = () => {
    setPlayback(null);
    setSettings((s) => ({ ...s, ...Object.fromEntries(items.map((it) => [it.id, { ...s[it.id], visible: true }])) }));
  };
  // Keep only the bottom layer (in the current order) and hide the others
  const bottomOnly = () => {
    setPlayback(null);
    const bottom = bottomFirst[0]?.id;
    setSettings((s) => ({
      ...s,
      ...Object.fromEntries(items.map((it) => [it.id, { ...s[it.id], visible: it.id === bottom }])),
    }));
  };
  const togglePlay = () => {
    if (playing) {
      setPlayback(null);
      return;
    }
    // 表示中の画像だけを使う。2 枚に満たなければ、すべてを使う
    const shown = bottomFirst.filter((it) => isLayerVisible(it, settings));
    const playItems = shown.length >= 2 ? shown : bottomFirst;
    const playIds = playItems.map((it) => it.id);
    const groups = playbackGroups(playItems);
    setSettings((s) => playbackSettings(s, playIds, groups, 0, direction));
    setPlayback({ canvasId, ids: playIds, groups, direction, step: 0 });
  };

  return (
    <div className="p-3 text-sm text-[var(--ds-fg)]">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="flex-1 min-w-0 text-xs text-gray-500 dark:text-gray-400">{t('hint')}</p>
        <button type="button" onClick={showAll} className="text-xs underline">
          {t('showAll')}
        </button>
        <button type="button" onClick={bottomOnly} className="text-xs underline">
          {t('bottomOnly')}
        </button>
        <button type="button" onClick={reset} className="text-xs underline">
          {t('reset')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2 rounded border border-[var(--ds-border)] p-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-pressed={!!playing}
          title={t(playing ? 'pause' : 'play')}
          className="inline-flex items-center gap-1 rounded border border-[var(--ds-border)] px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <PlayIcon playing={!!playing} />
          {t(playing ? 'pause' : 'play')}
        </button>
        <label className="inline-flex items-center gap-1 text-xs">
          {t('direction')}
          <select
            value={direction}
            onChange={(e) => {
              // 向きを変えたら、いったん止める（次の再生から新しい向き）
              setPlayback(null);
              setOptions((o) => ({ ...o, direction: e.target.value as PlaybackDirection }));
            }}
            className="rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-1 py-0.5"
          >
            <option value="build">{t('directionBuild')}</option>
            <option value="peel">{t('directionPeel')}</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          {t('interval')}
          <select
            value={seconds}
            onChange={(e) => setOptions((o) => ({ ...o, seconds: Number(e.target.value) }))}
            className="rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-1 py-0.5"
          >
            {INTERVALS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {t('seconds')}
        </label>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={loop} onChange={(e) => setOptions((o) => ({ ...o, loop: e.target.checked }))} />
          {t('loop')}
        </label>
        {playing && (
          <span className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            {t('playStep', { n: playing.step + 1, total: playbackStepCount(playing.groups) })}
          </span>
        )}
      </div>
      {items.some((it) => isVideoLayer(it.layer)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2 rounded border border-[var(--ds-border)] p-2">
          <button
            type="button"
            onClick={() => setVideosPlaying(!videosPlaying)}
            aria-pressed={videosPlaying}
            className="inline-flex items-center gap-1 rounded border border-[var(--ds-border)] px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <PlayIcon playing={videosPlaying} />
            {t(videosPlaying ? 'videoPause' : 'videoPlay')}
          </button>
          <label className="inline-flex items-center gap-1 text-xs">
            <input type="checkbox" checked={videoSound} onChange={(e) => setVideoSound(e.target.checked)} />
            {t('videoSound')}
          </label>
        </div>
      )}
      <ol className="space-y-2">
        {topFirst.map((it) => {
          const visible = isLayerVisible(it, settings);
          const opacity = Math.round(layerOpacity(it, settings) * 100);
          const pos = ids.indexOf(it.id);
          const name = nameOf(it);
          return (
            <li
              key={it.id}
              draggable
              onDragStart={(e) => {
                setDragging(it.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', it.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(it.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== it.id) moveTo(dragging, pos);
                setDragging(null);
                setOver(null);
              }}
              className={`rounded border p-2 bg-[var(--ds-surface)] ${
                over === it.id && dragging !== it.id ? 'border-blue-500' : 'border-[var(--ds-border)]'
              } ${dragging === it.id ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="cursor-grab select-none text-gray-400" title={t('drag')} aria-hidden="true">
                  ⠿
                </span>
                {isVideoLayer(it.layer) ? (
                  // the first frame of the clip
                  <video
                    src={`${it.layer.url.split('#')[0]}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden
                    className={`w-12 h-12 object-contain shrink-0 bg-gray-100 dark:bg-gray-800 pointer-events-none ${visible ? '' : 'opacity-40'}`}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={layerThumbnailUrl(it.layer, 96)}
                    alt=""
                    draggable={false}
                    className={`w-12 h-12 object-contain shrink-0 bg-gray-100 dark:bg-gray-800 ${visible ? '' : 'opacity-40'}`}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate" title={name}>
                    {name}
                  </div>
                  {it.choice && <div className="text-xs text-gray-500 dark:text-gray-400">{t('choiceOption')}</div>}
                  {isVideoLayer(it.layer) && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2" title={labelIn(it.layer.summary, locale) || undefined}>
                      {labelIn(it.layer.summary, locale) || t('video')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => patch(it.id, { visible: !visible })}
                  aria-pressed={visible}
                  aria-label={t(visible ? 'hide' : 'show', { name })}
                  title={t(visible ? 'hide' : 'show', { name })}
                >
                  <EyeIcon open={visible} />
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => moveTo(it.id, pos + 1)}
                  disabled={pos === ids.length - 1}
                  aria-label={t('up', { name })}
                  title={t('up', { name })}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => moveTo(it.id, pos - 1)}
                  disabled={pos === 0}
                  aria-label={t('down', { name })}
                  title={t('down', { name })}
                >
                  ▼
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0" htmlFor={`layer-opacity-${it.id}`}>
                  {t('opacity')}
                </label>
                <input
                  id={`layer-opacity-${it.id}`}
                  type="range"
                  min={0}
                  max={100}
                  value={opacity}
                  disabled={!visible}
                  onChange={(e) => patch(it.id, { opacity: Number(e.target.value) / 100 })}
                  className="flex-1 min-w-0"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={opacity}
                  disabled={!visible}
                  aria-label={t('opacityOf', { name })}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) patch(it.id, { opacity: Math.min(100, Math.max(0, v)) / 100 });
                  }}
                  className="w-14 rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-1 py-0.5 text-xs text-right"
                />
                <span className="text-xs">%</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const layersPanel: Panel = {
  id: 'layers',

  order: 40,
  available: ({ container }) => layerCountOf(container?.painting ?? []) > 1,
  Component: LayersTab,
};
