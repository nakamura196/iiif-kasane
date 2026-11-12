'use client';

import { useTranslations } from '../env';
import type { Display } from './types';

// 3D の表示（iiif-kasane/scene）を読み込んでいないサイトで、Scene を開いたときの案内。
// iiif-kasane/scene を import すると、同じ id の本物（SceneDisplay）に差し替わる。
function SceneMissing() {
  const t = useTranslations('Viewer');
  return (
    <div className="flex flex-1 min-h-0 min-w-0 items-center justify-center p-6 text-center text-sm text-[var(--ds-fg)]">
      <div className="max-w-md space-y-2">
        <p>{t('sceneNotLoaded')}</p>
        <p className="opacity-70">{t('sceneNotLoadedHint')}</p>
      </div>
    </div>
  );
}

export const sceneMissingDisplay: Display = {
  id: 'scene',
  match: (c) => c.kind === 'Scene',
  Component: SceneMissing,
};
