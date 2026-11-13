// Kinds of annotation for filtering: what an annotation is for, read from its W3C / IIIF motivation.
// The 3D list, the 2D annotations tab and the pages grid filter by the same kinds, so that a reader can, for
// example, show only the transcribed text (supplementing) and hide the regions that a model only classified
// (tagging). Nothing here knows about a particular model: the kinds are the motivations themselves.
//
// The filters share one rule: nothing chosen shows everything; something chosen shows only what has one of the
// chosen values. A chosen value that the current items do not have is ignored, so that moving to another page
// never leaves the list empty because of a choice made elsewhere.

import type { Facet } from './annotationSearch';
import { TEXT_GRANULARITIES } from './contentSearch';

/**
 * The order kinds are listed in: text first (what most readers look for), then notes, then the rest.
 * Kinds outside this list come after it, in the order they first occur.
 */
export const KIND_ORDER = [
  'supplementing',
  'painting',
  'commenting',
  'describing',
  'tagging',
  'classifying',
  'identifying',
  'linking',
  'bookmarking',
  'questioning',
  'replying',
  'editing',
  'moderating',
  'highlighting',
] as const;

/** The kind given to an annotation without a motivation: a note, as the viewers have always shown it. */
export const DEFAULT_KIND = 'commenting';

/**
 * The kind of an annotation: `painting` when its text is drawn on the Canvas, else its first motivation
 * (an annotation with several motivations is filed under the first, the one the list shows).
 */
export const annotationKindOf = (a: { motivations?: readonly string[]; painted?: boolean }): string => {
  if (a.painted) return 'painting';
  const m = a.motivations?.find((x) => typeof x === 'string' && x !== '');
  return m ?? DEFAULT_KIND;
};

const rankOf = (kind: string): number => {
  const i = (KIND_ORDER as readonly string[]).indexOf(kind);
  return i < 0 ? KIND_ORDER.length : i;
};

/** How many items of each kind there are, in KIND_ORDER (unknown kinds after, as they first occur). */
export const kindFacets = (kinds: readonly string[]): Facet[] => {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  // Map keeps the order of first occurrence; a stable sort keeps it among the unknown kinds
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => rankOf(a.value) - rankOf(b.value));
};

/** The chosen values that the items have (see the rule at the top). */
export const presentChoices = (chosen: readonly string[], facets: readonly Facet[]): string[] =>
  chosen.length === 0 ? [] : chosen.filter((v) => facets.some((f) => f.value === v));

/** Is a value kept by a choice? Nothing chosen keeps everything; otherwise the value must be one of the chosen. */
export const passesChoice = (value: string | undefined, chosen: readonly string[]): boolean =>
  chosen.length === 0 || (value !== undefined && chosen.includes(value));

/**
 * What pressing a value gives: a multiple choice turns it on or off, a single choice takes it (or lets it go).
 * Chosen values that the current items lack are kept (see the rule at the top), so that a choice made on another
 * page, or in another list sharing the choice, is not lost by a press here.
 */
export const nextChoice = (chosen: readonly string[], value: string, multiple: boolean): string[] => {
  if (multiple) return chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
  return chosen.length === 1 && chosen[0] === value ? [] : [value];
};

/** What pressing "All" gives: the chosen values the items have are let go, the others are kept. */
export const clearPresentChoices = (chosen: readonly string[], present: readonly string[]): string[] =>
  chosen.filter((v) => !present.includes(v));

/** The order units of text are listed in: the largest first (page, block … glyph), unknown units last. */
export const granularityRank = (g: string): number => {
  const i = (TEXT_GRANULARITIES as readonly string[]).indexOf(g);
  return i < 0 ? TEXT_GRANULARITIES.length : i;
};

type Narrowable = { motivations?: readonly string[]; painted?: boolean; granularity?: string };

/** The marks of a text search (highlighting): they have their own switch in the search tab and are never narrowed here. */
export const isSearchHit = (a: { motivations?: readonly string[] }): boolean => a.motivations?.includes('highlighting') ?? false;

/**
 * The annotations of a Canvas narrowed by the chosen kinds and unit of text, as the 2D annotations tab and the marks
 * over the image both narrow them (so the two always agree). The facets are what the filters offer: the kinds of all
 * the annotations, and the units among those of the chosen kinds. Choices the annotations do not have are ignored.
 * The marks of a text search are always kept and are not offered as a kind (a search must not add a filter row).
 */
export const narrowByKindAndUnit = <T extends Narrowable>(
  all: readonly T[],
  chosenKinds: readonly string[],
  granularity: string | null,
) => {
  const others = all.filter((a) => !isSearchHit(a));
  const kindOf = new Map(others.map((a) => [a, annotationKindOf(a)] as const));
  const kindsOffered = kindFacets([...kindOf.values()]);
  const kinds = presentChoices(chosenKinds, kindsOffered);
  const byKind = kinds.length > 0 ? others.filter((a) => kinds.includes(kindOf.get(a)!)) : others;
  const granularities = [...new Set(byKind.map((a) => a.granularity).filter((g): g is string => !!g))].sort(
    (a, b) => granularityRank(a) - granularityRank(b),
  );
  const activeGranularity = granularity && granularities.includes(granularity) ? granularity : null;
  const narrowing = kinds.length > 0 || activeGranularity !== null;
  // in the order of the Canvas, with the search marks where they were
  const annotations = narrowing
    ? all.filter(
        (a) =>
          !kindOf.has(a) ||
          ((kinds.length === 0 || kinds.includes(kindOf.get(a)!)) &&
            (!activeGranularity || a.granularity === activeGranularity)),
      )
    : [...all];
  return { kindFacets: kindsOffered, kinds, granularities, activeGranularity, narrowing, annotations };
};
