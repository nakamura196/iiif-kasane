'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
import { BUTTON } from '../common/buttonClasses';
import { CopyButton } from '../common/CopyButton';
import { baseImageLayerOf, sourceImageUrl } from '../inference/sourceImage';
import type { Panel, PanelContext } from './types';

// A jigsaw puzzle of the shown image (swap squares to restore the picture). Moved from portal_pro's puzzle.html.
// The image is fetched once and the pieces are cut out with the CSS background position. No pixels are read,
// so it works even when the image server does not allow cross-origin reads (CORS).

const PRIMARY =
  'px-2.5 py-1 rounded text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600';

const SIZES = [3, 4, 5, 6, 8] as const;
// The long side of the image to fetch. The board fits the screen, so more is not needed
const LONG_SIDE = 1600;
// The margin kept outside the board (the bar above and the row of controls below)
const CHROME_HEIGHT = 190;
// The number and the colours of the confetti that falls when the puzzle is solved
const CONFETTI_COUNT = 90;
const CONFETTI_COLORS = ['#facc15', '#f472b6', '#60a5fa', '#34d399', '#f97316', '#a78bfa', '#ffffff'];

// The celebration when solved. It adds no dependency and is drawn with CSS motion only.
// With reduced motion (prefers-reduced-motion), the glow and confetti are left out and only the result is shown
const CELEBRATION_CSS = `
@keyframes kasane-puzzle-snap {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
  35% { transform: scale(1.035); box-shadow: 0 0 0 6px rgba(250, 204, 21, 0.55); }
  100% { transform: scale(1); box-shadow: 0 0 32px 4px rgba(250, 204, 21, 0.25); }
}
@keyframes kasane-puzzle-shine {
  from { transform: translateX(-120%) skewX(-18deg); }
  to { transform: translateX(260%) skewX(-18deg); }
}
@keyframes kasane-puzzle-fall {
  0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
  85% { opacity: 1; }
  100% { transform: translate3d(var(--kp-dx), 110vh, 0) rotate(var(--kp-rot)); opacity: 0; }
}
@keyframes kasane-puzzle-pop {
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.kasane-puzzle-snap { animation: kasane-puzzle-snap 700ms ease-out 250ms both; }
.kasane-puzzle-shine {
  position: absolute; top: -10%; bottom: -10%; left: 0; width: 35%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.65), transparent);
  mix-blend-mode: soft-light;
  animation: kasane-puzzle-shine 1100ms ease-in-out 550ms both;
  pointer-events: none;
}
.kasane-puzzle-confetti {
  position: absolute; top: 0; width: 8px; height: 14px; border-radius: 2px;
  animation: kasane-puzzle-fall var(--kp-dur) cubic-bezier(0.25, 0.6, 0.5, 1) var(--kp-delay) both;
  pointer-events: none;
}
.kasane-puzzle-pop { animation: kasane-puzzle-pop 450ms ease-out 400ms both; }
@media (prefers-reduced-motion: reduce) {
  .kasane-puzzle-snap, .kasane-puzzle-pop { animation: none; }
  .kasane-puzzle-shine, .kasane-puzzle-confetti { display: none; }
  .kasane-puzzle-grid { transition: none !important; }
}
`;

interface Confetto {
  left: number;
  dx: number;
  rot: number;
  delay: number;
  dur: number;
  color: string;
  round: boolean;
}

const makeConfetti = (): Confetto[] =>
  Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    left: Math.random() * 100,
    dx: (Math.random() - 0.5) * 30,
    rot: (Math.random() - 0.5) * 1440,
    delay: 300 + Math.random() * 900,
    dur: 2200 + Math.random() * 1800,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: Math.random() < 0.3,
  }));

// The time of the moment it is solved, and the confetti that falls then (called only when a piece is moved)
const finishRound = () => ({ at: Date.now(), confetti: makeConfetti() });

/** Formats the elapsed time as m:ss (h:mm:ss over an hour). */
const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// The elapsed time. Stops at the finish time (finishedAt) when there is one
const useElapsed = (startedAt: number, finishedAt: number | null) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finishedAt !== null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [finishedAt, startedAt]);
  return (finishedAt ?? Math.max(now, startedAt)) - startedAt;
};

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

function PuzzleDialog({
  picture,
  size,
  onClose,
  shareUrl,
  t,
}: {
  picture: Picture;
  size: number;
  onClose: () => void;
  shareUrl?: string;
  t: Translator;
}) {
  const [board, setBoard] = useState<PuzzleBoard>(() => shufflePuzzle(size));
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [showSample, setShowSample] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const viewport = useViewport();
  const solved = isPuzzleSolved(board);
  // The time it was solved and the confetti for it (made anew each time it is solved)
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [confetti, setConfetti] = useState<Confetto[]>([]);
  const elapsed = useElapsed(startedAt, finishedAt);

  // A board that fits the screen (the aspect ratio of the image is kept)
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
    const next = swapPuzzlePieces(board, a, b);
    setBoard(next);
    setMoves((m) => m + 1);
    if (isPuzzleSolved(next)) {
      const done = finishRound();
      setFinishedAt(done.at);
      setConfetti(done.confetti);
    }
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
    setStartedAt(Date.now());
    setFinishedAt(null);
    setConfetti([]);
  };

  // It is rendered under body, so the viewer's colours and the viewer-only styles (iiif-viewer) are applied here too
  return createPortal(
    <div className="iiif-viewer">
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-white"
    >
      <style>{CELEBRATION_CSS}</style>
      <div className="flex min-h-14 flex-wrap items-center justify-center gap-3 text-sm" aria-live="polite">
        {solved ? (
          <div className="kasane-puzzle-pop flex flex-col items-center gap-0.5">
            <span className="text-xl font-bold tracking-wide text-yellow-300">{t('solvedTitle')}</span>
            <span className="tabular-nums text-sm text-white/90">
              {t('solvedStats', { moves, time: formatElapsed(elapsed), total: board.length })}
            </span>
          </div>
        ) : (
          <span className="tabular-nums">
            {t('status', { placed: puzzlePlacedCount(board), total: board.length, moves })}
            {' ・ '}
            {t('time', { time: formatElapsed(elapsed) })}
          </span>
        )}
      </div>

      <div className={`relative ${solved ? 'kasane-puzzle-snap' : ''}`} style={{ width, height }}>
        <div
          className="kasane-puzzle-grid grid h-full w-full"
          style={{
            gridTemplateColumns: `repeat(${size}, 1fr)`,
            gridTemplateRows: `repeat(${size}, 1fr)`,
            gap: solved ? 0 : 1,
            transition: 'gap 250ms ease-in',
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
                  // Position by the share of the board, not the size of a square, so gaps do not shift it
                  backgroundPosition: `${size > 1 ? (col / (size - 1)) * 100 : 0}% ${size > 1 ? (row / (size - 1)) * 100 : 0}%`,
                }}
              />
            );
          })}
        </div>
        {showSample && !solved && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture.url} alt="" className="pointer-events-none absolute inset-0 h-full w-full opacity-40" />
        )}
        {solved && (
          // The light sweeps across the picture. Clipped by this frame so it does not spill outside the board
          <div key={finishedAt ?? 0} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="kasane-puzzle-shine" />
          </div>
        )}
      </div>
      {solved && (
        <div key={finishedAt ?? 0} className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
          {confetti.map((c, i) => (
            <span
              key={i}
              className="kasane-puzzle-confetti"
              style={
                {
                  left: `${c.left}%`,
                  background: c.color,
                  borderRadius: c.round ? '9999px' : undefined,
                  width: c.round ? 9 : undefined,
                  height: c.round ? 9 : undefined,
                  '--kp-dx': `${c.dx}vw`,
                  '--kp-rot': `${c.rot}deg`,
                  '--kp-delay': `${c.delay}ms`,
                  '--kp-dur': `${c.dur}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className={`${BUTTON} border-gray-500 text-white hover:bg-gray-800`} onClick={restart}>
          {t('reshuffle')}
        </button>
        <label className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={showSample} onChange={(e) => setShowSample(e.target.checked)} />
          {t('sample')}
        </label>
        {shareUrl && (
          <CopyButton
            text={shareUrl}
            className={`${BUTTON} border-gray-500 text-white hover:bg-gray-800`}
            inputClassName="w-64 max-w-full rounded border border-gray-500 bg-black/40 px-1.5 py-0.5 text-xs text-white"
            failedLabel={t('copyFailed')}
          >
            {t('copyLink')}
          </CopyButton>
        )}
        <button type="button" className={PRIMARY} onClick={onClose} autoFocus>
          {t('close')}
        </button>
      </div>
    </div>
    </div>,
    document.body,
  );
}

/** Grid sizes the puzzle offers (n × n pieces). */
export const PUZZLE_SIZES: readonly number[] = SIZES;
/** Grid size chosen when none is given. */
export const DEFAULT_PUZZLE_SIZE = 4;

export interface PuzzleProps extends PanelContext {
  className?: string;
  /**
   * Open the puzzle at once with this grid size (one of `PUZZLE_SIZES`), e.g. from a link the
   * host page read. It starts once per Canvas; closing it does not start it again.
   */
  autoStart?: number;
  /** The link to share this puzzle at the given grid size. With it, the puzzle shows "Copy link". */
  shareUrl?: (size: number) => string;
  /** Called when the reader closes the puzzle (e.g. to drop the host page's link parameters). */
  onClose?: () => void;
}

/** The puzzle's start controls (grid size and Start) for the shown image. Also for a host page that puts it in a tab of its own. */
export function Puzzle({
  container,
  manifest,
  className = 'p-3 space-y-3 text-sm',
  autoStart,
  shareUrl,
  onClose,
}: PuzzleProps) {
  const t = useTranslations('Puzzle');
  const fromAtom = useAtomValue(manifestAtom);
  const m: ManifestV4 | null | undefined = manifest ?? fromAtom;
  const [size, setSize] = useState<number>(
    autoStart !== undefined && SIZES.includes(autoStart as (typeof SIZES)[number]) ? autoStart : DEFAULT_PUZZLE_SIZE,
  );
  const [picture, setPicture] = useState<Picture | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => {
    setPicture(null);
    onCloseRef.current?.();
  }, []);

  const start = async (c: ContainerInfo, n: number = size) => {
    if (n !== size) setSize(n);
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

  // When opened from a link: start once on that Canvas (so it does not open again after being closed)
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (autoStart === undefined || !container || !m || autoStarted.current === container.id) return;
    if (!SIZES.includes(autoStart as (typeof SIZES)[number])) return;
    autoStarted.current = container.id;
    // Start at the next chance so the state is not changed in the middle of drawing
    void Promise.resolve().then(() => start(container, autoStart));
    // start is made anew on every draw, so it is not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, container, m]);

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
      {picture && (
        <PuzzleDialog
          key={`${picture.url}-${size}`}
          picture={picture}
          size={size}
          onClose={close}
          shareUrl={shareUrl?.(size)}
          t={t}
        />
      )}
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
