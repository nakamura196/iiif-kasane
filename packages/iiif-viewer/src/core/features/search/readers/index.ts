// 読み手の一覧。新しい入力の種類は、読み手を 1 つ書いてここに足す（先に並べたものが優先）。

import type { ReadContext, SearchReader, SearchSource } from '../types';
import { collectionReader } from './collection';
import { curationReader } from './curation';
import { discoveryReader } from './discovery';

// discovery は collection より先に置く（OrderedCollection も型名が Collection で終わるため）
export const SEARCH_READERS: SearchReader[] = [curationReader, discoveryReader, collectionReader];

/** 入力の JSON を読める読み手。無ければ undefined。 */
export const readerFor = (json: unknown, readers = SEARCH_READERS): SearchReader | undefined =>
  readers.find((r) => r.accepts(json));

/** URL を取ってきて、読める読み手で項目の並びにする。読めなければ例外。 */
export async function loadSearchSource(ctx: ReadContext, readers = SEARCH_READERS): Promise<SearchSource> {
  const json = await ctx.fetchJson(ctx.url);
  const reader = readerFor(json, readers);
  if (!reader) throw new Error('unsupported resource: not a collection, a curation or a change discovery stream');
  const read = await reader.read(json, ctx);
  return { kind: reader.kind, url: ctx.url, ...read };
}
