// 3D で一覧する（/browse/）の描画。three.js の CSS3DRenderer に、サムネイルのカードを並べる。
// 元は nakamura196/iiif-3d-gallery の src/lib/gallery.ts。Tween は gsap に、設定と選択は呼び出し側（React）の状態に変えた。

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject, TrackballControls } from 'three-stdlib';
import gsap from 'gsap';
import { groupsOf, type BrowseItem, type BrowseLayout } from '@/lib/browse';

export interface BrowseSettings {
  spacing: { x: number; y: number };
  spacingType: 'absolute' | 'relative' | 'equal';
  /** グリッドの並べ方で、束ねた名前のカードを正面に向ける */
  gridForwardFacing: boolean;
}

export const DEFAULT_SETTINGS: BrowseSettings = {
  spacing: { x: 160, y: 200 },
  spacingType: 'absolute',
  gridForwardFacing: false,
};

export interface BrowseCallbacks {
  /** カードのクリック。-1 は何もない所のクリック */
  onSelect?: (index: number) => void;
  /** カードのダブルクリック（Keep の切り替え） */
  onToggleKeep?: (index: number) => void;
}

const CARD_W = 160;
const CARD_H = 200;
// ドラッグで回しただけのときは、離したときのクリックを選択として数えない
const CLICK_SLOP = 5;

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
    flat: [],
  };
  private labelTargets: THREE.Object3D[] = [];

  private layout: BrowseLayout = 'table';
  private settings: BrowseSettings = { ...DEFAULT_SETTINGS };
  private billboard = false;
  private dragEnabled = false;
  private selected = -1;
  private raf = 0;
  private downAt: { x: number; y: number } | null = null;
  private drag: { obj: CSS3DObject; x: number; y: number; start: THREE.Vector3 } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private container: HTMLElement,
    private callbacks: BrowseCallbacks = {}
  ) {
    const { width, height } = this.size();
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 10000);
    this.camera.position.z = 3000;
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);
    // 回転・拡大の操作は枠が受け、カードのクリックは下の document の手続きで拾う
    this.renderer.domElement.style.pointerEvents = 'none';
    this.controls = new TrackballControls(this.camera, container);
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 0;
    this.controls.maxDistance = 600000;

    container.addEventListener('pointerdown', this.onPointerDown, true);
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
  }

  // ---- 入力 ----

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
    for (const o of [...this.objects, ...this.labelObjects]) {
      this.scene.remove(o);
      o.element.remove();
    }
    this.objects = [];
    this.labelObjects = [];
    this.items = items;
    this.selected = -1;

    const { names } = groupsOf(items);
    for (const name of names) {
      const el = document.createElement('div');
      el.className = 'bw-group';
      el.textContent = name || '—';
      const o = new CSS3DObject(el);
      this.scene.add(o);
      this.labelObjects.push(o);
    }
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
    this.generateLayouts();
    this.setLayout(this.layout);
  }

  private cardElement(item: BrowseItem, index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bw-card';
    el.dataset.index = String(index);
    const img = document.createElement('img');
    img.alt = item.label;
    img.draggable = false;
    img.decoding = 'async';
    if (item.thumbnail) img.src = item.thumbnail;
    img.addEventListener('error', () => img.classList.add('bw-broken'));
    el.appendChild(img);
    const label = document.createElement('div');
    label.className = 'bw-label';
    label.textContent = item.label;
    el.appendChild(label);
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
    this.targets = { table: [], sphere: [], helix: [], grid: [], flat: [] };
    this.labelTargets = [];
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));

    const plane = (i: number) => {
      const o = new THREE.Object3D();
      o.position.set(
        (i % cols) * sp.x - ((cols - 1) * sp.x) / 2,
        -Math.floor(i / cols) * sp.y + ((rows - 1) * sp.y) / 2,
        0
      );
      return o;
    };
    for (let i = 0; i < n; i++) {
      this.targets.table.push(plane(i));
      this.targets.flat.push(plane(i));

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

  // グリッド: 束ねた名前ごとに 1 つの塊（縦に 10 枚ずつ）。束が 1 つだけのときは、奥行きに重ねた面にする
  private generateGrid(sp: { x: number; y: number }): void {
    const n = this.items.length;
    const { names, of } = groupsOf(this.items);
    const out: THREE.Object3D[] = new Array(n);
    if (names.length <= 1) {
      const perLayer = 24;
      const layers = Math.max(1, Math.ceil(n / perLayer));
      const per = Math.ceil(n / layers);
      const cols = Math.max(1, Math.ceil(Math.sqrt(per)));
      const rows = Math.ceil(per / cols);
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(i / per);
        const j = i % per;
        const o = new THREE.Object3D();
        o.position.set(
          (j % cols) * sp.x - ((cols - 1) * sp.x) / 2,
          -Math.floor(j / cols) * sp.y + ((rows - 1) * sp.y) / 2,
          -layer * 500
        );
        out[i] = o;
      }
      this.targets.grid = out;
      return;
    }
    const perColumn = 10;
    const members = names.map((_, g) => of.flatMap((x, i) => (x === g ? [i] : [])));
    const maxIn = Math.max(...members.map((m) => m.length));
    const groupW = Math.ceil(maxIn / perColumn) * sp.x + 100;
    const startX = -(names.length * groupW) / 2 + groupW / 2;
    members.forEach((idx, g) => {
      const gx = startX + g * groupW;
      const colsHere = Math.ceil(idx.length / perColumn);
      const label = new THREE.Object3D();
      label.position.set(gx, ((Math.min(idx.length, perColumn) - 1) * sp.y) / 2 + 120, 0);
      this.labelTargets.push(label);
      idx.forEach((itemIndex, j) => {
        const o = new THREE.Object3D();
        o.position.set(
          gx + Math.floor(j / perColumn) * sp.x - ((colsHere - 1) * sp.x) / 2,
          -(j % perColumn) * sp.y + ((Math.min(idx.length, perColumn) - 1) * sp.y) / 2,
          0
        );
        out[itemIndex] = o;
      });
    });
    this.targets.grid = out.map((o) => o ?? new THREE.Object3D());
  }

  setLayout(layout: BrowseLayout): void {
    this.layout = layout;
    this.clearSelection();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    const targets = this.targets[layout];
    if (!targets.length) return;
    const forward = layout === 'grid' && this.settings.gridForwardFacing;
    this.objects.forEach((o, i) => {
      const t = targets[i];
      if (!t) return;
      o.position.copy(t.position);
      if (forward) o.rotation.set(0, 0, 0);
      else o.rotation.copy(t.rotation);
    });
    const groupsShown = layout === 'grid' && this.labelTargets.length > 0;
    this.labelObjects.forEach((o, i) => {
      o.element.classList.toggle('bw-none', !groupsShown);
      if (groupsShown && this.labelTargets[i]) o.position.copy(this.labelTargets[i].position);
    });
    // 2D は回さない（平面のまま、ずらして拡大するだけ）
    this.controls.noRotate = layout === 'flat';
    this.fitToView(targets);
  }

  updateSettings(settings: BrowseSettings): void {
    this.settings = settings;
    this.generateLayouts();
    this.setLayout(this.layout);
  }

  private fitToView(targets: THREE.Object3D[]): void {
    const pad = 100;
    const box = new THREE.Box3();
    for (const t of targets) box.expandByPoint(t.position);
    box.min.x -= CARD_W / 2 + pad;
    box.max.x += CARD_W / 2 + pad;
    box.min.y -= CARD_H / 2 + pad;
    box.max.y += CARD_H / 2 + pad;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const distance = Math.max(s.y / 2 / tan, s.x / 2 / (tan * this.camera.aspect)) * 1.1 + s.z / 2;
    this.camera.position.set(c.x, c.y, c.z + distance);
    this.controls.target.copy(c);
    this.camera.lookAt(c);
    this.controls.update();
  }

  // ---- 選択・視点 ----

  focusItem(index: number, offset = 500): void {
    const t = this.targets[this.layout][index];
    if (!t) return;
    this.select(index);
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    gsap.to(this.camera.position, {
      x: t.position.x,
      y: t.position.y,
      z: t.position.z + offset,
      duration: 1,
      ease: 'power2.inOut',
    });
    gsap.to(this.controls.target, {
      x: t.position.x,
      y: t.position.y,
      z: t.position.z,
      duration: 1,
      ease: 'power2.inOut',
    });
  }

  private select(index: number): void {
    if (this.selected === index) return;
    this.selected = index;
    this.objects.forEach((o, i) => {
      o.element.classList.toggle('bw-selected', i === index);
      o.element.classList.toggle('bw-dimmed', i !== index);
    });
    this.labelObjects.forEach((o) => o.element.classList.add('bw-dimmed'));
  }

  clearSelection(): void {
    this.selected = -1;
    this.objects.forEach((o) => o.element.classList.remove('bw-selected', 'bw-dimmed'));
    this.labelObjects.forEach((o) => o.element.classList.remove('bw-dimmed'));
  }

  setBillboard(on: boolean): void {
    this.billboard = on;
    // 切ったときは、並べ方の向きに戻す
    if (!on)
      this.objects.forEach(
        (o, i) =>
          this.targets[this.layout][i] && o.rotation.copy(this.targets[this.layout][i].rotation)
      );
  }

  setDragEnabled(on: boolean): void {
    this.dragEnabled = on;
  }

  resetView(): void {
    const targets = this.targets[this.layout];
    if (targets.length) this.fitToView(targets);
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    if (this.billboard) for (const o of this.objects) o.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('dblclick', this.onDblClick, true);
    this.onDragEnd();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.controls.dispose();
    this.renderer.domElement.remove();
  }
}
