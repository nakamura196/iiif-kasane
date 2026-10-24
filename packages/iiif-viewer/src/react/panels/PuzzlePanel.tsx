'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue } from 'jotai';
import {
  imageLayerCount,
  isPuzzleSolved,
  puzzlePlacedCount,
  shufflePuzzle,
  swapPuzzlePieces,
  type ContainerInfo,
  type ManifestV4,
  type PuzzleBoard,
} from '../../core';
import { manifestAtom } from '../atoms';
import { useTranslations, type Translator } from '../env';
import { baseImageLayerOf, sourceImageUrl } from '../inference/sourceImage';
import type { Panel, PanelContext } from './types';

// 表示中の画像でジグソーパズル（マスを入れ替えて元の絵に戻す）。portal_pro の puzzle.html を移したもの。
// 画像は 1 枚だけ取り、ピースは CSS の背景の位置で切り出す。画素は読まないので、
// 画像のサーバが他所からの読み取り（CORS）を許していなくても遊べる。

const BUTTON =
  'px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent';
const PRIMARY =
  'px-2.5 py-1 rounded text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600';

const SIZES = [3, 4, 5, 6, 8] as const;
// 取り寄せる画像の長辺。盤面は画面に収まる大きさなので、これ以上は要らない
const LONG_SIDE = 1600;
// 盤面の外に取る余白（上の帯・下の操作の行）
const CHROME_HEIGHT = 150;

interface Picture {
  url: string;
  width: number;
  height: number;
}

const loadPicture = (url: string) =>
  new Promise<Picture>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('load'));
    img.src = url;
  });

const useViewport = () => {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
};

function PuzzleDialog({ picture, size, onClose, t }: { picture: Picture; size: number; onClose: () => void; t: Translator }) {
  const [board, setBoard] = useState<PuzzleBoard>(() => shufflePuzzle(size));
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [showSample, setShowSample] = useState(false);
  const viewport = useViewport();
  const solved = isPuzzleSolved(board);

  // 画面に収まる大きさの盤面（縦横比は画像のまま）
  const aspect = picture.width / picture.height;
  const maxW = Math.max(120, viewport.w - 32);
  const maxH = Math.max(120, viewport.h - CHROME_HEIGHT);
  const width = Math.floor(Math.min(maxW, maxH * aspect));
  const height = Math.floor(width / aspect);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const swap = (a: number, b: number) => {
    setSelected(null);
    if (a === b || solved) return;
    setBoard((cur) => swapPuzzlePieces(cur, a, b));
    setMoves((m) => m + 1);
  };
  const pick = (cell: number) => {
    if (solved) return;
    if (selected === null) setSelected(cell);
    else swap(selected, cell);
  };
  const restart = () => {
    setBoard(shufflePuzzle(size));
    setSelected(null);
    setMoves(0);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-white"
    >
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm" aria-live="polite">
        {solved ? (
          <span className="font-semibold text-green-300">{t('solved', { moves })}</span>
        ) : (
          <span className="tabular-nums">{t('status', { placed: puzzlePlacedCount(board), total: board.length, moves })}</span>
        )}
      </div>

      <div className="relative" style={{ width, height }}>
        <div
          className="grid h-full w-full"
          style={{
            gridTemplateColumns: `repeat(${size}, 1fr)`,
            gridTemplateRows: `repeat(${size}, 1fr)`,
            gap: solved ? 0 : 1,
            transition: 'gap 300ms',
          }}
        >
          {board.map((piece, cell) => {
            const col = piece % size;
            const row = Math.floor(piece / size);
            const active = selected === cell;
            return (
              <button
                key={piece}
                type="button"
                draggable={!solved}
                onClick={() => pick(cell)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(cell));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  if (Number.isInteger(from)) swap(from, cell);
                }}
                aria-label={t('piece', { cell: cell + 1 })}
                aria-pressed={active}
                className={`block min-h-0 min-w-0 p-0 ${solved ? 'cursor-default' : 'cursor-pointer'} ${
                  active ? 'relative z-10 outline outline-3 outline-yellow-400' : ''
                }`}
                style={{
                  backgroundImage: `url("${picture.url}")`,
                  backgroundSize: `${width}px ${height}px`,
                  // 隙間の分だけずれないよう、マスの大きさではなく盤面に対する割合で位置を決める
                  backgroundPosition: `${size > 1 ? (col / (size - 1)) * 100 : 0}% ${size > 1 ? (row / (size - 1)) * 100 : 0}%`,
                }}
              />
            );
          })}
        </div>
        {showSample && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture.url} alt="" className="pointer-events-none absolute inset-0 h-full w-full opacity-40" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className={`${BUTTON} border-gray-500 text-white hover:bg-gray-800`} onClick={restart}>
          {t('reshuffle')}
        </button>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={showSample} onChange={(e) => setShowSample(e.target.checked)} />
          {t('sample')}
        </label>
        <button type="button" className={PRIMARY} onClick={onClose} autoFocus>
          {t('close')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The puzzle's start controls (grid size and Start) for the shown image. Also for a host page that puts it in a tab of its own. */
export function Puzzle({ container, manifest, className = 'p-3 space-y-3 text-sm' }: PanelContext & { className?: string }) {
  const t = useTranslations('Puzzle');
  const fromAtom = useAtomValue(manifestAtom);
  const m: ManifestV4 | null | undefined = manifest ?? fromAtom;
  const [size, setSize] = useState<number>(4);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const close = useCallback(() => setPicture(null), []);

  const start = async (c: ContainerInfo) => {
    const layer = baseImageLayerOf(m, c);
    if (!layer) {
      setState('error');
      return;
    }
    setState('loading');
    try {
      setPicture(await loadPicture(await sourceImageUrl(layer, LONG_SIDE)));
      setState('idle');
    } catch {
      setState('error');
    }
  };

  if (!container) return null;
  return (
    <div className={className}>
      <p className="text-xs text-gray-600 dark:text-gray-300">{t('hint')}</p>
      <label className="flex items-center gap-2 text-xs">
        {t('size')}
        <select
          className="rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1 py-0.5"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        >
          {SIZES.map((n) => (
            <option key={n} value={n}>
              {t('sizeOption', { n, total: n * n })}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={PRIMARY} disabled={state === 'loading'} onClick={() => start(container)}>
        {state === 'loading' ? t('loading') : t('start')}
      </button>
      {state === 'error' && <p className="text-xs text-red-600 dark:text-red-400">{t('error')}</p>}
      {picture && <PuzzleDialog key={`${picture.url}-${size}`} picture={picture} size={size} onClose={close} t={t} />}
    </div>
  );
}

/** Whether the puzzle can be played on this container (a Canvas with an image). */
export const canPlayPuzzle = ({ container }: PanelContext) =>
  container?.kind === 'Canvas' && imageLayerCount(container.painting) > 0;

export const puzzlePanel: Panel = {
  id: 'puzzle',
  order: 110,
  available: canPlayPuzzle,
  Component: (ctx) => <Puzzle {...ctx} />,
};
