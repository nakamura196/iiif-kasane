import { describe, expect, it } from 'vitest';
import type { ManifestV4 } from '../types/iiif';
import { aboutOf } from '../features/about';
import { pickBodies } from '../features/annotationBody';
import { pickWikidataLabel, wikidataLabelUrl } from '../features/wikidataLabel';
import { contentLanguageOfInput, contentLocale, languageRank, languagesOf, primaryLanguage, uiLanguage } from './contentLanguage';
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

describe('review fixes', () => {
  it('counts the language of annotation text bodies, not of links or painting bodies', () => {
    const m = {
      type: 'Manifest',
      label: { en: ['T'], ja: ['題'] },
      homepage: [{ id: 'h', type: 'Text', label: { en: ['Home'] }, language: ['de'] }],
      items: [
        {
          type: 'Canvas',
          items: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', motivation: 'painting', body: { id: 'x.mp3', type: 'Sound', language: 'fr' } }] }],
        },
      ],
    };
    expect(languagesOf(m)).toEqual(['en', 'ja']);
  });

  it('reads the label map of a link', () => {
    expect(languagesOf({ type: 'Manifest', homepage: [{ id: 'h', type: 'Text', label: { en: ['Home'], ko: ['홈'] } }] })).toEqual(['en', 'ko']);
  });

  it('normalises tags: case, and a body tag merged into the one map key of the same language', () => {
    expect(languagesOf({ type: 'Manifest', label: { en: ['a'], 'zh-Hans': ['b'] }, summary: { EN: ['c'] } })).toEqual(['en', 'zh-Hans']);
    const withBody = { type: 'Manifest', label: { en: ['a'], zh: ['b'] }, annotations: [{ items: [{ body: { value: 'x', language: 'ZH-hant' } }] }] };
    expect(languagesOf(withBody)).toEqual(['en', 'zh']);
    // two keys of the same language: a body tag is kept as its own entry
    expect(languagesOf({ type: 'Manifest', label: { 'zh-hans': ['a'], 'zh-hant': ['b'] }, annotations: [{ items: [{ body: { value: 'x', language: 'zh-tw' } }] }] })).toEqual(['zh-hans', 'zh-hant', 'zh-tw']);
  });

  it('finds the key of a chosen language without regard to case or script', () => {
    expect(labelIn({ en: ['E'], 'zh-Hans': ['简'] }, contentLocale('ja', 'zh'))).toBe('简');
    expect(labelIn({ en: ['E'], 'zh-Hans': ['简'] }, contentLocale('ja', 'ZH-HANS'))).toBe('简');
    // a plain UI locale is matched exactly as before
    expect(labelIn({ en: ['E'], 'ja-JP': ['日'] }, 'ja')).toBe('E');
  });

  it('ranks languages by the preference list (chosen, then UI)', () => {
    const l = contentLocale('ja', 'zh');
    expect(languageRank('zh-Hans', l)).toBe(0);
    expect(languageRank('ja', l)).toBe(1);
    expect(languageRank('en', l)).toBeGreaterThan(1);
    expect(languageRank(undefined, l)).toBeGreaterThan(1);
  });

  it('asks Wikidata for every preferred language and picks by that order', () => {
    const l = contentLocale('ja', 'zh');
    expect(wikidataLabelUrl('Q1', l)).toContain('languages=zh|ja|en&');
    expect(wikidataLabelUrl('Q1', 'ja')).toContain('languages=ja|en&');
    const json = { entities: { Q1: { labels: { en: { value: 'Tokyo' }, ja: { value: '東京' } } } } };
    // no zh label: the UI language comes before en
    expect(pickWikidataLabel(json, 'Q1', l)).toBe('東京');
    expect(pickWikidataLabel(json, 'Q1', 'en')).toBe('Tokyo');
  });

  it('reads a content language from outside: not given leaves the choice, empty or a list gives automatic', () => {
    expect(contentLanguageOfInput(undefined)).toBeUndefined();
    expect(contentLanguageOfInput('')).toBeNull();
    expect(contentLanguageOfInput(' fr ')).toBe('fr');
    expect(contentLanguageOfInput('fr,ja')).toBeNull();
  });
});
