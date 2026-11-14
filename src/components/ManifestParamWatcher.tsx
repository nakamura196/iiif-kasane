'use client';

// URL の資料（iiif-content など）が変わったら知らせる。開いたときにも 1 回知らせる
// 入口のサンプルや事例のリンクは同じページへの移動なので、ページは開き直されず、開いたときだけ URL を読む作りでは何も起きない。
// useSearchParams を使うと静的書き出しでその部分が描かれなくなるので、ページ全体ではなく、何も描かないこの部品だけを Suspense で包んで使う
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { manifestFromParams } from 'iiif-kasane/core';
import { useStableList } from '@/lib/useStableList';

// The Collections walked through to reach the item (?collection=, repeated, top first) come as the second argument.
export default function ManifestParamWatcher({
  onChange,
}: {
  onChange: (manifest: string | null, collections: string[]) => void;
}) {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams?.toString() ?? '');
  const manifest = manifestFromParams(params);
  // the same array while the Collections are the same, so that the effect runs when they change (a new array each render would run it every time)
  const collections = useStableList(params.getAll('collection'));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeRef.current(manifest, collections);
  }, [manifest, collections]);
  return null;
}
