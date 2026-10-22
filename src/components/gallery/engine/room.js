// room.js — 展示室の3D構築: 配置計算(layoutWalls)・部屋(buildRoom)・作品(addArtwork)・銘板(makePlate)。
// 生成物はすべて G.galleryRoot 配下に追加し、展示の切替時にまとめて破棄できるようにする。

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { G } from "./state.js";

// 光だまりを「加算合成の放射状グラデーション板」で擬似的に描く(本物のライトを増やさない=軽い)。
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
// 接地影(低コストなリアリティ): 暗い放射状グラデの板を床に敷く。
let _shadowTex = null;
function shadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.6, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}
export function makeShadow(size, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity, toneMapped: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  return m;
}

// 立体的な額縁: 上下左右の4本のバーで縁取る(前方に少し出っ張る)。
function makeMolding(w, h, color) {
  const g = new THREE.Group();
  const bw = 0.085, bd = 0.07, z = 0.055;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.45 });
  const bar = (bx, by, sx, sy) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, bd), mat);
    m.position.set(bx, by, z);
    g.add(m);
  };
  bar(0, h / 2 + bw / 2, w + 2 * bw, bw);  // 上
  bar(0, -(h / 2 + bw / 2), w + 2 * bw, bw); // 下
  bar(-(w / 2 + bw / 2), 0, bw, h);          // 左
  bar(w / 2 + bw / 2, 0, bw, h);             // 右
  return g;
}

// オープングリッド天井(井桁ルーバー)風の emissiveMap。格子線だけが淡く自発光し、桝は黒。
// 暗室でも天井の格子が読めつつ、雰囲気を壊さない(線はブルームで少しにじむ)。
let _gridTex = null;
function gridCeilingTexture(reach) {
  const cells = Math.max(8, Math.round(reach / 0.9));
  if (_gridTex) { _gridTex.repeat.set(cells, cells); return _gridTex; }
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#000000"; x.fillRect(0, 0, 128, 128);          // 桝(発光なし)
  x.strokeStyle = "#8c8270"; x.lineWidth = 8; x.strokeRect(0, 0, 128, 128); // 桝の外枠(やや明るく)
  x.strokeStyle = "#3a352c"; x.lineWidth = 3;                                // 内側の細格子
  x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 128); x.moveTo(0, 64); x.lineTo(128, 64); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(cells, cells);
  _gridTex = t;
  return t;
}

// 寄木(板張り)床のテクスチャ。横板を少しずつ色変えし、継ぎ目と淡い木目を描く。
let _woodTex = null;
function woodFloorTexture() {
  if (_woodTex) return _woodTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  const planks = 6, ph = 256 / planks;
  for (let i = 0; i < planks; i++) {
    // 板ごとに明度を僅かに変える(暗い茶系)
    const base = 26 + ((i * 37) % 14);           // 26〜39
    x.fillStyle = `rgb(${base + 8},${base},${base - 6})`;
    x.fillRect(0, i * ph, 256, ph);
    // 木目(縦の淡い筋)
    for (let g = 0; g < 7; g++) {
      x.strokeStyle = `rgba(${base + 18},${base + 8},${base - 2},0.18)`;
      x.lineWidth = 1;
      const gx = (g * 41 + i * 17) % 256;
      x.beginPath(); x.moveTo(gx, i * ph + 2); x.lineTo(gx + 6, (i + 1) * ph - 2); x.stroke();
    }
    // 板の継ぎ目(横線) + 板を互い違いに割る縦の目地
    x.strokeStyle = "rgba(0,0,0,0.55)"; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, i * ph + 0.5); x.lineTo(256, i * ph + 0.5); x.stroke();
    const seam = (i % 2 ? 128 : 0);
    x.beginPath(); x.moveTo(seam, i * ph); x.lineTo(seam, (i + 1) * ph); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = G.renderer.capabilities.getMaxAnisotropy();
  _woodTex = t;
  return t;
}

function glowPlane(w, h, color, opacity) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: new THREE.Color(color),
      opacity,
      toneMapped: false,
    })
  );
}

// 作品が少なくても部屋が狭くならないよう、壁の数の下限。3 枚なら三角形(中心から壁まで約 1.8m)になっていた。
// 下限に満たないときは、作品を間隔を空けて掛け、残りの壁は空けておく。
const MIN_SIDES = 8;

// 正多角形の「閉じた部屋」。各壁は辺の中点(apothem)に内向きで置き、隣と頂点で接して連続する。
// 戻り値は作品ごとの配置(添字 = 作品の順番)。部屋を作るための全部の壁は .sides に入れる。
export function layoutWalls(n) {
  if (G.cfg.layout === "explicit") {
    return (G.cfg.walls || []).map((w) => ({
      position: w.position || [0, 1.55, -5],
      rotationY: (w.rotation && w.rotation[1]) || 0,
      segWidth: (G.cfg.polygon?.wallWidth ?? 4.2) + (G.cfg.polygon?.gap ?? 0.6),
      explicit: true,
    }));
  }
  const p = G.cfg.polygon || {};
  const wallWidth = p.wallWidth ?? 4.2;
  const gap = p.gap ?? 0.6;
  const hangY = G.cfg.room?.hangCenter ?? 1.55; // 絵の中心高さ(美術館の基準線)
  const seg = wallWidth + gap;
  const sides = Math.max(n, MIN_SIDES);
  const apothem = seg / (2 * Math.tan(Math.PI / sides));
  const all = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    all.push({
      position: [Math.sin(a) * apothem, hangY, Math.cos(a) * apothem],
      rotationY: a + Math.PI,
      segWidth: seg,
      apothem,
      maxWidth: wallWidth,
      angle: a,
    });
  }
  const placements = Array.from({ length: n }, (_, i) => all[Math.round((i * sides) / n)]);
  placements.sides = all;
  return placements;
}

export function buildRoom(artPlacements) {
  const placements = artPlacements.sides || artPlacements; // 壁・照明・什器は空の壁も含めた全周で作る
  const room = G.cfg.room || {};
  const roomH = room.height || 5.5;
  const root = G.galleryRoot;
  G.colliders = []; // 当たり箱をリセット
  // 見回し・三人称のカメラを部屋の中に留めるための形(controls.js の clampCameraToRoom)。
  // 自由配置(explicit)は壁が閉じていないので対象外。
  G.roomShape = placements.length > 2 && !placements[0].explicit
    ? { angles: placements.map((pl) => pl.angle), apothem: placements[0].apothem, height: roomH }
    : null;

  const wallMat = new THREE.MeshStandardMaterial({ color: room.wallColor || "#1b1e24", roughness: 0.95 });
  for (const pl of placements) {
    const seg = pl.segWidth || 4.8;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(seg + 0.02, roomH), wallMat);
    wall.position.set(pl.position[0], roomH / 2, pl.position[2]);
    wall.rotation.y = pl.rotationY;
    root.add(wall);
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(seg + 0.02, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 1 })
    );
    base.position.set(pl.position[0], 0.09, pl.position[2]);
    base.rotation.y = pl.rotationY;
    root.add(base);
  }

  // 床: 既定はマット(美術館同様)。floorStyle:"wood" で艶のある板張り、reflectiveFloor:true で鏡面。
  const reach = (placements[0]?.apothem || 8) * 2.4 + 6;
  G.floorReflective = false;
  if (room.floorStyle === "wood") {
    const woodTex = woodFloorTexture();
    woodTex.repeat.set(Math.round(reach / 1.8), Math.round(reach / 1.8));
    // 低 roughness + 環境マップで艶(板床の照り)を出す。スポット光の写り込みも乗る。軽い。
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(reach, 64),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: room.floorRoughness ?? 0.4, metalness: 0.12 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.name = "woodFloor";
    root.add(floor);
    // 画質 high(reflector 許可)時のみ、薄い鏡面を下に敷いて作品の本物の映り込みを足す(やや重い)。
    if (G.QP.reflector > 0 && room.floorReflect !== false) {
      const refl = new Reflector(new THREE.CircleGeometry(reach, 64), {
        color: new THREE.Color(0x070809), textureWidth: G.QP.reflector, textureHeight: G.QP.reflector, clipBias: 0.003,
      });
      refl.rotateX(-Math.PI / 2);
      refl.position.y = -0.012;            // 木目床のわずか下
      floor.material.transparent = true;    // 木目を通して鏡面が透ける
      floor.material.opacity = 0.82;
      root.add(refl);
      G.floorReflective = true;
    }
  } else if (room.reflectiveFloor === true && G.QP.reflector > 0) {
    const floor = new Reflector(new THREE.CircleGeometry(reach, 64), {
      color: new THREE.Color(room.floorColor || "#0a0b0d"),
      textureWidth: G.QP.reflector,
      textureHeight: G.QP.reflector,
      clipBias: 0.003,
    });
    floor.rotateX(-Math.PI / 2);
    root.add(floor);
  } else {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(reach, 64),
      new THREE.MeshStandardMaterial({ color: room.floorColor || "#101216", roughness: 0.7 })
    );
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
  }

  // 天井: 既定は無地。gridCeiling:true で井桁グリッド(美術館のオープン天井)風 — 格子線だけ淡く発光。
  const ceilMat = room.gridCeiling
    ? new THREE.MeshStandardMaterial({
        color: 0x0a0b0e, roughness: 1,
        emissive: new THREE.Color(room.lightColor || "#ffe9c4"),
        emissiveMap: gridCeilingTexture(reach),
        emissiveIntensity: room.gridGlow ?? 0.35,
      })
    : new THREE.MeshStandardMaterial({ color: room.ceilingColor || "#0c0d11", roughness: 1 });
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(reach, 64), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = roomH;
  root.add(ceil);

  if (room.downlights !== false && G.QP.downlights) buildDownlights(placements, roomH);
  if (room.furniture !== false) buildFurniture(placements, roomH);

  // 環境マップを使う場合、暗い雰囲気を保つため反映強度を抑える(質感は上がる)。
  if (G.envOn) {
    const intensity = room.envIntensity ?? 0.35;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m && "envMapIntensity" in m) m.envMapIntensity = intensity; });
    });
  }
}

function buildDownlights(placements, roomH) {
  const room = G.cfg.room || {};
  const n = room.downlightCount ?? 6;
  const ringR = (placements[0]?.apothem || 8) * 0.42;
  const lightCol = new THREE.Color(room.lightColor || "#ffe9c4");
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const x = Math.sin(a) * ringR;
    const z = Math.cos(a) * ringR;
    // 発光する器具(ブルームでにじむ・ライトコスト0)。ブルームの閾値(1.0)を超えるよう色を 1 より明るくする
    const fix = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 24),
      new THREE.MeshBasicMaterial({ color: lightCol.clone().multiplyScalar(2), toneMapped: false })
    );
    fix.rotation.x = Math.PI / 2;
    fix.position.set(x, roomH - 0.12, z);
    G.galleryRoot.add(fix);
    // 床の光だまり(擬似)
    const pool = glowPlane(3.2, 3.2, lightCol, 0.28);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.03, z);
    G.galleryRoot.add(pool);
  }
}

function buildFurniture(placements, roomH) {
  const room = G.cfg.room || {};
  const lightCol = new THREE.Color(room.lightColor || "#ffe9c4");
  // 床の什器が暗闇に沈まないよう、明るめの石材色 + 床に淡い接地グロー。
  const stone = new THREE.MeshStandardMaterial({ color: 0x3a4049, roughness: 0.7, metalness: 0.05 });
  const floorGlow = (x, z, size) => {
    if (room.floorGlow === false) return;
    const g = glowPlane(size, size, lightCol, 0.22);
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, 0.02, z);
    G.galleryRoot.add(g);
  };

  // 中央の台座(pedestal:false で消せる)。当たり箱もその時だけ追加。
  G.pedestalR = 0;
  if (room.pedestal !== false) {
    const pedR = 0.7;
    const pedH = 0.95;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(pedR, pedR * 1.05, pedH, 32), stone);
    ped.position.y = pedH / 2;
    G.galleryRoot.add(ped);
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(pedR, 32),
      new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.4 })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = pedH + 0.001;
    G.galleryRoot.add(top);
    floorGlow(0, 0, 3.2);
    const pedShadow = makeShadow(pedR * 2.8, 0.8); pedShadow.position.set(0, 0.016, 0); G.galleryRoot.add(pedShadow);
    G.pedestalR = pedR + 0.35;
    // 当たり箱: 台座(円柱)。横は通れず、上には乗れる。
    G.colliders.push({ kind: "cyl", x: 0, z: 0, r: pedR + 0.25, top: pedH });
  }

  // ベンチ(benches:false で消せる)
  if (room.benches === false) return;
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x343a43, roughness: 0.8 });
  const benchR = (placements[0]?.apothem || 8) * 0.5;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bx = Math.sin(a) * benchR, bz = Math.cos(a) * benchR;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.5), benchMat);
    bench.position.set(bx, 0.225, bz);
    bench.rotation.y = a + Math.PI / 2;
    G.galleryRoot.add(bench);
    floorGlow(bx, bz, 2.4);
    const bsh = makeShadow(1.9, 0.7); bsh.position.set(bx, 0.016, bz); G.galleryRoot.add(bsh);
    // 当たり箱: ベンチ(回転した箱)。半径方向に margin を足す。
    G.colliders.push({ kind: "obox", x: bx, z: bz, rotY: a + Math.PI / 2, hx: 0.8 + 0.2, hz: 0.25 + 0.2, top: 0.45 });
  }
}

export function addArtwork(wallCfg, resolved, place) {
  const room = G.cfg.room || {};
  const roomH = room.height || 5.5;
  const aspect = resolved.width && resolved.height ? resolved.width / resolved.height : 1;

  // 高さ・幅に上限(m)を設け、壁いっぱいにせず余白を残すのが美術館の掛け方。
  const maxH = room.artMaxHeight ?? 1.9;
  const maxW = Math.min(room.artMaxWidth ?? 2.4, place.maxWidth ?? (place.segWidth ? place.segWidth - 1.0 : 3));
  let h = maxH;
  let w = h * aspect;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }

  const group = new THREE.Group();
  group.position.set(place.position[0], place.position[1], place.position[2]);
  group.rotation.y = place.rotationY;
  G.galleryRoot.add(group);

  const normal = new THREE.Vector3(-place.position[0], 0, -place.position[2]);
  if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
  normal.normalize();

  // マット(額の内側の余白) — ホバー時のハイライト対象でもある。
  // frameStyle:"lightbox" は写真系美術館風: 深い白マットが発光し、細い暗フレームで縁取る。
  const lightbox = room.frameStyle === "lightbox";
  const matBorder = lightbox ? 0.20 : 0.08;
  const frameMat = lightbox
    ? new THREE.MeshBasicMaterial({ color: room.matColor || 0xeae6da, toneMapped: false }) // 発光する明るいマット
    : new THREE.MeshStandardMaterial({ color: 0x14110b, roughness: 0.85, metalness: 0.1 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + matBorder * 2, h + matBorder * 2), frameMat);
  frame.position.z = 0.02;
  group.add(frame);

  // 額縁(モールディング): 既定は落ち着いた金縁。lightbox は細い暗フレーム。
  if (room.frames !== false) group.add(makeMolding(w, h, lightbox ? 0x0a0a0c : (room.frameColor || 0x6e5a2c)));

  // lightbox: 作品まわりの壁に光をにじませる(ライトボックスのこぼれ光)
  if (lightbox) {
    const wallGlow = glowPlane(w * 2.3, h * 2.1, room.lightColor || "#fff4e0", 0.42);
    wallGlow.position.set(0, 0.05, 0.006); // 額(z=0.02)の背後 → 額の外側へ回り込む
    group.add(wallGlow);
  }

  // 絵: まずグレーのプレースホルダ → サムネ読み込み後に差し替え。発色維持のため非ライティング材質。
  const artMat = new THREE.MeshBasicMaterial({ color: 0x23262d, toneMapped: false });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = 0.04;
  group.add(art);

  const px = Math.max(512, Math.min(G.cfg.wallTexturePx || 1024, Math.round(Math.max(w, h) * 200)));
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(
    resolved.thumb(px),
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = G.renderer.capabilities.getMaxAnisotropy();
      artMat.map = tex;
      artMat.color.setHex(0xffffff);
      artMat.needsUpdate = true;
    },
    undefined,
    () => console.warn("thumbnail load failed")
  );

  if (G.cfg.plates !== false && (wallCfg.label || wallCfg.by)) {
    const plate = makePlate(wallCfg.label, wallCfg.by, w);
    plate.position.set(0, -h / 2 - 0.22, 0.05);
    group.add(plate);
  }

  const center = group.position.clone();

  // 床への映り込み(擬似): 作品の手前(中心側)へ伸びる縦長のグロー。鏡面 Reflector のような
  // シマー/コストなしで「作品の光が床に映る」重厚感を出す。group は内向きなので local +z が中心方向。
  if (room.floorReflectStreaks) {
    const streak = glowPlane(w * 0.95, 3.6, room.lightColor || "#ffe9c4", 0.58);
    streak.rotation.x = -Math.PI / 2;          // 床に寝かせる
    streak.position.set(0, -center.y + 0.02, 1.8); // 足元(world y≈0)・作品の手前へ
    group.add(streak);
  }

  // 作品まわりの照明。quality=high は本物のスポット(立体的で realistic)、それ以外は擬似グロー(軽い)。
  if (room.spotlights !== false) {
    if (G.QP.spotMode === "real") {
      const spot = new THREE.SpotLight(
        new THREE.Color(room.lightColor || "#ffe9c4"),
        room.spotIntensity ?? 120,
        0,
        THREE.MathUtils.degToRad(room.spotAngleDeg ?? 28),
        room.spotPenumbra ?? 0.7,
        2
      );
      spot.position.copy(center).addScaledVector(normal, 2.2);
      spot.position.y = roomH - 0.4;
      spot.target.position.copy(center).setY(center.y - 0.6);
      G.galleryRoot.add(spot, spot.target);
    } else {
      const glow = glowPlane(w * 2.6, h * 2.3, room.lightColor || "#ffe9c4", room.glowStrength ?? 0.95);
      glow.position.z = 0.012; // 額(0.02)の背後 → 額の周囲に光が回り込む
      glow.position.y = 0.1;
      group.add(glow);
    }
  }

  art.userData = { wallCfg, resolved, frame, center, normal, artH: h };
  G.pickables.push(art);
  return art;
}

// 題名/作者をキャンバスに描いて銘板テクスチャに(フォント読み込み不要)。実物大の小さなプレート。
function makePlate(title, by, artW) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 220;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0d0e12";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, c.width - 12, c.height - 12);

  const clip = (s, font, max) => {
    ctx.font = font;
    if (ctx.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t + "…";
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleFont = "600 60px -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillStyle = "#eef0f4";
  ctx.font = titleFont;
  ctx.fillText(clip(title || "", titleFont, c.width - 80), c.width / 2, by ? 86 : 110);
  if (by) {
    const byFont = "400 42px -apple-system, 'Hiragino Sans', sans-serif";
    ctx.fillStyle = "#9aa3b2";
    ctx.font = byFont;
    ctx.fillText(clip(by, byFont, c.width - 80), c.width / 2, 150);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pw = Math.min(Math.max(artW * 0.42, 0.42), 0.6);
  const ph = pw * (c.height / c.width);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(pw, ph),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
  );
}
