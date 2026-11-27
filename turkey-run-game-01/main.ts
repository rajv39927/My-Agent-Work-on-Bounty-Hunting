// Dinner Is Cancelled: the hand-in program.
//
// Node 22, standard library only. It takes the game and its screenshots
// from beside this file and lays them out under the output directory the
// platform gives it (MAKEFUN_OUTPUT_DIR outside the grader, /output inside),
// then writes the dossier the judge reads with the vendored make.fun
// library. Nothing here fetches anything or writes anything else.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Where the repository lives: the folder holding this file.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// Where the hand-in goes: the platform's output directory, or a local
// folder of the same name when run by hand.
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? join(repoRoot, 'out');

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes
// the bytes; the others refuse an entry the scorer would refuse — more
// than four screenshots or one over 256 KiB; more than 993 files in game/
// or 48 MiB of game files, in all, or a path under game/ over 1000 bytes.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

function handIn(): void {
  mkdirSync(outDir, { recursive: true });
  for (const folder of ['game', 'screenshots']) {
    const from = join(repoRoot, folder);
    if (!existsSync(from)) throw new Error(`missing ${folder}/ beside main.ts`);
    cpSync(from, join(outDir, folder), { recursive: true });
  }
  const dossier = buildDossier(outDir, DOSSIER_CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`handed in ${outDir} (${dossier.length} bytes of dossier)`);
  checkHandIn(dossier);
}

/**
 * The hand-in checks itself before it reports success: the game and the
 * screenshots are really there, the dossier parses, it is the one the
 * library writes from this output directory byte for byte, and it fits
 * the scorer's cap. Anything off fails loudly instead of handing in a
 * broken entry.
 */
function checkHandIn(dossier: Uint8Array): void {
  const problems: string[] = [];
  for (const folder of ['game', 'screenshots']) {
    if (!existsSync(join(outDir, folder))) problems.push(`${folder}/ was not copied`);
  }
  if (!existsSync(join(outDir, 'game', 'index.html'))) problems.push('game/index.html is missing');
  const shots = ['1-title.jpg', '2-play.jpg', '3-hide.jpg', '4-escaped.jpg'];
  for (const shot of shots) {
    if (!existsSync(join(outDir, 'screenshots', shot))) problems.push(`screenshots/${shot} is missing`);
  }
  const written = new TextDecoder('utf-8').decode(dossier);
  const parsed = JSON.parse(written) as { schema?: unknown };
  if (parsed.schema !== 'makefun/dossier/v1') problems.push('dossier schema is not makefun/dossier/v1');
  const rebuilt = buildDossier(outDir, DOSSIER_CAPS);
  if (Buffer.compare(Buffer.from(dossier), Buffer.from(rebuilt)) !== 0) {
    problems.push('dossier.json is not what buildDossier writes from this output');
  }
  if (dossier.length > 1572864) problems.push('dossier.json is over the 1.5 MiB cap');
  if (problems.length > 0) throw new Error(`hand-in failed its own checks: ${problems.join('; ')}`);
  console.log(`checks passed: ${shots.length} screenshots, dossier matches, ${dossier.length} bytes`);
}

handIn();
