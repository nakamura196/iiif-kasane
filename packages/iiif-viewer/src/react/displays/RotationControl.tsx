'use client';

import { useState } from 'react';

interface RotationControlProps {
  /** Current clockwise rotation angle in degrees. */
  degrees: number;
  onChange: (degrees: number) => void;
  label: string;
}

/** Normalize any angle to an integer in (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = Math.round(deg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d === 0 ? 0 : d;
}

/**
 * Compact arbitrary-angle rotation control for ImageView.
 * Shows an angle chip at the bottom-right corner and expands upward with a slider,
 * numeric input, and 90-degree presets.
 */
export default function RotationControl({ degrees, onChange, label }: RotationControlProps) {
  const [open, setOpen] = useState(false);
  const norm = normalizeDegrees(degrees);

  return (
    <div
      className="absolute bottom-2 right-2 z-20 flex flex-col items-end gap-1"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {open && (
        <div className="rounded-md border border-[var(--ds-border)] bg-[var(--ds-surface)]/95 backdrop-blur-xs p-2.5 shadow-md text-xs text-[var(--ds-fg)] flex flex-col gap-2 w-56">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--ds-fg-muted)]">{label}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={-180}
                max={180}
                step={1}
                value={norm}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) onChange(normalizeDegrees(v));
                }}
                aria-label={label}
                className="w-14 rounded border border-[var(--ds-border)] bg-[var(--ds-bg)] px-1.5 py-0.5 text-right tabular-nums text-[var(--ds-fg)]"
              />
              <span>°</span>
            </div>
          </div>

          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={norm}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={label}
            className="w-full cursor-pointer accent-blue-600"
          />

          <div className="flex items-center justify-between gap-1">
            {([-90, 0, 90, 180] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(preset)}
                className={`flex-1 rounded border px-1.5 py-0.5 text-[11px] tabular-nums cursor-pointer ${
                  norm === preset
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-[var(--ds-border)] bg-[var(--ds-bg)] hover:bg-[var(--ds-surface-2)] text-[var(--ds-fg-muted)]'
                }`}
              >
                {preset === 0 ? '0°' : `${preset > 0 ? '+' : ''}${preset}°`}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label}: ${norm}°`}
        title={`${label}: ${norm}°`}
        className="inline-flex items-center gap-1 rounded border border-[var(--ds-border)] bg-[var(--ds-surface)]/90 backdrop-blur-xs px-2 py-1 text-xs font-medium text-[var(--ds-fg)] shadow-sm hover:bg-[var(--ds-surface-2)] cursor-pointer tabular-nums"
      >
        <span aria-hidden="true">↻</span>
        <span>{norm}°</span>
      </button>
    </div>
  );
}
