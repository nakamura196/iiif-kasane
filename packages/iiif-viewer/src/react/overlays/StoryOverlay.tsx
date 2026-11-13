'use client';

import { useEffect, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  chapterLabel,
  sanitizeAnnotationHtml,
  stepAt,
  stepArrows,
  stepText,
  viewingOf,
  type AnnotationBodyItem,
  type StoryScroll,
} from '../../core';
import { manifestAtom } from '../atoms';
import type { StageInfo } from '../displays/ImageView';
import { useTranslations } from '../env';
import { storyCaptionAtom, storyOpenAtom, storyPlayingAtom } from './storyState';
import type { Overlay, OverlayProps } from './types';
import { autoplayDelay, useStory } from './useStory';

// ストーリーのタブを開いている間、絵の上に固定して出すもの（ズーム・移動に追従しない層）。
//  - 解説の札（右下。左下はサイトのボタン「地図で見る」などが使う）: いまの場面の見出しと本文、前へ・自動再生・次へ
//  - 絵巻の帯（上端）: 横に長い 1 枚の絵のストーリーで、全体の縮図に場面の区切りと、いま見ている範囲を出す
// 送り方はタブと同じ（useStory）。自動再生の時計はタブが持ち、ここは絵に触れたら止めるだけ。

const MARGIN = 12;

function CaptionText({ body }: { body: AnnotationBodyItem }) {
  const cls = 'text-sm leading-relaxed break-words [&_a]:text-sky-300 [&_a]:underline [&_p]:my-1.5 [&_img]:max-w-full';
  if (/html/i.test(body.format ?? '')) {
    return (
      <div
        className={cls}
        lang={body.language}
        // サニタイズ済み（許可したタグ・属性だけ）
        dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(body.value ?? '') }}
      />
    );
  }
  return (
    <p className={`${cls} whitespace-pre-wrap`} lang={body.language}>
      {body.value}
    </p>
  );
}

/** The part of the Canvas the view shows, along x (Canvas pixels). */
const seenSpan = (stage: StageInfo, width: number): [number, number] => {
  const k = width / stage.stageW;
  const cx = -stage.tx / stage.scale + stage.stageW / 2;
  const hw = stage.boxW / 2 / stage.scale;
  return [(cx - hw) * k, (cx + hw) * k];
};

function Strip({
  scroll,
  image,
  stage,
  at,
  label,
  titleOf,
  onGo,
}: {
  scroll: StoryScroll;
  image?: string;
  stage: StageInfo;
  at: number;
  label: string;
  titleOf: (i: number) => string;
  onGo: (i: number) => void;
}) {
  const w = Math.max(stage.boxW - MARGIN * 2, 0);
  const h = Math.min(48, Math.max(14, (w * scroll.height) / scroll.width));
  const pct = (x: number) => `${(Math.min(Math.max(x, 0), scroll.width) / scroll.width) * 100}%`;
  const [s0, s1] = seenSpan(stage, scroll.width);
  const cur = scroll.spans[at];
  // the view frame follows the glide (the stage gets its end values at once)
  const glide = stage.from ? 'left 1s cubic-bezier(0.65, 0, 0.35, 1), width 1s cubic-bezier(0.65, 0, 0.35, 1)' : undefined;
  return (
    <div
      className="absolute pointer-events-auto cursor-pointer rounded-sm overflow-hidden shadow-md ring-1 ring-black/40 bg-black/50"
      style={{ left: MARGIN, top: MARGIN, width: w, height: h }}
      role="group"
      aria-label={label}
      title={label}
      data-story-strip
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = stepAt(scroll, ((e.clientX - r.left) / r.width) * scroll.width);
        if (i !== null) onGo(i);
      }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" draggable={false} className="absolute inset-0 w-full h-full" />
      ) : null}
      {/* the scenes other than the current one are dimmed */}
      {cur ? (
        <>
          <div className="absolute inset-y-0 left-0 bg-black/45" style={{ width: pct(cur[0]) }} />
          <div className="absolute inset-y-0 right-0 bg-black/45" style={{ left: pct(cur[1]) }} />
        </>
      ) : null}
      {scroll.spans.map((sp, i) =>
        sp ? (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            title={titleOf(i)}
            aria-label={titleOf(i)}
            className="absolute inset-y-0 border-x border-white/30 hover:bg-white/15"
            style={{ left: pct(sp[0]), width: `calc(${pct(sp[1])} - ${pct(sp[0])})` }}
            onClick={(e) => {
              e.stopPropagation();
              onGo(i);
            }}
          />
        ) : null,
      )}
      {/* what the view shows now */}
      <div
        className="absolute inset-y-0 border-2 border-white rounded-[2px] pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: pct(s0), width: `calc(${pct(s1)} - ${pct(s0)})`, transition: glide }}
      />
    </div>
  );
}

// Nothing is read until the story tab is open (this layer is on every image, and over the 3D view).
export function StoryLayer(props: OverlayProps) {
  const open = useAtomValue(storyOpenAtom);
  return open ? <StoryLayerOpen {...props} /> : null;
}

function StoryLayerOpen({ container, stage }: OverlayProps) {
  const t = useTranslations('Story');
  const manifest = useAtomValue(manifestAtom);
  const { story, at, total, go, scroll, locale } = useStory();
  const [playing, setPlaying] = useAtom(storyPlayingAtom);
  const [caption, setCaption] = useAtom(storyCaptionAtom);
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const shown = !!story && story.steps[at]?.canvasId === container.id;

  // a drag or a wheel on the picture takes over from autoplay
  useEffect(() => {
    const box = root.current?.closest('[data-iiif-overlay-layer="box"]')?.parentElement;
    if (!box || !playing) return;
    const stop = (e: Event) => {
      if (root.current?.contains(e.target as Node)) return;
      setPlaying(false);
    };
    box.addEventListener('pointerdown', stop);
    box.addEventListener('wheel', stop, { passive: true });
    return () => {
      box.removeEventListener('pointerdown', stop);
      box.removeEventListener('wheel', stop);
    };
  }, [playing, setPlaying, shown]);

  // the wheel over the caption scrolls its text instead of zooming the picture
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const keep = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', keep, { passive: true });
    return () => el.removeEventListener('wheel', keep);
  }, [shown, caption]);

  if (!shown || !story || !stage) return <div ref={root} />;
  const step = story.steps[at];
  const { heading, bodies } = stepText(step, locale);
  const chapter = story.chapters.find((c) => c.steps.includes(at));
  const chapterText = chapter && chapter.headStep !== at ? chapterLabel(chapter, locale) : '';
  const arrows = stepArrows(viewingOf(manifest).direction);
  const strip = scroll && scroll.canvasId === container.id ? scroll : null;
  const stripH = strip ? Math.min(48, Math.max(14, ((stage.boxW - MARGIN * 2) * strip.height) / strip.width)) : 0;
  const image = container.painting[0]?.options.find((o) => o.kind === 'Image')?.url;
  const titleOf = (i: number) => stepText(story.steps[i], locale).heading ?? t('step', { n: i + 1 });
  const byHand = (i: number) => {
    setPlaying(false);
    go(i);
  };
  const toggle = () => {
    if (playing) return setPlaying(false);
    if (at >= total - 1) go(0);
    setPlaying(true);
  };
  const ctl =
    'w-8 h-8 inline-flex items-center justify-center rounded-full text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent';
  // the arrows follow the viewing direction (on a right-to-left scroll the previous step lies to the right)
  const back = arrows.prev;
  const fore = arrows.next;

  return (
    <div ref={root} className="absolute inset-0 pointer-events-none" data-story-layer>
      {caption ? (
        <div
          ref={card}
          key={step.id}
          className="absolute pointer-events-auto rounded-lg bg-black/65 text-white shadow-lg backdrop-blur-sm flex flex-col"
          style={{
            right: MARGIN,
            bottom: MARGIN,
            width: `min(28rem, ${Math.max(stage.boxW - MARGIN * 2, 0)}px)`,
            maxHeight: `max(8rem, ${stage.boxH - MARGIN * 3 - (strip ? stripH + 8 : 0)}px)`,
          }}
          data-story-caption
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 pt-3 overflow-y-auto min-h-0">
            <p className="text-[11px] tracking-wide text-white/60 tabular-nums">
              {t('position', { n: at + 1, total })}
              {chapterText ? ` · ${chapterText}` : ''}
            </p>
            {heading ? <h3 className="mt-0.5 text-base font-semibold leading-snug">{heading}</h3> : null}
            {bodies.map((b, i) => (
              <CaptionText key={i} body={b} />
            ))}
          </div>
          <div className="flex items-center gap-1 px-2 py-1.5 border-t border-white/10">
            {/* in reading order: right to left and bottom to top put "next" first */}
            {(arrows.nextFirst
              ? [
                  { key: 'next', label: t('next'), icon: fore, on: () => byHand(at + 1), off: at >= total - 1 },
                  { key: 'play', label: playing ? t('pause') : t('play'), icon: playing ? '❚❚' : '▶', on: toggle, off: false },
                  { key: 'prev', label: t('prev'), icon: back, on: () => byHand(at - 1), off: at <= 0 },
                ]
              : [
                  { key: 'prev', label: t('prev'), icon: back, on: () => byHand(at - 1), off: at <= 0 },
                  { key: 'play', label: playing ? t('pause') : t('play'), icon: playing ? '❚❚' : '▶', on: toggle, off: false },
                  { key: 'next', label: t('next'), icon: fore, on: () => byHand(at + 1), off: at >= total - 1 },
                ]
            ).map((b) => (
              <button
                key={b.key}
                type="button"
                className={ctl}
                onClick={b.on}
                disabled={b.off}
                title={b.label}
                aria-label={b.label}
                aria-pressed={b.key === 'play' ? playing : undefined}
              >
                <span className={b.key === 'play' ? 'text-xs' : ''}>{b.icon}</span>
              </button>
            ))}
            {playing ? <PlayBar key={`${step.id}:bar`} /> : <span className="flex-1" />}
            <button
              type="button"
              className={ctl}
              onClick={() => setCaption(false)}
              title={t('close')}
              aria-label={t('close')}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      {strip ? (
        <Strip scroll={strip} image={image} stage={stage} at={at} label={t('strip')} titleOf={titleOf} onGo={byHand} />
      ) : null}
    </div>
  );
}

/** A thin line that fills while autoplay stays on the step (restarted for each step by its key). */
function PlayBar() {
  const { story, at, locale } = useStory();
  const ref = useRef<HTMLDivElement>(null);
  const ms = story ? autoplayDelay(story.steps[at], locale) : 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || !ms) return;
    el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
  }, [ms]);
  return (
    <span className="flex-1 mx-2 h-0.5 rounded bg-white/15 overflow-hidden" aria-hidden>
      <div ref={ref} className="h-full bg-white/70 origin-left" style={{ transform: 'scaleX(0)' }} />
    </span>
  );
}

export const storyOverlay: Overlay = {
  id: 'story',
  layer: 'box',
  available: () => true,
  Component: StoryLayer,
};
