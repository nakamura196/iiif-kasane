'use client';

import { useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import {
  captionFilesOf,
  captionKindOf,
  isCaptions,
  labelIn,
  rawContainerOf,
  timedCaptionsOf,
  toWebVtt,
  youTubeIdOf,
  youTubeStartOf,
  type ContainerInfo,
  type MediaOption,
  languageRank,
} from '../../core';
import { manifestAtom } from '../atoms';
import { useContentLocale } from '../env';
import { usePlayback } from '../playback';
import MediaView, { type CaptionTrack } from './MediaView';
import { useReferencedPages } from './useReferencedPages';
import VideoAnnotations from './VideoAnnotations';
import YouTubeView from './YouTubeView';

// Shows video and audio (the chosen content). Captions go to <track>.
// Besides the shared reading (supplementing), captions in several languages inside a Choice (0074) are
// added from the plain data of the manifest. The language is switched with the video's own caption menu.
// Captions written as timed annotations (0079; often on a page that is only referenced) are
// rebuilt as WebVTT and given to <track>.
// If the content is a YouTube page, it is played in YouTube's embedded player (YouTubeView draws the captions over it).
export default function MediaPainting({
  container,
  option,
}: {
  container: ContainerInfo;
  option: MediaOption & { kind: 'Video' | 'Audio' };
}) {
  const locale = useContentLocale();
  const manifest = useAtomValue(manifestAtom);
  const { mediaRef, setCurrentTime } = usePlayback();

  const tracks: CaptionTrack[] = container.supplementing.filter(isCaptions).map((s) => ({
    url: s.url,
    language: s.language[0],
    label: labelIn(s.label, locale) || s.language[0] || 'captions',
    kind: captionKindOf(s.provides),
  }));
  const raw = rawContainerOf(manifest, container.id);
  for (const f of captionFilesOf(raw)) {
    if (tracks.some((t) => t.url === f.url)) continue;
    tracks.push({
      url: f.url,
      language: f.language,
      label: labelIn(f.label, locale) || f.language || 'captions',
      kind: f.kind,
    });
  }

  const resolved = useReferencedPages(raw);
  const annotated = useMemo(
    () =>
      timedCaptionsOf(resolved).map((g) => ({
        url: URL.createObjectURL(new Blob([toWebVtt(g.cues)], { type: 'text/vtt' })),
        language: g.language,
        label: g.language || 'captions',
        kind: g.kind,
      })),
    [resolved],
  );
  useEffect(() => () => annotated.forEach((t) => URL.revokeObjectURL(t.url)), [annotated]);
  tracks.push(...annotated);
  // captions in the reader's languages first (the chosen content language, then the UI language); the first one is the default
  tracks.sort((a, b) => languageRank(a.language, locale) - languageRank(b.language, locale));

  const youTubeId = option.kind === 'Video' ? youTubeIdOf(option.url) : null;
  if (youTubeId) {
    return (
      <YouTubeView
        videoId={youTubeId}
        start={youTubeStartOf(option.url)}
        tracks={tracks}
        mediaRef={mediaRef}
        onTimeUpdate={setCurrentTime}
      />
    );
  }

  return (
    <MediaView
      kind={option.kind}
      src={option.url}
      format={option.format}
      width={container.width}
      height={container.height}
      tracks={tracks}
      mediaRef={mediaRef}
      onTimeUpdate={setCurrentTime}
      overlay={option.kind === 'Video' && container.kind === 'Canvas' ? <VideoAnnotations container={container} /> : undefined}
    />
  );
}
