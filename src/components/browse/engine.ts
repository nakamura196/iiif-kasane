// 3D で一覧する（/browse/）の描画。three.js の CSS3DRenderer に、サムネイルのカードを並べる。
// 元は nakamura196/iiif-3d-gallery の src/lib/gallery.ts。Tween は gsap に、設定と選択は呼び出し側（React）の状態に変えた。
// グループ（束ごとの板）とキューブ（3 つの軸）は Kasane で足した並べ方。束と軸の決め方は lib/browse.ts。

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject, TrackballControls } from 'three-stdlib';
import gsap from 'gsap';
import type { BrowseItem, BrowseLayout } from '@/lib/browse';

export interface BrowseSettings {
  spacing: { x: number; y: number };
  spacingType: 'absolute' | 'relative' | 'equal';
}

export const DEFAULT_SETTINGS: BrowseSettings = {
  spacing: { x: 160, y: 200 },
  spacingType: 'absolute',
};

export interface BrowseCallbacks {
  /** カードのクリック。-1 は何もない所のクリック */
  onSelect?: (index: number) => void;
  /** カードのダブルクリック（Keep の切り替え） */
  onToggleKeep?: (index: number) => void;
}

/** グループの並べ方の 1 つの束（見出しは画面の言葉に直したもの） */
export interface GroupView {
  label: string;
  indexes: number[];
}

const CARD_W = 160;
const CARD_H = 200;
// ドラッグで回しただけのときは、離したときのクリックを選択として数えない
const CLICK_SLOP = 5;
// 手を離してから、ゆっくり回り始めるまで（ミリ秒）。球・らせんだけ
const IDLE_AFTER = 4000;
const IDLE_SPEED = 0.0012;
const IDLE_LAYOUTS: BrowseLayout[] = ['sphere', 'helix'];

type Box = { minX: number; maxX: number; minY: number; maxY: number };

export class Browse3D {
  private camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private renderer = new CSS3DRenderer();
  private controls: TrackballControls;

  private items: BrowseItem[] = [];
  private objects: CSS3DObject[] = [];
  private labelObjects: CSS3DObject[] = [];
  private targets: Record<BrowseLayout, THREE.Object3D[]> = {
    table: [],
    sphere: [],
    helix: [],
    grid: [],
  };
  private labelTargets: THREE.Object3D[] = [];
  private groupBoxes: Box[] = [];
  private groups: GroupView[] = [];

  private layout: BrowseLayout = 'table';
  private settings: BrowseSettings = { ...DEFAULT_SETTINGS };
  private billboard = false;
  private dragEnabled = false;
  private selected = -1;
  private highlighted: Set<number> | null = null;
  private raf = 0;
  private lastInput = 0;
  private downAt: { x: number; y: number } | null = null;
  private drag: { obj: CSS3DObject; x: number; y: number; start: THREE.Vector3 } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private container: HTMLElement,
    private callbacks: BrowseCallbacks = {}
  ) {
    const { width, height } = this.size();
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 20000);
    this.camera.position.z = 3000;
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);
    // 回転・拡大の操作は枠が受け、カードのクリックは下の document の手続きで拾う
    this.renderer.domElement.style.pointerEvents = 'none';
    this.controls = new TrackballControls(this.camera, container);
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 0;
    this.controls.maxDistance = 600000;
    // 既定では A・S・D のキーで操作の種類が切り替わり、検索欄に打った文字まで拾ってしまうので使わない
    this.controls.keys = ['', '', ''];
    // 動きを減らす設定では、手を離したあとの惰性も付けない
    if (reducedMotion()) this.controls.staticMoving = true;
    // 回している間はゆっくり回さない（離してからしばらく待つ）
    this.controls.addEventListener('start', this.onControlStart);
    this.controls.addEventListener('end', this.onControlEnd);

    container.addEventListener('pointerdown', this.onPointerDown, true);
    container.addEventListener('wheel', this.noteInput, { passive: true, capture: true });
    container.addEventListener('touchstart', this.noteInput, { passive: true, capture: true });
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('dblclick', this.onDblClick, true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.animate();
  }

  private size() {
    return { width: this.container.clientWidth || 800, height: this.container.clientHeight || 600 };
  }

  resize(): void {
    const { width, height } = this.size();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    // 操作の中心と感度も、新しい大きさに合わせる（欄の開閉・画面の回転のあと）
    this.controls.handleResize();
  }

  // ---- 入力 ----

  private interacting = false;

  /** 操作があった（ゆっくり回るのを止め、しばらく待ってから再び回す）。動いている視点の移動も止める */
  noteInput = (): void => {
    this.lastInput = performance.now();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    gsap.killTweensOf(this.camera.up);
  };

  private onControlStart = (): void => {
    this.interacting = true;
    this.noteInput();
  };

  private onControlEnd = (): void => {
    this.interacting = false;
    this.lastInput = performance.now();
  };

  private cardAt(e: MouseEvent): { el: HTMLElement; index: number } | null {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const card = (el as HTMLElement).closest?.('.bw-card') as HTMLElement | null;
      if (card && this.container.contains(card)) {
        const index = Number(card.dataset.index ?? -1);
        if (index >= 0) return { el: card, index };
      }
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.noteInput();
    this.downAt = { x: e.clientX, y: e.clientY };
    if (e.shiftKey && this.dragEnabled) {
      const hit = this.cardAt(e);
      const obj = hit && this.objects[hit.index];
      if (obj) {
        e.stopPropagation();
        e.preventDefault();
        this.drag = { obj, x: e.clientX, y: e.clientY, start: obj.position.clone() };
        this.controls.enabled = false;
        document.addEventListener('pointermove', this.onDragMove);
        document.addEventListener('pointerup', this.onDragEnd);
        document.addEventListener('pointercancel', this.onDragEnd);
        window.addEventListener('blur', this.onDragEnd);
      }
    }
  };

  private onDragMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    const distance = this.camera.position.distanceTo(d.start);
    const scale = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance) / this.size().height;
    d.obj.position.x = d.start.x + (e.clientX - d.x) * scale;
    d.obj.position.y = d.start.y - (e.clientY - d.y) * scale;
  };

  private onDragEnd = (): void => {
    this.drag = null;
    this.controls.enabled = true;
    document.removeEventListener('pointermove', this.onDragMove);
    document.removeEventListener('pointerup', this.onDragEnd);
    document.removeEventListener('pointercancel', this.onDragEnd);
    window.removeEventListener('blur', this.onDragEnd);
  };

  private moved(e: MouseEvent): boolean {
    return (
      !!this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > CLICK_SLOP
    );
  }

  private onClick = (e: MouseEvent): void => {
    if (!this.container.contains(e.target as Node) || this.moved(e)) return;
    const hit = this.cardAt(e);
    this.callbacks.onSelect?.(hit ? hit.index : -1);
  };

  private onDblClick = (e: MouseEvent): void => {
    if (!this.container.contains(e.target as Node)) return;
    const hit = this.cardAt(e);
    if (hit) this.callbacks.onToggleKeep?.(hit.index);
  };

  // ---- カード ----

  setItems(items: BrowseItem[]): void {
    const first = this.objects.length === 0;
    for (const o of [...this.objects, ...this.labelObjects]) {
      gsap.killTweensOf([o.position, o.rotation, o.scale]);
      this.scene.remove(o);
      o.element.remove();
    }
    this.objects = [];
    this.labelObjects = [];
    this.groups = [];
    this.items = items;
    this.selected = -1;
    this.highlighted = null;

    items.forEach((item, i) => {
      const o = new CSS3DObject(this.cardElement(item, i));
      o.position.set(
        Math.random() * 4000 - 2000,
        Math.random() * 4000 - 2000,
        Math.random() * 4000 - 2000
      );
      this.scene.add(o);
      this.objects.push(o);
    });
    // 初めて並べるときは、遠く斜めから寄っていく（カードは散らばった所から集まる）
    if (first && items.length && !reducedMotion()) {
      this.camera.position.set(2600, 1500, 8000);
      this.controls.target.set(0, 0, 0);
      this.camera.up.set(0, 1, 0);
    }
    this.generateLayouts();
    this.setLayout(this.layout, first ? 1.8 : 1.2);
  }

  private cardElement(item: BrowseItem, index: number): HTMLElement {
    // 外側は three.js が位置を書き込む箱。見た目と、持ち上がる動きは内側に付ける（transform がぶつからないように）
    const el = document.createElement('div');
    el.className = 'bw-card';
    el.dataset.index = String(index);
    const inner = document.createElement('div');
    inner.className = 'bw-card-inner';
    const img = document.createElement('img');
    img.alt = item.label;
    img.draggable = false;
    img.decoding = 'async';
    img.loading = 'lazy';
    if (item.thumbnail) img.src = item.thumbnail;
    img.addEventListener('error', () => img.classList.add('bw-broken'));
    inner.appendChild(img);
    const label = document.createElement('div');
    label.className = 'bw-label';
    label.textContent = item.label;
    inner.appendChild(label);
    el.appendChild(inner);
    return el;
  }

  /** あとから分かったサムネイルを差し替える */
  setThumbnail(index: number, url: string): void {
    const img = this.objects[index]?.element.querySelector('img');
    if (img && url) {
      img.classList.remove('bw-broken');
      img.src = url;
    }
  }

  setKept(kept: ReadonlySet<number>): void {
    this.objects.forEach((o, i) => o.element.classList.toggle('bw-kept', kept.has(i)));
  }

  /** グループの並べ方の束。今の並べ方がグループなら、すぐ並べ直す */
  setGroups(groups: GroupView[]): void {
    for (const o of this.labelObjects) {
      this.scene.remove(o);
      o.element.remove();
    }
    this.groups = groups;
    this.labelObjects = groups.map((g) => {
      // 束ごとの板。上に見出し（名前と枚数）、下の余白にカードが並ぶ
      const el = document.createElement('div');
      el.className = 'bw-group bw-off';
      const head = document.createElement('div');
      head.className = 'bw-group-head';
      const name = document.createElement('span');
      name.className = 'bw-group-name';
      name.textContent = g.label;
      name.title = g.label;
      const count = document.createElement('span');
      count.className = 'bw-group-count';
      count.textContent = String(g.indexes.length);
      head.append(name, count);
      el.append(head);
      const o = new CSS3DObject(el);
      this.scene.add(o);
      return o;
    });
    this.generateGrid(this.effectiveSpacing());
    if (this.layout === 'grid') this.setLayout('grid', 1);
  }

  // ---- 並べ方 ----

  private effectiveSpacing() {
    const { spacing, spacingType } = this.settings;
    if (spacingType === 'relative')
      return { x: CARD_W * (spacing.x / 100), y: CARD_H * (spacing.y / 100) };
    if (spacingType === 'equal') {
      const a = (spacing.x + spacing.y) / 2;
      return { x: a, y: a };
    }
    return { ...spacing };
  }

  private generateLayouts(): void {
    const n = this.items.length;
    const sp = this.effectiveSpacing();
    this.targets = { table: [], sphere: [], helix: [], grid: [] };
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));

    for (let i = 0; i < n; i++) {
      const o = new THREE.Object3D();
      o.position.set(
        (i % cols) * sp.x - ((cols - 1) * sp.x) / 2,
        -Math.floor(i / cols) * sp.y + ((rows - 1) * sp.y) / 2,
        0
      );
      this.targets.table.push(o);

      const phi = Math.acos(-1 + (2 * i) / n);
      const theta = Math.sqrt(n * Math.PI) * phi;
      const s = new THREE.Object3D();
      s.position.setFromSphericalCoords(800, phi, theta);
      s.lookAt(s.position.clone().multiplyScalar(2));
      this.targets.sphere.push(s);

      const h = new THREE.Object3D();
      h.position.setFromCylindricalCoords(900, i * 0.175 + Math.PI, -i * 8 + 450);
      h.lookAt(new THREE.Vector3(h.position.x * 2, h.position.y, h.position.z * 2));
      this.targets.helix.push(h);
    }
    this.generateGrid(sp);
  }

  /**
   * グループ: 束ごとに 1 枚の板（見出し＋カードの小さな格子）を作り、壁に掛けた掲示板のように左上から詰める。
   * 板の幅は、束の枚数に合わせて縦横がほぼ同じになるように決める。全体は横長に収める。
   */
  private generateGrid(sp: { x: number; y: number }): void {
    const n = this.items.length;
    const groups = this.groups.length ? this.groups : [{ label: '', indexes: this.items.map((_, i) => i) }];
    const header = 150;
    const gap = 180;
    const pad = 40;
    const blocks = groups.map((g) => {
      const k = Math.max(1, g.indexes.length);
      const cols = Math.max(1, Math.ceil(Math.sqrt((k * sp.y) / sp.x)));
      const rows = Math.ceil(k / cols);
      return { cols, w: Math.max(cols * sp.x, 2 * sp.x), h: rows * sp.y + header };
    });
    const area = blocks.reduce((a, b) => a + (b.w + gap) * (b.h + gap), 0);
    // 全体の縦横比を、画面の縦横比に近づける（縦長のスマートフォンでは縦に積む）
    const aspect = Math.min(2, Math.max(0.5, this.camera.aspect));
    const width = Math.max(Math.sqrt(area * aspect), ...blocks.map((b) => b.w));
    // 左上から右へ詰め、はみ出したら次の段へ
    const placed: { left: number; top: number }[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const b of blocks) {
      if (x > 0 && x + b.w > width) {
        x = 0;
        y -= rowH + gap;
        rowH = 0;
      }
      placed.push({ left: x, top: y });
      x += b.w + gap;
      rowH = Math.max(rowH, b.h);
    }
    const totalW = Math.max(...placed.map((p, i) => p.left + blocks[i].w));
    const totalH = -Math.min(...placed.map((p, i) => p.top - blocks[i].h));
    const dx = -totalW / 2;
    const dy = totalH / 2;

    const out: THREE.Object3D[] = new Array(n);
    this.labelTargets = [];
    this.groupBoxes = [];
    groups.forEach((g, gi) => {
      const b = blocks[gi];
      const left = placed[gi].left + dx;
      const top = placed[gi].top + dy;
      this.groupBoxes.push({ minX: left, maxX: left + b.w, minY: top - b.h, maxY: top });
      // 板はカードの少し奥に置く
      const board = new THREE.Object3D();
      board.position.set(left + b.w / 2, top - b.h / 2 + pad / 2, -6);
      this.labelTargets.push(board);
      const el = this.labelObjects[gi]?.element;
      if (el) {
        el.style.width = `${b.w + pad * 2}px`;
        el.style.height = `${b.h + pad}px`;
        el.style.setProperty('--bw-head', `${header - pad / 2}px`);
        // 小さな板では見出しの文字も小さくする（名前が切れにくいように）
        el.style.setProperty('--bw-font', `${Math.round(Math.min(44, Math.max(20, b.w / 11)))}px`);
      }
      g.indexes.forEach((itemIndex, j) => {
        if (itemIndex >= n) return;
        const o = new THREE.Object3D();
        o.position.set(
          left + (j % b.cols) * sp.x + sp.x / 2,
          top - header - Math.floor(j / b.cols) * sp.y - sp.y / 2,
          0
        );
        out[itemIndex] = o;
      });
    });
    this.targets.grid = Array.from(out, (o) => o ?? new THREE.Object3D());
  }

  /**
   * 並べ方を変える。カードは今の位置から新しい位置へ動かす（始まりを少しずつずらして波のように）。
   * duration は秒。動きを減らす設定（prefers-reduced-motion）のときは動かさずに置く。
   */
  setLayout(layout: BrowseLayout, duration = 1.2): void {
    this.layout = layout;
    this.clearSelection();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    const targets = this.targets[layout];
    const groupsShown = layout === 'grid' && this.groups.length > 0;
    this.labelObjects.forEach((o, i) => {
      o.element.classList.toggle('bw-off', !groupsShown);
      if (groupsShown && this.labelTargets[i]) o.position.copy(this.labelTargets[i].position);
    });
    if (!targets.length) return;
    const d = reducedMotion() ? 0 : duration;
    // 動いている間と、そのあと少しは、ゆっくり回さない
    this.lastInput = performance.now() + d * 1000;
    this.objects.forEach((o, i) => {
      const t = targets[i];
      if (!t) return;
      gsap.killTweensOf([o.position, o.rotation, o.scale]);
      const rot = { x: t.rotation.x, y: t.rotation.y, z: t.rotation.z };
      const sc = t.scale.x;
      if (d === 0) {
        o.position.copy(t.position);
        o.rotation.set(rot.x, rot.y, rot.z);
        o.scale.setScalar(sc);
        return;
      }
      const delay = Math.random() * d * 0.4;
      const ease = 'power2.inOut';
      gsap.to(o.position, { x: t.position.x, y: t.position.y, z: t.position.z, duration: d, delay, ease });
      gsap.to(o.scale, { x: sc, y: sc, z: sc, duration: d, delay, ease });
      // 正面に向ける表示のときは、毎フレーム向きを上書きするので回さない
      if (!this.billboard) gsap.to(o.rotation, { ...rot, duration: d, delay, ease });
    });
    this.fitToView(targets, d * 1.4);
  }

  updateSettings(settings: BrowseSettings): void {
    this.settings = settings;
    this.generateLayouts();
    this.setLayout(this.layout, 0.5);
  }

  /** 並べたものの外枠（グループは見出しも含める） */
  private boundsOf(targets: THREE.Object3D[]): THREE.Box3 {
    const box = new THREE.Box3();
    for (const t of targets) box.expandByPoint(t.position);
    const pad = 100;
    const sx = targets[0]?.scale.x ?? 1;
    box.min.x -= (CARD_W * sx) / 2 + pad;
    box.max.x += (CARD_W * sx) / 2 + pad;
    box.min.y -= (CARD_H * sx) / 2 + pad;
    box.max.y += (CARD_H * sx) / 2 + pad;
    if (this.layout === 'grid') for (const b of this.groupBoxes) box.expandByPoint(new THREE.Vector3(b.minX, b.maxY + 40, 0)).expandByPoint(new THREE.Vector3(b.maxX, b.minY, 0));
    return box;
  }

  private fitToView(targets: THREE.Object3D[], duration = 0): void {
    const box = this.boundsOf(targets);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const distance = Math.max(s.y / 2 / tan, s.x / 2 / (tan * this.camera.aspect)) * 1.1 + s.z / 2;
    const pos = new THREE.Vector3(c.x, c.y, c.z + distance);
    this.moveCamera(pos, c, duration);
  }

  /**
   * カメラを動かす。回したあとは、カメラの「上」も傾いている（TrackballControls は回すと上の向きごと転がす）。
   * 位置だけ戻すと傾いたまま・逆さのままになるので、上の向きもまっすぐに戻す
   */
  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    this.stopMomentum();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    gsap.killTweensOf(this.camera.up);
    // 真下を向いた「上」から戻すと、途中で長さが 0 を通って向きが決まらないので、少しずらしておく
    if (this.camera.up.y < -0.9) this.camera.up.x += 0.05;
    if (duration <= 0) {
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.controls.update();
      return;
    }
    const ease = 'power2.inOut';
    gsap.to(this.camera.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease });
    gsap.to(this.controls.target, { x: target.x, y: target.y, z: target.z, duration, ease });
    gsap.to(this.camera.up, {
      x: 0,
      y: 1,
      z: 0,
      duration,
      ease,
      onUpdate: () => {
        // 途中で長さが縮むので、毎回 1 にそろえる（0 になると向きが決まらない）
        if (this.camera.up.lengthSq() < 1e-6) this.camera.up.set(0, 1, 0);
        else this.camera.up.normalize();
      },
    });
  }

  // ---- 選択・視点 ----

  focusItem(index: number, offset = 500): void {
    const t = this.targets[this.layout][index];
    const obj = this.objects[index];
    if (!t || !obj) return;
    this.select(index);
    // カードの表の向き（球・らせんでは外向き）の正面から見る。真上・真下を向いたカードは少し手前に倒して見る
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(t.quaternion);
    if (Math.abs(normal.y) > 0.9) normal.z += 0.6;
    normal.normalize();
    const at = obj.position.clone();
    const dist = offset * Math.max(0.45, t.scale.x);
    this.moveCamera(at.clone().addScaledVector(normal, dist), at, reducedMotion() ? 0 : 1);
  }

  /** グループの板の 1 つへ寄る */
  focusGroup(index: number): void {
    const b = this.groupBoxes[index];
    if (!b || this.layout !== 'grid') return;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const w = b.maxX - b.minX + 200;
    const h = b.maxY - b.minY + 200;
    const distance = Math.max(h / 2 / tan, w / 2 / (tan * this.camera.aspect)) * 1.05;
    const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
    this.moveCamera(new THREE.Vector3(c.x, c.y, distance), c, reducedMotion() ? 0 : 1);
  }

  /** 一部のカードだけを目立たせる（ほかを薄くする）。null で元に戻す */
  highlight(indexes: number[] | null): void {
    this.highlighted = indexes ? new Set(indexes) : null;
    if (this.selected < 0) this.applyHighlight();
  }

  private applyHighlight(): void {
    const h = this.highlighted;
    this.objects.forEach((o, i) => {
      o.element.classList.remove('bw-selected');
      o.element.classList.toggle('bw-dimmed', !!h && !h.has(i));
    });
  }

  private select(index: number): void {
    if (this.selected === index) return;
    this.selected = index;
    this.objects.forEach((o, i) => {
      o.element.classList.toggle('bw-selected', i === index);
      o.element.classList.toggle('bw-dimmed', i !== index);
    });
  }

  clearSelection(): void {
    this.selected = -1;
    this.applyHighlight();
  }

  setBillboard(on: boolean): void {
    this.billboard = on;
    // 向きは毎フレーム上書きするので、動いている向きの変化は止める
    if (on) for (const o of this.objects) gsap.killTweensOf(o.rotation);
    // 切ったときは、並べ方の向きに戻す
    if (!on)
      this.objects.forEach(
        (o, i) =>
          this.targets[this.layout][i] && o.rotation.copy(this.targets[this.layout][i].rotation)
      );
  }

  /**
   * 回さない（ずらす・拡大のみ）。止めるときは、傾いた視点をまっすぐ正面に戻す。
   * （元の「2D」の並べ方は、table と同じ並びで回転を止めるだけだったので、これに分けた）
   */
  setRotationLock(on: boolean): void {
    this.controls.noRotate = on;
    if (on) this.resetView();
  }

  setDragEnabled(on: boolean): void {
    this.dragEnabled = on;
  }

  /** 視点を戻す。回して傾いた向きもまっすぐにし、全体が収まる位置へ短く動かす */
  resetView(): void {
    const targets = this.targets[this.layout];
    if (!targets.length) return;
    this.fitToView(targets, reducedMotion() ? 0 : 0.8);
  }

  /** 手を離したあとも惰性で回り続ける分（TrackballControls の慣性）を止める */
  private stopMomentum(): void {
    const c = this.controls as unknown as {
      _lastAngle: number;
      _movePrev: THREE.Vector2;
      _moveCurr: THREE.Vector2;
      _zoomStart: THREE.Vector2;
      _zoomEnd: THREE.Vector2;
      _panStart: THREE.Vector2;
      _panEnd: THREE.Vector2;
    };
    c._lastAngle = 0;
    c._movePrev?.copy(c._moveCurr);
    c._zoomStart?.copy(c._zoomEnd);
    c._panStart?.copy(c._panEnd);
  }

  /** 球・らせんで、しばらく触らなければ、ゆっくり横に回す */
  private idleTurn(): void {
    if (!IDLE_LAYOUTS.includes(this.layout) || this.controls.noRotate || this.selected >= 0) return;
    if (this.highlighted || this.drag || this.interacting || reducedMotion()) return;
    if (performance.now() - this.lastInput < IDLE_AFTER) return;
    if (gsap.isTweening(this.camera.position)) return;
    const t = this.controls.target;
    this.camera.position.sub(t).applyAxisAngle(UP, IDLE_SPEED).add(t);
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.idleTurn();
    this.controls.update();
    if (this.billboard) for (const o of this.objects) o.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.removeEventListener('end', this.onControlEnd);
    this.container.removeEventListener('wheel', this.noteInput, true);
    this.container.removeEventListener('touchstart', this.noteInput, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('dblclick', this.onDblClick, true);
    this.onDragEnd();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    gsap.killTweensOf(this.camera.up);
    for (const o of this.objects) gsap.killTweensOf([o.position, o.rotation, o.scale]);
    this.controls.dispose();
    this.renderer.domElement.remove();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** 動きを減らす設定（OS の「視差効果を減らす」など）が有効か */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
