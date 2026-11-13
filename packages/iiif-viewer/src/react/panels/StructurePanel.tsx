'use client';

import { useMemo } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  hasToc,
  isTocNodeActive,
  labelIn,
  navigableTree,
  rangesOf,
  sequencesOf,
  viewingOf,
  type TocNode,
} from '../../core';
import { sequenceIdAtom } from '../internalState';
import { navRequestAtom, nextSeq } from '../displays/structureState';
import { useLocale, useTranslations } from '../env';
import { usePlayback } from '../playback';
import type { Panel, PanelContext } from './types';

const formatTime = (s: number): string => {
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
};

function Tree({
  nodes,
  activeId,
  onOpen,
  time,
  depth,
  rtl,
}: {
  nodes: TocNode[];
  activeId: string | undefined;
  time: number;
  onOpen: (node: TocNode) => void;
  depth: number;
  /** right-to-left books: the thumbnail grid fills from the right */
  rtl: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations('Structure');

  const row = (n: TocNode) => {
    const label = labelIn(n.label, locale) || n.id.split('/').pop() || n.id;
    const t0 = n.target?.t?.[0];
    const active = isTocNodeActive(n, activeId, time);
    return (
      <button
        type="button"
        disabled={!n.target}
        onClick={() => onOpen(n)}
        aria-current={active ? 'true' : undefined}
        className={`w-full text-left text-sm px-2 py-1 rounded flex items-baseline gap-2 ${
          active ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]'
        } disabled:opacity-60 disabled:hover:bg-transparent`}
      >
        <span className="min-w-0 break-words">{label}</span>
        {t0 !== undefined ? <span className="ml-auto text-xs tabular-nums opacity-70">{formatTime(t0)}</span> : null}
        {n.target?.xywh ? <span className="ml-auto text-xs opacity-70">{t('region')}</span> : null}
      </button>
    );
  };

  return (
    <ul className={depth === 0 ? 'space-y-0.5' : 'ml-3 pl-2 border-l border-[var(--ds-border)] space-y-0.5'}>
      {nodes.map((n, i) => {
        // thumbnail-nav: the children are shown as a grid of their thumbnails
        const thumbs = n.behavior.includes('thumbnail-nav') && n.children.some((c) => c.thumbnail);
        return (
          <li key={`${n.id}-${i}`}>
            {row(n)}
            {n.children.length > 0 &&
              (thumbs ? (
                <ul className="grid grid-cols-2 gap-2 p-2" dir={rtl ? 'rtl' : undefined}>
                  {n.children.map((c, j) => (
                    <li key={`${c.id}-${j}`} dir={rtl ? 'ltr' : undefined}>
                      <button
                        type="button"
                        disabled={!c.target}
                        onClick={() => onOpen(c)}
                        className="w-full text-left text-xs text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)] rounded p-1"
                      >
                        {c.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbnail} alt="" loading="lazy" className="w-full h-auto" />
                        ) : null}
                        <span className="block break-words">{labelIn(c.label, locale)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Tree nodes={n.children} activeId={activeId} time={time} onOpen={onOpen} depth={depth + 1} rtl={rtl} />
              ))}
          </li>
        );
      })}
    </ul>
  );
}

// The table of contents (structures > Range) and the choice of page order (sequence Range).
function StructurePanel({ container, manifest }: PanelContext) {
  const t = useTranslations('Structure');
  const locale = useLocale();
  const [sequenceId, setSequenceId] = useAtom(sequenceIdAtom);
  const setRequest = useSetAtom(navRequestAtom);
  const { currentTime } = usePlayback();
  const tree = useMemo(() => navigableTree(rangesOf(manifest)), [manifest]);
  const sequences = useMemo(() => sequencesOf(manifest), [manifest]);

  const open = (node: TocNode) => {
    if (node.target) setRequest({ seq: nextSeq(), target: node.target });
  };

  return (
    <div className="p-3 space-y-4">
      {sequences.length > 1 && (
        <fieldset>
          <legend className="text-xs font-medium text-[var(--ds-fg)] opacity-70 mb-1">{t('order')}</legend>
          <label className="flex items-center gap-2 text-sm text-[var(--ds-fg)] py-0.5">
            <input type="radio" name="iiif-page-order" checked={sequenceId === null} onChange={() => setSequenceId(null)} />
            {t('orderDefault')}
          </label>
          {sequences.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-[var(--ds-fg)] py-0.5">
              <input
                type="radio"
                name="iiif-page-order"
                checked={sequenceId === s.id}
                onChange={() => setSequenceId(s.id)}
              />
              {labelIn(s.label, locale) || s.id}
            </label>
          ))}
        </fieldset>
      )}
      {tree.length > 0 ? (
        <nav aria-label={t('toc')}>
          <Tree nodes={tree} activeId={container?.id} time={currentTime} onOpen={open} depth={0} rtl={viewingOf(manifest).direction === 'right-to-left'} />
        </nav>
      ) : sequences.length <= 1 ? (
        <p className="text-sm text-[var(--ds-fg)] opacity-70">{t('empty')}</p>
      ) : null}
    </div>
  );
}

export const structurePanel: Panel = {
  id: 'structure',

  order: 30,
  available: ({ manifest }) => hasToc(manifest) || sequencesOf(manifest).length > 1,
  Component: StructurePanel,
};
