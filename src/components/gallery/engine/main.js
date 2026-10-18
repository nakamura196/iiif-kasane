// main.js — エントリポイント。config を読み、各モジュールを初期化し、描画ループを回す。
//
// 元サイト(法隆寺金堂壁画デジタルビューア)の「3D空間を見回し、絵に近づいてクリックで超高精細
// ズーム」体験を IIIF で再構成したビューア。構成は責務ごとに分割:
//   state.js  共有状態      scene.js   描画基盤+画質    room.js   展示室の3D
//   controls.js 操作(見回す/歩く)  viewer.js  深ズーム(OSD)   gallery.js 展示の構築/破棄
//   entrance.js 入口(展示選択)      iiif.js    IIIF 解決
//
// 元は nakamura196/iiif-vr-gallery の単独ページ。Kasane の /gallery/ に統合したため、
// startGallery(root) でページ内の要素に組み込み、stopGallery() で後片付けする。

import { G, $, resetState, escapeHtml } from "./state.js";
import { setLang, applyI18n, t } from "./i18n.js";
import { fetchJson, detectIiifType } from "./iiif.js";
import { setupScene, setupPostprocessing, onResize } from "./scene.js";
import { setupControls, setMode, updateWalk, updateThirdPerson, updateFlight, updateHover, clampCameraToRoom } from "./controls.js";
import { setupViewerUI } from "./viewer.js";
import { setupXR, bindXRInputSources, updateXR } from "./xr.js";
import { setupTourUI, updateTour, isTouring } from "./tour.js";
import { buildGalleryFromSource } from "./gallery.js";
import { setupIndexUI } from "./index.js";
import { setupEntranceUI, buildEntrance, buildEntranceFromCuration, selectExhibition } from "./entrance.js";
import CONFIG from "./config.json";

export { onResize };

// 起動中に window / document へ付けた操作の受け口。stopGallery() でまとめて外す
let listeners = [];
let stopped = false;

export function startGallery(root, { lang, basePath = "" } = {}) {
  stopped = false;
  resetState();
  G.root = root;
  G.basePath = basePath;
  return init(lang).catch((err) => {
    if (stopped) return;
    console.error(err);
    $("#loading").innerHTML = `<div class="err">${t("loadFailed")}<br>${escapeHtml(err.message)}</div>`;
    $("#loading").style.display = "flex";
    $("#entrance-back")?.classList.add("show");
  });
}

export function stopGallery() {
  stopped = true;
  for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
  listeners = [];
  try { G.renderer?.xr?.getSession?.()?.end(); } catch {}
  G.renderer?.setAnimationLoop(null);
  clearTimeout(G.idleTimer);
  try { G.osd?.destroy(); } catch {}
  G.osd = null;
  G.controls?.dispose();
  if (G.walkControls?.isLocked) G.walkControls.unlock();
  G.walkControls?.dispose();
  G.composer?.dispose?.();
  if (G.renderer) {
    G.renderer.dispose();
    G.renderer.forceContextLoss();
    G.renderer.domElement.remove();
  }
  document.body.style.cursor = "";
  G.root = null;
}

// 初期化の間だけ addEventListener を横取りし、付けたものを控えておく
function tracked(fn) {
  const targets = [window, document];
  const orig = targets.map((tg) => tg.addEventListener);
  targets.forEach((tg, i) => {
    tg.addEventListener = function (type, cb, opts) {
      listeners.push([tg, type, cb, opts]);
      return orig[i].call(tg, type, cb, opts);
    };
  });
  try {
    fn();
  } finally {
    targets.forEach((tg, i) => (tg.addEventListener = orig[i]));
  }
}

async function init(langOverride) {
  G.cfg = structuredClone(CONFIG);
  // 見本の展示などの相対パスは、元のサイトの置き場所(docs/)基準。Kasane では public/gallery/ に置く
  if (typeof G.cfg.source === "string" && G.cfg.source.startsWith("./"))
    G.cfg.source = `${G.basePath}/gallery/${G.cfg.source.slice(2)}`;
  // URLクエリで一部設定を上書き(デモ/共有用): ?quality=high|medium|low / ?vc=auto|always|off
  const q0 = new URLSearchParams(location.search);
  if (q0.get("quality")) G.cfg.quality = q0.get("quality");
  if (q0.get("vc")) G.cfg.virtualController = q0.get("vc");
  if (q0.get("walkSpeed")) G.cfg.walkSpeed = parseFloat(q0.get("walkSpeed")) || G.cfg.walkSpeed;
  // ?look=museum: 写真系美術館風(艶のある板床 + ライトボックス額装 + 床の映り込み + 発光グリッド天井)。
  // 参照写真に倣い什器(台座・ベンチ)は非表示にしてミニマルに。既定はOFF。
  if (q0.get("look") === "museum") {
    const r = (G.cfg.room = G.cfg.room || {});
    r.floorStyle = "wood"; r.floorReflectStreaks = true; r.frameStyle = "lightbox"; r.gridCeiling = true;
    r.pedestal = false; r.benches = false;
  }
  // 言語は Kasane の URL(/ja/ か /en/)に合わせる
  const lang = langOverride || q0.get("lang") || G.cfg.lang || navigator.language;
  setLang(lang);
  applyI18n();

  tracked(() => {
    setupScene();
    setupControls();
    setupPostprocessing();
    setupViewerUI();
    setupEntranceUI();
    setupXR();
    bindXRInputSources();
    setupQualityToggle();
    setupLookToggle();
    setupIndexUI();
    setupTourUI();
  });

  if (window.__DEBUG) exposeDebug();

  G.renderer.setAnimationLoop(loop); // WebXR は setAnimationLoop 必須

  // 入力ソースの決定(優先順): URLクエリ → config.source(IIIF URL) → config.exhibitions(後方互換) → config直下
  const q = new URLSearchParams(location.search);
  const url = q.get("u") || q.get("curation") || q.get("collection") || q.get("manifest") || G.cfg.source;
  const selParam = parseSelections(q.get("selections"));
  const limit = parseInt(q.get("limit") || "", 10);
  const startMode = q.get("walk") === "1" ? "walk" : q.get("mode") || G.cfg.controlMode;

  // 画質トグル等によるリロード直後は、保存した展示・モード・アバターで同じ展示室へ直接復帰
  // (ロビーに戻らない)。一度きり(読んだら破棄)なので通常のリロードは従来どおりロビーを出す。
  const reentry = readReentry();
  if (reentry && reentry.source) {
    if (reentry.char) G.charKind = reentry.char;
    await buildGalleryFromSource(reentry.source, { resetView: true });
    $("#loading").style.display = "none";
    $("#entrance-back").classList.add("show");
    setMode(reentry.mode || startMode);
    if ((reentry.mode || startMode) === "orbit" && G.cfg.autoRotate !== false) G.controls.autoRotate = true;
    return;
  }

  if (url) {
    await enterByUrl(url, { selections: selParam, limit: Number.isFinite(limit) ? limit : undefined, startMode });
    return;
  }

  const ex = G.cfg.exhibitions;
  if (Array.isArray(ex) && ex.length > 1) buildEntrance(ex);
  else if (Array.isArray(ex) && ex.length === 1) await selectExhibition(ex[0]);
  else {
    await buildGalleryFromSource(G.cfg, { resetView: true });
    $("#loading").style.display = "none";
    $("#entrance-back").classList.add("show");
    if (startMode === "walk") setMode("walk");
    else if (G.cfg.autoRotate !== false) G.controls.autoRotate = true;
  }
}

// 任意の IIIF URL を判定して入室。複数 selection を持つ Curation は入口(展示選択)を出す。
async function enterByUrl(url, { selections, limit, startMode } = {}) {
  let doc;
  try {
    doc = await fetchJson(url);
  } catch (err) {
    if (stopped) return;
    $("#loading").innerHTML = `<div class="err">${t("loadFailed")}<br>${escapeHtml(url)}<br>${escapeHtml(err.message)}</div>`;
    $("#loading").style.display = "flex";
    $("#entrance-back").classList.add("show"); // 失敗しても入口へ戻れるように
    return;
  }
  const multiSelectionCuration =
    detectIiifType(doc) === "curation" && (doc.selections || []).length > 1 && !selections;
  if (multiSelectionCuration) {
    buildEntranceFromCuration(url, doc, startMode);
    return;
  }
  await buildGalleryFromSource({ auto: url, selections, limit }, { resetView: true });
  $("#loading").style.display = "none";
  $("#entrance-back").classList.add("show");
  // 三人称は ?mode=thirdperson と書いたときだけ(ビューアの「ほかの表示」で選んで来る)。
  // config の controlMode(thirdperson)では従来どおり見回すで入る
  const explicit = new URLSearchParams(location.search).get("mode");
  if (startMode === "walk") setMode("walk");
  else if (explicit === "thirdperson") setMode("thirdperson");
  else if (G.cfg.autoRotate !== false) G.controls.autoRotate = true;
}

const REENTRY_KEY = "vrgallery:reentry";
// 画質トグルのリロードで保存した再入室情報を一度だけ読む(読んだら破棄)
function readReentry() {
  try {
    const s = sessionStorage.getItem(REENTRY_KEY);
    sessionStorage.removeItem(REENTRY_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function parseSelections(s) {
  if (!s) return null;
  const a = s.split(",").map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
  return a.length ? a : null;
}

// ギャラリー内の画質トグル: auto→high→medium→low を巡回(?quality= でリロード)。
function setupQualityToggle() {
  const btn = $("#quality-toggle");
  if (!btn) return;
  const order = ["auto", "high", "medium", "low"];
  const cur = (G.cfg.quality || "auto");
  btn.textContent = t("quality") + " " + cur + (cur === "auto" && G.quality ? "(" + G.quality + ")" : "");
  btn.addEventListener("click", () => {
    const next = order[(order.indexOf(cur) + 1) % order.length];
    const q = new URLSearchParams(location.search);
    if (next === "auto") q.delete("quality"); else q.set("quality", next);
    // 現在の展示・モード・アバターを保存し、リロード後に同じ展示室へ直接復帰させる
    try {
      sessionStorage.setItem(
        REENTRY_KEY,
        JSON.stringify({ source: G.entrySource || null, mode: G.mode, char: G.charKind })
      );
    } catch {}
    location.search = q.toString();
  });
  // ギャラリー入室中だけ表示(入口では隠す) — entrance の表示状態で切替
  const sync = () => btn.classList.toggle("show", !$("#entrance").classList.contains("show"));
  new MutationObserver(sync).observe($("#entrance"), { attributes: true, attributeFilter: ["class"] });
  sync();
}

// 内装トグル: 標準 ↔ 写真館(?look=museum でリロード)。画質トグルと同じく展示を保ったまま再入室。
function setupLookToggle() {
  const btn = $("#look-toggle");
  if (!btn) return;
  const isMuseum = new URLSearchParams(location.search).get("look") === "museum";
  btn.textContent = isMuseum ? t("lookMuseum") : t("lookStandard");
  btn.addEventListener("click", () => {
    const q = new URLSearchParams(location.search);
    if (isMuseum) q.delete("look"); else q.set("look", "museum");
    try {
      sessionStorage.setItem(
        REENTRY_KEY,
        JSON.stringify({ source: G.entrySource || null, mode: G.mode, char: G.charKind })
      );
    } catch {}
    location.search = q.toString();
  });
  const sync = () => btn.classList.toggle("show", !$("#entrance").classList.contains("show"));
  new MutationObserver(sync).observe($("#entrance"), { attributes: true, attributeFilter: ["class"] });
  sync();
}

function loop() {
  const dt = Math.min(G.clock.getDelta(), 0.05);
  if (G.xrPresenting) {
    updateXR(dt);
    if (G.mixer) G.mixer.update(dt);
    G.renderer.render(G.scene, G.camera); // XR 中はポスト処理を使わない
    return;
  }
  // 録画ツアー中はカメラを直接駆動する(通常操作・ホバーは止める)。描画は通常経路のまま
  // (composer.render が canvas を更新 → captureStream が録れる。ブルーム等の演出も乗る)。
  if (isTouring()) {
    updateTour(dt);
    G.composer.render();
    return;
  }
  updateFlight(dt);
  updateWalk(dt);
  updateThirdPerson(dt);
  if (G.mode === "orbit" || G.mode === "thirdperson") {
    G.controls.update();
    clampCameraToRoom();
  }
  updateHover();
  G.composer.render();
}

// puppeteer 等での検証用フック(window.__DEBUG 時のみ)
function exposeDebug() {
  window.__camera = () => G.camera;
  window.__getMode = () => G.mode;
  window.__walkBounds = () => G.walkBounds;
  window.__getPickables = () => G.pickables;
  window.__avatar = () => G.avatar;
  window.__charLoaded = () => !!G.mixer;
  window.__setCam = (p, t) => {
    G.controls.autoRotate = false;
    G.camera.position.set(p[0], p[1], p[2]);
    G.controls.target.set(t[0], t[1], t[2]);
    G.controls.update();
  };
  window.__openFirst = () => {
    const m = G.pickables[0];
    if (m) import("./viewer.js").then(({ openViewer }) => openViewer(m.userData.wallCfg, m.userData.resolved));
  };
  window.__selectExhibition = (i) => selectExhibition((G.cfg.exhibitions || [])[i]);
}
