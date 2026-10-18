'use client';

import { startTransition, Suspense, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { Clone, useAnimations, useGLTF, Bounds } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Box3, Group, PerspectiveCamera, Points, PointsMaterial, Sphere, Vector3, type Object3D } from 'three';
import gsap from 'gsap';
import Annotations from '../three/Annotations';
import ModelErrorBoundary from './ModelErrorBoundary';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { manifestAtom, measuringAtom, modelAnimationAtom, modelChoicesAtom, modelRadiusAtom, paintedModelsAtom, sceneIdAtom, showAnnotationsAtom } from '../atoms';
import MeasureMarks, { useMeasure } from './MeasureTool';
import { sceneSpatialScaleOf, upgradeUrl } from '../../core';
import { defaultCameraOf, type DefaultCamera } from '../../core';
import { runFocusFlight, type Vec3 } from '../../core';
import { fitView, topView } from '../../core';
import { ZOOM_MAX_FACTOR } from '../../core';

// Place the camera where the manifest's default Camera says (Presentation 4.0:
// the first Camera painted into the Scene). Without `lookAt`, look at the model's center.
function ManifestCamera({ cam, center, radius }: { cam: DefaultCamera; center: Vector3; radius: number }) {
  const { camera, controls } = useThree();
  // once per Camera: a progressive model swapped in later must not pull the view back
  const applied = useRef<DefaultCamera | null>(null);
  useEffect(() => {
    if (applied.current === cam) return;
    applied.current = cam;
    const target = cam.lookAt ? new Vector3(...cam.lookAt) : center;
    camera.position.set(...cam.position);
    if (camera instanceof PerspectiveCamera) {
      if (cam.fieldOfView) camera.fov = cam.fieldOfView;
      // keep the whole model inside the clipping range from wherever the camera is,
      // including as far out as the zoom buttons go
      const reach = camera.position.distanceTo(center) + radius;
      camera.near = Math.max(reach / 10000, 0.01);
      camera.far = Math.max(reach * 2, radius * (ZOOM_MAX_FACTOR + 1) * 2);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
    const orbit = controls as unknown as { target?: Vector3; update?: () => void } | null;
    orbit?.target?.copy(target);
    orbit?.update?.();
  }, [cam, center, radius, camera, controls]);
  return null;
}

// What the canvas view buttons ask of the scene.
export interface ViewHandle {
  fit: () => void; // 全体
  top: () => void; // 上
  goTo: (cam: DefaultCamera) => void; // a Camera from the manifest
}

// Flies the camera for the view buttons. Lives inside the Canvas (needs the camera and
// the OrbitControls) and next to the model (needs its bounding sphere).
function ViewController({ handle, center, radius }: { handle: Ref<ViewHandle>; center: Vector3; radius: number }) {
  const { camera, controls, size } = useThree();
  useImperativeHandle(handle, () => {
    const c: Vec3 = [center.x, center.y, center.z];
    // read at click time: the manifest's default Camera may have set the fov after mount
    const fov = () => (camera instanceof PerspectiveCamera ? camera.fov : 50);
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const fly = (position: Vec3, target: Vec3) => {
      if (camera instanceof PerspectiveCamera) {
        // keep the whole model inside the clipping range at the new distance
        const reach = Math.hypot(position[0] - c[0], position[1] - c[1], position[2] - c[2]) + radius;
        camera.near = Math.max(reach / 10000, 0.01);
        camera.far = Math.max(camera.far, reach * 2);
        camera.updateProjectionMatrix();
      }
      const orbit = controls as unknown as { target: Vector3; update?: () => void; enabled?: boolean } | null;
      runFocusFlight({ camera, controls: orbit, gsap }, position, target);
    };
    const here: () => Vec3 = () => [camera.position.x, camera.position.y, camera.position.z];
    return {
      fit: () => {
        const v = fitView(c, radius, here(), fov(), aspect);
        fly(v.position, v.target);
      },
      top: () => {
        const v = topView(c, radius, fov(), aspect);
        fly(v.position, v.target);
      },
      goTo: (cam) => fly(cam.position, cam.lookAt ?? c),
    };
  }, [camera, controls, size, center, radius]);
  return null;
}

// A glTF point cloud without a material is drawn by three.js one pixel per point,
// which leaves a sparse cloud almost invisible. Give such points a size in metres
// from their spacing (area seen from above / count), so that they touch.
function sizePoints(root: Object3D, fov: number) {
  root.traverse((o) => {
    if (!(o instanceof Points) || !(o.material instanceof PointsMaterial) || o.material.sizeAttenuation) return;
    const box = new Box3().setFromObject(o);
    const count = o.geometry.getAttribute('position')?.count ?? 0;
    if (count === 0) return;
    const spacing = Math.sqrt(((box.max.x - box.min.x) * (box.max.z - box.min.z)) / count);
    // three.js draws a point size*(h/2)/depth px tall; an m-metre object is m*(h/2)/(depth*tan(fov/2))
    o.material.size = (1.5 * spacing) / Math.tan(((fov / 2) * Math.PI) / 180);
    o.material.sizeAttenuation = true;
    o.material.needsUpdate = true;
  });
}

function useSizedPoints(root: Object3D) {
  const { camera } = useThree();
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
  useMemo(() => sizePoints(root, fov), [root, fov]);
}

// Loads a progressive model's detailed version without showing it, then makes it the
// chosen option. useGLTF caches the result, so the swap itself does not suspend.
function Upgrade({ url, onReady }: { url: string; onReady: () => void }) {
  useGLTF(url);
  useEffect(onReady, [onReady]);
  return null;
}

export interface PlacedModel {
  url: string;
  position: [number, number, number];
}

// A model painted into the Scene besides the main one (e.g. the ground). Each loads
// in its own Suspense so that switching it does not hide the rest of the scene.
function PlacedGLTF({ url, position }: PlacedModel) {
  const model = useGLTF(url);
  useSizedPoints(model.scene);
  return (
    <group position={position}>
      <Clone object={model.scene} />
    </group>
  );
}

// Plays the animations stored in the model (glTF animations), looped, all at once.
// The play/pause button outside the 3D view switches modelAnimationAtom.playing.
function useModelAnimation(model: { animations: import('three').AnimationClip[] }) {
  const root = useRef<Group>(null);
  const { actions } = useAnimations(model.animations, root);
  const setAnimation = useSetAtom(modelAnimationAtom);
  const { playing } = useAtomValue(modelAnimationAtom);

  useEffect(() => {
    setAnimation({ clips: model.animations.length, playing: true });
    return () => setAnimation({ clips: 0, playing: true });
  }, [model, setAnimation]);

  useEffect(() => {
    const all = Object.values(actions);
    all.forEach((a) => a?.reset().play());
    return () => all.forEach((a) => a?.stop());
  }, [actions]);

  useEffect(() => {
    Object.values(actions).forEach((a) => {
      if (a) a.paused = !playing;
    });
  }, [actions, playing]);

  return root;
}

export default function Scene({
  glbUrl,
  extraModels = [],
  viewRef,
}: {
  glbUrl: string;
  extraModels?: PlacedModel[];
  viewRef?: Ref<ViewHandle>;
}) {
  const [showAnnotations] = useAtom(showAnnotationsAtom);
  const [manifest] = useAtom(manifestAtom);
  const sceneId = useAtomValue(sceneIdAtom);
  const [paintedModels] = useAtom(paintedModelsAtom);
  const [choices, setChoices] = useAtom(modelChoicesAtom);
  const model = useGLTF(glbUrl);
  useSizedPoints(model.scene);
  const upgrades = useMemo(
    () =>
      paintedModels.flatMap((m) => {
        const url = upgradeUrl(m, choices);
        return url ? [{ id: m.id, url, index: m.options.length - 1 }] : [];
      }),
    [paintedModels, choices],
  );
  const cam = useMemo(() => defaultCameraOf(manifest, sceneId), [manifest, sceneId]);
  const sphere = useMemo(() => new Box3().setFromObject(model.scene).getBoundingSphere(new Sphere()), [model]);
  const setModelRadius = useSetAtom(modelRadiusAtom);
  useEffect(() => {
    setModelRadius(sphere.radius);
    return () => setModelRadius(null);
  }, [sphere, setModelRadius]);
  const animationRoot = useModelAnimation(model);
  // 測る: シーンに spatialScale があり、ボタンが入っているときだけ
  const spatialScale = useMemo(() => sceneSpatialScaleOf(manifest, sceneId), [manifest, sceneId]);
  const measuring = useAtomValue(measuringAtom) && !!spatialScale;
  const measure = useMeasure(measuring);
  // A model with animations is drawn as it is loaded, not as a copy: the copy rebuilds each light
  // with a new target, so a spot light that the animation moves would keep pointing at the origin.
  const body = (
    <group ref={animationRoot} onClick={measure.onClick}>
      {model.animations.length > 0 ? <primitive object={model.scene} /> : <Clone object={model.scene} />}
    </group>
  );

  return (
    <>
      {cam ? (
        <>
          {body}
          <ManifestCamera cam={cam} center={sphere.center} radius={sphere.radius} />
        </>
      ) : (
        /* Auto-frame the model regardless of its units (cm/m/mm) or center
           offset. Bounds fits the (makeDefault) OrbitControls camera to the
           model's bounding box on load, replacing the old fixed camera that
           left many Smithsonian scans off-screen / oversized. Only the model is
           wrapped so the fit targets the mesh, not the annotation markers. */
        <Bounds fit clip margin={1.2}>
          {body}
        </Bounds>
      )}
      {viewRef && <ViewController handle={viewRef} center={sphere.center} radius={sphere.radius} />}
      {extraModels.map((m, i) => (
        // a model beside the main one that fails to load is left out; the rest stays
        <ModelErrorBoundary key={`${i}:${m.url}`}>
          <Suspense fallback={null}>
            <PlacedGLTF url={m.url} position={m.position} />
          </Suspense>
        </ModelErrorBoundary>
      ))}
      {upgrades.map((u) => (
        // a detailed version that fails to load is given up; the light one stays
        <ModelErrorBoundary key={u.id}>
          <Suspense fallback={null}>
            <Upgrade
              url={u.url}
              onReady={() => startTransition(() => setChoices((c) => (u.id in c ? c : { ...c, [u.id]: u.index })))}
            />
          </Suspense>
        </ModelErrorBoundary>
      ))}
      {/* 測っている間は注釈の印を隠す（印のクリックが計測と混ざらないように） */}
      {model && showAnnotations && !measuring && <Annotations model={model} />}
      {measuring && spatialScale && (
        <MeasureMarks points={measure.points} scale={spatialScale} size={sphere.radius * 0.01} />
      )}
    </>
  );
}
