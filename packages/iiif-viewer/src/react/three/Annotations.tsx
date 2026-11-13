'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import gsap from 'gsap';
import AnnotationMarker from '../three/AnnotationMarker';
import AreaMarker from '../three/AreaMarker';
import { useAtom, useAtomValue } from 'jotai';
import { annotationsAtom, visibleAnnotationsAtom } from '../atoms';
import { selectedAnnotationIdAtom } from '../atoms';
import { storyNotesAtom, storyOpenAtom } from '../overlays/storyState';
import { useTranslations } from '../env';
import { useEffect } from 'react';
import { Vector3, Mesh, Frustum, Matrix4, Raycaster, Box3, Sphere } from 'three';
import { computeFocusCamera, runFocusFlight } from '../../core';
import { groupByRegion } from '../../core';
import { GLTF } from 'three-stdlib';

// 再利用可能なオブジェクト
const sharedFrustum = new Frustum();
const sharedMatrix = new Matrix4();
const sharedRaycaster = new Raycaster();
const sharedCameraDirection = new Vector3();
const sharedToAnnotation = new Vector3();
const prevCameraPosition = new Vector3();

// パフォーマンス設定
const CAMERA_MOVE_THRESHOLD = 0.01; // カメラ移動の閾値（スクロール時の微小な動きを無視）
const IDLE_FRAMES_BEFORE_RAYCAST = 30; // 停止後このフレーム数待ってからRaycast（約0.5秒 @ 60fps）

export default function Annotations({ model }: { model: GLTF }) {
  const t = useTranslations('Viewer');
  const [openAnnotationId, setOpenAnnotationId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useAtom(selectedAnnotationIdAtom);
  const [annotations] = useAtom(annotationsAtom);
  const [visibleAnnotations] = useAtom(visibleAnnotationsAtom);
  const { camera } = useThree();
  // OrbitControls(makeDefault)。注視点(target)を動かす・飛行中に無効化するために取得。
  const controls = useThree((s) => s.controls) as unknown as
    | { target: Vector3; update?: () => void; enabled?: boolean }
    | null;
  const [meshList, setMeshList] = useState<Mesh[]>([]);
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>({});
  const idleFrameCountRef = useRef(0);
  const needsRaycastRef = useRef(true);

  useEffect(() => {
    const meshes: Mesh[] = [];
    model.scene.traverse((child) => {
      if (child.type === 'Mesh') {
        meshes.push(child as Mesh);
      }
    });
    setMeshList(meshes);
  }, [model]);

  // 同じ場所（target.id が同じ）の注釈は、印を 1 つにまとめる
  // 検索・絞り込みで外れた注釈の印は出さない
  const regionGroups = useMemo(() => groupByRegion(visibleAnnotations), [visibleAnnotations]);
  // 番号は一覧と同じく、全注釈の中での順番
  const numberOf = useMemo(
    () => new Map(annotations.map((a, i) => [a.id, i + 1])),
    [annotations],
  );

  // アノテーション位置をメモ化
  const annotationPositions = useMemo(() => {
    const positions: Record<string, Vector3> = {};
    annotations.forEach((annotation) => {
      const value = annotation.data?.target?.selector?.value;
      if (value) {
        positions[annotation.id] = new Vector3(value[0], value[1], value[2]);
      }
    });
    return positions;
  }, [annotations]);

  // カメラが停止した時のみRaycastを実行
  useFrame(() => {
    if (annotations.length === 0) return;

    // カメラの移動量をチェック
    const cameraMoved = camera.position.distanceTo(prevCameraPosition) > CAMERA_MOVE_THRESHOLD;
    prevCameraPosition.copy(camera.position);

    if (cameraMoved) {
      // カメラが動いている間はカウンタをリセット
      idleFrameCountRef.current = 0;
      needsRaycastRef.current = true;
      return;
    }

    // カメラが停止している
    idleFrameCountRef.current++;

    // 停止後、一定フレーム待ってからRaycast実行（1回のみ）
    if (!needsRaycastRef.current) return;
    if (idleFrameCountRef.current < IDLE_FRAMES_BEFORE_RAYCAST) return;

    // Raycast実行
    needsRaycastRef.current = false;

    // Frustum更新
    sharedMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    sharedFrustum.setFromProjectionMatrix(sharedMatrix);
    camera.getWorldDirection(sharedCameraDirection);

    const newVisibilityMap: Record<string, boolean> = {};
    const visibleAnnotations: { id: string; position: Vector3 }[] = [];

    // 第1パス: Frustum + カメラ前方判定（軽量）
    annotations.forEach((annotation) => {
      const position = annotationPositions[annotation.id];
      if (!position) {
        newVisibilityMap[annotation.id] = true;
        return;
      }

      // Frustum判定
      if (!sharedFrustum.containsPoint(position)) {
        newVisibilityMap[annotation.id] = false;
        return;
      }

      // カメラ前後判定
      sharedToAnnotation.subVectors(position, camera.position).normalize();
      if (sharedCameraDirection.dot(sharedToAnnotation) <= 0) {
        newVisibilityMap[annotation.id] = false;
        return;
      }

      // 視野内のアノテーションをリストに追加
      visibleAnnotations.push({ id: annotation.id, position });
    });

    // 第2パス: 視野内のアノテーションのみRaycast（重い処理）
    if (meshList.length > 0) {
      visibleAnnotations.forEach(({ id, position }) => {
        sharedToAnnotation.subVectors(position, camera.position).normalize();
        sharedRaycaster.set(camera.position, sharedToAnnotation);
        const intersects = sharedRaycaster.intersectObjects(meshList, true);
        const distance = camera.position.distanceTo(position);

        if (intersects.length > 0 && intersects[0].distance < distance - 0.01) {
          newVisibilityMap[id] = false;
        } else {
          newVisibilityMap[id] = true;
        }
      });
    } else {
      // メッシュがない場合は視野内=可視
      visibleAnnotations.forEach(({ id }) => {
        newVisibilityMap[id] = true;
      });
    }

    setVisibilityMap(newVisibilityMap);
  });

  // モデルのバウンディング球（半径はフォーカス時のカメラ距離の基準、中心は視点が無いときの向きの基準）
  const { focusRadius, focusCenter } = useMemo(() => {
    const sphere = new Sphere();
    new Box3().setFromObject(model.scene).getBoundingSphere(sphere);
    return {
      focusRadius: sphere.radius || 1,
      focusCenter: [sphere.center.x, sphere.center.y, sphere.center.z] as [number, number, number],
    };
  }, [model]);

  const focusOnAnnotation = useCallback((annotationId: string) => {
    const annotation = annotations.find((a) => a.id === annotationId);
    if (!annotation) return;

    const selector = annotation.data?.target?.selector;
    const value = selector?.value;
    if (!value) return;
    const camPosRaw = selector?.camPos as number[] | undefined;
    const normalRaw = selector?.normal as number[] | undefined;
    const lookAtRaw = selector?.camLookAt as number[] | undefined;

    const { position, target } = computeFocusCamera({
      target: [value[0], value[1], value[2]],
      cameraPos: [camera.position.x, camera.position.y, camera.position.z],
      radius: focusRadius,
      // camPos は「点と異なる場合のみ」有効視点として扱われる（parser は
      // カメラ注釈が無いと camPos=点 にフォールバックするため）。
      camPos: Array.isArray(camPosRaw) && camPosRaw.length >= 3
        ? [camPosRaw[0], camPosRaw[1], camPosRaw[2]]
        : null,
      // マニフェストのカメラが向く先（lookAt）。あれば回転の中心にする
      camLookAt: Array.isArray(lookAtRaw) && lookAtRaw.length >= 3
        ? [lookAtRaw[0], lookAtRaw[1], lookAtRaw[2]]
        : null,
      // 注釈の法線（Voyager direction）で正面から見る。
      normal: Array.isArray(normalRaw) && normalRaw.length >= 3
        ? [normalRaw[0], normalRaw[1], normalRaw[2]]
        : null,
      // 視点も法線も無いときは、モデルの中心から点へ向かう外向きに見る
      center: focusCenter,
    });

    // 飛行の実行（トゥイーン掃除・飛行中の controls 無効化・完了後の復帰）は
    // runFocusFlight に集約（依存注入でユニットテスト可能）。
    runFocusFlight({ camera, controls, gsap }, position, target);
  }, [annotations, camera, controls, focusRadius, focusCenter]);

  // A click on a mark that has its own Camera (`scope`) flies there: that is the view its maker chose.
  // A mark without one only opens its label, and the view moves from the label's button: framing the
  // point by itself went right up to it (Lincoln's life mask, 2026-11-12), unlike Voyager, which stays.
  // Notes picked elsewhere (the list) still fly, as before.
  const stay = useRef(false);
  const ownCamera = (a: (typeof annotations)[number] | undefined): boolean => {
    const s = a?.data?.target?.selector;
    const cam = s?.camPos as number[] | undefined;
    const at = s?.value as number[] | undefined;
    return !!cam && !!at && cam.some((v, i) => v !== at[i]);
  };
  const pick = (a: (typeof annotations)[number]) => {
    if (a.id === selectedAnnotationId) {
      // already selected (the effect will not run again): open it, and fly back to its Camera
      setOpenAnnotationId(a.id);
      if (ownCamera(a)) focusOnAnnotation(a.id);
      return;
    }
    stay.current = !ownCamera(a);
    setSelectedAnnotationId(a.id);
  };
  // While a story is read, each step opens the label of the notes it names (`scope`), as a Voyager tour
  // step opens its active annotation, and the other marks step back. A step that names none closes it.
  const storyOpen = useAtomValue(storyOpenAtom);
  const storyNotes = useAtomValue(storyNotesAtom);
  const told = storyOpen ? storyNotes : null;
  useEffect(() => {
    if (told) setOpenAnnotationId(told[0] ?? null);
  }, [told]);
  const zoom = { label: t('zoomToNote'), onClick: () => openAnnotationId && focusOnAnnotation(openAnnotationId) };

  useEffect(() => {
    if (selectedAnnotationId) {
      setOpenAnnotationId(selectedAnnotationId);
      if (stay.current) stay.current = false;
      else focusOnAnnotation(selectedAnnotationId);
    }
  }, [selectedAnnotationId, focusOnAnnotation]);

  return (
    <>
      {regionGroups.map((group) => {
        // 形は先頭の注釈から取る（拡張の決まりで、同じ場所の注釈は同じ形を持つ）
        const annotation = group.annotations[0];
        const type = annotation.data?.target?.selector?.type;
        const isOpen = group.annotations.some((a) => a.id === openAnnotationId);
        const dimmed = !!told?.length && !group.annotations.some((a) => told.includes(a.id));
        const label = group.annotations.length > 1
          ? group.annotations.map((a) => a.data.body.label).filter(Boolean).join(' / ')
          : undefined;

        return type === 'PointSelector' ? (
          <AnnotationMarker
            key={group.key}
            annotation={annotation}
            label={label}
            isOpen={isOpen}
            onClick={() => pick(annotation)}
            action={isOpen ? zoom : undefined}
            isVisible={visibilityMap[annotation.id] ?? true}
            dimmed={dimmed}
            named={storyOpen}
          />
        ) : (
          <AreaMarker
            key={group.key}
            number={String(numberOf.get(annotation.id) ?? '')}
            annotation={annotation}
            label={label}
            isOpen={isOpen}
            onClick={() => pick(annotation)}
          />
        );
      })}
    </>
  );
}
