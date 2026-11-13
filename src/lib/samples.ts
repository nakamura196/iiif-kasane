import { contentParam } from 'iiif-kasane/core';
import { withBasePath } from '@/lib/basePath';
import type { ViewerTab } from '@/lib/viewerTabs';

export interface Sample {
  id: string;
  media: 'image' | 'audio' | 'video' | '3d';
  title: { ja: string; en: string };
  note: { ja: string; en: string };
  manifest: string;
  // 開いたあとに選ぶタブ
  tab?: ViewerTab;
}

// このサイトの検査用マニフェスト（/samples/kasane）。
// IIIF Cookbook のレシピは cookbookRecipes.ts にあり、/samples に一覧で出す。
export const SAMPLES: Sample[] = [
  // 3D モデルへのアノテーションが Kasane の中心の機能なので、一覧の先頭に置く
  {
    id: 'globe-annotations', media: '3d',
    title: { ja: '地球儀とアノテーション', en: 'Globe with annotations' },
    note: {
      ja: '『石淵家地球儀』（菊池市立図書館所蔵）の 3D モデルの地名に、アノテーションを付けた例。一覧の地名を押すと、その場所へ視点が移ります',
      en: 'Annotations on place names of a 3D model of the Ishibuchi family globe (Kikuchi City Library). Click a place in the list to move the view there',
    },
    manifest: withBasePath('/manifests/sample-manifest-with-annotations.json'), tab: 'annotations',
  },
  {
    id: 'globe-viewpoints', media: '3d',
    title: { ja: '地球儀と視点', en: 'Globe with viewpoints' },
    note: {
      ja: '同じ地球儀の Scene に、3 つの視点（PerspectiveCamera）を書いた例。最初の視点「日本」で開き、右上のボタンで「ヨーロッパ」「真上」に切り替えられます',
      en: 'The same globe with three viewpoints (PerspectiveCamera) in its Scene. It opens at the first one, Japan; the buttons at the top right switch to Europe and From above',
    },
    manifest: withBasePath('/manifests/sample-manifest-viewpoints.json'),
  },
  {
    id: 'spacesuit-story', media: '3d',
    title: { ja: '宇宙服の 3D ツアー', en: '3D tour of a spacesuit' },
    note: {
      ja: 'IIIF 3D 作業部会の例の宇宙服に、隠した視点（Camera）と順に進む注釈の頁（behavior: sequence）でツアーを書いた検証用の例。「次へ」で視点が全体・手袋・ヘルメット・背中と移ります。段の本文は仮のものです',
      en: 'A test of a tour on the spacesuit from the IIIF 3D TSG examples, written with hidden Cameras and an annotation page with behavior "sequence". "Next" moves the view through the whole suit, the glove, the helmet and the back. The step texts are placeholders',
    },
    manifest: withBasePath('/manifests/sample-manifest-story-3d.json'), tab: 'story',
  },
  {
    id: 'video-transcript', media: 'video',
    title: { ja: '動画と時刻つき文字起こし', en: 'Video with timed transcript' },
    note: {
      ja: '字幕と同じ VTT を文字起こしにも指定。行を押すと再生位置が移り、再生に合わせて強調されます',
      en: 'The same VTT as captions and as transcript. Click a line to seek; the current line is highlighted',
    },
    manifest: withBasePath('/manifests/sample-manifest-video-transcript.json'), tab: 'transcript',
  },
  {
    id: 'video-objects', media: 'video',
    title: { ja: '動画の中の人の枠', en: 'Boxes on people in a video' },
    note: {
      ja: '動画の時間と範囲を指す注釈（#t=…&xywh=…）の例。ArchiveBase の Video Search が AI で見つけた人の枠（目で確かめて、確かに人のものだけを残した）が、その時間だけ動画の上に出ます。一覧を押すと、その時刻へ移ります',
      en: 'Annotations on a time and a region of a video (#t=…&xywh=…). Boxes on people that ArchiveBase Video Search found with AI (checked by eye, keeping only those that really show a person) appear over the video at their time. Click one in the list to go there',
    },
    manifest: withBasePath('/manifests/sample-manifest-video-objects.json'), tab: 'canvasAnnotations',
  },
  {
    id: 'physdim-hyakki', media: 'image',
    title: { ja: '実寸の物差し: 百鬼夜行図', en: 'Physical ruler: Hyakki Yagyo scroll' },
    note: {
      ja: '横長の絵巻（約 7.9 m）の例。キャンバスに実寸（physdim）が書いてあるので、画像の上端と左端に物差しが出ます。拡大すると目盛りが細かくなります。左上の歯車で単位（mm・cm・in）や色を変えられます',
      en: 'A long handscroll (about 7.9 m). The Canvas carries its physical size (physdim), so a ruler appears along the top and left edges and its ticks get finer as you zoom. The gear at the top left changes the unit (mm, cm, in) and colours',
    },
    manifest: withBasePath('/manifests/physdim-hyakki.json'),
  },
];

// 「開く」の行き先（/viewer）。一覧の画面と、サムネイルを撮るスクリプトの両方で使う
export const sampleHref = (s: Sample): string =>
  `/viewer?${contentParam(s.manifest)}${s.tab ? `&tab=${s.tab}` : ''}`;

// サムネイル（scripts/capture-thumbnails.mjs で撮った画面）。public/ からのパス
// sampleThumbnailPath は basePath なし（og:image など metadataBase からの URL 用）、sampleThumbnail は画面の <img> 用
export const sampleThumbnailPath = (s: Sample): string => `/thumbnails/samples/${s.id}.webp`;
export const sampleThumbnail = (s: Sample): string => withBasePath(sampleThumbnailPath(s));

export const sampleById = (id: string): Sample | undefined => SAMPLES.find((s) => s.id === id);
