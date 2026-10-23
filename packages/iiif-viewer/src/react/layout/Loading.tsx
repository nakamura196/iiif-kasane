'use client';

// 読み込み中の印。画像・マニフェスト・3D で同じ形にする（以前は 3D だけ回る輪で、画像は文字だけだった）。

/** A turning ring. `small` for the corner chip. */
export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full border-[var(--ds-primary)] border-t-transparent animate-spin motion-reduce:animate-none ${
        small ? 'w-3.5 h-3.5 border-2' : 'w-10 h-10 border-4'
      }`}
    />
  );
}

/** The ring with its words, in the middle of the parent (which must be positioned). */
export function LoadingOverlay({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 rounded-lg bg-[var(--ds-surface)]/80 px-6 py-5 backdrop-blur-sm">
        <Spinner />
        <span className="text-sm text-[var(--ds-fg)]">{label}</span>
        {children}
      </div>
    </div>
  );
}

/** A small chip at the bottom of the parent: the picture is there, sharper parts are still coming. */
export function LoadingChip({ label }: { label: string }) {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-full bg-[var(--ds-surface)]/85 px-3 py-1 text-xs text-[var(--ds-fg)] shadow-sm backdrop-blur-sm">
        <Spinner small />
        <span>{label}</span>
      </div>
    </div>
  );
}
