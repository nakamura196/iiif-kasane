// <iiif-viewer iiif-content="..." locale="ja" theme="auto" options='{"tab":"metadata","panelOpen":false,"pager":false}'></iiif-viewer>
// Light DOM (no shadow root) so that the host page can set --iiif-viewer-* variables.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '../style.css';
import { decodeContentState } from '../core';
import { Viewer, type ViewerProps } from '../react/Viewer';
import type { InfoTab } from '../react/layout/panels/Info';

const TABS: readonly InfoTab[] = ['metadata', 'annotations'];

function parseOptions(raw: string | null): { tab?: InfoTab; panelOpen?: boolean; pager?: boolean } {
  if (!raw) return {};
  try {
    const json: unknown = JSON.parse(raw);
    if (typeof json !== 'object' || json === null) return {};
    const { tab, panelOpen, pager } = json as { tab?: unknown; panelOpen?: unknown; pager?: unknown };
    return {
      ...(typeof tab === 'string' && (TABS as readonly string[]).includes(tab) ? { tab: tab as InfoTab } : {}),
      ...(typeof panelOpen === 'boolean' ? { panelOpen } : {}),
      ...(typeof pager === 'boolean' ? { pager } : {}),
    };
  } catch {
    return {};
  }
}

export class IiifViewerElement extends HTMLElement {
  static observedAttributes = ['iiif-content', 'locale', 'theme', 'options'];

  private root: Root | null = null;
  private container: HTMLDivElement | null = null;
  // Side panel tab: starts from options.tab, then follows the user's clicks.
  private tab: InfoTab | undefined;

  connectedCallback() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'iiif-viewer-host';
      this.appendChild(this.container);
    }
    this.tab ??= parseOptions(this.getAttribute('options')).tab;
    // After a reconnect the old root is gone; create a new one.
    this.root ??= createRoot(this.container);
    this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = null;
  }

  attributeChangedCallback(name: string) {
    if (name === 'options') this.tab = parseOptions(this.getAttribute('options')).tab;
    if (this.root) this.render();
  }

  private render() {
    if (!this.root) return;
    const content = decodeContentState(this.getAttribute('iiif-content'));
    if (!content) {
      this.root.render(
        createElement(
          'div',
          { role: 'alert', style: { padding: '1rem', fontSize: '0.875rem' } },
          'iiif-content is missing or not a manifest URL / content state.',
        ),
      );
      return;
    }
    const lang = this.getAttribute('locale') ?? document.documentElement.lang;
    const locale: ViewerProps['locale'] = lang.toLowerCase().startsWith('en') ? 'en' : 'ja';
    const themeAttr = this.getAttribute('theme');
    const theme: ViewerProps['theme'] =
      themeAttr === 'light' || themeAttr === 'dark' || themeAttr === 'auto' ? themeAttr : 'auto';
    this.root.render(
      createElement(Viewer, {
        iiifContent: content,
        locale,
        theme,
        tab: this.tab,
        panelOpen: parseOptions(this.getAttribute('options')).panelOpen,
        pager: parseOptions(this.getAttribute('options')).pager,
        onTabChange: (next) => {
          this.tab = next;
          this.render();
        },
        className: 'h-full',
      }),
    );
  }
}

// Load style.css from the same directory as this module, once per page.
// (If the page already links it by hand, add data-iiif-viewer-style to that <link> to skip this.)
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-iiif-viewer-style]')) return;
  const href = new URL('style.css', import.meta.url).href;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-iiif-viewer-style', '');
  document.head.appendChild(link);
}

ensureStyle();

if (typeof customElements !== 'undefined' && !customElements.get('iiif-viewer')) {
  customElements.define('iiif-viewer', IiifViewerElement);
}
