'use client';

import { useState } from 'react';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Vector3 } from 'three';
import { distanceBetween, formatLength, type SpatialScale } from '../../core';

// 測る: モデルをクリックした 2 点に印を置き、線と長さを描く。3 回目のクリックで新しい計測を始める。
// 長さは「シーンの単位 × spatialScale」。クリックの拾い方は注釈エディタと同じ（レイキャストの交点 event.point）。
export function useMeasure(active: boolean) {
  const [points, setPoints] = useState<Vector3[]>([]);
  // 切ったら点を消す
  if (!active && points.length > 0) setPoints([]);
  // モデルの onClick に渡す。測っていないときは何もしない（注釈の選択などは元の処理に任せる）
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (!active) return;
    event.stopPropagation();
    const p = event.point.clone();
    setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  };
  return { points: active ? points : [], onClick };
}

export default function MeasureMarks({
  points,
  scale,
  size,
}: {
  points: Vector3[];
  scale: SpatialScale;
  // 印の大きさ（シーンの単位。モデルの大きさに比例させる）
  size: number;
}) {
  const [a, b] = points;
  const mid = a && b ? a.clone().add(b).multiplyScalar(0.5) : null;
  return (
    <>
      {points.map((p, i) => (
        // 面の手前に隠れないよう depthTest を切る
        <mesh key={i} position={p} renderOrder={999}>
          <sphereGeometry args={[size, 16, 16]} />
          <meshBasicMaterial color="#f97316" depthTest={false} transparent />
        </mesh>
      ))}
      {a && b && mid && (
        <>
          <Line points={[a, b]} color="#f97316" lineWidth={2} depthTest={false} renderOrder={998} />
          <Html position={mid} center style={{ pointerEvents: 'none' }}>
            <div className="px-2 py-0.5 rounded bg-white/90 dark:bg-gray-800/90 text-sm font-medium text-gray-900 dark:text-gray-100 shadow whitespace-nowrap">
              {formatLength(distanceBetween(a.toArray(), b.toArray()), scale)}
            </div>
          </Html>
        </>
      )}
    </>
  );
}
