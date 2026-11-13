#!/usr/bin/env node
// Smithsonian Voyager のシーン（svx、document.json）を IIIF Presentation 4.0 の Manifest に変換する。
//
//   node scripts/svx-to-iiif.mjs <svx の URL かファイル> --id <書き出す Manifest の URL> [--out file.json]
//     [--base <模型の置き場の URL>] [--quality Low|Medium|High] [--lang EN] [--rights <URL>]
//
// 例（スミソニアンのトリケラトプス）:
//   node scripts/svx-to-iiif.mjs https://3d-api.si.edu/content/document/3d_package:d8c623be-4ebc-11ea-b77f-2e728ce88125/document.json \
//     --id https://kasane.ldas.jp/manifests/si-triceratops.json --out public/manifests/si-triceratops.json \
//     --rights http://creativecommons.org/publicdomain/zero/1.0/
//
// 置き換えの規則:
// - 模型: Web3D の派生のうち --quality（既定 Medium）の glb を painting にする。
//   svx の model の translation・rotation（四元数）・scale と、模型を置くノードの分を、
//   IIIF の ScaleTransform → RotateTransform → TranslateTransform に直す（three.js の T·R·S と同じ順）。
// - 視点: Voyager のナビゲーションは原点の周りを回る。orbit = [pitch, head, roll]（度）、
//   offset = [x, y, 距離]。カメラの行列は Rz(roll)·Ry(head)·Rx(pitch) に、R·offset の移動を足したもの
//   （dpo-voyager の libs/ff-three/source/math.ts の composeOrbitMatrix）。
//   カメラは自分の -Z を向くので、位置は R·offset、見る点は R·(x, y, 0)。roll は IIIF の lookAt では書けないので捨てる。
// - ツアー: setups[0].tours の各段 → behavior: sequence の AnnotationPage の describing 注釈。
//   段の視点は、隠した（behavior: hidden）PerspectiveCamera を scope で指す。
//   本文は段の題と、段で開く注釈の説明（無ければ記事の説明）。記事の HTML そのものは取り込まない。
// - 注釈: models[].annotations → commenting の注釈（PointSelector は模型の変換をかけた位置）。
//   viewId があれば、その視点のカメラを scope で指す。
// - 光・shader・exposure・場面の切り替わりの速さは、IIIF に当たるものが無いので捨てる。

import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const src = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const manifestId = opt('id');
if (!src || !manifestId) {
  console.error('使い方: node scripts/svx-to-iiif.mjs <svx の URL かファイル> --id <Manifest の URL> [--out file.json]');
  process.exit(1);
}
const quality = opt('quality', 'Medium');
const lang = opt('lang', 'EN');
const rights = opt('rights');
const base = opt('base', /^https?:/.test(src) ? new URL('.', src).href : undefined);

const svx = JSON.parse(/^https?:/.test(src) ? await (await fetch(src)).text() : await readFile(src, 'utf8'));

// ---- 行列（3x3 は行の配列、m[行][列]）----
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const round = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;
const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
const apply3 = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const add = (a, b) => a.map((x, i) => x + b[i]);

// Rz(roll)·Ry(head)·Rx(pitch)。Kasane の RotateTransform（x → y → z の順に回す）と同じ形
const eulerMatrix = ([x, y, z]) => {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return mul3(Rz, mul3(Ry, Rx));
};
const quatMatrix = ([x, y, z, w]) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
];
// R = Rz·Ry·Rx から x, y, z（ラジアン）を取り出す
const matrixEuler = (m) => {
  const y = Math.asin(Math.max(-1, Math.min(1, -m[2][0])));
  if (Math.abs(m[2][0]) < 0.9999999) return [Math.atan2(m[2][1], m[2][2]), y, Math.atan2(m[1][0], m[0][0])];
  return [Math.atan2(-m[1][2], m[1][1]), y, 0];
};

// 平行移動・回転・拡大（three.js の T·R·S）。合成は親 · 子
const trs = (o = {}) => ({
  t: o.translation ?? [0, 0, 0],
  r: o.rotation ? quatMatrix(o.rotation) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  s: o.scale ?? [1, 1, 1],
});
const scaleM = (s) => [[s[0], 0, 0], [0, s[1], 0], [0, 0, s[2]]];
// 一様な拡大だけを扱う（Voyager の模型はふつう一様）
const compose = (p, c) => ({
  t: add(p.t, apply3(mul3(p.r, scaleM(p.s)), c.t)),
  r: mul3(p.r, c.r),
  s: p.s.map((v, i) => v * c.s[i]),
});
const applyTrs = (m, v) => add(m.t, apply3(m.r, v.map((x, i) => x * m.s[i])));

// 単位: シーンの単位に模型の単位を合わせる
const UNIT = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 };

// ---- svx を読む ----
const scene = svx.scenes[svx.scene ?? 0];
const sceneUnit = UNIT[scene.units] ?? 1;
const setup = svx.setups?.[scene.setup ?? 0] ?? {};
const meta = svx.metas?.[scene.meta] ?? {};
const text = (o, key) => o?.[`${key}s`]?.[lang] ?? o?.[key] ?? '';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 模型を置くノードを、親からの変換をかけながら探す
const placements = [];
const walk = (index, parent) => {
  const node = svx.nodes[index];
  const m = compose(parent, trs(node));
  if (node.model !== undefined) placements.push({ node, model: svx.models[node.model], matrix: m });
  for (const c of node.children ?? []) walk(c, m);
};
for (const n of scene.nodes) walk(n, trs());

const sceneId = `${manifestId}/scene/1`;
const sceneRef = { id: sceneId, type: 'Scene' };
const painting = [];
const comments = [];
const tour = [];

placements.forEach(({ node, model, matrix }, i) => {
  const unit = (UNIT[model.units] ?? sceneUnit) / sceneUnit;
  const m = compose(matrix, { ...trs(model), s: (model.scale ?? [1, 1, 1]).map((v) => v * unit) });
  model.__matrix = m;
  const derivs = model.derivatives.filter((d) => d.usage === 'Web3D');
  const d = derivs.find((x) => x.quality === quality) ?? derivs.find((x) => x.quality === 'Medium') ?? derivs[0];
  const uri = d.assets.find((a) => a.type === 'Model' || /\.glb$/i.test(a.uri)).uri;
  const transform = [];
  if (m.s.some((v) => Math.abs(v - 1) > 1e-9)) transform.push({ type: 'ScaleTransform', x: round(m.s[0]), y: round(m.s[1]), z: round(m.s[2]) });
  const [rx, ry, rz] = matrixEuler(m.r).map((a) => round(deg(a)));
  if (rx || ry || rz) transform.push({ type: 'RotateTransform', x: rx, y: ry, z: rz });
  if (m.t.some((v) => v !== 0)) transform.push({ type: 'TranslateTransform', x: round(m.t[0]), y: round(m.t[1]), z: round(m.t[2]) });
  painting.push({
    id: `${sceneId}/model/${i + 1}`,
    type: 'Annotation',
    motivation: ['painting'],
    body: {
      type: 'SpecificResource',
      source: { id: new URL(uri, base).href, type: 'Model', format: 'model/gltf-binary', label: { en: [node.name ?? `model ${i + 1}`] } },
      ...(transform.length ? { transform } : {}),
    },
    target: sceneRef,
  });
});

// ---- 視点（snapshots の state）→ 隠したカメラ ----
const snap = setup.snapshots ?? { targets: [], states: [] };
const at = (suffix) => snap.targets.findIndex((t) => t.endsWith(suffix));
const iOrbit = at('navigation/orbit');
const iOffset = at('navigation/offset');
const iAnno = at('viewer/activeAnnotation');
const iArticle = at('reader/articleId');
const states = new Map(snap.states.map((s) => [s.id, s]));
const fov = svx.cameras?.[0]?.perspective?.yfov;
const cameraIds = new Map();

const cameraFor = (stateId) => {
  if (cameraIds.has(stateId)) return cameraIds.get(stateId);
  const s = states.get(stateId);
  const orbit = s?.values[iOrbit];
  const offset = s?.values[iOffset];
  if (!orbit || !offset) return null;
  const R = eulerMatrix(orbit.map(rad));
  const position = apply3(R, offset);
  const lookAt = apply3(R, [offset[0], offset[1], 0]);
  const id = `${sceneId}/cameras/${cameraIds.size + 1}`;
  painting.push({
    id,
    type: 'Annotation',
    motivation: ['painting'],
    // 開いたときの視点だけ見せ、ほかは段や注釈から呼ぶために隠す
    ...(stateId === '__initial' ? {} : { behavior: ['hidden'] }),
    body: {
      id: `${id}/body`,
      type: 'PerspectiveCamera',
      ...(fov ? { fieldOfView: fov } : {}),
      lookAt: { type: 'PointSelector', x: round(lookAt[0]), y: round(lookAt[1]), z: round(lookAt[2]) },
    },
    target: {
      type: 'SpecificResource',
      source: sceneRef,
      selector: [{ type: 'PointSelector', x: round(position[0]), y: round(position[1]), z: round(position[2]) }],
    },
  });
  cameraIds.set(stateId, id);
  return id;
};

// 開いている視点（setup の navigation）を最初のカメラにする
const nav = setup.navigation?.orbit;
if (nav) {
  states.set('__initial', { id: '__initial', values: Object.assign([], { [iOrbit]: nav.orbit, [iOffset]: nav.offset }) });
  cameraFor('__initial');
}

// ---- 注釈 ----
const annotationsById = new Map();
for (const { model } of placements) {
  for (const a of model.annotations ?? []) {
    annotationsById.set(a.id, a);
    const p = applyTrs(model.__matrix, a.position);
    const cam = a.viewId ? cameraFor(a.viewId) : null;
    const lead = text(a, 'lead');
    comments.push({
      id: `${sceneId}/annotations/${a.id}`,
      type: 'Annotation',
      motivation: ['commenting'],
      label: { en: [text(a, 'title')] },
      body: { type: 'TextualBody', value: lead.trim() || text(a, 'title'), format: 'text/plain', language: lang.toLowerCase() },
      target: {
        type: 'SpecificResource',
        source: sceneRef,
        selector: [{ type: 'PointSelector', x: round(p[0]), y: round(p[1]), z: round(p[2]) }],
      },
      ...(cam ? { scope: [{ id: cam, type: 'Annotation' }] } : {}),
    });
  }
}

// ---- ツアー ----
const articles = new Map((meta.articles ?? []).map((a) => [a.id, a]));
const tours = Array.isArray(setup.tours) ? setup.tours : setup.tours?.tours ?? [];
const t0 = tours[0];
for (const step of t0?.steps ?? []) {
  const s = states.get(step.id);
  const anno = s && annotationsById.get(s.values[iAnno]);
  const article = s && articles.get(s.values[iArticle]);
  const lead = (anno && text(anno, 'lead')) || (article && text(article, 'lead')) || '';
  const cam = cameraFor(step.id);
  tour.push({
    id: `${sceneId}/tour/${step.id}`,
    type: 'Annotation',
    motivation: ['describing'],
    body: {
      type: 'TextualBody',
      value: `<h2>${esc(text(step, 'title'))}</h2>${lead.trim() ? `<p>${esc(lead.trim())}</p>` : ''}`,
      format: 'text/html',
      language: lang.toLowerCase(),
    },
    target: sceneRef,
    ...(cam ? { scope: [{ id: cam, type: 'Annotation' }] } : {}),
  });
}

// ---- Manifest ----
const title = text(t0, 'title') || meta.collection?.title || scene.name || 'Voyager scene';
const manifest = {
  '@context': 'http://iiif.io/api/presentation/4/context.json',
  id: manifestId,
  type: 'Manifest',
  label: { en: [meta.collection?.title ?? title] },
  ...(text(t0, 'lead') ? { summary: { en: [text(t0, 'lead')] } } : {}),
  ...(rights ? { rights } : {}),
  requiredStatement: {
    label: { en: ['Source'] },
    value: { en: [`Converted from a Smithsonian Voyager scene (${/^https?:/.test(src) ? src : 'svx'}) by Kasane's svx-to-iiif.mjs. ${svx.asset?.copyright ?? ''}`.trim()] },
  },
  ...(/^https?:/.test(src) ? { seeAlso: [{ id: src, type: 'Dataset', format: 'application/json', label: { en: ['Voyager scene (svx)'] } }] } : {}),
  items: [
    {
      id: sceneId,
      type: 'Scene',
      label: { en: [scene.name ?? title] },
      items: [{ id: `${sceneId}/page/1`, type: 'AnnotationPage', items: painting }],
      annotations: [
        ...(comments.length ? [{ id: `${sceneId}/annotations`, type: 'AnnotationPage', items: comments }] : []),
        ...(tour.length ? [{ id: `${sceneId}/tour`, type: 'AnnotationPage', label: { en: [title] }, behavior: ['sequence'], items: tour }] : []),
      ],
    },
  ],
};

const out = opt('out');
const json = `${JSON.stringify(manifest, null, 1)}\n`;
if (out) await writeFile(out, json);
else process.stdout.write(json);
console.error(`模型 ${placements.length}・カメラ ${cameraIds.size}・注釈 ${comments.length}・ツアーの段 ${tour.length}`);
