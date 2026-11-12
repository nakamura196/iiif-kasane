'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FacetSelection } from 'iiif-kasane/core';

// 検索画面の状態と URL の引数の対応。状態は URL に残すので、そのまま共有できる。
//   u: 読み込む URL（curation / collection / iiif-content でも受ける）
//   q: 語句
//   f: <項目>:<値>（いくつでも）
// 新しい状態（並べ替え・表示の切り替えなど）を足すときは、ここの読み書きを増やす。

export interface SearchState {
  url: string | null;
  query: string;
  selection: FacetSelection;
}

export function readSearchParams(params: URLSearchParams): SearchState {
  const selection: FacetSelection = {};
  for (const f of params.getAll('f')) {
    const i = f.indexOf(':');
    if (i <= 0) continue;
    (selection[f.slice(0, i)] ??= []).push(f.slice(i + 1));
  }
  return {
    url: params.get('u') ?? params.get('curation') ?? params.get('collection') ?? params.get('iiif-content'),
    query: params.get('q') ?? '',
    selection,
  };
}

export function writeSearchParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.url) params.set('u', state.url);
  if (state.query.trim()) params.set('q', state.query.trim());
  for (const [k, vs] of Object.entries(state.selection)) for (const v of vs) params.append('f', `${k}:${v}`);
  return params;
}

/** 選択の中の 1 つの値を、付け外しする。 */
export function toggleValue(selection: FacetSelection, key: string, value: string): FacetSelection {
  const cur = selection[key] ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  const out = { ...selection, [key]: next };
  if (next.length === 0) delete out[key];
  return out;
}

/**
 * URL から状態を読み、変わるたびに URL に書き戻す。
 * 別の URL を開く（open）ときは履歴に積むので、ブラウザの「戻る」で前の一覧に戻れる。
 * 読む前（サーバ側の描画と最初の描画）は ready が false。
 */
export function useSearchState() {
  const [state, setState] = useState<SearchState>({ url: null, query: '', selection: {} });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => setState(readSearchParams(new URLSearchParams(window.location.search)));
    read();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL はブラウザでしか読めない
    setReady(true);
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  // 語句と選択の変化は、履歴を増やさずに URL を書き換える
  useEffect(() => {
    if (!ready || !state.url) return;
    const next = `?${writeSearchParams(state).toString()}`;
    if (next !== window.location.search) window.history.replaceState(window.history.state, '', next);
  }, [ready, state]);

  const open = useCallback((url: string | null) => {
    const next: SearchState = { url, query: '', selection: {} };
    const search = writeSearchParams(next).toString();
    window.history.pushState(window.history.state, '', search ? `?${search}` : window.location.pathname);
    setState(next);
  }, []);
  const setQuery = useCallback((query: string) => setState((s) => ({ ...s, query })), []);
  const setSelection = useCallback(
    (update: (s: FacetSelection) => FacetSelection) => setState((s) => ({ ...s, selection: update(s.selection) })),
    [],
  );
  return { ...state, ready, open, setQuery, setSelection };
}
