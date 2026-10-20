'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useTranslations } from '../env';

// 右（狭い画面では下）の説明欄。ボタンで畳み、3D や地図の表示領域を広げる。
// 畳んだかどうかはページをまたいで同じ値をブラウザに保存する。保存が無ければ、狭い画面では畳んで始める。
// 横に並ぶときは左の境界で幅を、下に置くときは上の境界で高さを、ドラッグして変えられる。
// 幅と高さも同じくブラウザに保存する。
const STORAGE_KEY = 'iiif3d.sidePanelOpen';
const WIDTH_KEY = 'iiif3d.sidePanelWidth';
const HEIGHT_KEY = 'iiif3d.sidePanelHeight';
const MIN_WIDTH = 240;
// タブの見出しと数行が見える高さ
const MIN_HEIGHT = 120;
// 表示領域が狭くなりすぎないよう、幅は全体の 70%、高さは 80% まで
const MAX_RATIO = 0.7;
const MAX_HEIGHT_RATIO = 0.8;
const NARROW = '(max-width: 639px)';

// Tailwind はクラス名を文字列のまま探すので、区切りの幅ごとに書き分ける
const CLASSES = {
  sm: {
    height: 'h-[50%] sm:h-full',
    // 画面を回して高さが縮んでも、保存した高さが上限を超えないようにする
    sizedHeight: 'h-[min(var(--side-h),80%)] sm:h-full',
    width: 'sm:w-[30%]',
    sizedWidth: 'sm:w-[var(--side-w)]',
    handle: 'hidden sm:block',
    closed: 'h-10 sm:h-full sm:w-10 flex-row sm:flex-col border-t sm:border-t-0 sm:border-l',
    desktop: 'hidden sm:block',
    mobile: 'sm:hidden',
  },
  lg: {
    height: 'h-[40%] lg:h-full',
    sizedHeight: 'h-[min(var(--side-h),80%)] lg:h-full',
    width: 'lg:w-96',
    sizedWidth: 'lg:w-[var(--side-w)]',
    handle: 'hidden lg:block',
    closed: 'h-10 lg:h-full lg:w-10 flex-row lg:flex-col border-t lg:border-t-0 lg:border-l',
    desktop: 'hidden lg:block',
    mobile: 'lg:hidden',
  },
} as const;

const Chevron = ({ dir }: { dir: 'left' | 'right' | 'up' | 'down' }) => {
  const d = { left: 'M15 19l-7-7 7-7', right: 'M9 5l7 7-7 7', up: 'M5 15l7-7 7 7', down: 'M19 9l-7 7-7-7' }[dir];
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
};

type Props = {
  children: React.ReactNode;
  // 横に並ぶ幅（この幅より狭いと下に置く）
  breakpoint?: 'sm' | 'lg';
  className?: string;
  // 畳んだ保存があっても開いて始める（リンクが欄の中身を指しているとき）。保存は書き換えない
  openOnStart?: boolean;
  // 使う側のページが決めた、始めの開閉。保存より優先する（保存は書き換えない）。openOnStart はさらに優先する
  initialOpen?: boolean;
};

export default function SidePanel({
  children,
  breakpoint = 'sm',
  className = '',
  openOnStart = false,
  initialOpen,
}: Props) {
  const t = useTranslations('SidePanel');
  const c = CLASSES[breakpoint];
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // 保存が使えないときは画面の幅だけで決める
    }
    const fallback = saved !== null ? saved === '1' : !window.matchMedia(NARROW).matches;
    setOpen(openOnStart || (initialOpen ?? fallback));
    try {
      const w = Number(window.localStorage.getItem(WIDTH_KEY));
      if (w >= MIN_WIDTH) setWidth(w);
    } catch {
      // 保存が使えないときは既定の幅
    }
    try {
      const h = Number(window.localStorage.getItem(HEIGHT_KEY));
      if (h >= MIN_HEIGHT) setHeight(h);
    } catch {
      // 保存が使えないときは既定の高さ
    }
    // 開いたときの 1 回だけ見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // axis が x なら左の境界で幅を、y なら上の境界で高さを変える
  const startResize = (axis: 'x' | 'y', e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = parent.getBoundingClientRect();
    const [min, max, set, key] =
      axis === 'x'
        ? [MIN_WIDTH, parent.clientWidth * MAX_RATIO, setWidth, WIDTH_KEY]
        : [MIN_HEIGHT, parent.clientHeight * MAX_HEIGHT_RATIO, setHeight, HEIGHT_KEY];
    const own = el.getBoundingClientRect();
    let last = axis === 'x' ? own.width : own.height;
    const move = (ev: globalThis.PointerEvent) => {
      const size = axis === 'x' ? rect.right - ev.clientX : rect.bottom - ev.clientY;
      last = Math.round(Math.min(max, Math.max(min, size)));
      set(last);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try {
        window.localStorage.setItem(key, String(last));
      } catch {
        // 保存できなくても大きさは変わる
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  // ダブルクリックで既定の大きさに戻す
  const resetSize = (axis: 'x' | 'y') => {
    (axis === 'x' ? setWidth : setHeight)(null);
    try {
      window.localStorage.removeItem(axis === 'x' ? WIDTH_KEY : HEIGHT_KEY);
    } catch {
      // 保存が使えなくても戻せる
    }
  };

  const toggle = () => {
    setOpen(!open);
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? '0' : '1');
    } catch {
      // 保存できなくても開閉はできる
    }
  };

  const buttonClass =
    'flex items-center justify-center rounded text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)] transition-colors';

  if (!open) {
    return (
      <div
        className={`${c.closed} flex-none flex items-start px-1 py-1 bg-[var(--ds-surface)] border-[var(--ds-border)]`}
      >
        <button onClick={toggle} className={`${buttonClass} w-full py-1 gap-2`} title={t('open')} aria-expanded={false}>
          <span className={c.desktop}><Chevron dir="left" /></span>
          <span className={c.mobile}><Chevron dir="up" /></span>
          <span className={`${c.mobile} text-sm`}>{t('open')}</span>
        </button>
      </div>
    );
  }

  return (
    // つまみと閉じるボタンは外側の箱に置く。中身が縦に流れても一緒に流れないように
    <div
      ref={box}
      className={`${height ? c.sizedHeight : c.height} ${width ? c.sizedWidth : c.width} flex-none relative`}
      style={{ '--side-w': width ? `${width}px` : undefined, '--side-h': height ? `${height}px` : undefined } as CSSProperties}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title={t('resize')}
        onPointerDown={(e) => startResize('x', e)}
        onDoubleClick={() => resetSize('x')}
        className={`${c.handle} absolute left-0 top-0 z-30 h-full w-1.5 -ml-0.5 cursor-col-resize touch-none hover:bg-blue-500/40 active:bg-blue-500/60`}
      />
      {/* 指でもつかめるよう高さを取り、閉じるボタンの手前で止める。中央の短い線が目印 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        title={t('resizeHeight')}
        onPointerDown={(e) => startResize('y', e)}
        onDoubleClick={() => resetSize('y')}
        className={`${c.mobile} absolute left-0 right-10 top-0 z-30 h-3 flex justify-center pt-1 cursor-row-resize touch-none hover:bg-blue-500/20 active:bg-blue-500/40`}
      >
        <span className="h-1 w-10 rounded-full bg-[var(--ds-border)]" aria-hidden="true" />
      </div>
      <button
        onClick={toggle}
        className={`${buttonClass} absolute top-1.5 right-1.5 z-20 w-7 h-7 bg-[var(--ds-surface)] border border-[var(--ds-border)]`}
        title={t('close')}
        aria-expanded={true}
      >
        <span className={c.desktop}><Chevron dir="right" /></span>
        <span className={c.mobile}><Chevron dir="down" /></span>
      </button>
      <div className={`h-full w-full ${className}`}>{children}</div>
    </div>
  );
}
