// i18n.js — 軽量な多言語対応(ja / en)。?lang= か config.lang か navigator.language で決定。
// 静的要素は data-i18n / data-i18n-html 属性で差し替え、動的文字列は t(key) を使う。

import { G } from "./state.js";

const DICT = {
  ja: {
    loadFailed: "読み込みに失敗しました:",
    appTitle: "IIIF バーチャル美術館",
    entranceLead: "モードと展示を選んで「入室する」",
    enter: "入室する →",
    enterVR: "VRで入室 →",
    vrUnsupported: "お使いの環境は VR(WebXR) に対応していません",
    back: "← 入口",
    modeThird: "歩く(三人称)",
    modeWalk: "歩く(一人称)",
    modeOrbit: "見回す",
    charMan: "男性",
    charGirl: "女性",
    urlLabel: "自分の IIIF を見る",
    urlPlaceholder: "Curation / Collection / Manifest の URL",
    urlLoad: "読み込む",
    tutWatch: "使い方（動画）",
    tourWatch: "自動ツアー（動画）",
    urlExample: "例: IIIF Cookbook コレクションを入れる",
    panelRights: "利用条件・ライセンス",
    panelMeta: "メタデータ",
    panelSource: "IIIF ソース",
    toWalk: "歩く",
    toLook: "見回す",
    loading: "読み込み中…",
    loadingCuration: "Curation を読み込み中…",
    loadingManifest: "Manifest を読み込み中…",
    loadingCollection: "Collection を読み込み中…",
    placing: "画像を配置中…",
    noImages: "表示する画像がありません",
    serverTimeout: "画像の提供元（{host}）が応答しません。時間をおいて試してください。",
    serverUnreachable: "画像の提供元（{host}）に接続できません。",
    zoom: "拡大する",
    openInKasane: "Kasane で開く",
    openInKasaneTitle: "注釈や目次も見られる Kasane のビューアで、この作品を新しいタブに開く",
    zoomHintE: "E で拡大",
    helpHtml:
      "見回す: ドラッグ/ホイール ・ 歩く: WASD／矢印（スマホはスティック）<br>作品にカーソル → <b>拡大ボタン</b>（歩行中は<b>E</b>）で拡大 ・ Esc で戻る",
    walkBig: "クリックで歩行開始",
    walkSub: "WASD / 矢印で移動　マウスで見回す　作品を見て E で拡大　Esc で解除",
    close: "閉じる (Esc)",
    vrHelp: "左スティック: 移動（前後左右）　右スティック: 30°ずつ回転　作品に向けてトリガーで拡大（覗き込み）",
    lookStandard: "内装 標準",
    lookMuseum: "内装 写真館",
    tourFirst: "● 一人称ツアー",
    tourThird: "● 三人称ツアー",
    tourStop: "■ 停止",
    tourTitleFirst: "一人称視点で作品を自動で巡る映像を録画(WebM保存)",
    tourTitleThird: "アバターが歩いて作品を巡る映像を録画(WebM保存)",
    indexOpen: "目次",
    indexTitle: "作品一覧",
    indexEmpty: "表示できる作品がありません",
    quality: "画質",
    noImagesIn: "{kind} から画像を抽出できませんでした",
    exhibitionN: "展示 {n}",
    countWorks: "{n}点",
  },
  en: {
    loadFailed: "Failed to load:",
    appTitle: "IIIF Virtual Museum",
    entranceLead: "Choose a mode and an exhibition, then “Enter”",
    enter: "Enter →",
    enterVR: "Enter in VR →",
    vrUnsupported: "Your device does not support VR (WebXR)",
    back: "← Lobby",
    modeThird: "Third-person (walk)",
    modeWalk: "First-person (walk)",
    modeOrbit: "Look around",
    charMan: "Man",
    charGirl: "Girl",
    urlLabel: "View your own IIIF",
    urlPlaceholder: "Curation / Collection / Manifest URL",
    urlLoad: "Load",
    tutWatch: "Tutorial video",
    tourWatch: "Auto tour (video)",
    urlExample: "Try an example: IIIF Cookbook collection",
    panelRights: "Rights & License",
    panelMeta: "Metadata",
    panelSource: "IIIF source",
    toWalk: "Walk",
    toLook: "Look",
    loading: "Loading…",
    loadingCuration: "Loading Curation…",
    loadingManifest: "Loading Manifest…",
    loadingCollection: "Loading Collection…",
    placing: "Placing images…",
    noImages: "No images to show",
    serverTimeout: "The image provider ({host}) is not responding. Please try again later.",
    serverUnreachable: "Could not connect to the image provider ({host}).",
    zoom: "Zoom",
    openInKasane: "Open in Kasane",
    openInKasaneTitle: "Open this work in the Kasane viewer (annotations, contents and more) in a new tab",
    zoomHintE: "Press E to zoom",
    helpHtml:
      "Look: drag / wheel ・ Walk: WASD / arrows (stick on mobile)<br>Aim at a work → <b>Zoom button</b> (or <b>E</b> while walking) ・ Esc to exit",
    walkBig: "Click to start walking",
    walkSub: "WASD / arrows to move　mouse to look　aim at a work and press E to zoom　Esc to release",
    close: "Close (Esc)",
    vrHelp: "Left stick: move (all directions)　Right stick: snap-turn 30°　Aim at a work and hold the trigger to magnify",
    lookStandard: "Interior: Standard",
    lookMuseum: "Interior: Lightbox",
    tourFirst: "● First-person",
    tourThird: "● Third-person",
    tourStop: "■ Stop",
    tourTitleFirst: "Record a first-person auto tour of the works (saves WebM)",
    tourTitleThird: "Record a tour with the avatar walking the works (saves WebM)",
    indexOpen: "Contents",
    indexTitle: "All works",
    indexEmpty: "No works to show",
    quality: "Quality",
    noImagesIn: "No images could be extracted from the {kind}",
    exhibitionN: "Exhibition {n}",
    countWorks: "{n} works",
  },
};

let LANG = "ja";

export function setLang(l) {
  const code = (l || "").slice(0, 2).toLowerCase();
  LANG = DICT[code] ? code : "ja";
}

export function getLang() {
  return LANG;
}

export function t(key) {
  return (DICT[LANG] && DICT[LANG][key]) ?? DICT.ja[key] ?? key;
}

// data-i18n(textContent) / data-i18n-html(innerHTML) を持つ静的要素を一括反映
export function applyI18n() {
  (G.root || document).querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  (G.root || document).querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  (G.root || document).querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  (G.root || document).querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
}
