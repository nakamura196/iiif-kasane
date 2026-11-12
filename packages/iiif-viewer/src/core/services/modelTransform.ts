// The `transform` list of a SpecificResource painted into a Scene (Presentation 4.0):
// ScaleTransform, RotateTransform and TranslateTransform, applied in the order listed.
//
// RotateTransform: x, y, z are degrees, counter-clockwise (right-handed), about the
// local origin; with more than one axis, the rotation is made about x first, then y,
// then z (so the matrix is Rz · Ry · Rx).
//
// The result is one 4x4 matrix in column-major order (three.js Matrix4.elements),
// or undefined when there is nothing to apply.

type Json = Record<string, unknown>;
type M4 = number[];

const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

// a · b (apply b first, then a)
const mul = (a: M4, b: M4): M4 => {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  return out;
};

const rad = (deg: number) => (deg * Math.PI) / 180;

const rotX = (deg: number): M4 => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};
const rotY = (deg: number): M4 => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};
const rotZ = (deg: number): M4 => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};

const stepOf = (t: Json): M4 | null => {
  switch (t?.type) {
    case 'RotateTransform':
      return mul(rotZ(num(t.z, 0)), mul(rotY(num(t.y, 0)), rotX(num(t.x, 0))));
    case 'ScaleTransform':
      return [num(t.x, 1), 0, 0, 0, 0, num(t.y, 1), 0, 0, 0, 0, num(t.z, 1), 0, 0, 0, 0, 1];
    case 'TranslateTransform':
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, num(t.x, 0), num(t.y, 0), num(t.z, 0), 1];
    default:
      return null;
  }
};

export const transformMatrixOf = (transform: unknown): M4 | undefined => {
  const list = Array.isArray(transform) ? transform : transform == null ? [] : [transform];
  let m: M4 | null = null;
  for (const t of list) {
    const step = stepOf(t as Json);
    if (step) m = mul(step, m ?? IDENTITY);
  }
  return m ?? undefined;
};

// A point moved by the matrix (for tests and for callers that place things beside a model).
export const applyMatrix = (m: M4, p: [number, number, number]): [number, number, number] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
