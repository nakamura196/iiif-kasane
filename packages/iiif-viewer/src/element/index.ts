// <iiif-kasane iiif-content="..." collection="<url> <url>" locale="ja" theme="auto" options='{"tab":"metadata","panelOpen":false,"pager":false,"environment":"none"}'></iiif-kasane>
// Light DOM (no shadow root) so that the host page can set --iiif-viewer-* variables.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '../style.css';
import { collectionsFromParams, decodeContentState } from '../core';
import { Viewer, type ViewerProps } from '../react/Viewer';
// The tag shows every kind of item, 3D Scenes included.
import '../react/scene';
import type { InfoTab } from '../react/layout/panels/Info';

const TABS: readonly InfoTab[] = ['metadata', 'annotations'];

function parseOptions(raw: string | null): {
  tab?: InfoTab;
  panelOpen?: boolean;
  pager?: boolean;
  environment?: string;
} {
  if (!raw) return {};
  try {
    const json: unknown = JSON.parse(raw);
    if (typeof json !== 'object' || json === null) return {};
    const { tab, panelOpen, pager, environment } = json as {
      tab?: unknown;
      panelOpen?: unknown;
      pager?: unknown;
      environment?: unknown;
    };
    return {
      ...(typeof tab === 'string' && (TABS as readonly string[]).includes(tab) ? { tab: tab as InfoTab } : {}),
      ...(typeof panelOpen === 'boolean' ? { panelOpen } : {}),
      ...(typeof pager === 'boolean' ? { pager } : {}),
      ...(typeof environment === 'string' ? { environment } : {}),
    };
  } catch {
    return {};
  }
}

export class IiifViewerElement extends HTMLElement {
  static observedAttributes = ['iiif-content', 'collection', 'locale', 'theme', 'options'];

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
    // the Collections walked through to reach iiif-content, top first, separated by spaces (a URL has none)
    const collection = collectionsFromParams((this.getAttribute('collection') ?? '').split(/\s+/).filter(Boolean));
    const lang = this.getAttribute('locale') ?? document.documentElement.lang;
    const locale: ViewerProps['locale'] = lang.toLowerCase().startsWith('en') ? 'en' : 'ja';
    const themeAttr = this.getAttribute('theme');
    const theme: ViewerProps['theme'] =
      themeAttr === 'light' || themeAttr === 'dark' || themeAttr === 'auto' ? themeAttr : 'auto';
    this.root.render(
      createElement(Viewer, {
        iiifContent: content,
        collection,
        // lets the embedding page write the location into its own URL (and give it back as iiif-content + collection)
        onShownChange: (shown) =>
          this.dispatchEvent(new CustomEvent('kasane-shown', { detail: shown, bubbles: true, composed: true })),
        locale,
        theme,
        tab: this.tab,
        panelOpen: parseOptions(this.getAttribute('options')).panelOpen,
        pager: parseOptions(this.getAttribute('options')).pager,
        environment: parseOptions(this.getAttribute('options')).environment,
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

// The tag is <iiif-kasane>. <iiif-viewer> is the name before 0.3.0; it stays so that pages that already
// embed it keep working. A tag name can be defined only once per page, and the same class cannot be
// defined under two names, so the old name gets a subclass.
if (typeof customElements !== 'undefined') {
  if (!customElements.get('iiif-kasane')) customElements.define('iiif-kasane', IiifViewerElement);
  if (!customElements.get('iiif-viewer')) customElements.define('iiif-viewer', class extends IiifViewerElement {});
}
