// iiif.js — IIIF Image / Presentation API helpers.
//
// 役割:
//  - 個別の IIIF Image service を解決して、サムネURL・寸法・深ズーム用 tileSource を出す
//  - IIIF Presentation Manifest / Collection を読み、含まれる画像を「壁ソース」の配列に変換
//
// IIIF Image API も Presentation API も v2/v3 の両方を相手にする。

/** 末尾の /info.json や / を落として image service の base id にそろえる */
import { t, getLang } from "./i18n.js";

// 外部サーバを待つ上限。応答しないサーバ（接続も拒否もしない）でも、ここで打ち切って
// 「読み込めません」を出す。打ち切らないとブラウザがあきらめるまで数分、黒い画面のままになる。
const FETCH_TIMEOUT_MS = 15000;

/** 待ち時間の上限つき fetch。打ち切り・通信失敗は、どのサーバかが分かる文言の Error にする */
export async function fetchWithTimeout(url, opts = {}) {
  let host = url;
  try { host = new URL(url, location.href).host; } catch {}
  try {
    return await fetch(url, { mode: "cors", ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(t("serverTimeout").replace("{host}", host));
    }
    throw new Error(t("serverUnreachable").replace("{host}", host));
  }
}

export function imageServiceBase(idOrInfo) {
  return idOrInfo.replace(/\/info\.json$/i, "").replace(/\/$/, "");
}

/**
 * 多言語ラベル (v3 の {en:[...]}) や v2 の文字列/配列をプレーン文字列に。
 * 言語マップは、ページの言語 → none → en → 最初の言語、の順に選ぶ
 * (packages/iiif-viewer の labelIn と同じ順)。locale を省略するとページの言語。
 */
export function plainLabel(label, locale = getLang()) {
  if (!label) return "";
  if (typeof label === "string") return label;
  if (Array.isArray(label)) return plainLabel(label[0], locale);
  if (typeof label === "object") {
    if ("@value" in label) return plainLabel(label["@value"], locale);
    for (const lang of [locale, "none", "en", ...Object.keys(label)]) {
      const v = label[lang];
      if (Array.isArray(v) && v.length > 0) return plainLabel(v[0], locale);
      if (typeof v === "string") return v;
    }
    return "";
  }
  return String(label);
}

/**
 * 1つの壁ソース(config の source、もしくは manifest 抽出物)を、描画に必要な形へ解決する。
 * 返り値: { type, infoUrl|url, width, height, thumb(maxPx), osdTileSource }
 */
export async function resolveSource(source) {
  const type = source.type || "iiif";

  if (type === "iiif") {
    const base = imageServiceBase(source.id || source.infoJson || source.url);
    const infoUrl = base + "/info.json";
    const info = await fetchWithTimeout(infoUrl).then((r) => {
      if (!r.ok) throw new Error(`info.json ${r.status}: ${infoUrl}`);
      return r.json();
    });
    let width = info.width;
    let height = info.height;

    // 切り抜き(#xywh 由来)。サムネはその領域だけを要求し、縦横比も領域から取る。
    let region = null;
    if (source.region) {
      const [x, y, w, h] = (Array.isArray(source.region) ? source.region : String(source.region).split(",")).map(Number);
      if ([x, y, w, h].every((v) => Number.isFinite(v)) && w > 0 && h > 0) {
        region = { x, y, w, h, imgW: info.width, imgH: info.height };
        width = w;
        height = h;
      }
    }

    return {
      type,
      base,
      infoUrl,
      width,
      height,
      region,
      // OpenSeadragon には info.json の URL を渡す(OSD が取得して IIIF と判定する)。
      // パース済みオブジェクトを直接渡すと版によって IIIF と認識されないため URL 文字列にする。
      osdTileSource: infoUrl,
      thumb: (maxPx) =>
        region
          ? `${base}/${region.x},${region.y},${region.w},${region.h}/${maxPx},/0/default.jpg`
          : `${base}/full/${maxPx},/0/default.jpg`,
    };
  }

  if (type === "image") {
    // 単一の通常画像(IIIF Image Service なし)。サーバ側リサイズができないため、
    // 3D 壁テクスチャには軽い thumbnail があればそれを使い、深ズーム(OSD)には原寸 URL を使う。
    return {
      type,
      url: source.url,
      width: source.width || null,
      height: source.height || null,
      osdTileSource: { type: "image", url: source.url },
      thumb: () => source.thumbUrl || source.url,
    };
  }

  if (type === "dzi") {
    return {
      type,
      url: source.url,
      width: source.width || null,
      height: source.height || null,
      osdTileSource: source.url, // .dzi の URL を渡す
      thumb: () => source.thumb || source.url,
    };
  }

  throw new Error(`unknown source type: ${type}`);
}

/** v2/v3 どちらの Canvas からでも image service の id を取り出す */
function imageServiceFromCanvas(canvas) {
  // ---- v2: canvas.images[].resource.service['@id'] ----
  const imgs = canvas.images || canvas.resources;
  if (imgs && imgs[0]) {
    const res = imgs[0].resource || imgs[0];
    const svc = res.service;
    const id = serviceId(svc);
    if (id) return id;
    // service が無くても resource 自体が画像URLのことがある
    if (res["@id"] || res.id) return null; // 画像直URLは深ズーム不可なので扱わない
  }
  // ---- v3: canvas.items[0].items[0].body.service[0].id ----
  const ap = canvas.items?.[0]?.items?.[0];
  const body = ap?.body;
  if (body) {
    const id = serviceId(body.service);
    if (id) return id;
  }
  return null;
}

/**
 * Canvas から描画用ソースを1つ取り出す。
 * IIIF Image Service があれば深ズーム可能な {type:'iiif', id} を、
 * 無ければ静的画像の直 URL を {type:'image', url, width, height, thumbUrl} として返す。
 * どちらも取れなければ null。
 */
function canvasSource(canvas, fallbackThumb = null) {
  // 3D の Scene には壁に掛ける画像が無い。Scene(無ければ Manifest)の thumbnail を絵として掛ける
  if (/Scene/i.test(canvas.type || "")) {
    const t = thumbnailImage(canvas) || fallbackThumb;
    return t ? { type: "image", ...t, thumbUrl: t.url } : null;
  }
  const id = imageServiceFromCanvas(canvas);
  if (id) return { type: "iiif", id };
  const img = plainImageFromCanvas(canvas);
  if (!img) return null;
  return { type: "image", ...img, thumbUrl: img.thumbUrl || fallbackThumb?.url || null };
}

/** service を持たない Canvas から静的画像 URL と寸法・サムネを拾う(v2/v3) */
function plainImageFromCanvas(canvas) {
  // v2: images[0].resource  /  v3: items[0].items[0].body
  const v3 = canvas.items?.[0]?.items?.[0]?.body;
  const v2 = (canvas.images || canvas.resources)?.[0]?.resource;
  let body = v3 || v2;
  if (Array.isArray(body)) body = body[0];
  const url = body?.id || body?.["@id"];
  if (!url) return null;
  return {
    url,
    width: body.width || canvas.width || null,
    height: body.height || canvas.height || null,
    thumbUrl: thumbnailUrl(canvas),
  };
}

/** thumbnail 配列/オブジェクトから先頭 URL を取り出す(v2/v3) */
function thumbnailUrl(node) {
  const t = node?.thumbnail;
  const first = Array.isArray(t) ? t[0] : t;
  if (!first) return null;
  if (typeof first === "string") return first;
  return first.id || first["@id"] || null;
}

/** thumbnail の先頭を { url, width, height } で(寸法が無ければ null) */
function thumbnailImage(node) {
  const url = thumbnailUrl(node);
  if (!url) return null;
  const t = Array.isArray(node.thumbnail) ? node.thumbnail[0] : node.thumbnail;
  return { url, width: t?.width || null, height: t?.height || null };
}

function serviceId(svc) {
  if (!svc) return null;
  const s = Array.isArray(svc) ? svc.find((x) => isImageService(x)) || svc[0] : svc;
  if (!s) return null;
  return imageServiceBase(s.id || s["@id"] || "");
}

function isImageService(s) {
  const t = s.type || s["@type"] || "";
  const profile = JSON.stringify(s.profile || "");
  return /ImageService/i.test(t) || /image\/\d/.test(profile) || !!(s.id || s["@id"]);
}

export async function fetchJson(url) {
  let r;
  try {
    r = await fetchWithTimeout(url);
  } catch (err) {
    // https のページからは http を読めない(CODH の見本の within など)。https で取り直す
    if (!/^http:\/\//i.test(url)) throw err;
    return fetchJson(url.replace(/^http:/i, "https:"));
  }
  if (!r.ok) throw new Error(`${r.status}: ${url}`);
  return r.json();
}

/** ドキュメントの種別を判定: "curation" | "collection" | "manifest" */
export function detectIiifType(doc) {
  const t = String(doc["@type"] || doc.type || "").toLowerCase();
  if (doc.selections || t.includes("curation")) return "curation";
  if (doc.manifests || doc.collections || t.includes("collection")) return "collection";
  return "manifest";
}

/** 任意の IIIF URL を種別判定して壁配列に解決(?u= 用)。curation は selections で絞り込み可。 */
export async function loadAuto(url, opts = {}) {
  const doc = await fetchJson(url);
  const type = detectIiifType(doc);
  if (type === "curation") return parseCurationDoc(doc, opts);
  if (type === "collection") return loadCollection(url, opts);
  return parseManifestDoc(doc, { ...opts, url });
}

/** Manifest URL → 壁ソース配列 [{ label, by, source:{type:'iiif', id} }] */
export async function loadManifest(url, opts = {}) {
  return parseManifestDoc(await fetchJson(url), { ...opts, url });
}

function parseManifestDoc(m, { limit = 24, url = null } = {}) {
  const manifestUrl = url || m["@id"] || m.id || null;
  const manLabel = plainLabel(m.label);
  const meta = extractMeta(m);
  // v2: sequences[0].canvases  /  v3: items
  const canvases = m.sequences?.[0]?.canvases || m.items || [];
  const manThumb = thumbnailImage(m);
  const walls = [];
  for (const c of canvases) {
    const source = canvasSource(c, manThumb);
    if (!source) continue;
    walls.push({
      label: plainLabel(c.label) || manLabel,
      by: manLabel,
      source,
      meta,
      origin: originOf(manifestUrl, c["@id"] || c.id),
    });
    if (walls.length >= limit) break;
  }
  if (!walls.length) throw new Error(t("noImagesIn").replace("{kind}", "manifest"));
  return walls;
}

/** Collection URL → 各 Manifest の代表(先頭)画像を1枚ずつ集めて壁ソース配列に */
export async function loadCollection(url, { limit = 24 } = {}) {
  const col = await fetchWithTimeout(url).then((r) => {
    if (!r.ok) throw new Error(`collection ${r.status}: ${url}`);
    return r.json();
  });
  // v2: manifests[]  /  v3: items[](type:Manifest)
  const entries =
    col.manifests ||
    (col.items || []).filter((x) => /Manifest/i.test(x.type || x["@type"] || ""));
  const walls = [];
  for (const e of entries) {
    if (walls.length >= limit) break;
    const murl = e["@id"] || e.id;
    if (!murl) continue;
    try {
      const first = (await loadManifest(murl, { limit: 1 }))[0];
      if (first) {
        first.label = plainLabel(e.label) || first.label;
        walls.push(first);
      }
    } catch (err) {
      console.warn("collection: skip manifest", murl, err.message);
    }
  }
  if (!walls.length) throw new Error(t("noImagesIn").replace("{kind}", "collection"));
  return walls;
}

/**
 * IIIF Curation (cr:Curation, CODH/IIIF Curation Viewer 形式) URL → 壁ソース配列。
 * 各メンバーは canvas @id(#xywh で切り抜き) + manifest を持つので、manifest から
 * image service を引き、切り抜き領域つきの単品画像にする。
 * opts.selections: 使う selection の添字配列(省略時は全部)。opts.limit: 最大枚数。
 */
export async function loadCuration(url, opts = {}) {
  return parseCurationDoc(await fetchJson(url), opts);
}

async function parseCurationDoc(cur, { selections = null, limit = 64 } = {}) {
  const sels = cur.selections || [];
  const chosen = selections ? selections.map((i) => sels[i]).filter(Boolean) : sels;
  const members = chosen.flatMap(selectionMembers);
  const walls = await resolveCurationMembers(members, { limit });
  if (!walls.length) throw new Error(t("noImagesIn").replace("{kind}", "curation"));
  return walls;
}

// curation メンバー(canvas@id #xywh + manifest)→ 切り抜き付き壁ソースに解決
async function resolveCurationMembers(members, { limit = 64 } = {}) {
  const manifestCache = new Map();
  const getManifest = (u) => {
    if (!manifestCache.has(u)) manifestCache.set(u, fetchJson(u));
    return manifestCache.get(u);
  };
  // 異なる manifest を多数含む curation でも速いよう、ユニークな manifest を先に並列取得
  const uniqueManifests = [...new Set(members.map((m) => m.manifest).filter(Boolean))];
  const settled = await Promise.allSettled(uniqueManifests.map(getManifest));
  // manifest が 1 つも取れなければ、「画像を抽出できません」ではなく取れなかった理由を出す
  const firstFailure = settled.find((r) => r.status === "rejected");
  if (firstFailure && settled.every((r) => r.status === "rejected")) throw firstFailure.reason;

  const walls = [];
  for (const m of members) {
    if (walls.length >= limit) break;
    try {
      const { baseId, xywh } = splitCanvasId(m["@id"] || m.id || "");
      if (!m.manifest) continue;
      const man = await getManifest(m.manifest);
      const canvases = man.sequences?.[0]?.canvases || man.items || [];
      const canvas = canvases.find((c) => (c["@id"] || c.id) === baseId);
      if (!canvas) continue;
      const svc = imageServiceFromCanvas(canvas);
      if (!svc) continue;
      walls.push({
        label: plainLabel(m.label) || plainLabel(canvas.label),
        by: cleanDescription(m.description),
        source: { type: "iiif", id: svc, region: xywh },
        meta: extractMeta(man),
        origin: originOf(m.manifest, m["@id"] || m.id),
      });
    } catch (err) {
      console.warn("curation member skip:", err.message);
    }
  }
  return walls;
}

// selection のメンバーを {@id, manifest, label, description} にそろえる。
// CODH の見本のように、manifest をメンバーではなく selection の within に書く形や、
// canvases を canvas @id の文字列の配列で書く形もある。
function selectionMembers(sel) {
  const within = sel.within;
  const selManifest = typeof within === "string" ? within : within?.["@id"] || within?.id || null;
  return (sel.members || sel.canvases || []).map((m) => {
    const member = typeof m === "string" ? { "@id": m } : m;
    if (!member || member.manifest || !selManifest) return member;
    return { ...member, manifest: selManifest };
  }).filter(Boolean);
}

// 元の資料(マニフェストと Canvas。Canvas は #xywh 付きのこともある)。
// 拡大表示の「Kasane で開く」が使う。どちらかが分からなければ null
function originOf(manifest, canvas) {
  return manifest && canvas ? { manifest, canvas } : null;
}

function splitCanvasId(cid) {
  const hash = cid.indexOf("#");
  const baseId = hash >= 0 ? cid.slice(0, hash) : cid;
  const frag = hash >= 0 ? cid.slice(hash + 1) : "";
  const xywh = (frag.match(/xywh=([\d.,]+)/) || [])[1] || null;
  return { baseId, xywh };
}

// 入口生成用: curation の各 selection の概要(ラベル・点数・先頭メンバー)を返す
export function curationSelections(doc) {
  return (doc.selections || []).map((s, index) => {
    const members = selectionMembers(s);
    return { index, label: plainLabel(s.label) || t("exhibitionN").replace("{n}", String(index + 1)), count: members.length, first: members[0] };
  });
}

// 入口カードの表紙: 1メンバーを解決して切り抜きサムネ URL を得る(best-effort)
export async function memberThumbnail(member, px = 480) {
  try {
    const { baseId, xywh } = splitCanvasId(member["@id"] || member.id || "");
    if (!member.manifest) return null;
    const man = await fetchJson(member.manifest);
    const canvases = man.sequences?.[0]?.canvases || man.items || [];
    const canvas = canvases.find((c) => (c["@id"] || c.id) === baseId);
    if (!canvas) return null;
    const base = imageServiceFromCanvas(canvas);
    if (!base) return null;
    return xywh ? `${base}/${xywh}/${px},/0/default.jpg` : `${base}/full/${px},/0/default.jpg`;
  } catch {
    return null;
  }
}

// manifest から 権利表記・帰属・メタデータを取り出す(v2/v3)。表示用パネルに使う。
export function extractMeta(man) {
  if (!man || typeof man !== "object") return null;
  const rs = man.requiredStatement;
  const required = rs ? plainLabel(rs.value) : plainLabel(man.attribution);
  const requiredLabel = rs ? plainLabel(rs.label) : "";
  const rights = typeof man.rights === "string" ? man.rights
    : typeof man.license === "string" ? man.license
    : Array.isArray(man.license) ? man.license[0] : "";
  const metadata = (man.metadata || [])
    .map((e) => ({ label: plainLabel(e.label), value: plainLabel(e.value) }))
    .filter((e) => e.label || e.value)
    .slice(0, 8);
  const source = man["@id"] || man.id || "";
  return { required, requiredLabel, rights, metadata, source };
}

function cleanDescription(d) {
  return plainLabel(d).replace(/[\s　]*から[\s　]*$/, "").replace(/[\s　]+$/, "").trim();
}
