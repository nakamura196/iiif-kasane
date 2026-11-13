'use client';

import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { fetchManifest } from '../../core';
import { shownManifestAtom } from '../atoms';

// The manifest as served (before convertToV4), for the image display and the image comparison.
// For the shown manifest, the JSON read when it was loaded (shownManifestAtom) is used as is, without fetching
// again (so inputs that cannot be fetched again keep their service). Only other URLs (given by host pages) are fetched;
// requests for the same URL are shared.

const rawCache = new Map<string, Promise<unknown>>();

/** The manifest as served (undefined while loading, null when it could not be read). */
export function useRawManifest(url: string | null): unknown | null | undefined {
  const shown = useAtomValue(shownManifestAtom);
  const stored = url && shown?.url === url ? shown.raw : undefined;
  const [res, setRes] = useState<{ url: string; raw: unknown } | null>(null);
  useEffect(() => {
    if (!url || stored !== undefined) return;
    let cancelled = false;
    let p = rawCache.get(url);
    if (!p) {
      p = fetchManifest(url);
      rawCache.set(url, p);
    }
    p.then((raw) => {
      if (!cancelled) setRes({ url, raw });
    });
    return () => {
      cancelled = true;
    };
  }, [url, stored]);
  if (stored !== undefined) return stored;
  return url && res?.url === url ? res.raw : undefined;
}
