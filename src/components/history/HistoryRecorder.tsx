'use client';

import { useEffect } from 'react';
import { fetchManifest } from 'iiif-kasane/core';
import { isRecordable, recordLoaded } from '@/lib/history';

// Adds the item shown in the viewer to "Recently opened". Draws nothing.
// The label and the thumbnail come from the manifest, which the viewer has just fetched (the package shares the request).
// An item that cannot be read (fetchManifest gives null) is not recorded. A successful read is recorded even when the
// user has already left: it only writes to storage, never to React state.
// Items reached by browsing inside a Collection are not recorded: the viewer does not report them yet.
export default function HistoryRecorder({ url }: { url: string | null }) {
  useEffect(() => {
    if (!url || !isRecordable(url)) return;
    void fetchManifest(url).then((raw) => recordLoaded(url, raw));
  }, [url]);
  return null;
}
