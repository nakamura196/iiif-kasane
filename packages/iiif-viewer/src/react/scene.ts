// iiif-kasane/scene: the 3D display (three.js, react-three-fiber, drei, gsap, three-stdlib).
// Importing this module registers it, so that <Viewer> / <CanvasView> show IIIF Scenes:
//   import 'iiif-kasane/scene';
// Without it the main entry needs none of the 3D packages, and a Scene shows a short notice.
import { registerDisplay } from './displays/registry';
import { sceneDisplay } from './displays/SceneDisplay';

registerDisplay(sceneDisplay);

export { sceneDisplay };
export { default as CanvasComponent } from './three/Canvas';
export { default as Scene, type PlacedModel, type ViewHandle } from './three/Scene';
export {
  default as SceneEnvironment,
  resolveSceneEnvironment,
  type SceneEnvironmentOption,
} from './three/SceneEnvironment';
