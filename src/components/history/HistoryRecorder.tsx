'use client';

import { useEffect } from 'react';
import { fetchManifest, manifestThumbnailOf } from 'iiif-kasane/core';
import { isRecordable, recordOpened, type HistoryLabel } from '@/lib/history';

const labelOf = (raw: unknown): HistoryLabel | undefined => {
  const label = (raw as { label?: unknown } | null)?.label;
  return typeof label === 'string' || (typeof label === 'object' && label !== null) ? (label as HistoryLabel) : undefined;
};

// Adds the item shown in the viewer to "Recently opened". Draws nothing.
// The label and the thumbnail come from the manifest, which the viewer has just fetched (the package shares the request).
// fetchManifest resolves null when the item cannot be read: it is still recorded, and what was known before is kept.
// Items reached by browsing inside a Collection are not recorded: the viewer does not report them yet.
export default function HistoryRecorder({ url }: { url: string | null }) {
  useEffect(() => {
    if (!url || !isRecordable(url)) return;
    let cancelled = false;
    fetchManifest(url).then((raw) => {
      if (cancelled) return;
      if (!raw) {
        recordOpened({ url });
        return;
      }
      recordOpened({
        url,
        label: labelOf(raw),
        kind: (raw as { type?: unknown }).type === 'Collection' ? 'collection' : 'manifest',
        thumbnail: manifestThumbnailOf(raw),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return null;
}
