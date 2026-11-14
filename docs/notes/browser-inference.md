# ブラウザ内の推論（OCR など）

## 2026-10-13

### 何をしたか

右パネルに「推論」タブを足した。モデルごとに「ダウンロード → この画像で実行 → 画像に重ねる・結果を保存」ができる。
最初のモデルは NDL古典籍OCR-Lite（行の検出 RTMDet-s ＋ 文字の読み取り PARSeq）。モデルは閲覧者のブラウザに保存し、画像は外に送らない。

今後もモデルが増える前提で、3 つに分けた。

- **モデルごとの部品**: `packages/iiif-viewer/src/react/inference/models/<名前>.ts`（名前・大きさ・ライセンス・取得元・`load()`）と、
  Worker の中でだけ読み込む `<名前>.run.ts`。一覧は `models/registry.ts` に 1 行
- **共通の実行の土台**: Worker 1 つ（`worker.ts`）、ブラウザへの保存（Cache Storage、`modelStore.ts`）、実行エンジンの読み込み（`ort.ts`）、
  画像の取り直し（`sourceImage.ts`）
- **結果は W3C / IIIF の AnnotationPage**（`core/features/inference/annotationPage.ts`）。OCR の行は motivation `supplementing`
  ＋ `textGranularity: "line"`、領域は `tagging`。どのモデルで作ったかは `generator`。既存の注釈の重ね表示にそのまま出し、JSON とテキストで保存できる

React・DOM に依存しない前処理・後処理（NMS、PIL と同じ BICUBIC の縮小、PARSeq の読み取り、行の読む順、AnnotationPage への書き出し）は
`core/features/inference/` に置き、テストを付けた（298 件すべて通過）。

### 対象モデルの調査（Hugging Face の nakamura196、2026-10-13 時点）

| まとまり | モデル | 大きさ |
|---|---|---|
| すぐ使える ONNX | ndlkotenocr-lite-web-onnx（RTMDet 40MB ＋ PARSeq 42MB） | 83MB |
| | ndlocr-lite-web-onnx（DEIM 40MB ＋ PARSeq 3 種 36〜41MB） | 154MB |
| | honkoku-ocr-onnx（レイアウト 37MB ＋ エンコーダ 90MB ＋ デコーダ 2 つ 60MB、int8） | 187MB |
| | metom-onnx / metom-komonjo-onnx（単字の分類） | 23MB |
| | yolo26x-ndl-layout-onnx（fp16 / fp32） | 112MB / 223MB |
| 大きすぎる | YOLO11x 系（codh-char・komonjo-char・kaokore-face・ukiyoe-face）の fp32 | 各 228MB |
| | yolov5-kao、retinaface-r50 | 346MB / 109MB |
| .pt だけ | yolov8s-layout（22MB）ほか、trocr-small-*（399MB） | — |

自明でなかったこと:

- honkoku-ocr-onnx の語彙表は HF に無く、kuzushiji-web 側にしか無い。Metom は単字の分類なので、文字の検出と組み合わせないと使えない
- HF の `resolve` は CORS を返す（`Origin` をそのまま返す）。ビューアの画像は既に `crossOrigin="anonymous"` で読んでいるので、
  表示できている画像なら画素も読める
- NDL古典籍OCR-Lite の字の一覧（NDLmoji.yaml）も HF には無い。`ndlKotenOcrLite.chars.json` として同梱した（7,141 字、約 50KB。Worker 側の chunk にだけ入る）

### 決めたこと・やめた案

- **実行エンジン（onnxruntime-web 1.26.0）は CDN（jsDelivr、版を固定）から実行時に読む。** 構成案では npm で入れて同梱するつもりだったが、やめた。
  WebGPU 用の wasm が約 26MB あり、サイトの配布物と `<iiif-viewer>` の埋め込みが重くなる。docviz・kuzushiji-web と同じ方式で、そちらで動作の実績がある。
  型は使う所だけ `ort.ts` に書いた（npm の onnxruntime-web は入れていない）
- **cross-origin isolation（COOP/COEP）は入れない。** 入れると wasm を複数スレッドで動かせるが、他所の IIIF 画像が読めなくなることがあり、
  Safari では COEP の credentialless が使えない。代わりに、検出は WebGPU（無ければ wasm）、読み取りは wasm 1 スレッド
- **画像は表示中のタイルではなく、IIIF Image API で長辺 1,600px に取り直す。** 1,600px は docviz で原本 `ocr.py` と 27 行すべて一致を確かめた大きさ
- **supplementing の注釈を、画像の一部を指すときは表示するようにした**（`core/features/annotations.ts`）。これまでは字幕などと同じく一律に除いていた。
  Canvas 全体を指す supplementing（字幕・文字起こし）は従来どおり除く
- 閲覧者の手元で作った AnnotationPage を混ぜる入口として `localAnnotationPagesAtom`（`overlays/canvasAnnotationState.ts`）を足した。推論以外（手で付けた注釈など）にも使える
- 切り抜き（region）・回転した画像は、結果の置き直しが未対応なので、実行前に断る

### 実測

NDL デジタルコレクション「銘尽」（https://dl.ndl.go.jp/api/iiif/1288371/manifest.json ）の 6 コマ目、Chrome（macOS）。

- ダウンロード 83MB: 10 秒以内
- 推論 18 行: 5.4 秒（検出 0.3 秒・WebGPU、読み取りの準備 2.0 秒、18 行の読み取り 3.0 秒・wasm）。dev と本番の書き出しで同じ
- 読めた行の例: 「国吉吉永二郎定俊恵永小次郎」「備前備中雑鍛冶交名」。刀工の名の一覧として筋が通っている（正解との突き合わせはしていない）
- 1 コマ目（表紙）のラベル「6 49」は「□□□□□□□」と読んだ。古典籍のモデルなので、数字のラベルは対象外とみてよい
- 本番の書き出しで 1 度だけ 43〜55 秒かかった。同じ条件で測り直すと 5.4 秒で、再現しなかった。
  タブが裏に回っていたときの減速と推測しているが、確かめていない

### 書き出しで分かったこと

- Next.js（Turbopack）は `new Worker(new URL('./worker.ts', import.meta.url))` を Worker として正しく束ねるが、**元の `worker.ts` も静的ファイルとして `out/` にそのまま出す**。
  実行には害が無いが、`out/` を残したまま次に build すると、型の検査がその `.ts` を読んで失敗する。`tsconfig.json` の exclude に `out` を足した
- `<iiif-viewer>`（Vite）では Worker は `dist/assets/worker-*.js` に出て、`copy-element.mjs` がそのまま `out/element/` に運ぶ

### 確かめていないこと

- Safari・Firefox・スマホでの動作（WebGPU が無い端末では wasm になるはずだが未確認）
- 原本 `ocr.py` との突き合わせ（docviz では一致を確認済みだが、Kasane の画像の取り方では未確認）
- Cache Storage の容量が足りないときの振る舞い

## 2026-10-13（続き）NDLOCR-Lite を足した

### 何をしたか

推論タブの 2 つ目のモデルとして NDLOCR-Lite（レイアウト検出 DEIM ＋ 文字の読み取り PARSeq 30 字・50 字・100 字の 3 本、計 154MB）を足した。
モデルの部品は `models/ndlOcrLite.ts`・`ndlOcrLite.run.ts`・`ndlOcrLite.chars.json`、一覧に 1 行。共通の土台（Worker・保存・AnnotationPage）は変えていない。
足した共通部分は、onnxruntime の int64 の入力の型（`ort.ts`）と、XY-cut の順位だけを返す `xyCutRanks`（`readingOrder.ts`）。

モデルの外の手順は `core/features/inference/ndlOcr.ts` に、原本 ndl-lab/ndlocr-lite（2026-10-13 の main）から写した。

- 検出の前処理（deim.py）: 正方形に黒を足す → PIL の BICUBIC で 800 角 → RGB・ImageNet の mean/std。しきい値は 0.25（ocr.py の既定）
- どの枠を行にするか（ndl_parser.py の convert_to_xml_string3）: 原本は XML を組み立てる。本文の塊・広告・表組への振り分け、
  入れ子の塊の統合、**行を持たない塊は塊そのものを 1 行にする**、を同じ形の木で再現した
- 読む順（xy_cut/eval.py の eval_xml）: XY-cut の順位 → 割注のまとめ（warichu_block.py）→ 塊ごとの並べ替えと重複の除去（reorder.py）
  → 並びのならし（smooth_order.py。前後 2 つまでの入れ替えで、紙面上の飛びと順位の差の合計が最小になる並び）。どれも写した
- 文字の読み取り（parseq.py・ocr.py の process_cascade）: 文字数の見込み（検出モデルの char_count）で 30 字用・50 字用・100 字用を選び、
  25 字・45 字以上読めたら次の大きさで読み直す。100 字用で 98 字以上の横書きの行は左右半分に分けて読む

### 自明でなかったこと

- **NDLOCR-Lite の PARSeq の前処理は、古典籍 OCR-Lite と違う。** 回すのは「高さが幅の 0.8 倍を超えたら」（古典籍は「高さ ＞ 幅」）、
  縮め方は OpenCV の `cv2.resize`（INTER_LINEAR）で、PIL の BICUBIC ではない。docviz の `src/parseq.ts` は両者を同じとして書いていたが、
  今の原本とは違っていた（docviz 側の見直しは別の作業）
- OpenCV の INTER_LINEAR を画素単位で同じにするには、固定小数点（重み 1/2048）と、縦方向の SIMD の丸め
  `(((a>>4)*b0>>16) + ((c>>4)*b1>>16) + 2) >> 2` まで写す必要があった。素直な丸め `(…+2^21)>>22` では 300 例中 290 例で 1 ずれる。
  もう 1 つの落とし穴: 横方向は端で重みを 0 にするが、**縦方向は行の番号を端に寄せるだけで重みはそのまま**（拡大のとき上下端の行が合わない）。
  cv2 4.13（arm64）の出力と、乱数の切り抜き 300 例すべてで一致（`pixels.ts` の `resizeLinearCv`）
- 検出モデルの入力は **800 角**（ONNX の入力の形で確認）。HF の README（nakamura196/ndlocr-lite-web-onnx）には 1024×1024 とあり、誤り
- 字の一覧（ndlocr-lite の NDLmoji.yaml）は 7,141 字で、古典籍 OCR-Lite の一覧と字数は同じだが**中身が違う**。別ファイルで同梱した
- 原本の癖も写した: 検出の後処理でラベルと文字数の見込みだけ絞り込み前の並びのまま使う（出力が確からしさ順なので結果は正しい）、
  並びのならしで塊の位置に最初ではなく最後の行を使う、細い塊を外すと塊の番号がずれる、など

### 実測（原本の ocr.py と突き合わせ）

原本を Python（onnxruntime 1.19.2、Pillow 10.4、OpenCV 4.13、networkx 3.2.1）で同じ画像に走らせ、LINE の枠・順・文字を比べた。

| 資料 | 行数 | 枠と読む順（テスト） | 文字（ブラウザ） | 時間（ブラウザ） |
|---|---|---|---|---|
| 国立国会図書館年報 昭和27年度（3048008）24 コマ目、幅 2,048px、横書き・見開き | 28 | 28 行すべて一致 | 28 行すべて一致 | 6.3 秒 |
| ndlocr-lite の見本 geppo1803_00021（827×1170、縦書き 2 段組＋見出し・図） | 53 | 53 行すべて一致 | 53 行すべて一致 | 8.6 秒 |

- 枠と読む順は、原本の検出の出力をそのまま `ndlOcrLines` に渡すテスト（`ndlOcr.test.ts`、出力は `fixtures/ndlocr-lite-layout.json`）
- 文字は、Chrome（macOS、検出 WebGPU・読み取り wasm）で推論タブから実行した結果と比べた。縦書きの見本は手元のサーバに置いたマニフェストで開いた
- 画像の長辺は 2,048px にした（docviz で字の誤り率 1,600px 5.7%・2,048px 4.0%）

### 確かめていないこと

- 割注（line_note）を含む頁、広告・表組の中の行、100 字用でもあふれる行（左右に分けて読む処理）は、実物で通していない（コードは原本を写しただけ）
- 塊の中の行が 64 を超えるときの並べ替え。原本は推移的でない比べ方で並べるので、結果は並べ替えの手順に左右される。
  Python も V8 も TimSort で、64 未満は同じ手順（二分挿入）なので一致するはずだが、64 以上は確かめていない
- 並びのならしで、順位の幅が 0 になる場合（原本は 0 で割って止まる）
- Safari・Firefox・スマホ

## 2026-10-14 顔の検出（顔貌コレクションで学習した YOLO11x）を足した

### 何をしたか

- 推論タブに 3 つ目のモデル「顔の検出（日本の絵画）」を足した（`models/kaokoreFace.ts`・`.run.ts`、共通の部品は `core/features/inference/yolo.ts`）。
  結果は `regions`（枠と `face` の札）で、既存の注釈への書き出しにそのまま乗った
- 検出の手順は face-web（nakamura196/face-web の `src/lib/ort-yolo.ts`・`sahi.ts`）から写した。face-web は同じモデルの fp32 版（228MB）を既にブラウザで動かしていた
- モデルは fp16 にして HF の既存リポジトリ nakamura196/yolov11x-kaokore-face に `best-fp16.onnx` として足した（コミット 526e7db、README に 1 段落）

### 決めたこと・やめた案

- **重みだけ fp16（onnxconverter-common、keep_io_types）。** 228MB → 114MB。int8 は WebGPU で使えない演算になりやすいのでやめた
- **全体で 1 回 ＋ 1,280 角に 20% 重ねて切った分（SAHI）。** 長辺 2,560px で取り直し、6 枚に切る。入力は 1,280 角・batch 1 の固定（書き出しが dynamic でない）なので 1 枚ずつ流す。
  まとめの NMS は face-web と同じ IoU 0.3、下限 0.25
- 当初「YOLO11x 系の fp32 は大きすぎる」として外していた（上の表）。face-web で実際に動いていたので、この判断は改めた

### 実測（NDL 1301975「江戸名所」1 コマ目、ndl-face-finder の edonohanami キュレーションの資料）

- fp32 と fp16（onnxruntime 1.31 CPU、1,280px）: 3 件とも同じ、枠の差は 1 画素以内
- 全体だけ: 3 件（キュレーションの 3 件すべて）。全体 ＋ 切った分: 21 件。描いて目で見ると 19 件が顔、2 件が違う（確からしさ 0.27・0.34）
- ブラウザ（Chrome、localhost、WebGPU）: 21 件、1.9 秒。Python の結果と件数が一致

### 確かめていないこと

- wasm（WebGPU の無いブラウザ）での時間。7 回流すので長くなるはず
- 浮世絵の顔のモデル（yolov11x-ukiyoe-face、入力 1,536 角）・YuNet（227KB、写実的な顔）・RetinaFace は未搭載。face-web にはある
- 顔コレの学習元（絵巻・絵本）と違う画風での取りこぼし

## 2026-10-14 顔の輪郭（顔の枠 → SAM 2.1 で多角形）を足した

### 何をしたか

- 推論の結果に輪郭（多角形）を持てるようにした（Detection の polygon）。輪郭のある領域は、注釈の target を
  枠（#xywh）ではなく SvgSelector の多角形にする。表示側は前から SvgSelector の多角形を描けたので、手を入れていない
- 推論タブに「顔の輪郭（日本の絵画）」を足した。顔の検出（kaokore-face と同じ）のあと、見つけた枠ごとに
  SAM 2.1 tiny（Meta、Apache-2.0）に枠を渡して範囲を塗らせ、そのいちばん大きなかたまりの外周をたどって多角形にする
  （Moore 近傍でたどり、Douglas-Peucker で 1 画素の誤差まで間引く。core/features/inference/contour.ts・sam2.ts）
- SAM は onnx-community/sam2.1-hiera-tiny-ONNX の fp16 版（エンコーダ 67MB・デコーダ 10MB）。重みが別ファイル（.onnx_data）
  なので、モデルのファイルに「重みのファイル」を持てるようにし、onnxruntime-web の externalData で渡した

### 決めたこと・やめた案

- **画像全体を 1 回だけエンコードするのはやめた。** SAM の入力は 1,024 角なので、長辺 2,560px の絵では 40px 前後の顔が
  16px になる。枠ごとに、枠の 2.5 倍（最低 160px）の正方形を切り出して 1,024 角に引き伸ばす。エンコーダは枠の数だけ回る
- **SlimSAM（SAM 1 を小さくしたもの、Xenova/slimsam-77-uniform、fp32 で計 40MB）はやめた。** 同じ 21 件で、マスクの面積が
  枠の 0.3〜10 倍とばらつき、多くは背景や人物全体を囲んだ（枠を 2 点・ラベル 2/3 で渡した。渡し方の誤りの可能性は残る）。
  SAM 2.1 tiny は枠に対して 0.22〜0.62 倍で、目で見て顔の形に沿っていた
- まずは「検出した枠 → 輪郭」だけにした。画面の操作を変えずに済むため。次は「画像をクリック → 輪郭」（点を渡す）

### 実測（前の節と同じ「江戸名所」、長辺 2,560px）

- Python（onnxruntime 1.31、CPU、M 系の Mac）: エンコーダ 1 回 0.6〜1.3 秒。IoU（モデル自身の見込み）は 0.78〜0.96、
  誤検出の 1 件（桜の花の部分）だけ 0.28。比べた図は手元の scratchpad（sam_cmp_2.5.jpg）で、git には入れていない
- Chrome（localhost、WebGPU）: 21 件・4.6 秒（枠だけのときは 1.9 秒。輪郭で約 2.7 秒増えた）。コンソールのエラーなし。
  画像の上に青い多角形が出た

### 確かめていないこと

- wasm での時間（エンコーダを 21 回回すので、かなり長くなるはず）
- 顔以外（人物・建物・器物）での輪郭の質
- SAM 2.1 の small 版（エンコーダ fp16 で 81MB）との差

## 2026-10-14 クリックで切り出す（画像をクリック → SAM 2.1 で多角形）を足した

### 何をしたか

- 推論タブに「クリックで切り出す」（`sam2-click`）を足した。ボタンで 1 回走らせるのではなく、
  「画像をクリックして切り出す」を押すと、画像の上の層（`overlays/PointPickOverlay.tsx`）がクリックを拾い、
  クリックのたびに SAM 2.1 tiny を走らせて、多角形の注釈（SvgSelector）を 1 件ずつ足す
- Shift+クリックで直前の形に範囲を足す（内側の点）、Alt+クリックで削る（外側の点）。直前の 1 件を置き換える
- SAM のファイルは顔の輪郭と同じ住所なので、どちらかを落とせば両方で使える（`models/sam2.ts` にまとめた）
- モデルの契約に `input: 'points'` と、実行時の `prompt`（点と、読む範囲）・`imageKey` を足した

### 決めたこと・やめた案

- **読む範囲は、画面に見えている部分。** 画像全体を 1,024 角に縮めると、顔ほどの物は数十画素になって形が取れない。
  見えている部分を切り出せば、拡大してからクリックするほど細かく取れる。狭すぎるとき（256px 未満）は広げる
- **画像を読む処理（エンコーダ）は、同じ範囲なら 1 回だけ。** Worker が最後に読んだ範囲を覚えておき、
  同じ範囲へのクリックはデコーダだけを流す。画面を動かせば読み直す
- 元の画像は長辺 3,072px で 1 回取る（Canvas ごとに画面側で持ち、Worker には写しを渡す）
- 点だけを渡すとき、枠は「0 個」（形 [1, 0, 4]）で渡す。SAM 1 の「詰め物の点（ラベル -1）」は要らない。
  Python の onnxruntime で、合成画像（赤い円・青い四角の中の黄色い円）で確かめた: 円をクリック → 円だけ、
  四角に内側の点＋黄色い円に外側の点 → 四角から円を抜いた形（面積 8,851 ≒ 計算値 8,885、マスク 256 角で数えた値）
- クリックとドラッグ（画像の移動）は、押してから離すまでの動きが 4px 以内かどうかで分ける。
  クリック中はダブルクリック（表示を元に戻す）を止める

### 実測（前の節と同じ「江戸名所」、キュレーションの 2 番目の開き方。Chrome、WebGPU）

- 中央の顔をクリック: 1 件、0.7 秒（画像の読み取りを含む。モデルの読み込みは別）。頭から胸元の赤い襟までを囲んだ
- 胸元を Alt+クリック: 頭だけになった。同じ範囲なので 0.1 秒未満
- 右下の顔をクリック: 2 件目が足された。「最後の 1 件を消す」で 1 件に戻った

### 確かめていないこと

- wasm（WebGPU の無い端末）での時間
- タッチ端末（スマートフォン）での操作。Shift・Alt が無いので、足し引きはできない
- 大きな資料をうんと拡大したとき: 元の画像が長辺 3,072px なので、それより細かくは取れない
  （IIIF Image API で見えている範囲だけを高い解像度で取り直せば良くなるはず。未着手）

### 追記: 多角形の線が太かった（同じ日）

- 多角形の注釈の線（2px）が、拡大に合わせて太くなっていた（深く拡大した開き方では 20px を超えた）。
  SVG の non-scaling-stroke は viewBox の引き伸ばしは打ち消すが、舞台の CSS の拡大は打ち消さない。
  枠の注釈と同じく、線の幅を拡大率で割った（`calc(2px / var(--image-scale))`）。顔の輪郭の結果も同じく細くなる
- クリックの印（緑・赤の点）も、大きさを拡大率で割ると白い枠だけになった。1px 未満の枠が 1px に丸められてから
  拡大されるため。決まった大きさで描いてから `scale(1 / 拡大率)` で縮める形にした（点の注釈と同じ）

## 2026-10-14 PaddleOCR（PP-OCRv5 mobile）を足した

### 何をしたか

- 推論タブに 2 つ足した: 「PP-OCRv5（中国語・英語・日本語）」と「PP-OCRv5（ラテン文字）」。行の検出（DB）は共通で、読み取り（CTC）だけが違う
- モデルは公式の Paddle の重み（PaddlePaddle/PP-OCRv5_mobile_det・PP-OCRv5_mobile_rec・latin_PP-OCRv5_mobile_rec、Apache-2.0）を
  paddle2onnx 2.1.0（opset 14）で ONNX にし、HF nakamura196/ppocrv5-mobile-web-onnx（rev dc7e227）に置いた。重みは float32 のまま。
  大きさは検出 4.8MB・読み取り 16.5MB・ラテン文字 8.0MB
- 手順は公式の PaddleOCR 3.7.0（paddlex の OCR パイプライン）を `core/features/inference/ppocr.ts` に写した。
  字の一覧は各モデルの inference.yml の character_dict（18,383 字と 836 字。先頭に CTC の空白、末尾に空白文字が付いて 18,385・838 クラス）

### 決めたこと・やめた案

- **Florence-2 より先にした。** PP-OCR は今の土台（onnxruntime-web を CDN から読む、Worker）にそのまま載り、合わせて 20MB 前後。
  Florence-2 は文章を 1 語ずつ組み立てる処理と単語の表引きが要り、いちばん軽い版（onnx-community/Florence-2-base-ft の q4f16）でも約 220MB
- **変換は自分でした。** RapidOCR の配布物は HF に無く（ModelScope）、HF にある第三者の変換は出どころが追いにくい
- **輪郭の取り方を簡単にした。** 公式は cv2.findContours の輪郭から最小外接矩形を取る。ここでは、つながった画素のかたまり（8 近傍）の
  行ごとの左右の端から凸包を作り、最小外接矩形を取る（同じ矩形になる）。広げる処理（pyclipper の丸い offset）は、四角形を各辺
  d = 面積 × 1.5 ÷ 周囲 だけ広げた四角形で代えた（その最小外接矩形と同じ）
- **切り出しは、整数にした四隅の最小外接矩形を取り直してから行う**（公式の get_minarea_rect_crop と同じ）。取り直さずに切ると、
  フランス語のページで字の差が 0.52% だった（取り直して 0.33%）
- 補間は OpenCV の INTER_CUBIC と同じ係数（a = -0.75）、縁は繰り返し。縮めるのは既存の resizeLinearCv（cv2.resize と同じ）
- 検出は WebGPU、読み取りは wasm（行ごとに入力の幅が変わる）。画像は長辺 2,048px で取る（公式は原寸のまま検出する）
- 斜めの行は四隅を polygon で返す（SvgSelector になる）。まっすぐな行は枠（xywh）のまま

### 実測

公式（PaddleOCR 3.7.0、Paddle 推論、文書の向き・ゆがみ・行の向きの判定は切る）と、写した手順（Node の onnxruntime 1.22、CPU）を
同じ画像（IIIF Image API の `!2048,2048`）で突き合わせた。行は枠の重なり（IoU）で対応を取った。

| 資料 | モデル | 行（公式／写し） | 全く同じ行 | 字の差 | 枠の IoU（最小／平均） |
|---|---|---|---|---|---|
| Internet Archive originofspecies00darwuoft、30 ページ（英語） | 中・英・日 | 42 / 42 | 39 | 3 / 2,266（0.13%） | 0.951 / 0.976 |
| Wellcome b21053613、7 ページ（フランス語、1877 年） | ラテン文字 | 48 / 48 | 40 | 10 / 3,055（0.33%） | 0.946 / 0.976 |

- 英語の差 3 字: 公式が "unintentionaly"、写しが "wil" と "iniherited"（片方ずつ誤り）
- フランス語の差はほぼアポストロフィの形（' と ’）の読み分け。モデル自身がどちらとも決めかねている字
- 変換前後（Paddle 推論と ONNX）の出力の差は、ランダムな入力で最大 1.3e-7（検出）・7.2e-5（読み取り）
- ブラウザ（Chrome、dev、WebGPU＋wasm）: 英語 42 行 6.0 秒、フランス語 48 行 6.4 秒（モデルの読み込みは別。初回は準備を含めて 13.0 秒）。
  枠は行の上に重なった。ブラウザの結果は Node の結果と 1 行（"will … unintentionally"、どちらも正しい側）だけ違った。JPEG の読み方の差とみられる

### 自明でなかったこと

- Internet Archive の資料は見開き（2 ページ並べ）で開く。**見開きの表示では、注釈の枠をそもそも描かない**（PagedDisplay は重ね表示を載せていない）。
  推論の結果も枠が出ず、テキストだけが出る。今回の変更より前からの制限。確認は、1 ページずつのマニフェストを手元に置いて行った
- paddle2onnx の出力を onnxruntime で開くと「使われていない初期値を消した」という警告が出るが、onnx の上では未使用の初期値は無い。
  onnxruntime 自身の最適化で生じたもので、害は無い
- 1 画素だけのかたまりで、最小外接矩形の計算が落ちた（凸包の辺の長さが 0）。テストで見つけて直した

### 確かめていないこと

- 中国語・日本語の資料での精度（中・英・日の版を英語でしか試していない）。縦書きは、縦長の行を左へ回して読む作り（公式と同じ）だが未確認
- 傾いた紙面（polygon になる行）の表示
- wasm だけの端末、Safari・Firefox、スマートフォン
- 公式の PP-OCRv5 には文書の向き・行の向きの判定（別のモデル）があるが、入れていない

## 2026-10-14 Florence-2（説明文・物の検出）を足した

### 何をしたか

- Microsoft の Florence-2 base-ft を、transformers.js 4.3.1 で動かすモデルとして 2 つ足した。
  「絵の説明文」（`<MORE_DETAILED_CAPTION>`、英語の段落）と「物の検出」（`<OD>`、英語の名前の付いた枠）。ファイルは共有
- 重みは onnx-community/Florence-2-base-ft（rev e88a44e、MIT。元の microsoft/Florence-2-* も MIT）。
  軽量化の組み合わせは公式デモ（Xenova/florence2-webgpu）と同じ: 画像の読み取りと語の表は fp16、encoder / decoder は q4。合計約 357MB
- 結果の種類に `description`（画像全体の説明文）を足した。注釈は motivation "describing"、target は画像全体の xywh
- モデルの部品に `engine: 'transformers'` を足した。この種のモデルでは、Worker が onnxruntime-web 1.26 を読まない
  （transformers.js は自分の onnxruntime-web 1.31.0-dev を CDN から読む。二重に読まないため）

### 決めたこと・やめた案

- **transformers.js を使い、デコーダを自前で書かない。** 文章を 1 語ずつ作る処理（KV キャッシュ付き）、BART のトークナイザ、
  出力の `<loc_*>` を座標に戻す処理を全部書くことになり、重い。transformers.js は CDN から読み、同梱しない（ort.ts と同じ理由）
- **ダウンロードは推論タブの仕組みのまま。** transformers.js が取りに行く住所（huggingface.co/<repo>/resolve/<rev>/<file>）を、
  推論タブの保存場所（Cache Storage）の鍵と同じにした。transformers.js の custom cache と custom fetch を差し替え、
  保存場所に無いモデルのファイルは取りに行かずに 404 と答える。transformers.js からの書き込みは止めた（「削除」で消せない物が残るため）
- large-ft はやめた（4 ビットでも約 580MB）。全部 q4f16 にすると約 223MB になるが、公式デモの組み合わせを優先した（精度を比べていない）
- WebGPU は GPU が半精度（shader-f16）に対応しているときだけ使い、無ければ wasm

### 実測（Chrome、dev、WebGPU）

| 画像 | 説明文 | 物の検出 |
|---|---|---|
| IIIF Cookbook 0005 のゲッティンゲンの写真（長辺 1,024px） | 2.0 秒。広場・建物・自転車・噴水・白い傘・旗を正しく挙げた | 0.8 秒、25 件（person・umbrella・building・bicycle など）。枠は物に重なった |
| ndl-face-finder「江戸の花見」2 番目（浮世絵） | 1.7 秒。"people riding horses … large body of water" — 外れ | 0.3 秒、2 件（poster＝全体、person） |

- 浮世絵には向かない。説明文にも「古い絵は外すこともあります」と書いた
- 車の写真（transformers.js の例）では、公式の例とほぼ同じ文が出た

### 自明でなかったこと

- **transformers.js 4.3.1 は、トークナイザの有無を確かめるとき版の指定を無視する**（`get_tokenizer_files` が `resolve/main/` の
  tokenizer_config.json を見る）。版を固定した保存場所では「無い」になり、`tokenizer_class` を読めずに落ちる。
  `resolve/main/` を固定した版の住所に読み替えて引くようにした
- transformers.js は `allowLocalModels` と `allowRemoteModels` を両方 false にすると、設定の誤りとして止まる。
  ネットに出さない制御は custom fetch で行う
- Worker で onnxruntime-web の代わりに渡す Proxy は、`then` を読まれても例外を投げてはいけない（Promise.all が「待つ物か」を確かめに読む）
- 説明文の注釈は画像全体を囲む枠として描かれる（重ねると画像全体が薄く色づく）

### 確かめていないこと

- wasm だけの端末（shader-f16 の無い GPU）、Safari・Firefox、スマートフォン
- 初回の準備時間（シェーダの用意）。今回はページで一度動かした後に測った
- 他のタスク（`<OCR_WITH_REGION>`、`<DENSE_REGION_CAPTION>`、言葉で探す `<CAPTION_TO_PHRASE_GROUNDING>`）
- q4f16 だけの組み合わせ（約 223MB）との精度の比較

## 2026-10-16 PP-OCRv6（small）を足した

### 何をしたか

- 推論タブに「PP-OCRv6（中国語・英語・日本語）」を足した。PP-OCRv5 の 2 つの上に並べた
- モデルは PaddlePaddle が HF に置いている公式の ONNX をそのまま使う
  （PaddlePaddle/PP-OCRv6_small_det_onnx rev 28fe589・PP-OCRv6_small_rec_onnx rev b8f84f0、Apache-2.0）。
  大きさは検出 9.9MB・読み取り 21.2MB（v5 は合わせて 21.3MB）
- 手順は v5 のもの（`ppocr.shared.ts` の `ppocrRunner`）をそのまま使い、字の一覧（18,708 字）だけを差し替えた
- 作業の手順を `docs/adding-inference-model.md` に書き起こした。突き合わせの道具を `scripts/inference/` に置いた

### 決めたこと・やめた案

- **tiny 版（合わせて 6.2MB）はやめた。** 公式の評価表では日本語の点が small より高い（89.8 と 88.2）が、
  字の一覧（6,904 字）に平仮名・片仮名が 1 字も無い（々・〆はある）。small には仮名 180 字がある
- **medium 版は試していない。** 公式のパイプラインの既定は medium だが、ONNX が大きい（未計測）
- **検出のしきい値は v5 と同じ値のまま。** v6 の検出モデルの inference.yml には thresh 0.2・box_thresh 0.4
  （small は 0.45）・unclip 1.4 とあるが、公式の OCR パイプライン（paddlex の `configs/pipelines/OCR.yaml`）が
  0.3・0.6・1.5 で上書きする。値をモデルごとに変えられる作りに一度直したが、公式に合わせるなら不要なので戻した
- 読み取りの前処理（高さ 48、幅 320 以上、3,200 まで）も v5 と同じ（paddlex の `text_recognition/predictor.py`）

### 実測

公式（PaddleOCR 3.7.0、onnxruntime 1.31 で ONNX を動かす、向き・ゆがみ・行の向きの判定は切る）と、
写した手順（Node の onnxruntime 1.22、CPU）を同じ画素で突き合わせた。

| 資料 | 版 | 行（公式／写し） | 全く同じ行 | 字の差 | 枠の IoU（最小／平均） |
|---|---|---|---|---|---|
| Internet Archive originofspecies00darwuoft、`$29`（英語） | v6 small | 9 / 9 | 9 | 0 / 372（0%） | 0.978 / 0.990 |
| NDL 3048008（国立国会図書館年報 1952）24 コマ目（和文・横書き、2048×1367） | v6 small | 32 / 32 | 20 | 16 / 900（1.78%） | 0.883 / 0.951 |
| 同上 | v5 mobile（参考） | 33 / 33 | 18 | 36 / 863（4.17%） | 0.910 / 0.960 |

- 和文の差は、枠の四隅が 1 画素ずれることで読みが変わったもの。紙面がわずかに傾いていて、ほとんどの行が
  斜めの四角形になっている。差の多くは写しの側が正しかった（公式「写冥」「ュネスコ」「ロックフラー」、
  写し「写真」「ユネスコ」「ロックフェラー」）。逆の例は「委员」（写し）など
- 公式の読み取りを 1 行ずつ（batch 1）にしても差は 1.56% で、まとめ方は主因ではなかった
- v5 は同じページで片仮名の読み落としが多い（「サーヴィスセンター」が「サーィンー」など）。v6 はほぼ読めた
- 写しの所要時間（Node、CPU）: 英語 9 行 0.5 秒、和文 32 行 1.0 秒。v5 は和文 33 行 3.7 秒
- ブラウザ（Chrome、dev、WebGPU＋wasm）: 同じ資料の 1 コマ目（表紙。和文と英文が混ざる）で 8 行、3.9 秒
  （ダウンロード直後の初回、準備を含む）。枠は行の上に重なり、文字はすべて正しかった

### 自明でなかったこと

- PP-OCRv6 のモデルカードの評価表の「JP」は、tiny の字の一覧から見て漢字中心の評価とみられる。
  点だけを見て tiny を選ぶと、仮名を読めないモデルを入れることになる
- 公式の ONNX は検出が opset 14、読み取りが opset 11。演算子は標準のもの（Erf・HardSigmoid など）だけで、
  onnxruntime-web 1.26 の WebGPU でそのまま動いた

### 確かめていないこと

- 縦書きの和文（縦長の行を左へ回して読む作りは v5 と同じ）
- v5 との精度の差を、正解の文字（人手の翻刻）と比べた数字。今回は公式との一致と、目で見た読み落としの比較だけ
- medium 版、wasm だけの端末、Safari・Firefox、スマートフォン

## 2026-10-17 表示中の範囲だけを推論にかける

### 何をしたか

各モデルに「表示中の範囲で実行」を足した。拡大して見ている範囲だけを切り出してモデルに渡す。
範囲を変えて押すと、結果を前の結果に足していく（絵巻を場面ごとに読み進めるため）。「この画像で実行」は今までどおり置き換える。
全体が見えているとき（Canvas の 98% 以上）に押すと、画像全体の実行と同じになる。

きっかけは福富草紙（クリーブランド美術館、76,716 × 2,577）。画像全体を長辺 2,048 に縮めると 2,048 × 69 px になり、文字も顔も潰れる。

### 作り

- 表示中の範囲: 画像の上に何も描かない層（`overlays/ViewRegionOverlay.tsx`）を置き、押したときにだけ範囲を読む。
  拡大・移動のたびに推論タブへ書き込むと、推論タブまで描き直しになるため。範囲の計算は注釈の印と同じ `visibleBoxOf` で、
  回転した表示にも対応させた（回転した画面を囲む枠）
- 画像の取り方は 3 通り（`sourceImage.ts` の `loadSourceRegion`）
  - Image API level 1 以上: region を指定して、その範囲だけ頼む
  - level 0 の静的タイル: 範囲にかかるタイルを、長辺がモデルの大きさ以上になるいちばん粗い縮尺で集め、つなぎ合わせる。
    64 枚を超えるときは縮尺を 1 段粗くし、いちばん粗くても超えるなら「範囲が広すぎます」と断る
  - サービスが無い画像・タイルの無い level 0: 取れるいちばん大きい画像から切り出す
- 位置の置き直しは、切り出した範囲のずれを座標の変換に足すだけ（`core/features/inference/region.ts`）

### 実測（福富草紙・顔の検出、YOLO11x・長辺 2,560、WebGPU）

| 読み方 | 見つかった顔 |
|---|---|
| 画像全体 | 0 件（2.4 秒） |
| 表示中の範囲 1 回目（数場面を表示） | 3 件（7.8 秒、うち画像の取得を含む） |
| 範囲を右へ移して 2 回目 | 11 件（1.4 秒）。足して 14 件 |

枠は絵の顔の上に正しく重なった。

### 確かめていないこと

- Image API level 1 以上のサーバでの範囲指定（作りは単純だが、実機では未確認）
- OCR のモデルでの読み取りの質（この端末に OCR のモデルを入れていなかった）
- 範囲を重ねて 2 回読んだときの重複は除いていない（同じ顔・行が 2 件になる）

## 2026-11-13 PP-OCRv6 medium beside small

### What was done

Added PP-OCRv6 medium to the Inference tab as a second model (`ppocrv6-medium`). small (`ppocrv6`) is kept as it was;
only its display name now says "small". The maintainer decided to offer both and let the viewer choose.

medium needs no new code: the `inference.yml` files of `PP-OCRv6_medium_det_onnx` / `_rec_onnx` differ from small's
only in `model_name` (same thresholds, same pre-processing, same character list of 18,708 characters), so medium reuses
`ppocrV6.run.ts` and `ppocrV6.chars.json`. The revisions are the ones Local OCR pins
(`det` 61323801…, `rec` 50c7eacaf…). Files: 62,032,837 + 76,554,979 bytes (139 MB; small is 31 MB).

### Measurements

English print: *Alice's Adventures in Wonderland* (1872, Internet Archive `alicesadventures00carruoft`), 11 pages,
ground truth from Project Gutenberg #11. Character error rate over letters and digits only; differences between the
editions add the same amount to every engine. Kasane's own pipeline in Node on CPU (`scripts/inference/ppocr-ours.mts`):

| Model | CER | Time for 12 pages (Node, CPU) |
|---|---|---|
| small | 1.43% | 17 s |
| small detection + medium recognition | 1.40% | 42 s |
| medium | 1.35% | 74 s |

For reference, on the same pages: PP-OCRv6 medium in Local OCR 1.20%, PaddleOCR-VL 1.50%, Apple Vision 1.72%.
With punctuation counted, all engines are at 4.48–6.07%.

Chinese woodblock book: Jiaxing Canon (Toyo Bunko IIIF), 177-03 to 05, 15 proofread pages, 292 lines, 5,714 characters.
Each line read inside NDL's line box; variant forms counted as the same character.

| Model | CER | Lines exactly right | Time per line (CPU, median) |
|---|---|---|---|
| NDL Koten OCR-Lite | 4.90% | – | – |
| PP-OCRv6 small | 1.65% (94 chars) | 216 | 10 ms |
| PP-OCRv6 medium | 1.45% (83 chars) | 223 | 40 ms |

Browser (this Mac, WebGPU for detection + wasm for recognition), Alice canvas 20 (24 lines): small 5.2 s, medium 20.5 s
(the second run; the first, with model preparation, 22.5 s). Both read the same 24 lines. No console errors.

### Not obvious

- The woodblock numbers use NDL's line boxes. When PP-OCRv6 also detects the lines, the error rate rises to 16.6%,
  because it also reads the ruler at the edge of the scan, the block centre and seals. Kasane lets PP-OCRv6 detect,
  so on woodblock books expect boxes outside the main text.

### Not checked

- medium on Japanese print (the 2026-10-16 comparison was for small only).
- Memory use of medium on phones.
