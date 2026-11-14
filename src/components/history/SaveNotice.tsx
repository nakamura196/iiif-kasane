'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

const SHOW_MS = 6000;

// "Could not save": goes away by itself after a few seconds, and can be closed.
export default function SaveNotice({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  const t = useTranslations('History');
  useEffect(() => {
    const id = setTimeout(onClose, SHOW_MS);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <span role="alert" className={`flex items-start gap-2 text-xs text-red-600 dark:text-red-400 ${className}`}>
      <span>{t('saveFailed')}</span>
      <button type="button" onClick={onClose} aria-label={t('close')} className="shrink-0 underline">
        ×
      </button>
    </span>
  );
}
