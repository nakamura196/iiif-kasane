import { ppocrRunner } from './ppocr.shared';
// The character list (character_dict in inference.yml of PaddlePaddle/PP-OCRv6_small_rec_onnx; Apache-2.0).
// PP-OCRv6_medium_rec_onnx has the same list, so both sizes use this runner.
import chars from './ppocrV6.chars.json';

export const run = ppocrRunner(chars as string[]);
