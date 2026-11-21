import { describe, expect, it } from 'vitest';
import type { ManifestV4 } from '../types/iiif';
import { aboutOf } from '../features/about';
import { pickBodies } from '../features/annotationBody';
import { storyBodies } from '../features/story';
import { pickWikidataLabel, wikidataLabelUrl } from '../features/wikidataLabel';
import { contentLanguageOfInput, contentLocale, languageRank, languagesOf, matchLanguage, primaryLanguage, uiLanguage } from './contentLanguage';
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

  it('does not let a language from outside reach the Wikidata URL (only language tags pass)', () => {
    expect(contentLanguageOfInput('en&props=claims')).toBeNull();
    expect(contentLanguageOfInput('en|fr')).toBeNull();
    expect(contentLanguageOfInput('zh-Hant')).toBe('zh-Hant');
    expect(contentLocale('ja', 'en&props=claims')).toBe('ja');
    expect(contentLocale('ja', 'en|fr')).toBe('ja');
    // and whatever gets in, each language is escaped
    const url = wikidataLabelUrl('Q1', 'en&props=claims,ja');
    expect(url).not.toContain('props=claims');
    expect(wikidataLabelUrl('Q1', 'en|fr,ja')).toContain('languages=en%7Cfr|ja|en&');
  });

  it('does not treat different scripts as the same language', () => {
    const both = { 'zh-Hans': ['简'], 'zh-Hant': ['繁'], en: ['E'] };
    expect(labelIn(both, contentLocale('ja', 'zh-Hant'))).toBe('繁');
    expect(labelIn(both, contentLocale('ja', 'zh-Hans'))).toBe('简');
    // a plain zh matches neither of two scripts: it falls to the usual order (en)
    expect(labelIn(both, contentLocale('ja', 'zh'))).toBe('E');
    // zh-Hant never picks a lone zh-Hans value; a plain zh key is fine for either
    expect(labelIn({ 'zh-Hans': ['简'], en: ['E'] }, contentLocale('ja', 'zh-Hant'))).toBe('E');
    expect(labelIn({ zh: ['中'], 'zh-Hans': ['简'] }, contentLocale('ja', 'zh-Hant'))).toBe('中');
    expect(matchLanguage('zh', ['zh-Hans'])).toBe('zh-Hans');
    expect(matchLanguage('zh', ['zh-Hans', 'zh-Hant'])).toBeUndefined();
    expect(matchLanguage('ZH-HANT', ['zh-Hans', 'zh-Hant'])).toBe('zh-Hant');
    // a body tag of another script is its own language
    expect(languagesOf({ type: 'Manifest', label: { 'zh-Hans': ['a'], en: ['b'] }, annotations: [{ items: [{ body: { value: 'x', language: 'zh-Hant' } }] }] })).toEqual(['zh-Hans', 'en', 'zh-hant']);
  });

  it('picks annotation bodies and story bodies by the same matching, never across scripts', () => {
    const body = (language: string, value: string) => ({ kind: 'text', value, language, choice: 0 });
    const hans = [body('zh-Hans', '简'), body('zh-Hant', '繁')] as never;
    expect(pickBodies(hans, contentLocale('ja', 'zh-Hant'))[0]).toMatchObject({ value: '繁' });
    expect(pickBodies(hans, contentLocale('ja', 'zh-Hans'))[0]).toMatchObject({ value: '简' });
    const mixed = [body('ja', '日'), body('zh-Hans', '简')] as never;
    expect(pickBodies(mixed, contentLocale('ja', 'zh-Hant'))[0]).toMatchObject({ value: '日' });
    const steps = { bodies: [{ kind: 'text', value: '简', language: 'zh-Hans' }, { kind: 'text', value: '繁', language: 'zh-Hant' }] } as never;
    expect(storyBodies(steps, contentLocale('ja', 'zh-Hant')).map((b) => b.value)).toEqual(['繁']);
    expect(storyBodies({ bodies: [{ kind: 'text', value: '日', language: 'ja' }, { kind: 'text', value: '简', language: 'zh-Hans' }] } as never, contentLocale('ja', 'zh-Hant')).map((b) => b.value)).toEqual(['日']);
  });

  it('ranks captions and asks Wikidata by the same matching', () => {
    const l = contentLocale('ja', 'zh-Hant');
    expect(languageRank('zh-Hans', l)).toBeGreaterThan(1);
    expect(languageRank('zh-Hant', l)).toBe(0);
    expect(wikidataLabelUrl('Q1', l)).toContain('languages=zh-hant|ja|en&');
    const json = { entities: { Q1: { labels: { 'zh-hans': { value: '简' }, ja: { value: '日' } } } } };
    expect(pickWikidataLabel(json, 'Q1', l)).toBe('日');
  });

  it('lists only body tags that are language tags', () => {
    const m = { type: 'Manifest', label: { en: ['a'] }, annotations: [{ items: [{ body: { value: 'x', language: 'English' } }, { body: { value: 'y', language: 'en_US' } }, { body: { value: 'z', language: 'fr' } }] }] };
    expect(languagesOf(m)).toEqual(['en', 'fr']);
  });

  it('with no content language, regions of one language are matched as on main ([ja, en-US, en-GB], UI en gives en-US)', () => {
    const body = (language: string, value: string) => ({ kind: 'text', value, language, choice: 0 });
    const bodies = [body('ja', '日'), body('en-US', 'US'), body('en-GB', 'GB')] as never;
    expect(pickBodies(bodies, 'en')[0]).toMatchObject({ value: 'US' });
    expect(pickBodies(bodies, contentLocale('ja', 'en'))[0]).toMatchObject({ value: 'US' });
    expect(matchLanguage('en', ['en-US', 'en-GB'])).toBe('en-US');
    expect(matchLanguage('zh', ['zh-Hans', 'zh-Hant'])).toBeUndefined();
    const story = { bodies: [body('ja', '日'), body('en-US', 'US'), body('en-GB', 'GB')] } as never;
    expect(storyBodies(story, 'en').map((b) => b.value)).toEqual(['US']);
  });

  it('storyBodies counts languages as on main when none is chosen (en and en-US are one language)', () => {
    const t = (language: string, value: string) => ({ kind: 'text', value, language });
    const same = { bodies: [t('en', 'A'), t('en-US', 'B')] } as never;
    expect(storyBodies(same, 'ja').map((b) => b.value)).toEqual(['A', 'B']);
    expect(storyBodies(same, 'en').map((b) => b.value)).toEqual(['A', 'B']);
  });

  it('keeps the UI language step of the plain lookups: caption rank and Wikidata are as on main without a choice', () => {
    expect(languageRank('ja-JP', 'ja')).toBe(0);
    expect(languageRank('en', 'ja')).toBeGreaterThan(0);
    expect(wikidataLabelUrl('Q1', 'ja')).toContain('languages=ja|en&');
    const json = { entities: { Q1: { labels: { 'ja-jp': { value: 'x' }, en: { value: 'E' } } } } };
    expect(pickWikidataLabel(json, 'Q1', 'ja')).toBe('E');
  });

  it('caption rank compares the UI language without regard to case, as main did ([ja, EN], UI en gives EN)', () => {
    expect(languageRank('EN', 'en')).toBe(0);
    expect(languageRank('JA', 'ja')).toBe(0);
    const tracks = [{ language: 'ja' }, { language: 'EN' }];
    expect(tracks.sort((a, b) => languageRank(a.language, 'en') - languageRank(b.language, 'en'))[0].language).toBe('EN');
  });

  it('reads one language-tag pattern: a label map with ja and ja-x-kana lists both', () => {
    expect(languagesOf({ type: 'Manifest', label: { ja: ['a'], 'ja-x-kana': ['b'] } })).toEqual(['ja', 'ja-x-kana']);
  });

  it('storyBodies with a chosen language keeps the same language in the same script ([fr, fr-CA, ja], fr chosen)', () => {
    const t = (language: string, value: string) => ({ kind: 'text', value, language });
    const step = { bodies: [t('fr', 'F'), t('fr-CA', 'C'), t('ja', 'J')] } as never;
    expect(storyBodies(step, contentLocale('ja', 'fr')).map((b) => b.value)).toEqual(['F', 'C']);
  });

  it('regions of Chinese imply their script: zh-TW and zh-CN are different, so a plain zh matches neither', () => {
    expect(matchLanguage('zh', ['zh-TW', 'zh-CN'])).toBeUndefined();
    expect(matchLanguage('zh', ['zh-TW', 'zh-HK'])).toBe('zh-TW');
    expect(labelIn({ 'zh-TW': ['繁'], 'zh-CN': ['简'], en: ['E'] }, contentLocale('ja', 'zh'))).toBe('E');
  });
});
