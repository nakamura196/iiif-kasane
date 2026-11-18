'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// A round button that opens a panel of controls. On a phone, the /georef page puts the controls
// that are not used all the time in here, so that they do not cover the map or the image.
// The panel closes on Escape or a tap outside it. It stays inside the nearest element marked
// data-menu-bounds (the map or the image pane), and scrolls when its content is taller.

interface Props {
  label: string;
  children: ReactNode;
}

export default function ControlMenu({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const fit = () => {
      if (!panel.current) return;
      const bounds = panel.current.closest('[data-menu-bounds]')?.getBoundingClientRect();
      const bottom = Math.min(bounds?.bottom ?? Infinity, window.innerHeight);
      setMaxHeight(Math.max(120, bottom - panel.current.getBoundingClientRect().top - 8));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative pointer-events-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-white/95 dark:bg-gray-800/95 shadow text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <div
          ref={panel}
          style={{ maxHeight }}
          role="group"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-3 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-lg text-sm text-gray-700 dark:text-gray-200"
        >
          {children}
        </div>
      )}
    </div>
  );
}
