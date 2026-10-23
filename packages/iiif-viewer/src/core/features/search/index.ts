// search: キュレーションやコレクションを、メタデータで絞り込める一覧にする。
// 読み込み（readers/）→ 項目の並び（SearchItem）→ 絞り込み（facets.ts）の順に流れる。
// 読み込みと集計はすべてブラウザの中で行う（サーバは使わない）。React に依存しない。
export * from './types';
export * from './facets';
export * from './metadata';
export { canvasThumbnail, manifestThumbnail, regionOf, sizeParam } from './thumbnails';
export { SEARCH_READERS, loadSearchSource, readerFor } from './readers';
export { curationReader } from './readers/curation';
export { collectionReader } from './readers/collection';
export { DISCOVERY_MAX_ITEMS, discoveryReader, recentManifests } from './readers/discovery';
