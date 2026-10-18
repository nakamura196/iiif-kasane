'use client';

// structure 機能の状態。Viewer ごとの jotai store に載る（グローバルな変数は作らない）。
// 右パネルの目次・ページ送り・表示が、これを通してつながる。

import { useCallback, useMemo } from 'react';
import { useLocale } from '../env';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import {
  canvasBehaviorsOf,
  convertToV4,
  fetchManifest,
  firstSceneOf,
  groupSpreads,
  orderOf,
  paintedModelsOf,
  parseManifestV4,
  sequencesOf,
  viewingOf,
  type CanvasTarget,
  type CompareItem,
  type ContainerInfo,
  type ManifestV4,
  type SequenceInfo,
  type ViewingInfo,
} from '../../core';
import { annotationsAtom, manifestAtom, manifestUrlAtom, modelChoicesAtom, paintedModelsAtom } from '../atoms';

/** 移動の依頼（右パネルの目次などが出し、ContainerList が受ける）。 */
export interface NavRequest {
  seq: number;
  target: CanvasTarget;
  /** false: move there without drawing the box around the region (the asker marks it itself). */
  highlight?: boolean;
}

export const navRequestAtom = atom<NavRequest | null>(null);

/** いま強調する領域・時間（移動の結果）。ページを変えると消える。 */
export const focusAtom = atom<NavRequest | null>(null);

/** 0540: content state が複数の Canvas を指すとき、並べて見せる container の番号（先頭が選択中）。 */
export const compareAtom = atom<number[]>([]);

/**
 * 0540: content state が別々のマニフェストの Canvas を指すとき、並べて見せるもの。
 * anchor は開いているマニフェストの Canvas の番号（ここから離れたら解除）。failed は読めなかったマニフェスト。
 */
export interface CompareMulti {
  anchor: number;
  items: CompareItem[];
  failed: string[];
}
export const compareMultiAtom = atom<CompareMulti | null>(null);

/** 選ばれている代替のページ順（sequence の Range の id）。null は元の順。 */
export const sequenceIdAtom = atom<string | null>(null);

/** Collection をたどってきた道すじ（戻るために、開く前のものを積む）。 */
export const trailAtom = atom<{ owner: string | null; items: ManifestV4[] }>({ owner: null, items: [] });

let seqCounter = 0;
export const nextSeq = (): number => ++seqCounter;

export interface PageOrder {
  viewing: ViewingInfo;
  sequences: SequenceInfo[];
  /** 表示順の container の番号 */
  order: number[];
  /** 見開きなどの組（表示順） */
  groups: number[][];
}

/** マニフェストの見せ方・ページ順・見開きの組を決める。 */
export function usePageOrder(manifest: ManifestV4 | null | undefined, containers: ContainerInfo[]): PageOrder {
  const sequenceId = useAtomValue(sequenceIdAtom);
  return useMemo(() => {
    const viewing = viewingOf(manifest);
    const sequences = sequencesOf(manifest);
    const chosen = sequences.find((s) => s.id === sequenceId) ?? null;
    const order = orderOf(containers, chosen);
    const behaviors = canvasBehaviorsOf(manifest);
    const standalone = (i: number) => {
      const b = behaviors.get(containers[i]?.id) ?? [];
      return b.includes('non-paged') || b.includes('facing-pages');
    };
    return { viewing, sequences, order, groups: groupSpreads(order, viewing.mode, standalone) };
  }, [manifest, containers, sequenceId]);
}

/** マニフェストを（URL から）読み直して、Viewer の状態に入れる。Collection からの移動にも使う。 */
export function useManifestSwitch() {
  const manifest = useAtomValue(manifestAtom);
  const manifestUrl = useAtomValue(manifestUrlAtom);
  const trail = useAtomValue(trailAtom);
  const locale = useLocale();
  const setManifest = useSetAtom(manifestAtom);
  const setAnnotations = useSetAtom(annotationsAtom);
  const setPainted = useSetAtom(paintedModelsAtom);
  const setChoices = useSetAtom(modelChoicesAtom);
  const setTrail = useSetAtom(trailAtom);
  const setSequence = useSetAtom(sequenceIdAtom);
  const setFocus = useSetAtom(focusAtom);
  const setCompare = useSetAtom(compareAtom);
  const setCompareMulti = useSetAtom(compareMultiAtom);

  const apply = useCallback(
    (next: ManifestV4) => {
      const { annotations } = parseManifestV4(next, undefined, locale);
      setPainted(paintedModelsOf(firstSceneOf(next)));
      setChoices({});
      setManifest(next);
      setAnnotations(annotations);
      setSequence(null);
      setFocus(null);
      setCompare([]);
      setCompareMulti(null);
    },
    [setManifest, setAnnotations, setPainted, setChoices, setSequence, setFocus, setCompare, setCompareMulti, locale],
  );

  /** URL のマニフェスト（または Collection）を開く。push なら「戻る」で今のものに戻れる。 */
  const open = useCallback(
    async (url: string, push: boolean): Promise<boolean> => {
      const raw = await fetchManifest(url);
      if (!raw) return false;
      try {
        const next = convertToV4(raw);
        if (push && manifest) {
          setTrail((t) => ({
            owner: manifestUrl,
            items: t.owner === manifestUrl ? [...t.items, manifest] : [manifest],
          }));
        }
        apply(next);
        return true;
      } catch (e) {
        console.error('Error reading manifest:', e);
        return false;
      }
    },
    [apply, manifest, manifestUrl, setTrail],
  );

  const items = useMemo(() => (trail.owner === manifestUrl ? trail.items : []), [trail, manifestUrl]);

  const back = useCallback(() => {
    const prev = items[items.length - 1];
    if (!prev) return;
    setTrail({ owner: manifestUrl, items: items.slice(0, -1) });
    apply(prev);
  }, [items, manifestUrl, setTrail, apply]);

  return { open, back, canGoBack: items.length > 0 };
}
