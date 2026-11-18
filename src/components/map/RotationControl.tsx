'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

// Changes the rotation of the image on the map-and-image page. The button opens a slider, a number,
// "North up" and "Reset". Counterclockwise is positive (the same direction and range as geo.ldas.jp).
// "North up near the selected point" is geo.ldas.jp's autoRotateOnSelect; there it had no switch on screen
// and could only be set in the URL.

interface Props {
  rotation: number;
  onChange: (degrees: number) => void;
  /** The angle that puts north up. null when there are too few points to work it out ("North up" is disabled). */
  northUp: number | null;
  autoRotateOnSelect: boolean;
  onAutoRotateOnSelectChange: (on: boolean) => void;
  /** Open the panel below the button in the page flow instead of floating over the image (inside a menu). */
  inline?: boolean;
}

export default function RotationControl({ rotation, onChange, northUp, autoRotateOnSelect, onAutoRotateOnSelectChange, inline = false }: Props) {
  const t = useTranslations('GeoRef');
  const [open, setOpen] = useState(false);
  const label = `${Number(rotation.toFixed(1))}°`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          inline
            ? 'text-left text-sm text-gray-700 dark:text-gray-300 hover:underline'
            : 'bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
        }
      >
        {t('rotation')}: {label}
      </button>
      {open && (
        <div className={`${inline ? 'mt-2 border-t pt-3' : 'absolute left-0 mt-2 w-64 rounded-lg shadow-lg bg-white dark:bg-gray-800 border p-3'} whitespace-normal border-gray-200 dark:border-gray-700 space-y-3 text-sm text-gray-700 dark:text-gray-300`}>
          <label className="block">
            <span className="sr-only">{t('rotation')}</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="flex items-center gap-2">
            <span>{t('rotationDegrees')}</span>
            <input
              type="number"
              min={-180}
              max={180}
              step={0.1}
              value={Number(rotation.toFixed(1))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
              }}
              className="w-24 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => northUp !== null && onChange(northUp)}
              disabled={northUp === null}
              title={northUp === null ? t('northUpUnavailable') : undefined}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              {t('northUp')}
            </button>
            <button
              type="button"
              onClick={() => onChange(0)}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('rotationReset')}
            </button>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={autoRotateOnSelect}
              onChange={(e) => onAutoRotateOnSelectChange(e.target.checked)}
              disabled={northUp === null}
              className="mt-0.5"
            />
            <span>{t('autoRotateOnSelect')}</span>
          </label>
        </div>
      )}
    </div>
  );
}
