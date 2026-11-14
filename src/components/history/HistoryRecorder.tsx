'use client';

import { useEffect } from 'react';
import { fetchManifest, manifestThumbnailOf } from 'iiif-kasane/core';
import { isRecordable, recordOpened, type HistoryLabel } from '@/lib/history';

const labelOf = (raw: unknown): HistoryLabel => {
  const label = (raw as { label?: unknown } | null)?.label;
  return typeof label === 'string' || (typeof label === 'object' && label !== null) ? (label as HistoryLabel) : '';
};

// Adds the item shown in the viewer to "Recently opened". Draws nothing.
// The label and the thumbnail come from the manifest, which the viewer has just fetched (the package shares the request).
// Items reached by browsing inside a Collection are not recorded: the viewer does not report them yet.
export default function HistoryRecorder({ url }: { url: string | null }) {
  useEffect(() => {
    if (!url || !isRecordable(url)) return;
    let cancelled = false;
    fetchManifest(url)
      .then((raw) => {
        if (cancelled) return;
        const isCollection = (raw as { type?: unknown } | null)?.type === 'Collection';
        recordOpened({
          url,
          label: labelOf(raw),
          kind: isCollection ? 'collection' : 'manifest',
          thumbnail: manifestThumbnailOf(raw),
        });
      })
      .catch(() => {
        // an item that cannot be read is still worth finding again
        if (!cancelled) recordOpened({ url, label: '', kind: 'manifest' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return null;
}
