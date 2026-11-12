import { describe, expect, it } from 'vitest';
import { applyMatrix, transformMatrixOf } from './modelTransform';
import { paintedModelsOf } from './paintedModels';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('transformMatrixOf', () => {
  it('is undefined when there is nothing to apply', () => {
    expect(transformMatrixOf(undefined)).toBeUndefined();
    expect(transformMatrixOf([{ type: 'Unknown' }])).toBeUndefined();
  });

  it('rotates as in the spec example: (1, 1, 0) by 90 about x gives (1, 0, 1)', () => {
    const m = transformMatrixOf([{ type: 'RotateTransform', x: 90 }])!;
    close(applyMatrix(m, [1, 1, 0]), [1, 0, 1]);
  });

  it('rotates about x first, then y, then z', () => {
    const m = transformMatrixOf([{ type: 'RotateTransform', x: 90, y: 90 }])!;
    // x: (0, 1, 0) -> (0, 0, 1); then y: (0, 0, 1) -> (1, 0, 0)
    close(applyMatrix(m, [0, 1, 0]), [1, 0, 0]);
  });

  it('applies the list in order', () => {
    const m = transformMatrixOf([
      { type: 'ScaleTransform', x: 2, y: 2, z: 2 },
      { type: 'TranslateTransform', x: 1 },
    ])!;
    close(applyMatrix(m, [1, 0, 0]), [3, 0, 0]);
  });
});

describe('paintedModelsOf with a SpecificResource body', () => {
  it('reads the Model inside and its transform', () => {
    const scene = {
      id: 's',
      type: 'Scene',
      items: [
        {
          type: 'AnnotationPage',
          items: [
            {
              id: 'a',
              type: 'Annotation',
              motivation: ['painting'],
              body: {
                type: 'SpecificResource',
                source: [{ id: 'https://example.org/m.glb', type: 'Model' }],
                transform: [{ type: 'RotateTransform', y: 180 }],
              },
              target: 's',
            },
          ],
        },
      ],
    };
    const [model] = paintedModelsOf(scene as never);
    expect(model.options[0].url).toBe('https://example.org/m.glb');
    close(applyMatrix(model.options[0].matrix!, [1, 0, 0]), [-1, 0, 0]);
  });
});
