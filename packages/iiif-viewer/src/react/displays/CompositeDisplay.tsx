'use client';

import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeItemsAt,
  canvasImagesOf,
  isComposite,
  mediaTimeAt,
  rawCanvasOf,
  rawContainerOf,
  sanitizeTemporalHtml,
  timelineImageUrl,
  timelineOf,
  type ContainerInfo,
  type Timeline,
  type TimelineItem,
} from '../../core';
import { modelChoicesAtom } from '../atoms';
import { useTranslations } from '../env';
import { usePlayback } from '../playback';
import ChoiceBar from './ChoiceBar';
import { flatDisplay } from './FlatDisplay';
import { MediaCover } from './ImageExtras';
import { FIRST_FRAME } from './MediaView';
import { useRawManifest } from './rawManifest';
import { useSeekOnFocus } from './structureState';
import { fmt } from './TranscriptPanel';
import type { Display, DisplayProps } from './types';

// 1 つの Canvas に、画像・動画・音声・テキストが時間と場所を決めて並ぶ表示（0489・0560 など）。
// Canvas の座標のまま描いた舞台を、枠に合わせて縮小して見せる。時刻は舞台ごとに持つ時計で進め、
// 動画・音声はその時刻に合わせる。

const TICK_MS = 100;

function TimedMedia({ item, time, playing }: { item: TimelineItem; time: number; playing: boolean }) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const local = mediaTimeAt(item, time);
  const localRef = useRef(local);
  useEffect(() => {
    localRef.current = local;
  }, [local]);
  const src = (item.url ?? '').split('#')[0];

  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.currentTime - local) > 0.6) {
      try {
        el.currentTime = local;
      } catch {
        /* metadata not loaded yet: onLoadedMetadata sets it */
      }
    }
  }, [local]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [playing]);

  const common = {
    preload: 'auto' as const,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      // 0 秒のままだと最初のフレームが描かれず黒くなるので、ほんの少し進める
      e.currentTarget.currentTime = Math.max(localRef.current, FIRST_FRAME);
    },
  };
  if (item.kind === 'Audio') {
    return (
      <audio ref={(el) => void (ref.current = el)} {...common}>
        <source src={src} type={item.format} />
      </audio>
    );
  }
  return (
    <video
      ref={(el) => void (ref.current = el)}
      className="w-full h-full object-contain"
      crossOrigin="anonymous"
      playsInline
      {...common}
    >
      <source src={src} type={item.format} />
    </video>
  );
}

function ItemView({ item, time, playing }: { item: TimelineItem; time: number; playing: boolean }) {
  switch (item.kind) {
    case 'Image': {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={timelineImageUrl(item)} alt="" className="w-full h-full object-contain" />;
    }
    case 'Text':
      return item.isHtml ? (
        <div className="w-full h-full overflow-hidden" dangerouslySetInnerHTML={{ __html: sanitizeTemporalHtml(item.text ?? '') }} />
      ) : (
        <div className="w-full h-full overflow-hidden whitespace-pre-line">{item.text}</div>
      );
    default:
      return <TimedMedia item={item} time={time} playing={playing} />;
  }
}

function CompositeStage({ container, timeline, cover }: { container: ContainerInfo; timeline: Timeline; cover?: string }) {
  const t = useTranslations('Viewer');
  const choices = useAtomValue(modelChoicesAtom);
  const { mediaRef, setCurrentTime } = usePlayback();
  useSeekOnFocus(container);
  const { duration, width, height } = timeline;

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // 一度でも再生するか、位置を動かすまでは表紙を出す
  const [started, setStarted] = useState(false);
  const clock = useRef({ t0: 0, base: 0 });
  const timeRef = useRef(0);

  const seek = useCallback((seconds: number) => {
    const v = Math.min(Math.max(seconds, 0), duration);
    timeRef.current = v;
    clock.current = { t0: performance.now(), base: v };
    setTime(v);
    if (v > 0) setStarted(true);
  }, [duration]);

  // 文字起こし（右パネル）から時刻を動かせるように、再生位置の受け口を舞台の時計にする
  useEffect(() => {
    const proxy = {
      get currentTime() {
        return timeRef.current;
      },
      set currentTime(v: number) {
        seek(v);
      },
    };
    mediaRef.current = proxy as unknown as HTMLMediaElement;
    return () => {
      mediaRef.current = null;
    };
  }, [mediaRef, seek]);

  useEffect(() => {
    if (!playing) return;
    clock.current = { t0: performance.now(), base: timeRef.current };
    const id = setInterval(() => {
      const next = clock.current.base + (performance.now() - clock.current.t0) / 1000;
      if (next >= duration) {
        if (timeline.repeat) {
          clock.current = { t0: performance.now(), base: 0 };
          timeRef.current = 0;
          setTime(0);
        } else {
          timeRef.current = duration;
          setTime(duration);
          setPlaying(false);
        }
        return;
      }
      timeRef.current = next;
      setTime(next);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, duration, timeline.repeat]);

  // 右パネルへの再生位置の通知は、細かくなりすぎないように間引く
  const reported = useRef(-1);
  useEffect(() => {
    if (Math.abs(time - reported.current) >= 0.25 || !playing) {
      reported.current = time;
      setCurrentTime(time);
    }
  }, [time, playing, setCurrentTime]);

  const visible = useMemo(
    () =>
      timeline.items.filter(
        (m) => m.choiceId === undefined || (choices[m.choiceId] ?? 0) === m.choiceIndex
      ),
    [timeline, choices]
  );
  const active = activeItemsAt({ ...timeline, items: visible }, time);

  // 舞台（Canvas の座標）を枠に合わせて縮める
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const scale = box.w && box.h ? Math.min(box.w / width, box.h / height) : 0;

  const togglePlay = () => {
    if (!playing && timeRef.current >= duration) seek(0);
    setStarted(true);
    setPlaying((p) => !p);
  };

  return (
    <>
      {container.painting
        .filter((p) => p.options.length > 1)
        .map((p) => (
          <ChoiceBar key={p.id} painting={p} />
        ))}
      <div ref={boxRef} className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center bg-black overflow-hidden">
        <div style={{ width: width * scale, height: height * scale, position: 'relative', overflow: 'hidden', background: '#111' }}>
          <div
            style={{
              width,
              height,
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              color: '#fff',
            }}
          >
            {active.map((m) => {
              const r = m.region ?? { x: 0, y: 0, w: width, h: height };
              return (
                <div
                  key={m.id + (m.choiceIndex ?? '')}
                  style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h }}
                >
                  <ItemView item={m} time={time} playing={playing} />
                </div>
              );
            })}
          </div>
        </div>
        {cover && (
          <MediaCover src={cover} dismissed={started} onDismiss={() => setStarted(true)} onPlay={() => setPlaying(true)} />
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--ds-surface)] border-t border-[var(--ds-border)] text-[var(--ds-fg)]">
        <button
          onClick={togglePlay}
          aria-label={playing ? t('compositePause') : t('compositePlay')}
          className="px-2 py-0.5 rounded border border-[var(--ds-border)] text-sm hover:bg-[var(--ds-surface-2)]"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={time}
          aria-label={t('compositeSeek')}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 min-w-0"
        />
        <span className="shrink-0 tabular-nums text-xs opacity-80">
          {fmt(time)} / {fmt(duration)}
        </span>
      </div>
    </>
  );
}

function CompositeDisplayView(props: DisplayProps) {
  const { container, manifest } = props;
  // 表紙は元のマニフェストの placeholderCanvas、無ければ Canvas の thumbnail（動画を含むときだけ）
  const raw = useRawManifest(props.iiifContent);
  const cover = useMemo(() => {
    const images = canvasImagesOf(rawCanvasOf(raw ?? manifest, container.id));
    return images.placeholder?.layer.url ?? images.thumbnail;
  }, [raw, manifest, container.id]);
  const timeline = useMemo(
    () => timelineOf(rawContainerOf(manifest, container.id), manifest),
    [manifest, container.id]
  );
  // 時間の指定が読めなかったときは、これまでどおりの表示にする
  if (!timeline || !isComposite(timeline)) return <flatDisplay.Component {...props} />;
  const hasVideo = timeline.items.some((m) => m.kind === 'Video');
  return <CompositeStage key={container.id} container={container} timeline={timeline} cover={hasVideo ? cover : undefined} />;
}

// 共有の読み取り（ContainerInfo）には時間が無いので、ここでは「動画・音声か duration があり、
// 画像・動画・音声が 2 つ以上ある」ことだけを見る。時間の有無は Component が読み、
// 合成でなければ flatDisplay に渡す。
export const compositeDisplay: Display = {
  id: 'composite',
  match: (c) => {
    if (c.kind === 'Scene') return false;
    const media = c.painting.filter((p) => p.options.some((o) => o.kind !== 'Model'));
    if (media.length < 2) return false;
    return (
      c.duration !== undefined ||
      media.some((p) => p.options.some((o) => o.kind === 'Video' || o.kind === 'Audio'))
    );
  },
  Component: CompositeDisplayView,
};
