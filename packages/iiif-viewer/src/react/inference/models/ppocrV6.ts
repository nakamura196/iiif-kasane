import type { InferenceModel } from './types';

// PaddleOCR PP-OCRv6 (PaddlePaddle): line detection (DB) and text recognition (CTC), in two sizes.
// The files are PaddlePaddle's own ONNX exports on Hugging Face, used as they are.
// The steps are the same as v5 (core/features/inference/ppocr.ts): the official OCR pipeline keeps v5's pre- and
// post-processing values for v6.
// small and medium share the character list (ppocrV6.chars.json) and the runner; their inference.yml files differ
// only in model_name. Only the weights differ.
// The tiny version (6 MB in all) has no kana in its character list and cannot read Japanese, so it is not used.
const REPO = 'https://huggingface.co/PaddlePaddle';

const common = {
  license: 'Apache-2.0',
  credit: { ja: 'PaddlePaddle', en: 'PaddlePaddle' },
  homepage: 'https://github.com/PaddlePaddle/PaddleOCR',
  // Same as v5. The official pipeline detects at full size
  imageLongSide: 2048,
  load: () => import('./ppocrV6.run'),
};

export const ppocrV6: InferenceModel = {
  ...common,
  id: 'ppocrv6',
  name: { ja: 'PP-OCRv6 small（中国語・英語・日本語）', en: 'PP-OCRv6 small (Chinese, English, Japanese)' },
  description: {
    ja: '活字の資料（主に横書き）の文字を、行ごとに読み取ります。PP-OCRv5 の新しい版で、特に日本語の読み落としが減っています。medium より軽く、速く読めます。',
    en: 'Reads the text of printed material (mainly horizontal), line by line. The successor of PP-OCRv5, with notably fewer missed characters in Japanese. Lighter and faster than medium.',
  },
  files: [
    {
      name: 'detector',
      url: `${REPO}/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx`,
      bytes: 9880512,
    },
    {
      name: 'recognizer',
      url: `${REPO}/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx`,
      bytes: 21159378,
    },
  ],
};

// Measured on 2026-11-13 (docs/notes/browser-inference.md): fewer errors than small on English print and on
// Chinese woodblock books, at about 4 times the time and 139 MB of files.
export const ppocrV6Medium: InferenceModel = {
  ...common,
  id: 'ppocrv6-medium',
  name: { ja: 'PP-OCRv6 medium（中国語・英語・日本語）', en: 'PP-OCRv6 medium (Chinese, English, Japanese)' },
  description: {
    ja: 'PP-OCRv6 の大きい版です。small より読み誤りが少なくなります（英語の活字と漢籍で確かめました）。ファイルは約 139MB で、読み取りには small の 4 倍ほどの時間がかかります。',
    en: 'The larger version of PP-OCRv6. It misreads fewer characters than small (checked on English print and Chinese woodblock books). The files are about 139 MB, and reading takes about 4 times as long as small.',
  },
  files: [
    {
      name: 'detector',
      url: `${REPO}/PP-OCRv6_medium_det_onnx/resolve/61323801669c338b7891481ec7bac61ce31b576a/inference.onnx`,
      bytes: 62032837,
    },
    {
      name: 'recognizer',
      url: `${REPO}/PP-OCRv6_medium_rec_onnx/resolve/50c7eacafc52fa7bcf4194e8cd08e46f8558504b/inference.onnx`,
      bytes: 76554979,
    },
  ],
};
