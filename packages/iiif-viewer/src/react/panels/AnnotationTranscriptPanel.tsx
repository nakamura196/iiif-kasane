'use client';

import { useMemo, useState } from 'react';
import {
  captionFilesOf,
  labelIn,
  rawContainerOf,
  renderingTranscriptOf,
  timedTextsOf,
  transcriptOf,
  type CaptionFile,
  languageRank,
} from '../../core';
import TranscriptPanel, { CueList } from '../displays/TranscriptPanel';
import { useContentLocale, useTranslations } from '../env';
import { usePlayback } from '../playback';
import type { Panel, PanelContext } from './types';

// A tab for what the shared "transcript" tab (transcriptOf) cannot pick up.
//  1. Timed annotations (a TextualBody whose target is #t=...; 0103 and the like), as a list of times
//  2. Captions by language inside a Choice (0074), as a list for the language the reader picks
//  3. The transcript text in the rendering of a Canvas (0017)
// The look of the list, and moving to a time when it is clicked, are the same as the transcript VTT (CueList).

const sources = (ctx: PanelContext) => {
  const raw = ctx.container ? rawContainerOf(ctx.manifest, ctx.container.id) : undefined;
  const hasTranscript = !!transcriptOf(ctx.container?.supplementing ?? []);
  return {
    cues: timedTextsOf(raw),
    // when there is the shared transcript tab, that is enough
    captions: hasTranscript ? [] : captionFilesOf(raw),
    rendering: hasTranscript ? undefined : renderingTranscriptOf(raw),
  };
};

// the caption file that fits the preference list best (chosen content language, then the UI language); none fits: the first
const bestFile = (files: CaptionFile[], locale: string) =>
  files.reduce((best, f) => (languageRank(f.language, locale) < languageRank(best.language, locale) ? f : best), files[0]);

function CaptionFiles({ files }: { files: CaptionFile[] }) {
  const t = useTranslations('Transcript');
  const locale = useContentLocale();
  const { currentTime, seek } = usePlayback();
  const [picked, setPicked] = useState<string | null>(null);
  const url = picked && files.some((f) => f.url === picked) ? picked : bestFile(files, locale).url;
  const file = files.find((f) => f.url === url)!;
  return (
    <div className="h-full flex flex-col">
      {files.length > 1 && (
        <div className="flex items-center gap-2 p-2 border-b border-[var(--ds-border)]">
          <label htmlFor="iiif-viewer-caption-language" className="text-sm text-[var(--ds-fg)]">
            {t('language')}
          </label>
          <select
            id="iiif-viewer-caption-language"
            value={url}
            onChange={(e) => setPicked(e.target.value)}
            className="text-sm rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-fg)] px-1 py-0.5 max-w-full"
          >
            {files.map((f) => (
              <option key={f.url} value={f.url}>
                {labelIn(f.label, locale) || f.language || f.url}
                {f.language && labelIn(f.label, locale) ? ` (${f.language})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <TranscriptPanel key={url} url={url} format={file.format} currentTime={currentTime} onSeek={seek} />
      </div>
    </div>
  );
}

function AnnotationTranscript(ctx: PanelContext) {
  const { currentTime, seek } = usePlayback();
  const { cues, captions, rendering } = useMemo(
    () => sources(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.container, ctx.manifest]
  );
  if (cues.length > 0) return <CueList cues={cues} currentTime={currentTime} onSeek={seek} />;
  if (captions.length > 0) return <CaptionFiles files={captions} />;
  if (rendering) {
    return (
      <TranscriptPanel key={rendering.url} url={rendering.url} format={rendering.format} currentTime={currentTime} onSeek={seek} />
    );
  }
  return null;
}

export const annotationTranscriptPanel: Panel = {
  id: 'annotationTranscript',

  order: 70,
  available: (ctx) => {
    if (!ctx.container || ctx.container.kind === 'Scene') return false;
    const s = sources(ctx);
    return s.cues.length > 0 || s.captions.length > 0 || !!s.rendering;
  },
  Component: AnnotationTranscript,
};
