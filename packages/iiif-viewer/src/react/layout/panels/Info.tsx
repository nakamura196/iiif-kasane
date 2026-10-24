'use client';

import { useState } from 'react';
import { useAtomValue } from 'jotai';
import type { ContainerInfo, ManifestV4 } from '../../../core';
import { useTranslations } from '../../env';
import { withExtraPanels } from '../../panels/registry';
import type { Panel } from '../../panels/types';
import { annotationsAtom } from '../../atoms';
import { inferenceResultsAtom } from '../../inference/state';
import { localAnnotationPagesAtom } from '../../overlays/canvasAnnotationState';
import { CONTENT_SEARCH_SOURCE } from '../../panels/ContentSearchPanel';

// 既知のタブ名。機能を足すと増えるので、任意の文字列も受ける。
export type InfoTab = 'metadata' | 'annotations' | 'transcript' | (string & {});

type Props = {
  /** Controlled tab. Without it the component keeps the tab in its own state. */
  tab?: InfoTab;
  onTabChange?: (tab: InfoTab) => void;
  /** The container that is shown. Without it: metadata, and annotations when any are loaded (compare page). */
  container?: ContainerInfo;
  manifest?: ManifestV4 | null;
  /** Tabs added by the host page (links to its own pages etc.), mixed in by order. */
  extraPanels?: Panel[];
  /** Ids of the viewer's own tabs not to show. */
  hiddenPanels?: string[];
};

const TAB_CLASS = (active: boolean) =>
  `shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
    active
      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
      : 'border-transparent text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
  }`;

const Info = ({ tab, onTabChange, container, manifest, extraPanels, hiddenPanels }: Props) => {
  const t = useTranslations('Info');
  const [inner, setInner] = useState<InfoTab | null>(null);
  const annotationCount = useAtomValue(annotationsAtom).length;
  const localPages = useAtomValue(localAnnotationPagesAtom);
  const inferenceCount = Object.keys(useAtomValue(inferenceResultsAtom)).length;
  // 文字の検索の印そのものは数えない（印だけが残ってタブが消えなくなるため）
  const localAnnotationCount = localPages.filter((l) => l.source !== CONTENT_SEARCH_SOURCE).length + inferenceCount;
  const ctx = { container, manifest, annotationCount, localAnnotationCount };
  const available = withExtraPanels(extraPanels).filter((p) => !hiddenPanels?.includes(p.id) && p.available(ctx));
  const ids = available.map((p) => p.id);
  // 「資料情報」は前の「資料情報（about）」タブも兼ねる。古いリンクの ?tab=about はそこへ
  const asked = tab === 'about' ? 'metadata' : tab;
  const wanted = asked ?? inner ?? ids[0];
  const active = available.find((p) => p.id === wanted) ?? available[0];

  const handleTabChange = (next: InfoTab) => {
    setInner(next);
    onTabChange?.(next);
  };

  return (
    <div className="h-full min-w-0 flex flex-col">
      {/* タブヘッダー */}
      <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {available.map((p) => (
          <button key={p.id} onClick={() => handleTabChange(p.id)} className={TAB_CLASS(active?.id === p.id)}>
            {p.label ?? t(p.id)}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
        {active ? <active.Component {...ctx} /> : null}
      </div>
    </div>
  );
};

export default Info;
