// The shared annotation filter (kind, unit, tags, marks switch) in each place that uses it: the parts alone, the 2D
// annotations tab, the marks over the image, the page thumbnails and the 3D list. They share one state, so a choice
// made in one place must narrow the others in the same way.
import { createElement, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider, createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import extensionSample from '../../../../../public/manifests/sample-manifest-region-tags.json';
import { convertToV4 } from '../../core/services/manifestConverter';
import { parseManifestV4 } from '../../core/services/manifestParser';
import { toAnnotationPage, type ContainerInfo, type ManifestV4, type PageMark } from '../../core';
import { ViewerEnv } from '../env';
import { annotationFilterAtom, annotationsAtom, manifestAtom, showAnnotationsAtom } from '../atoms';
import {
  canvasAnnotationGranularityAtom,
  canvasAnnotationKindsAtom,
  canvasAnnotationTagsAtom,
  localAnnotationPagesAtom,
  selectedCanvasAnnotationAtom,
} from '../overlays/canvasAnnotationState';
import { CONTENT_SEARCH_SOURCE } from '../overlays/contentSearchSource';
import { AnnotationOverlayView } from '../overlays/AnnotationOverlay';
import { CanvasAnnotationsPanelBody } from '../panels/CanvasAnnotationsPanel';
import { PageThumbMarks, batchModelAtom, thumbMarksShown } from '../panels/PagesBatch';
import { inferenceResultsAtom, resultKey } from '../inference/state';
import AnnotationList from './AnnotationList';
import { clearPresentChoices, nextChoice } from '../../core';
import { FilterChips, visibleOptions } from './FilterChips';
import { ShowMarksToggle } from './ShowMarksToggle';

type Store = ReturnType<typeof createStore>;

const render = (node: ReactNode, store: Store = createStore(), locale = 'en') =>
  renderToStaticMarkup(
    createElement(
      Provider,
      { store },
      createElement(
        ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light'; children?: ReactNode }>,
        { locale, resolvedTheme: 'light' },
        node,
      ),
    ),
  );

const pressed = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>([^<]*)/g)].map((m) => m[1]);
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

// ---- one inference result on one page: two read lines with a class, one line without, one classified region ----

const canvasId = 'https://example.org/canvas/1';
const container: ContainerInfo = { id: canvasId, kind: 'Canvas', label: 'p1', width: 1000, height: 1000, painting: [], supplementing: [] };
const manifest = { id: 'https://example.org/manifest', type: 'Manifest', items: [{ id: canvasId, type: 'Canvas', width: 1000, height: 1000, items: [] }] } as unknown as ManifestV4;
let n = 0;
const page = toAnnotationPage(
  {
    kind: 'lines',
    imageWidth: 1000,
    imageHeight: 1000,
    classes: ['line_main', 'block_fig'],
    items: [
      { x: 10, y: 10, w: 20, h: 300, score: 1, label: 'line_main', text: 'first line' },
      { x: 40, y: 10, w: 20, h: 300, score: 1, label: 'line_main', text: 'second line' },
      { x: 70, y: 10, w: 20, h: 300, score: 1, text: 'plain line' },
      { x: 400, y: 400, w: 300, h: 300, score: 1, label: 'block_fig' },
    ],
  },
  {
    canvasId,
    map: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    newId: () => `urn:test:${++n}`,
    generator: { id: 'https://example.org/model', name: 'Model' },
  },
);
const ids = (page.items as { id: string }[]).map((a) => a.id);

// a text search mark (highlighting) on the same page: the kind, unit and marks switch do not hide it
const searchPage = {
  id: 'urn:search',
  type: 'AnnotationPage',
  items: [
    {
      id: 'urn:search:hit',
      type: 'Annotation',
      motivation: 'highlighting',
      body: { type: 'TextualBody', value: 'first' },
      target: `${canvasId}#xywh=10,10,20,30`,
    },
  ],
};

const canvasStore = (o: { kinds?: string[]; tags?: string[]; granularity?: string | null; show?: boolean; search?: boolean } = {}) => {
  const store = createStore();
  store.set(manifestAtom, manifest as never);
  store.set(localAnnotationPagesAtom, [
    { source: 'inference:test', canvasId, page },
    ...(o.search ? [{ source: CONTENT_SEARCH_SOURCE, canvasId, page: searchPage }] : []),
  ]);
  if (o.kinds) store.set(canvasAnnotationKindsAtom, o.kinds);
  if (o.tags) store.set(canvasAnnotationTagsAtom, o.tags);
  if (o.granularity !== undefined) store.set(canvasAnnotationGranularityAtom, o.granularity);
  if (o.show !== undefined) store.set(showAnnotationsAtom, o.show);
  return store;
};

const marksOn = (store: Store) =>
  [...render(createElement(AnnotationOverlayView, { container, canvasWidth: 1000, canvasHeight: 1000 }), store).matchAll(
    /data-annotation-id="([^"]+)"/g,
  )].map((m) => m[1]);

const panel = (store: Store, locale = 'en') =>
  render(createElement(CanvasAnnotationsPanelBody, { container, manifest } as never), store, locale);

// ---- the parts alone --------------------------------------------------------------------------------------------

describe('nextChoice', () => {
  it('toggles a value of a multiple choice', () => {
    expect(nextChoice([], 'a', true)).toEqual(['a']);
    expect(nextChoice(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextChoice(['a', 'b'], 'a', true)).toEqual(['b']);
  });
  it('takes one value of a single choice, and lets it go when pressed again', () => {
    expect(nextChoice([], 'a', false)).toEqual(['a']);
    expect(nextChoice(['a'], 'b', false)).toEqual(['b']);
    expect(nextChoice(['a'], 'a', false)).toEqual([]);
  });
  it('keeps a chosen value the current options lack (chosen on another page, or in another list)', () => {
    // FilterChips passes every stored choice, not only those it shows
    expect(nextChoice(['elsewhere'], 'b', true)).toEqual(['elsewhere', 'b']);
  });
});

describe('clearPresentChoices ("All")', () => {
  it('lets go of the shown choices and keeps the others', () => {
    expect(clearPresentChoices(['a', 'elsewhere'], ['a'])).toEqual(['elsewhere']);
    expect(clearPresentChoices(['a'], ['a'])).toEqual([]);
  });
});

describe('visibleOptions', () => {
  const options = ['a', 'b', 'c', 'd'].map((value) => ({ value }));
  it('shows everything without a limit, or when expanded', () => {
    expect(visibleOptions(options, [], undefined, false)).toHaveLength(4);
    expect(visibleOptions(options, [], 2, true)).toHaveLength(4);
  });
  it('shows the first ones under the limit, and a chosen value even past it', () => {
    expect(visibleOptions(options, [], 2, false).map((o) => o.value)).toEqual(['a', 'b']);
    expect(visibleOptions(options, ['d'], 2, false).map((o) => o.value)).toEqual(['a', 'b', 'd']);
  });
});

describe('FilterChips', () => {
  const chips = (props: Partial<Parameters<typeof FilterChips>[0]> = {}) =>
    render(
      createElement(FilterChips, {
        label: 'Kind',
        options: [
          { value: 'supplementing', label: 'Transcription', count: 3 },
          { value: 'tagging', label: 'Tag', count: 1, color: '#ff0000' },
        ],
        chosen: [],
        onChange: () => {},
        ...props,
      }),
    );
  it('presses "All" while nothing is chosen', () => {
    expect(pressed(chips())).toEqual(['All']);
  });
  it('presses the chosen values and not "All"', () => {
    expect(pressed(chips({ chosen: ['tagging'] }))).toEqual(['']);
    expect(chips({ chosen: ['tagging'] })).toMatch(/aria-pressed="true" data-value="tagging"/);
  });
  it('ignores a chosen value the options do not have (back to "All")', () => {
    expect(pressed(chips({ chosen: ['commenting'] }))).toEqual(['All']);
  });
  it('shows the counts and the class color', () => {
    const html = chips();
    expect(html).toContain('Transcription');
    expect(html).toContain('>3<');
    expect(html).toContain('background-color:#ff0000');
  });
  it('is not shown with fewer options than asked for', () => {
    expect(chips({ minOptions: 3 })).toBe('');
    expect(chips({ options: [] })).toBe('');
  });
  it('offers "Show all" past the limit', () => {
    expect(chips({ limit: 1 })).toContain('Show all (2)');
    expect(chips({ limit: 2 })).not.toContain('Show all');
  });
  it('names the row for screen readers', () => {
    expect(chips()).toContain('role="group" aria-label="Kind"');
  });
});

describe('ShowMarksToggle', () => {
  it('follows the shared marks switch', () => {
    const store = createStore();
    expect(render(createElement(ShowMarksToggle), store)).toContain('checked=""');
    store.set(showAnnotationsAtom, false);
    expect(render(createElement(ShowMarksToggle), store)).not.toContain('checked=""');
  });
  it('is named in both languages', () => {
    expect(render(createElement(ShowMarksToggle))).toContain('Show marks');
    expect(render(createElement(ShowMarksToggle), createStore(), 'ja')).toContain('印を表示');
  });
});

// ---- the marks over the image (2D) ------------------------------------------------------------------------------

describe('marks over the image', () => {
  it('draws every region with nothing chosen', () => {
    expect(marksOn(canvasStore()).sort()).toEqual([...ids].sort());
  });
  it('draws only the read lines when the transcription kind is chosen', () => {
    expect(marksOn(canvasStore({ kinds: ['supplementing'] })).sort()).toEqual(ids.slice(0, 3).sort());
  });
  it('draws only the classified regions when the tag kind is chosen', () => {
    expect(marksOn(canvasStore({ kinds: ['tagging'] }))).toEqual([ids[3]]);
  });
  it('narrows read lines by their class, now that read lines keep it as a tag', () => {
    expect(marksOn(canvasStore({ tags: ['line_main'] })).sort()).toEqual(ids.slice(0, 2).sort());
  });
  it('ANDs the kind and the tag', () => {
    expect(marksOn(canvasStore({ kinds: ['supplementing'], tags: ['line_main'] })).sort()).toEqual(ids.slice(0, 2).sort());
  });
  it('ignores a chosen tag that the chosen kind does not have, as the list does', () => {
    expect(marksOn(canvasStore({ kinds: ['tagging'], tags: ['line_main'] }))).toEqual([ids[3]]);
  });
  it('ignores a chosen kind the page does not have', () => {
    expect(marksOn(canvasStore({ kinds: ['commenting'] }))).toHaveLength(4);
  });
  it('draws nothing with the marks switched off', () => {
    expect(marksOn(canvasStore({ show: false }))).toEqual([]);
  });
  it('keeps the text search marks whatever the kind, unit or marks switch', () => {
    expect(marksOn(canvasStore({ search: true, show: false }))).toEqual(['urn:search:hit']);
    expect(marksOn(canvasStore({ search: true, kinds: ['tagging'] })).sort()).toEqual([ids[3], 'urn:search:hit'].sort());
    expect(marksOn(canvasStore({ search: true, granularity: 'word' }))).toContain('urn:search:hit');
  });
  it('keeps the selected search hit drawn with the marks switched off and a tag chosen', () => {
    const store = canvasStore({ search: true, show: false, tags: ['line_main'] });
    store.set(selectedCanvasAnnotationAtom, 'urn:search:hit');
    expect(marksOn(store)).toEqual(['urn:search:hit']);
  });
});

// ---- the annotations tab (2D) -----------------------------------------------------------------------------------

describe('annotations tab', () => {
  it('offers the kinds with their names and counts, "All" first and pressed', () => {
    const html = panel(canvasStore());
    expect(html).toContain('aria-label="Kind"');
    expect(html).toMatch(/data-value="supplementing"[^>]*>Transcription<span[^>]*>3</);
    expect(html).toMatch(/data-value="tagging"[^>]*>Tag<span[^>]*>1</);
    expect(pressed(html)).toEqual(['All', 'All']); // the kind row and the tag row
  });
  it('lists only the annotations of the chosen kind, as the marks', () => {
    const html = panel(canvasStore({ kinds: ['supplementing'] }));
    expect(html).toContain('first line');
    expect(html).toContain('plain line');
    expect(html).not.toContain('>block_fig<');
    expect(html).toContain('3 of 4');
  });
  it('offers the classes of read lines as tags', () => {
    expect(panel(canvasStore())).toMatch(/data-value="line_main"[^>]*>line_main<span[^>]*>2</);
  });
  it('has the marks switch, the same one as the 3D list and the pages grid', () => {
    expect(panel(canvasStore())).toContain('data-show-marks');
    expect(panel(canvasStore(), 'ja')).toContain('印を表示');
  });
  it('shows no kind row when there is only one kind', () => {
    const store = canvasStore();
    store.set(localAnnotationPagesAtom, [
      { source: 'inference:test', canvasId, page: { ...page, items: (page.items as unknown[]).slice(0, 3) } },
    ]);
    expect(panel(store)).not.toContain('aria-label="Kind"');
  });
  it('shows "N of M" when a kind is chosen', () => {
    expect(panel(canvasStore({ kinds: ['tagging'] }))).toContain('1 of 4');
    expect(panel(canvasStore())).toContain('4 annotations');
  });
  it('keeps the search hits in the list whatever the kind, as over the image', () => {
    const html = panel(canvasStore({ search: true, kinds: ['tagging'] }));
    expect(html).toContain('data-annotation-id="urn:search:hit"');
  });
  it('does not offer a search as a kind (a search must not add a kind row)', () => {
    const store = canvasStore({ search: true });
    store.set(localAnnotationPagesAtom, [
      { source: 'inference:test', canvasId, page: { ...page, items: (page.items as unknown[]).slice(0, 3) } },
      { source: CONTENT_SEARCH_SOURCE, canvasId, page: searchPage },
    ]);
    expect(panel(store)).not.toContain('aria-label="Kind"');
  });
});

// ---- the page thumbnails ----------------------------------------------------------------------------------------

describe('page thumbnails', () => {
  const mark = (kind: string, tag?: string): PageMark => ({ x: 0, y: 0, w: 1, h: 1, color: '#000', text: kind === 'supplementing', kind, ...(tag ? { tag } : {}) });
  const marks = [mark('supplementing', 'line_main'), mark('supplementing'), mark('tagging', 'block_fig')];

  it('shows every mark with nothing chosen, and none with the marks switched off', () => {
    expect(thumbMarksShown(marks, { showMarks: true, kinds: [], tags: [] })).toHaveLength(3);
    expect(thumbMarksShown(marks, { showMarks: false, kinds: [], tags: [] })).toHaveLength(0);
  });
  it('narrows by kind and by tag, and ANDs them', () => {
    expect(thumbMarksShown(marks, { showMarks: true, kinds: ['supplementing'], tags: [] })).toHaveLength(2);
    expect(thumbMarksShown(marks, { showMarks: true, kinds: [], tags: ['line_main'] })).toHaveLength(1);
    expect(thumbMarksShown(marks, { showMarks: true, kinds: ['tagging'], tags: ['line_main'] })).toHaveLength(0);
  });
  it('narrows by the unit chosen in the annotations tab', () => {
    const withUnit = [{ ...marks[0], granularity: 'line' }, marks[1], marks[2]];
    expect(thumbMarksShown(withUnit, { showMarks: true, kinds: [], granularity: 'line', tags: [] })).toHaveLength(1);
  });

  const thumbStore = (o: { kinds?: string[]; show?: boolean; granularity?: string | null } = {}) => {
    const store = canvasStore(o);
    store.set(batchModelAtom, 'm');
    store.set(inferenceResultsAtom, {
      [resultKey(canvasId, 'm')]: { canvasId, modelId: 'm', output: { kind: 'lines', items: [] } as never, page, backends: [], ms: 0, created: '' },
    });
    return store;
  };
  const shapes = (store: Store) => count(render(createElement(PageThumbMarks, { page: container }), store), /<(rect|polygon) /g);

  it('draws the marks of the shared kind choice made in the annotations tab', () => {
    expect(shapes(thumbStore())).toBe(4);
    expect(shapes(thumbStore({ kinds: ['supplementing'] }))).toBe(3);
    expect(shapes(thumbStore({ kinds: ['tagging'] }))).toBe(1);
  });
  it('follows the shared marks switch', () => {
    expect(shapes(thumbStore({ show: false }))).toBe(0);
  });
  it('follows the unit chosen in the annotations tab, as the list and the marks over the image', () => {
    expect(shapes(thumbStore({ granularity: 'line' }))).toBe(3);
    // a unit the results lack is ignored
    expect(shapes(thumbStore({ granularity: 'word' }))).toBe(4);
  });
});

// ---- the 3D list ------------------------------------------------------------------------------------------------

describe('3D annotation list', () => {
  const annotations = parseManifestV4(convertToV4(extensionSample)).annotations;
  const list = (setup?: (s: Store) => void) => {
    const store = createStore();
    store.set(annotationsAtom, annotations);
    setup?.(store);
    return render(createElement(AnnotationList), store);
  };
  it('uses the shared filter rows, with "All" pressed', () => {
    const html = list();
    expect(html).toContain('aria-label="Creator"');
    expect(html).toContain('aria-label="Tags"');
    expect(pressed(html).every((p) => p === 'All')).toBe(true);
  });
  it('has the shared marks switch instead of its own', () => {
    const html = list();
    expect(html).toContain('data-show-marks');
    expect(html).toContain('Show marks');
  });
  it('offers kinds when the annotations have more than one', () => {
    const mixed = annotations.map((a, i) => ({ ...a, motivations: [i === 0 ? 'tagging' : 'commenting'] }));
    const store = createStore();
    store.set(annotationsAtom, mixed);
    const html = render(createElement(AnnotationList), store);
    expect(html).toContain('aria-label="Kind"');
    expect(html).toMatch(/data-value="tagging"[^>]*>Tag<span[^>]*>1</);
  });
  it('presses a chosen creator', () => {
    const creator = annotations[0].creator;
    const html = list((s) => s.set(annotationFilterAtom, { query: '', creators: [creator], tags: [] }));
    expect(html).toContain(`aria-pressed="true" data-value="${creator}"`);
  });
});

describe('page thumbnails and the annotations tab agree', () => {
  it('ignores a chosen tag that the chosen kind does not have', () => {
    const store = canvasStore({ kinds: ['tagging'], tags: ['line_main'] });
    store.set(batchModelAtom, 'm');
    store.set(inferenceResultsAtom, {
      [resultKey(canvasId, 'm')]: { canvasId, modelId: 'm', output: { kind: 'lines', items: [] } as never, page, backends: [], ms: 0, created: '' },
    });
    expect(count(render(createElement(PageThumbMarks, { page: container }), store), /<(rect|polygon) /g)).toBe(1);
    expect(marksOn(store)).toEqual([ids[3]]);
  });
});
