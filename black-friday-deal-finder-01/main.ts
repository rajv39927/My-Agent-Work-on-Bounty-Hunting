// Hand in the Black Friday Audit: copy this repo's app/ and screenshots/
// beside this file into the output directory and write the dossier the
// judge reads, using the vendored make.fun library. Node 22, standard
// library only. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// vendor/makefun-frontend.ts stays exactly as the kit shipped it: the
// scorer requires dossier.json to be byte for byte what its own copy
// writes, so the library is never edited.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
};

function handIn() {
  mkdirSync(dest, { recursive: true });
  cpSync(join(repoRoot, 'app'), join(dest, 'app'), { recursive: true });
  const shots = join(repoRoot, 'screenshots');
  if (existsSync(shots)) {
    cpSync(shots, join(dest, 'screenshots'), { recursive: true });
  }
  const dossier = buildDossier(dest, caps);
  writeFileSync(join(dest, 'dossier.json'), dossier);
  console.log(`handed in ${dest} (${dossier.length} bytes of dossier)`);
  checkHandIn(dossier);
}

// A second pass over what was just written: rebuild the dossier from
// the output and demand it match byte for byte, confirm the schema,
// the four screenshots and the 1.5 MiB cap. Anything off fails loudly
// instead of handing in a dossier the scorer would refuse.
function checkHandIn(first) {
  // buildDossier returns bytes, not a string: two builds are equal
  // only when their bytes match, so compare them as buffers.
  const again = buildDossier(dest, caps);
  const firstBytes = Buffer.from(first);
  const againBytes = Buffer.from(again);
  if (!firstBytes.equals(againBytes)) throw new Error('dossier is not stable: a rebuild differs');
  const parsed = JSON.parse(firstBytes.toString('utf8'));
  if (parsed.schema !== 'makefun/dossier/v1') throw new Error('dossier schema is not makefun/dossier/v1');
  const shots = readdirSync(join(dest, 'screenshots')).filter((n) => !n.startsWith('.'));
  if (shots.length !== 4) throw new Error(`expected 4 screenshots, found ${shots.length}`);
  for (const name of shots) {
    const size = statSync(join(dest, 'screenshots', name)).size;
    if (size > 262144) throw new Error(`screenshot ${name} is ${size} bytes, over 256 KiB`);
  }
  if (Buffer.byteLength(first, 'utf8') > 1572864) throw new Error('dossier is over 1.5 MiB');
  console.log(`checks passed: ${shots.length} screenshots, dossier matches, ${first.length} bytes`);
}

handIn();
