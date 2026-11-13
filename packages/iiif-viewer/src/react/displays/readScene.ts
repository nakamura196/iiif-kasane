import { paintedModelsOf, parseManifestV4, sceneOf, type ManifestV4 } from '../../core';

/** What the 3D display reads from the Scene on display: its painted models and notes. */
export interface SceneRead {
  paintedModels: ReturnType<typeof paintedModelsOf>;
  annotations: ReturnType<typeof parseManifestV4>['annotations'];
}

/** Read a Scene of the manifest. null (reported on the console) when it cannot be parsed. */
export function readScene(manifest: ManifestV4, sceneId: string, locale: string): SceneRead | null {
  try {
    return {
      paintedModels: paintedModelsOf(sceneOf(manifest, sceneId)),
      annotations: parseManifestV4(manifest, sceneId, locale).annotations,
    };
  } catch (e) {
    console.error('Error reading manifest:', e);
    return null;
  }
}
