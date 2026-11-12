'use client';

import { useState } from 'react';
import {
  AnnotationList,
  CanvasView,
  Metadata,
  Viewer,
  ViewerProvider,
  useViewer,
  type ViewerSelection,
} from 'iiif-kasane';
import { labelIn } from 'iiif-kasane/core';

// /developers のプレビュー。見せるコードと同じ形で書く。
// - OwnLayoutDemo は packages/iiif-viewer/examples/astro/src/components/FreeLayout.tsx と同じ中身
//   （サイトの中では style.css を別に読むので、その import だけが無い）。直すときは両方を直す
// - CSS は parts.astro の実物をそのまま受け取って描く

type Locale = 'ja' | 'en';

export function ViewerDemo({ manifest, locale, theme }: { manifest: string; locale: Locale; theme: 'light' | 'dark' }) {
  return (
    <div style={{ height: '32rem' }}>
      <Viewer iiifContent={manifest} locale={locale} theme={theme} className="h-full" />
    </div>
  );
}

function PageLabel({ locale }: { locale: Locale }) {
  const { container, selectedIndex, containers } = useViewer();
  if (!container) return null;
  return (
    <p className="page-label">
      {selectedIndex + 1} / {containers.length}: {labelIn(container.label, locale) || container.id}
    </p>
  );
}

export function OwnLayoutDemo({ manifest, locale, css }: { manifest: string; locale: Locale; css: string }) {
  const [shown, setShown] = useState<ViewerSelection | null>(null);
  return (
    // 例の CSS は明るい色だけで書いてあるので、サイトが暗い表示でもこの枠は明るくする
    <div style={{ background: '#fff', color: '#111', padding: '0.75rem' }}>
      <style>{css}</style>
      <ViewerProvider iiifContent={manifest} locale={locale} theme="light" className="free-layout" onSelect={setShown}>
        <section className="area-view">
          <PageLabel locale={locale} />
          <CanvasView className="view" />
        </section>
        <section className="area-annotations">
          <AnnotationList />
        </section>
        <section className="area-metadata">
          <h2>About</h2>
          <Metadata />
        </section>
      </ViewerProvider>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
        onSelect: {shown ? `${shown.index}, ${shown.canvasId}` : '(not yet)'}
      </p>
    </div>
  );
}

/** <iiif-viewer> のプレビュー。タグだけの素のページを iframe に描く（サイトの CSS・React と混ざらない） */
export function TagDemo({ html, title }: { html: string; title: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>${html}</body></html>`;
  return <iframe title={title} srcDoc={doc} className="block w-full border-0" style={{ height: '32rem' }} />;
}
