'use client';

import { useEffect, useState } from 'react';
import { fetchJson, loadSearchSource, type SearchSource } from 'iiif-kasane/core';

export type SourceStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress?: [number, number]; partial?: SearchSource }
  | { kind: 'error' }
  | { kind: 'ready'; source: SearchSource };

/** URL を読み込み、項目の並びにする。参照先（マニフェスト）を取りに行く進み具合と、読めた分までの途中の結果も返す。 */
export function useSearchSource(url: string | null, locale: string): SourceStatus {
  const [status, setStatus] = useState<SourceStatus>({ kind: 'idle' });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 読み込みの開始を表示に出す
    setStatus({ kind: 'loading' });
    loadSearchSource({
      url,
      fetchJson,
      locale,
      onProgress: (done, total) => {
        if (!cancelled) setStatus((s) => (s.kind === 'loading' ? { ...s, progress: [done, total] } : s));
      },
      onPartial: (partial) => {
        if (!cancelled) setStatus((s) => (s.kind === 'loading' ? { ...s, partial } : s));
      },
    })
      .then((source) => !cancelled && setStatus({ kind: 'ready', source }))
      .catch((e) => {
        console.error('Error loading the search source:', e);
        if (!cancelled) setStatus({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [url, locale]);

  return url ? status : { kind: 'idle' };
}
