// Token Radar: a token launch radar for make.fun's token-radar-01 bounty (Node 22, stdlib only).
//
// The program reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json), values
// every pre-token protocol with the ratio model in lib/model.ts, and writes into the output
// directory ($MAKEFUN_OUTPUT_DIR, default /output):
//
//   board.json    the ranked board: watchlist covered, ranks 1..N, a farm plan on every row
//   data.js       the same board as window.BOARD_DATA, for the dashboard to render offline
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  the judge's summary, built with the vendored buildDossier, byte for byte
//
// The run is deterministic: the same snapshot always writes the same bytes.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildData, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the dossier library is told them: text cap, screenshot caps, dashboard caps. */
const DOSSIER_TEXT_MAX = 65_536;
const DOSSIER_SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function argument(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argument('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  fail(`no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed snapshot at /input`);
}
const outputDir = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath!, 'utf8'));
const board = buildBoard(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model produced a board the gate refuses: ${problem}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(buildData(snapshot, board)));

/** Copy a directory's plain files (dot-names skipped) into the output, returning the names copied. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyPlainFiles(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const screenshots = copyPlainFiles(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (screenshots.length < 3) {
  fail(`screenshots/ holds ${screenshots.length} image(s): hand in 3 (the board, a detail view, a filtered view)`);
}
for (const name of screenshots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// Written last: the gate rebuilds the dossier from this output and compares it byte for byte.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX, screenshots: DOSSIER_SCREENSHOTS, dashboard: DOSSIER_DASHBOARD }),
);

const early = board.filter((r) => !r.watchlist).length;
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked (${early} beyond the watchlist)\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), ` +
    `screenshots/ (${screenshots.length} images) and dossier.json to ${outputDir}\n`,
);
