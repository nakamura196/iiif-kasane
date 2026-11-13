# IIIF Kasane

[English](README.md)

IIIF の Manifest に沿って、3D モデル・画像・音声・動画を表示し、注釈を付けて見るための Web アプリケーションです。

旧名は **IIIF 3D Viewer** です。3D のビューアとして始まり、いまは他のメディアも扱います。名前の「重ね」は、平安装束の「重ねの色目」から取りました。モデル・画像・メディア・注釈を、1 つの画面に重ねて見せます。

- サイト: https://kasane.ldas.jp/ja/
- 埋め込み用の部品（npm）: [`iiif-kasane`](https://www.npmjs.com/package/iiif-kasane)。使い方は https://kasane.ldas.jp/ja/developers/

## できること

- **3D モデル**: GLB/GLTF と点群、初期の視点、同じ位置に置いた複数のモデルの切り替え
- **画像**: IIIF Image API による深いズーム、回転、複数の画像を合成した Canvas
- **音声・動画**: 字幕と時刻つきの文字起こし、複数のメディアを組み合わせた Canvas
- **注釈**: 3D モデル上の点・画像の領域・メディアの時刻。まとめ、タグ、検索、絞り込み
- **比較と地図**: 2 つのモデルを並べる・スワイプ・のぞき窓で比べる。位置情報つきの資料の地図表示
- **構造・共有・埋め込み**: 目次、ページ送り、見開き、Collection、IIIF Content State のリンク、`<iiif-viewer>` 要素
- **IIIF Curation API**: 複数の manifest から集めたキュレーションを 1 つの資料として開く
- **日本語と英語**、静的なサイトとしての書き出し、スマートフォンでの表示

## 開発・貢献

開発の手順、プロジェクトの構成、配布の方法は、英語の [README.md](README.md) にあります。
貢献の手引きは [CONTRIBUTING.md](CONTRIBUTING.md) です。Issue と PR は日本語でもかまいません。

## ライセンス

[LICENSE](LICENSE) を参照してください。
