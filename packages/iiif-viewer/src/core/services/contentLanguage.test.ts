import { describe, expect, it } from 'vitest';
import type { ManifestV4 } from '../types/iiif';
import { aboutOf } from '../features/about';
import { pickBodies } from '../features/annotationBody';
import { contentLocale, languagesOf, primaryLanguage, uiLanguage } from './contentLanguage';
import { labelIn } from './paintedModels';

const multi = {
  '@context': 'http://iiif.io/api/presentation/4/context.json',
  id: 'https://example.org/m.json',
  type: 'Manifest',
  label: { ja: ['日本語の題'], en: ['English title'], zh: ['中文标题'] },
  summary: { ja: ['要約'], en: ['Summary'] },
  metadata: [{ label: { en: ['Author'], zh: ['作者'] }, value: { none: ['X'] } }],
  items: [{ id: 'https://example.org/c1', type: 'Canvas', label: { none: ['1'] }, width: 1, height: 1, items: [] }],
} as unknown as ManifestV4;

describe('content language', () => {
  it('shows the chosen language while the UI stays Japanese', () => {
    expect(labelIn(multi.label, 'ja')).toBe('日本語の題');
    expect(labelIn(multi.label, contentLocale('ja', 'zh'))).toBe('中文标题');
    const about = aboutOf(multi, undefined, contentLocale('ja', 'zh'))!;
    expect(about.manifest.label).toBe('中文标题');
    expect(about.manifest.metadata[0].label).toBe('作者');
  });

  it('falls back to the UI language, then the usual order, where the chosen one has no value', () => {
    // the summary has no zh: the UI language (ja) is used, not en
    const about = aboutOf(multi, undefined, contentLocale('ja', 'zh'))!;
    expect(about.manifest.summary).toEqual(['要約']);
    expect(labelIn({ en: ['E'], fr: ['F'] }, contentLocale('ja', 'zh'))).toBe('E');
  });

  it('is the UI locale itself without a choice, or when the choice is the UI locale', () => {
    expect(contentLocale('ja')).toBe('ja');
    expect(contentLocale('ja', null)).toBe('ja');
    expect(contentLocale('en', 'en')).toBe('en');
    expect(aboutOf(multi, undefined, contentLocale('ja'))).toEqual(aboutOf(multi, undefined, 'ja'));
  });

  it('keeps dates and other UI formatting on the UI language', () => {
    const l = contentLocale('en', 'zh');
    expect(primaryLanguage(l)).toBe('zh');
    expect(uiLanguage(l)).toBe('en');
    const m = { ...multi, navDate: '2020-05-06T00:00:00Z' } as unknown as ManifestV4;
    expect(aboutOf(m, undefined, l)!.manifest.navDate).toEqual(aboutOf(m, undefined, 'en')!.manifest.navDate);
  });

  it('picks the annotation body of the chosen language in a Choice', () => {
    const bodies = [
      { kind: 'text', value: '日本語', language: 'ja', choice: 0 },
      { kind: 'text', value: 'English', language: 'en', choice: 0 },
      { kind: 'text', value: '中文', language: 'zh', choice: 0 },
    ] as never;
    expect(pickBodies(bodies, 'ja')[0]).toMatchObject({ value: '日本語' });
    expect(pickBodies(bodies, contentLocale('ja', 'zh'))[0]).toMatchObject({ value: '中文' });
  });

  describe('languagesOf', () => {
    it('collects the languages of the language maps and annotation bodies, without "none"', () => {
      expect(languagesOf(multi)).toEqual(['ja', 'en', 'zh']);
      const withAnnotation = {
        ...multi,
        items: [
          {
            type: 'Canvas',
            annotations: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', body: { type: 'TextualBody', value: 'x', language: 'fr' } }] }],
          },
        ],
      };
      expect(languagesOf(withAnnotation)).toEqual(['ja', 'en', 'zh', 'fr']);
    });

    it('finds one language for a single-language resource (no selector)', () => {
      expect(languagesOf({ type: 'Manifest', label: { en: ['Only'] }, summary: { none: ['x'] } })).toEqual(['en']);
      expect(languagesOf({ type: 'Manifest', label: { none: ['Only'] } })).toEqual([]);
    });
  });
});
