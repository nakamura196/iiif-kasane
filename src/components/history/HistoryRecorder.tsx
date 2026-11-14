'use client';

import { useEffect, useRef } from 'react';
import { fetchManifest } from 'iiif-kasane/core';
import { beginOpen, isRecordable, recordLoaded } from '@/lib/history';

// Adds the item shown in the viewer to "Recently opened". Draws nothing.
// The label and the thumbnail come from the manifest, which the viewer has just fetched (the package shares the request).
// An item that cannot be read (fetchManifest gives null) is not recorded. A successful read is recorded even when the
// user has already left the viewer: that only writes to storage. A read is dropped when another item was opened since,
// or when "Clear history" ran since it started (see beginOpen).
// onLoaded tells the Header that this item loaded, so that it can be bookmarked; it is not called after unmount.
// Items reached by browsing inside a Collection are not recorded: the viewer does not report them yet.
export default function HistoryRecorder({ url, onLoaded }: { url: string | null; onLoaded?: (url: string) => void }) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!url || !isRecordable(url)) return;
    const ticket = beginOpen(url);
    void fetchManifest(url).then((raw) => {
      recordLoaded(url, raw, ticket);
      if (raw && mounted.current) onLoaded?.(url);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded is a state setter
  }, [url]);
  return null;
}
