import { readFileSync } from 'node:fs';
import { parseBabyCage } from '../src/physics/baby-cage.ts';

export function loadModel() {
  const bytes=readFileSync('src/assets/model/jelly-baby.bin');
  return parseBabyCage(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
    JSON.parse(readFileSync('src/assets/model/jelly-baby.json','utf8')));
}
