// entrance.js — 入口(ロビー)。展示を選び、操作モード(見回す/一人称/三人称)を選んで入室する。
// 展示は config.exhibitions でも、IIIF Curation の各 selection からでも生成できる。

import { G, $, escapeHtml } from "./state.js";
import { buildGalleryFromSource, clearGallery } from "./gallery.js";
import { setMode } from "./controls.js";
import { curationSelections, memberThumbnail } from "./iiif.js";
import { isVRAvailable, enterVR } from "./xr.js";
import { t, getLang } from "./i18n.js";

const MODES = [
  { id: "thirdperson", key: "modeThird" },
  { id: "walk", key: "modeWalk" },
  { id: "orbit", key: "modeOrbit" },
];
let selectedMode = "thirdperson"; // 既定は三人称
let selectedEx = null; // 選択中の展示

export function setupEntranceUI() {
  $("#entrance-back").addEventListener("click", showEntrance);
  // 独自の IIIF URL を読み込む(?u= 経路を再利用してリロード。lang は維持)
  $("#entrance-url")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("#entrance-url-input").value.trim();
    if (!url) return;
    const lang = new URLSearchParams(location.search).get("lang");
    const qs = new URLSearchParams({ u: url });
    if (lang) qs.set("lang", lang);
    location.search = "?" + qs.toString();
  });
  $("#entrance-enter").addEventListener("click", () => {
    if (selectedEx) selectExhibition(selectedEx, selectedMode);
  });
  setupVrEnter();
  // 「例」ボタン: クリックで URL 入力欄にサンプル(Cookbook 等)を流し込む(送信はしない)
  const exUrl = G.cfg.exampleIiifUrl;
  const exBtn = $("#entrance-url-example");
  if (exUrl && exBtn) {
    exBtn.hidden = false;
    exBtn.addEventListener("click", () => {
      const input = $("#entrance-url-input");
      input.value = exUrl;
      input.focus();
    });
  }
  setupTutorial();
}

// ロビーの「VRで入室」ボタン。VR(WebXR)が使える時だけ表示し、使えない時は disabled でグレーアウト。
// VR ではアバターや一人称/三人称の区別は意味を持たない(入室時に無効化される)ため、選んだモードに
// 関係なく、選択中の展示をそのまま VR で開く。セッション要求は activation を保つためクリック内で発行する。
function setupVrEnter() {
  const btn = $("#entrance-enter-vr");
  if (!btn) return;
  isVRAvailable().then((ok) => {
    btn.hidden = false; // 対応・非対応どちらでも見せる(非対応はグレーアウトで理由を伝える)
    btn.disabled = !ok;
    if (!ok) btn.title = t("vrUnsupported");
  });
  btn.addEventListener("click", () => {
    if (btn.disabled || !selectedEx) return;
    $("#entrance").classList.remove("show");
    // ギャラリー構築を enterVR に渡す(セッション要求と並行させ、両方そろってから没入開始)。
    enterVR(() => buildGalleryFromSource(selectedEx.source, { resetView: true })).then(() => {
      $("#entrance-back").classList.add("show");
    }).catch((err) => {
      console.error(err);
      // 失敗時はロビーに戻して理由を出す(空の真っ暗な状態に取り残さない)
      $("#entrance").classList.add("show");
      $("#loading").style.display = "none";
    });
  });
}

// 動画ID を言語別に解決する。文字列ならそのまま、{ja,en} なら現在の言語(無ければ ja)を選ぶ。
function pickVideoId(conf) {
  if (!conf) return null;
  if (typeof conf === "string") return conf;
  return conf[getLang()] || conf.ja || Object.values(conf)[0] || null;
}

// 使い方/ツアー動画(YouTube埋め込み)モーダル。config.tutorialVideoId / tourVideoId があるとき出す。
// どちらも {ja,en} で言語別の動画を指定可。共有モーダル(#tut-modal)に開く。
function setupTutorial() {
  const close = () => {
    $("#tut-modal").classList.remove("show");
    $("#tut-embed").innerHTML = "";
  };
  // 各カード(ボタン)を配線。vid が無ければ非表示のまま。
  const wireCard = (btnSel, conf, labelKey) => {
    const vid = pickVideoId(conf);
    const btn = $(btnSel);
    if (!vid || !btn) return;
    btn.hidden = false;
    btn.style.backgroundImage = `url("https://img.youtube.com/vi/${vid}/hqdefault.jpg")`;
    btn.innerHTML = `<span class="play">▶</span><span class="cap">${escapeHtml(t(labelKey))}</span>`;
    btn.addEventListener("click", () => {
      // 開いた時だけ iframe を生成(閉じたら破棄して再生を止める)
      $("#tut-embed").innerHTML =
        `<iframe src="https://www.youtube.com/embed/${vid}?rel=0&autoplay=1" ` +
        `title="${labelKey}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>`;
      $("#tut-modal").classList.add("show");
    });
  };
  wireCard("#entrance-tut", G.cfg.tutorialVideoId, "tutWatch");
  wireCard("#entrance-tour", G.cfg.tourVideoId, "tourWatch");

  // モーダルの閉じる操作は一度だけ配線
  $("#tut-close").addEventListener("click", close);
  $("#tut-modal").addEventListener("click", (e) => { if (e.target.id === "tut-modal") close(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#tut-modal").classList.contains("show")) close();
  });
}

// config.exhibitions(後方互換: {title, subtitle, cover, source, controlMode})
export function buildEntrance(exhibitions, startMode) {
  renderEntrance(exhibitions, startMode);
}

// IIIF Curation の selection を1展示=1カードに(標準フォーマットだけで入口を構成)
export function buildEntranceFromCuration(url, doc, startMode) {
  const exhibitions = curationSelections(doc).map((s) => ({
    title: s.label,
    subtitle: t("countWorks").replace("{n}", String(s.count)),
    coverMember: s.first,
    source: { curation: url, selections: [s.index] },
  }));
  renderEntrance(exhibitions, startMode);
}

function renderEntrance(exhibitions, startMode) {
  selectedMode = MODES.some((m) => m.id === startMode) ? startMode : "thirdperson";
  selectedEx = exhibitions[0] || null;
  $("#entrance").classList.toggle("scroll", exhibitions.length > 6); // 展示が多い時は上詰めスクロール

  // モード選択
  const modeWrap = $("#entrance-modes");
  modeWrap.innerHTML = "";
  for (const m of MODES) {
    const btn = document.createElement("button");
    btn.className = "mode-pick" + (m.id === selectedMode ? " on" : "");
    btn.textContent = t(m.key);
    btn.addEventListener("click", () => {
      selectedMode = m.id;
      [...modeWrap.children].forEach((c) => c.classList.toggle("on", c === btn));
      updateCharVisibility();
    });
    modeWrap.appendChild(btn);
  }

  // 三人称のキャラ選択(man/girl)
  const charWrap = $("#entrance-chars");
  charWrap.innerHTML = "";
  for (const c of [{ id: "man", key: "charMan" }, { id: "girl", key: "charGirl" }]) {
    const btn = document.createElement("button");
    btn.className = "mode-pick" + (c.id === G.charKind ? " on" : "");
    btn.textContent = t(c.key);
    btn.addEventListener("click", () => {
      G.charKind = c.id;
      [...charWrap.children].forEach((x) => x.classList.toggle("on", x === btn));
    });
    charWrap.appendChild(btn);
  }
  updateCharVisibility();

  // 展示カード(クリックで選択。入室は専用ボタンで)
  const wrap = $("#entrance-cards");
  wrap.innerHTML = "";
  exhibitions.forEach((ex, i) => {
    const card = document.createElement("button");
    card.className = "ex-card" + (ex === selectedEx ? " on" : "");
    if (ex.cover) card.style.backgroundImage = `url("${ex.cover}")`;
    card.innerHTML =
      `<div class="ex-meta"><div class="ex-title">${escapeHtml(ex.title || "")}</div>` +
      (ex.subtitle ? `<div class="ex-sub">${escapeHtml(ex.subtitle)}</div>` : "") +
      `</div>`;
    card.addEventListener("click", () => {
      selectedEx = ex;
      [...wrap.children].forEach((c, j) => c.classList.toggle("on", j === i));
    });
    card.addEventListener("dblclick", () => selectExhibition(ex, selectedMode)); // ダブルクリックで即入室
    wrap.appendChild(card);
    if (!ex.cover && ex.coverMember) {
      memberThumbnail(ex.coverMember, 480).then((u) => {
        if (u) card.style.backgroundImage = `url("${u}")`;
      });
    }
  });
  showEntrance();
}

// キャラ選択は三人称のときだけ表示
function updateCharVisibility() {
  const el = $("#entrance-chars");
  if (el) el.style.display = selectedMode === "thirdperson" ? "flex" : "none";
}

export function showEntrance() {
  // ?u= など、ロビーに展示カードが無い経路から戻る場合は、ソース系クエリを外して
  // 再読込し、config の既定ロビーを作り直す(空のロビーで行き止まりにしない)。
  if (!$("#entrance-cards")?.querySelector(".ex-card")) {
    const q = new URLSearchParams(location.search);
    ["u", "curation", "collection", "manifest", "selections", "limit"].forEach((k) => q.delete(k));
    const qs = q.toString();
    location.search = qs ? "?" + qs : "";
    return;
  }
  if (G.mode !== "orbit") setMode("orbit");
  G.controls.autoRotate = false;
  clearGallery();
  $("#loading").style.display = "none";
  $("#entrance").classList.add("show");
  $("#entrance-back").classList.remove("show");
}

export async function selectExhibition(ex, mode) {
  $("#entrance").classList.remove("show");
  document.title = ex.title ? `${ex.title}｜${G.cfg.title || "IIIF Gallery"}` : G.cfg.title || "IIIF Gallery";
  try {
    await buildGalleryFromSource(ex.source, { resetView: true });
  } catch (err) {
    console.error(err);
    $("#loading").innerHTML = `<div class="err">${t("loadFailed")}<br>${escapeHtml(err.message)}</div>`;
    $("#loading").style.display = "flex";
    $("#entrance-back").classList.add("show"); // 失敗しても入口へ戻れるように
    return;
  }
  $("#entrance-back").classList.add("show"); // 入口経由で来たら「戻る」を出す
  const m = mode || ex.controlMode || G.cfg.controlMode || "orbit";
  if (m !== "orbit") setMode(m);
  else if (G.cfg.autoRotate !== false) G.controls.autoRotate = true;
}
