// main.ts — the program the harness runs (node22): read every case from /input/cases.json, answer each one on its
// own with run() from solve.js, and write /output/answers.json, a JSON array of the answers in the cases' order.
//
// Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// V8 is tuned before solve.js is imported, so every allocation the reader makes happens under it: incremental
// marking off, exactly as the house baseline runs it. (A larger young generation was measured too — 16 and 64 MiB
// against the default — and moved the total by less than the run-to-run noise, so it is not set here.)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const { run } = await import(new URL('./solve.js', import.meta.url).href);

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'));
const answers = [];
for (let i = 0; i < cases.length; i += 1) answers.push(run(cases[i].input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
