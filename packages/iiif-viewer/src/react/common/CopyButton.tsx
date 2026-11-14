'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from '../env';
import { BUTTON } from './buttonClasses';

const INPUT = 'w-64 max-w-full rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-1.5 py-0.5 text-xs text-[var(--ds-fg)]';

// A button that copies text to the clipboard and says so ("Copied"). Where the clipboard cannot be written
// (no permission, an old browser), it shows the text in a field so the reader can select and copy it by hand.
export function CopyButton({
  text,
  label,
  children,
  className = BUTTON,
  inputClassName = INPUT,
  failedLabel,
}: {
  /** The text, or a function that gives it when the button is pressed (to copy the newest state). */
  text: string | (() => string);
  /** The accessible name of the button, when the visible text is not enough. */
  label?: string;
  /** The visible text. Default: "Copy". */
  children?: ReactNode;
  className?: string;
  /** The class of the field shown when copying fails (for a dark background, for example). */
  inputClassName?: string;
  /** The text of the field when copying fails. Default: the shared message. */
  failedLabel?: string;
}) {
  const t = useTranslations('Copy');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [failedText, setFailedText] = useState('');
  useEffect(() => {
    if (state !== 'copied') return;
    const id = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [state]);
  const copy = async () => {
    const value = typeof text === 'function' ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setFailedText(value);
      setState('failed');
    }
  };
  return (
    <>
      <button type="button" className={className} onClick={copy} aria-label={label}>
        {state === 'copied' ? t('copied') : (children ?? t('copy'))}
      </button>
      {state === 'failed' && (
        <input
          readOnly
          value={failedText}
          aria-label={failedLabel ?? t('failed')}
          title={failedLabel ?? t('failed')}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          className={inputClassName}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? t('copied') : ''}
      </span>
    </>
  );
}
