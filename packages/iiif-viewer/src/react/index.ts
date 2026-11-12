// Public API of iiif-kasane: React components on top of ./core.
export { Viewer, type ViewerProps, type ViewerActionsState } from './Viewer';
export {
  ViewerProvider,
  useViewer,
  useOptionalViewer,
  type ViewerProviderProps,
  type ViewerState,
} from './ViewerProvider';
export { CanvasView, type CanvasViewProps } from './CanvasView';
export { useManifest } from './useManifest';
export type { ViewerTarget, ViewerSelection } from './navigation';
export * from './atoms';
export {
  ViewerEnv,
  useSceneEnvironment,
  useLocale,
  useTranslations,
  useTheme,
  type ViewerLocale,
  type ResolvedTheme,
  type Translator,
} from './env';
export { messages as viewerMessages, type ViewerMessages } from './messages';
// The 3D parts (CanvasComponent, Scene, SceneEnvironment) are in 'iiif-kasane/scene'.
export { default as ModelChoice } from './three/ModelChoice';
export { registerDisplay } from './displays/registry';
export type { Display, DisplayProps } from './displays/types';
export { default as SidePanel } from './layout/SidePanel';
export { default as Info, type InfoTab } from './layout/panels/Info';
export { PANEL_IDS } from './panels/registry';
export type { Panel, PanelContext } from './panels/types';
// 権利のタブ（/georef の右の欄でも使う）
export { rightsPanel } from './panels/AboutPanel';
// パズルの始める欄（タブを隠して、使う側のタブに置くとき）
export { Puzzle, canPlayPuzzle } from './panels/PuzzlePanel';
export { default as AnnotationList } from './annotation/AnnotationList';
export { default as AnnotationCard } from './annotation/AnnotationCard';
export { default as Metadata } from './metadata/Metadata';
export {
  default as ImageCompareView,
  useCanvasImages,
  TINT_COLORS,
  type CompareBlend,
  type ImageCompareViewProps,
} from './displays/ImageCompareView';
export { useCompareSources } from './displays/useCompareSources';
// IIIF Auth 2.0 for pages that load models themselves (e.g. the compare page)
export { default as AuthPrompt } from './auth/AuthPrompt';
export { useAuthStates, type AuthState } from './auth/authStore';
export * from './compare/CompareParts';
export {
  default as GeoImageView,
  type GeoImagePoint,
  type GeoImageViewProps,
} from './georef/GeoImageView';
// 推論タブのモデルの定義（一覧ページ用。重い処理は load() の先にあるので、読み込んでも動き出さない）
export { MODELS as INFERENCE_MODELS } from './inference/models/registry';
export type { InferenceModel } from './inference/models/types';
