'use client';

// URL の資料（iiif-content など）が変わったら知らせる。開いたときにも 1 回知らせる
// 入口のサンプルや事例のリンクは同じページへの移動なので、ページは開き直されず、開いたときだけ URL を読む作りでは何も起きない。
// useSearchParams を使うと静的書き出しでその部分が描かれなくなるので、ページ全体ではなく、何も描かないこの部品だけを Suspense で包んで使う
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { manifestFromParams } from '@nakamura196/iiif-viewer/core';

export default function ManifestParamWatcher({ onChange }: { onChange: (manifest: string | null) => void }) {
  const searchParams = useSearchParams();
  const manifest = manifestFromParams(new URLSearchParams(searchParams?.toString() ?? ''));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeRef.current(manifest);
  }, [manifest]);
  return null;
}
