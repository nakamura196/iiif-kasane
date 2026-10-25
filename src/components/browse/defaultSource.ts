// 引数なしで開いたときに並べる資料: Kasane のユースケースのうち、ビューアで開くもの。
// 外の Collection を既定にすると、そのサーバが落ちたり認証を掛けたり（元の iiif-3d-gallery の既定は 401 になった）で
// 入口が壊れるので、サイト内のサムネイルだけで並べる。ネットワークは使わない。

import { USE_CASES, thumbnailOf, type Locale } from '@/lib/usecases';
import type { BrowseItem, BrowseSource } from '@/lib/browse';

export function defaultBrowseSource(locale: Locale): BrowseSource {
  const items: BrowseItem[] = USE_CASES.flatMap((u) =>
    u.open.page === 'viewer'
      ? [
          {
            id: u.id,
            label: u.title[locale],
            manifestUrl: u.open.manifest,
            canvasIndex: null,
            thumbnail: thumbnailOf(u, locale),
            group: '',
            summary: u.headline?.[locale] ?? '',
          },
        ]
      : []
  );
  return { kind: 'collection', title: '', items };
}
