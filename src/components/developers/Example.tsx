'use client';

import { useEffect, useId, useRef, useState } from 'react';

// 動くビューアとコードを、タブで切り替えて見せる枠（Clover IIIF の docs と同じ形）。
// ビューアは重い（画像の取得・WebGL）ので、プレビューは画面に入ってから初めて描き、その後は消さない。

export type ExampleTab = { label: string; code: string; lang?: string };

export function CodeBlock({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-[var(--ds-border)] bg-[var(--ds-bg)] px-2 py-0.5 text-xs text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]"
      >
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </button>
      <pre className="max-h-[32rem] overflow-auto bg-[var(--ds-surface)] p-4 pr-20 text-xs leading-relaxed text-[var(--ds-fg)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function LazyMount({ children, minHeight }: { children: React.ReactNode; minHeight: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <div ref={ref} style={{ minHeight }}>
      {shown ? children : null}
    </div>
  );
}

export default function Example({
  preview,
  previewLabel,
  tabs,
  copyLabel,
  copiedLabel,
  minHeight = '32rem',
}: {
  preview: React.ReactNode;
  previewLabel: string;
  tabs: ExampleTab[];
  copyLabel: string;
  copiedLabel: string;
  minHeight?: string;
}) {
  const id = useId();
  // 0 はプレビュー、1 以降はコードのタブ
  const [active, setActive] = useState(0);
  const labels = [previewLabel, ...tabs.map((t) => t.label)];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowRight' ? 1 : labels.length - 1)) % labels.length;
    setActive(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div className="overflow-hidden rounded border border-[var(--ds-border)]">
      <div role="tablist" className="flex flex-wrap border-b border-[var(--ds-border)] text-sm" onKeyDown={onKey}>
        {labels.map((label, i) => (
          <button
            key={label}
            id={`${id}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            className={`-mb-px border-b-2 px-4 py-2 ${
              active === i
                ? 'border-[var(--ds-primary)] font-semibold text-[var(--ds-fg)]'
                : 'border-transparent text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]'
            } ${i > 0 ? 'font-mono text-xs' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* プレビューはタブを替えても消さない（読み込み直しを避ける） */}
      <div
        id={`${id}-panel-0`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-0`}
        hidden={active !== 0}
      >
        <LazyMount minHeight={minHeight}>{preview}</LazyMount>
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.label}
          id={`${id}-panel-${i + 1}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${i + 1}`}
          hidden={active !== i + 1}
        >
          <CodeBlock code={t.code} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </div>
      ))}
    </div>
  );
}
