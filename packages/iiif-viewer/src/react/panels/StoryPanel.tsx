'use client';

import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import {
  articleBodiesOf,
  articleSandbox,
  labelIn,
  chapterLabel,
  openingStep,
  sanitizeAnnotationHtml,
  stepText,
  stepArrows,
  storyOf,
  viewingOf,
  type AnnotationBodyItem,
  type Story,
  type StoryStep,
} from '../../core';
import { navRequestAtom, nextSeq } from '../displays/structureState';
import { useTranslations } from '../env';
import { selectedCanvasAnnotationAtom } from '../overlays/canvasAnnotationState';
import { storyCaptionAtom, storyFrameAtom, storyOpenAtom, storyPlayingAtom } from '../overlays/storyState';
import { autoplayDelay, useStory } from '../overlays/useStory';
import type { Panel, PanelContext } from './types';

function Text({ body, large }: { body: AnnotationBodyItem; large?: boolean }) {
  const size = large ? 'text-base leading-relaxed' : 'text-sm';
  if (/html/i.test(body.format ?? '')) {
    return (
      <div
        className={`${size} text-[var(--ds-fg)] break-words [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_p]:my-2`}
        lang={body.language}
        // サニタイズ済み（許可したタグ・属性だけ）
        dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(body.value ?? '') }}
      />
    );
  }
  return (
    <p className={`${size} text-[var(--ds-fg)] whitespace-pre-wrap break-words`} lang={body.language}>
      {body.value}
    </p>
  );
}

// An article of a step (an external HTML body), shown as it is in a closed frame, as a Voyager tour
// step opens one beside the model. The viewer does not read it: its look, images and videos are its own.
function Article({ body, locale }: { body: AnnotationBodyItem; locale: string }) {
  const t = useTranslations('Story');
  const url = body.url ?? '';
  const sandbox = articleSandbox(url, typeof window === 'undefined' ? '' : window.location.origin);
  if (!sandbox) return null;
  const label = labelIn(body.label, locale) || t('article');
  return (
    <section aria-label={t('article')} className="rounded border border-[var(--ds-border)] overflow-hidden">
      <iframe key={url} src={url} title={label} sandbox={sandbox} loading="lazy" className="w-full h-[60vh] border-0 bg-white" />
    </section>
  );
}

const summaryOf = (step: StoryStep, locale: string): string => {
  const { heading, bodies } = stepText(step, locale);
  if (heading) return heading;
  const first = bodies[0]?.value ?? '';
  return first.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

// ストーリー（ガイドツアー）: 説明の注釈を順に送り、その領域に寄って本文を読む。読み取りは core/features/story.ts。
// 本文は絵の上の札（StoryOverlay）にも出る。自動再生の時計はこのタブが持つ（Viewer に 1 つだけ開くため）。
function StoryPanel({ manifest }: PanelContext) {
  const t = useTranslations('Story');
  const { story, at, total, go, setIndex, sizes, locale } = useStory(manifest);
  const [selected, setSelected] = useAtom(selectedCanvasAnnotationAtom);
  const setRequest = useSetAtom(navRequestAtom);
  const current = useRef<HTMLLIElement>(null);
  const setOpen = useSetAtom(storyOpenAtom);
  const [frame, setFrame] = useAtom(storyFrameAtom);
  const [playing, setPlaying] = useAtom(storyPlayingAtom);
  const [caption, setCaption] = useAtom(storyCaptionAtom);
  const arrows = stepArrows(viewingOf(manifest).direction);

  // while this tab is shown, the annotation marks on the picture step back (see AnnotationOverlay)
  useEffect(() => {
    setOpen(true);
    return () => {
      setOpen(false);
      setPlaying(false);
    };
  }, [setOpen, setPlaying]);

  // a mark chosen on the picture: follow it when it is a step (no move)
  useEffect(() => {
    if (!story || !selected) return;
    const i = story.steps.findIndex((s) => s.id === selected);
    if (i >= 0) setIndex(i);
  }, [selected, story, setIndex]);

  // On opening the tab, move to the step it shows ("1 / 31" must show scene 1, not the whole picture).
  // Only once per opening; later moves come from the buttons or a chosen mark.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !story) return;
    opened.current = true;
    const i = openingStep(story, at, selected);
    if (i !== null) go(i);
  }, [story, at, selected, go]);

  // autoplay: on to the next step after the time to read this one; stops after the last
  useEffect(() => {
    if (!playing || !story) return;
    const id = window.setTimeout(() => {
      if (at >= total - 1) setPlaying(false);
      else go(at + 1);
    }, autoplayDelay(story.steps[at], locale));
    return () => window.clearTimeout(id);
  }, [playing, story, at, total, locale, go, setPlaying]);

  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [at]);

  if (!story) return null;
  const step = story.steps[at];

  // a step chosen by hand takes over from autoplay
  const byHand = (i: number) => {
    setPlaying(false);
    go(i);
  };
  const play = () => {
    if (playing) return setPlaying(false);
    if (at >= total - 1) go(0);
    setPlaying(true);
  };
  const whole = () => {
    setPlaying(false);
    setSelected(null);
    setRequest({ seq: nextSeq(), target: { canvasId: step.canvasId, xywh: wholeOf(sizes.get(step.canvasId)) } });
  };

  const { heading, bodies } = stepText(step, locale);
  const chapter = story.chapters.find((c) => c.steps.includes(at));
  const button = 'px-3 py-1 rounded border border-[var(--ds-border)] text-sm disabled:opacity-40';
  const prevButton = (
    <button type="button" className={button} onClick={() => byHand(at - 1)} disabled={at <= 0}>
      {arrows.nextFirst ? `${t('prev')} ${arrows.prev}` : `${arrows.prev} ${t('prev')}`}
    </button>
  );
  const nextButton = (
    <button type="button" className={button} onClick={() => byHand(at + 1)} disabled={at >= total - 1}>
      {arrows.nextFirst ? `${arrows.next} ${t('next')}` : `${t('next')} ${arrows.next}`}
    </button>
  );

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* right to left and bottom to top put "next" first, as on the caption card */}
        {arrows.nextFirst ? nextButton : prevButton}
        <span className="text-sm tabular-nums text-[var(--ds-fg)] opacity-70" aria-live="polite">
          {t('position', { n: at + 1, total })}
        </span>
        {arrows.nextFirst ? prevButton : nextButton}
        <button type="button" className={button} onClick={play} aria-pressed={playing}>
          {playing ? `❚❚ ${t('pause')}` : `▶ ${t('play')}`}
        </button>
        <button type="button" className="ml-auto text-xs underline text-[var(--ds-fg)] opacity-70" onClick={whole}>
          {t('whole')}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-2 text-xs text-[var(--ds-fg)] opacity-80">
          <input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} />
          {t('caption')}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--ds-fg)] opacity-80">
          <input type="checkbox" checked={frame} onChange={(e) => setFrame(e.target.checked)} />
          {t('frame')}
        </label>
      </div>

      {/* the text is over the picture already; here only when the caption is closed */}
      {caption ? null : (
        <article className="rounded border border-[var(--ds-border)] p-3 space-y-2">
          {chapter && chapter.headStep !== at && chapterLabel(chapter, locale) ? (
            <p className="text-xs text-[var(--ds-fg)] opacity-70">{chapterLabel(chapter, locale)}</p>
          ) : null}
          {heading ? <h3 className="text-lg font-semibold text-[var(--ds-fg)]">{heading}</h3> : null}
          {bodies.map((b, i) => (
            <Text key={i} body={b} large />
          ))}
        </article>
      )}

      {articleBodiesOf(step.bodies).map((b) => (
        <Article key={b.url} body={b} locale={locale} />
      ))}

      <nav aria-label={t('steps')}>
        <StepList story={story} at={at} locale={locale} onGo={byHand} currentRef={current} label={(n) => t('step', { n })} />
      </nav>
    </div>
  );
}

const wholeOf = (size?: { width?: number; height?: number }): [number, number, number, number] | undefined =>
  size?.width && size?.height ? [0, 0, size.width, size.height] : undefined;

function StepList({
  story,
  at,
  locale,
  onGo,
  currentRef,
  label,
}: {
  story: Story;
  at: number;
  locale: string;
  onGo: (i: number) => void;
  currentRef: React.RefObject<HTMLLIElement | null>;
  label: (n: number) => string;
}) {
  const item = (i: number, indent: boolean) => (
    <li key={story.steps[i].id} ref={i === at ? currentRef : undefined}>
      <button
        type="button"
        onClick={() => onGo(i)}
        aria-current={i === at || undefined}
        className={`w-full text-left text-sm rounded px-2 py-1 ${indent ? 'pl-5' : ''} ${
          i === at ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-[var(--ds-fg)]'
        }`}
      >
        <span className="line-clamp-2">{summaryOf(story.steps[i], locale) || label(i + 1)}</span>
      </button>
    </li>
  );

  if (story.chapters.length === 0) return <ol className="space-y-0.5">{story.steps.map((_, i) => item(i, false))}</ol>;

  const grouped = new Set(story.chapters.flatMap((c) => c.steps));
  return (
    <ol className="space-y-2">
      {story.chapters.map((c) => (
        <li key={c.id}>
          {c.headStep === undefined && chapterLabel(c, locale) ? (
            <p className="text-xs font-medium text-[var(--ds-fg)] opacity-70 px-2">{chapterLabel(c, locale)}</p>
          ) : null}
          <ol className="space-y-0.5">{c.steps.map((i) => item(i, c.headStep !== undefined ? i !== c.headStep : false))}</ol>
        </li>
      ))}
      {story.steps.map((_, i) => i).filter((i) => !grouped.has(i)).map((i) => item(i, false))}
    </ol>
  );
}

export const storyPanel: Panel = {
  id: 'story',
  // 資料情報（10）の次。開いてすぐ読み始められるように
  order: 15,
  available: ({ manifest }) => storyOf(manifest) !== null,
  Component: StoryPanel,
};
