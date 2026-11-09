import type { FetchAllOptions } from './json';

// search の型。読み手（readers/）・絞り込み（facets.ts）・画面のあいだの取り決め。

/** 項目を開く先。ビューアに `iiif-content=<content>`（と `pos`）で渡す。 */
export interface SearchTarget {
  /** マニフェスト、またはキュレーションの URL */
  content: string;
  /** キュレーションの何番目の member か（1 から） */
  pos?: number;
}

export interface SearchItem {
  /** 一覧の中で一意な鍵 */
  key: string;
  label: string;
  /** 小さな画像の URL */
  thumbnail?: string;
  /** メタデータ。項目名 → 値（1 項目に値が複数あることもある） */
  metadata: Record<string, string[]>;
  target: SearchTarget;
}

export interface SearchSource {
  /** 読み手の種類（readers/ の kind） */
  kind: string;
  label: string;
  url: string;
  items: SearchItem[];
  /** 読めなかった参照先（マニフェストなど）の数 */
  failed: number;
}

/** 読み手が返す結果（kind と url は loadSearchSource が足す）。 */
export type ReadResult = Omit<SearchSource, 'kind' | 'url'>;

export type FetchJson = (url: string) => Promise<unknown>;

export interface ReadContext {
  /** 読み込む元の URL */
  url: string;
  fetchJson: FetchJson;
  /** 言語つきの値を選ぶときの言語 */
  locale: string;
  /** 参照先を取りに行くときの進み具合 */
  onProgress?: (done: number, total: number) => void;
  /** 読めた分までの途中の結果。全部読み終えるのを待たずに一覧を出すためのもの */
  onPartial?: (partial: ReadResult) => void;
  /** 参照先の取り方（同時に取りに行く数・取り直しの回数など）。省略すると json.ts の既定 */
  fetchOptions?: Omit<FetchAllOptions, 'onProgress'>;
}

/**
 * 入力の種類ごとの読み手。新しい種類は、これを 1 つ書いて readers/index.ts に足す。
 * accepts は取ってきた JSON（変換前）を見て判定する。先に登録したものが優先。
 */
export interface SearchReader {
  kind: string;
  accepts(json: unknown): boolean;
  read(json: unknown, ctx: ReadContext): Promise<ReadResult>;
}
