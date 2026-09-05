import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const clang=process.env.CLANG||'clang';
const dir=mkdtempSync(join(tmpdir(),'jelly-kernel-'));
try {
  const wasm=join(dir,'soft-body-kernel.wasm');
  execFileSync(clang,[
    '--target=wasm32','-O3','-fno-builtin','-nostdlib',
    '-Wl,--no-entry','-Wl,--export-memory',
    '-Wl,--initial-memory=16777216','-Wl,--max-memory=16777216',
    'scripts/native/soft-body-kernel.c','-o',wasm,
  ],{stdio:'inherit'});
  const encoded=readFileSync(wasm).toString('base64');
  const file='src/physics/soft-body-kernel.js';
  const source=readFileSync(file,'utf8');
  const pattern=/const KERNEL_BASE64='[^']*';/;
  if(!pattern.test(source))throw new Error('Could not find generated kernel payload');
  const next=source.replace(pattern,`const KERNEL_BASE64='${encoded}';`);
  writeFileSync(file,next);
  console.log(`Embedded ${readFileSync(wasm).byteLength} byte WebAssembly kernel in ${file}`);
} finally {
  rmSync(dir,{recursive:true,force:true});
}
