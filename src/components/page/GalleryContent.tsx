'use client';

import { useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import Header from '@/components/Header';
import '@/components/gallery/gallery.css';

// IIIF VR Gallery（元: nakamura196/iiif-vr-gallery）。three.js で組んだ展示室を
// 素の JavaScript のまま動かすので、ここでは部品の置き場所（id 付きの要素）だけを用意し、
// 中身の文言や動きは engine/ 側が埋める。
const GalleryContent = () => {
  const locale = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let engine: typeof import('@/components/gallery/engine/main.js') | null = null;
    let observer: ResizeObserver | null = null;
    // three.js と OpenSeadragon はブラウザでしか動かないので、ここで読み込む
    import('@/components/gallery/engine/main.js').then((mod) => {
      if (cancelled) return;
      engine = mod;
      mod.startGallery(root, { lang: locale, basePath: process.env.NEXT_PUBLIC_BASE_PATH || '' });
      observer = new ResizeObserver(() => mod.onResize());
      observer.observe(root);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      engine?.stopGallery();
    };
  }, [locale]);

  return (
    <div className="flex flex-col h-dvh">
      <Header compact />
      <main className="flex-1 relative overflow-hidden">
        <div id="vrg" ref={rootRef} key={locale}>
          <div id="scene"></div>

          <div id="help" data-i18n-html="helpHtml"></div>

          <button id="mode-toggle" data-i18n="toWalk"></button>
          <button id="quality-toggle" data-i18n-title="quality"></button>
          <button id="tour-toggle" data-i18n="tourFirst" data-i18n-title="tourTitleFirst"></button>
          <button id="tour-toggle-3p" data-i18n="tourThird" data-i18n-title="tourTitleThird"></button>
          <button id="look-toggle" title="内装 / Interior"></button>
          <button id="index-toggle" data-i18n="indexOpen" data-i18n-title="indexTitle"></button>
          <button id="entrance-back" data-i18n="back"></button>
          <div id="crosshair"></div>
          <div id="walk-prompt">
            <div className="big" data-i18n="walkBig"></div>
            <div className="sub" data-i18n="walkSub"></div>
          </div>

          <div id="joystick"><div id="joystick-knob"></div></div>

          <div id="hud"><span id="hud-text"></span><button id="hud-zoom" data-i18n="zoom"></button></div>
          <div id="loading" data-i18n="loading"></div>

          <div id="entrance">
            <h1 data-i18n="appTitle"></h1>
            <div className="lead" data-i18n="entranceLead"></div>
            <button id="entrance-tut" type="button" hidden aria-label="tutorial"></button>
            <button id="entrance-tour" type="button" hidden aria-label="auto tour"></button>
            <div id="entrance-modes"></div>
            <div id="entrance-chars"></div>
            <div id="entrance-cards"></div>
            <div id="entrance-actions">
              <button id="entrance-enter" data-i18n="enter"></button>
              <button id="entrance-enter-vr" type="button" hidden data-i18n="enterVR"></button>
            </div>
            <form id="entrance-url" autoComplete="off">
              <span className="lbl" data-i18n="urlLabel"></span>
              <input id="entrance-url-input" type="url" data-i18n-ph="urlPlaceholder" />
              <button id="entrance-url-go" type="submit" data-i18n="urlLoad"></button>
            </form>
            <button id="entrance-url-example" type="button" hidden data-i18n="urlExample"></button>
          </div>

          {/* 使い方動画(YouTube埋め込み)モーダル */}
          <div id="tut-modal">
            <button id="tut-close" title="Esc">×</button>
            <div id="tut-frame"><div id="tut-embed"></div></div>
          </div>

          {/* 目次(作品一覧): サムネのグリッド。クリックでその作品へ寄って拡大 */}
          <div id="index-overlay">
            <div id="index-head">
              <span id="index-title" data-i18n="indexTitle"></span>
              <button id="index-close" title="Esc">×</button>
            </div>
            <div id="index-grid"></div>
          </div>

          <div id="osd-overlay">
            <div id="osd"></div>
            <div id="osd-title"></div>
            <button id="osd-info" title="Info">i</button>
            <button id="osd-close" title="Esc">×</button>
            <div id="osd-panel"></div>
            <a id="osd-kasane" target="_blank" rel="noopener" data-i18n="openInKasane" data-i18n-title="openInKasaneTitle"></a>
          </div>
        </div>
      </main>
    </div>
  );
};

export default GalleryContent;
