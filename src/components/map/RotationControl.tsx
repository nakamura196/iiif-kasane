'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

// 地図と画像の画面で、画像の回転を変える。ボタンを押すと、スライダー・数値・「北を上に」「元に戻す」が開く。
// 角度は反時計回りが正（geo.ldas.jp の回転の画面と同じ向き・範囲）。
// 「選んだ地点の近くで北を上に」は geo.ldas.jp の autoRotateOnSelect。向こうには画面のスイッチが無く、URL でしか入れられなかった。

interface Props {
  rotation: number;
  onChange: (degrees: number) => void;
  /** 北が上になる角度。地点が足りず求まらないときは null（「北を上に」を押せなくする）。 */
  northUp: number | null;
  autoRotateOnSelect: boolean;
  onAutoRotateOnSelectChange: (on: boolean) => void;
}

export default function RotationControl({ rotation, onChange, northUp, autoRotateOnSelect, onAutoRotateOnSelectChange }: Props) {
  const t = useTranslations('GeoRef');
  const [open, setOpen] = useState(false);
  const label = `${Number(rotation.toFixed(1))}°`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        {t('rotation')}: {label}
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-64 whitespace-normal rounded-lg shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
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
