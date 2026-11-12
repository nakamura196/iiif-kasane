import { InfoView } from '../panels/AboutPanel';
import { useOptionalViewer } from '../ViewerProvider';

// 資料全体の情報（右パネルの「資料情報」タブと同じもの）。単体で置くときに使う。
// ViewerProvider の中では、表示中の頁の情報も出す。
const Metadata = () => {
  const viewer = useOptionalViewer();
  return <InfoView container={viewer?.container} />;
};

export default Metadata;
