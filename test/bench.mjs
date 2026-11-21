// test/bench.mjs — wall clock, CPU time and memory for csv-reader 1.0.0 against solve.js, on the practice instance
// and on generated corpora, with an exactness check on every answer it times.
//
// CPU time is process.cpuUsage() around the calls only (no JSON parsing, no file IO), which is what the bounty
// times. Wall clock is hrtime.bigint() around the same calls. Peak RSS is measured with --expose-gc: the corpus is
// built and collected first, then a run's heap growth is read from process.memoryUsage() right after it.
//
//   node --expose-gc test/bench.mjs [--reps 3] [--practice <kit>] [--verify-only]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { run as fast } from '../solve.js';
import { readCsv as slow } from '../vendor/csv-reader/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const REPS = Number(argOf('--reps', 3));
const PRACTICE = argOf('--practice', join(root, '..', 'csv-reader-speed-01-run-20261121-kit'));

/** A JSON value with every object's keys in code-unit order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * A generated corpus of the shapes that matter: a wide numeric table, a table of quoted text with commas and
 * doubled quotes, records with newlines inside quoted fields, empty and missing values, and CRLF record ends.
 */
function corpus() {
  const cases = [];
  const numeric = [];
  numeric.push('id,price,qty,name');
  for (let i = 0; i < 40000; i += 1) numeric.push(`${i},${(i % 977) / 100},${i % 13},name ${i % 501}`);
  cases.push({ id: 'numeric-wide', input: { text: `${numeric.join('\n')}\n`, header: true } });

  const quoted = [];
  quoted.push('sku,description,note');
  for (let i = 0; i < 26000; i += 1) {
    quoted.push(`${i},"a, b ""quoted"" ${i}",""`);
  }
  cases.push({ id: 'quoted-escapes', input: { text: `${quoted.join('\r\n')}\r\n`, header: true } });

  const multiline = [];
  multiline.push('id,body');
  for (let i = 0; i < 9000; i += 1) multiline.push(`${i},"line one\r\nline two, with comma\r\nline three"`);
  cases.push({ id: 'newlines-in-quotes', input: { text: `${multiline.join('\n')}\n`, header: true } });

  const sparse = [];
  for (let i = 0; i < 30000; i += 1) sparse.push(i % 7 === 0 ? '' : `${i},,${i % 5}`);
  cases.push({ id: 'empty-values', input: { text: `${sparse.join('\n')}\n`, header: false } });

  const ragged = ['a,b,c'];
  for (let i = 0; i < 20000; i += 1) ragged.push(i % 3 === 0 ? `${i},${i}` : i % 3 === 1 ? `${i},${i},${i},${i}` : `${i},${i},${i}`);
  cases.push({ id: 'ragged-rows', input: { text: `${ragged.join('\r\n')}\r\n`, header: true } });
  return cases;
}

function time(fn, input) {
  if (global.gc) global.gc();
  const before = process.cpuUsage();
  const wall = performance.now();
  const answer = fn(input);
  const wallMs = performance.now() - wall;
  const cpu = process.cpuUsage(before);
  return { answer, wallMs, cpuMs: (cpu.user + cpu.system) / 1000 };
}

function bytes(answer) {
  return JSON.stringify(answer).length;
}

function report(label, cases, chars) {
  const rows = [];
  for (const c of cases) {
    const want = canonical(slow(c.input));
    const got = fast(c.input);
    if (canonical(got) !== want) throw new Error(`${label}/${c.id}: solve.js does not answer as csv-reader does`);
  }
  // Warm both sides once, so the numbers are steady state rather than first-call compilation.
  for (const c of cases) {
    slow(c.input);
    fast(c.input);
  }
  let baseCpu = 0;
  let fastCpu = 0;
  let baseWall = 0;
  let fastWall = 0;
  let outBytes = 0;
  for (let rep = 0; rep < REPS; rep += 1) {
    for (const c of cases) {
      const b = time(slow, c.input);
      const f = time(fast, c.input);
      baseCpu += b.cpuMs;
      baseWall += b.wallMs;
      fastCpu += f.cpuMs;
      fastWall += f.wallMs;
      outBytes = bytes(f.answer);
    }
  }
  const per = REPS;
  const speedup = baseCpu / fastCpu;
  rows.push({ label, chars, baseMs: baseCpu / per, fastMs: fastCpu / per, baseWall: baseWall / per, fastWall: fastWall / per, speedup, outBytes });
  return rows;
}

const practice = JSON.parse(readFileSync(join(PRACTICE, 'practice', 'input', 'cases.json'), 'utf8'));
const practiceChars = practice.reduce((n, c) => n + c.input.text.length, 0);
const generated = corpus();
const generatedChars = generated.reduce((n, c) => n + c.input.text.length, 0);

const rows = [
  ...report('practice (6 cases)', practice, practiceChars),
  ...report('generated (5 cases)', generated, generatedChars),
];

console.log(`\n${'corpus'.padEnd(20)} ${'chars'.padStart(10)} ${'ref cpu'.padStart(9)} ${'mine cpu'.padStart(9)} ${'speedup'.padStart(8)} ${'ref wall'.padStart(9)} ${'mine wall'.padStart(9)} ${'MB/s'.padStart(7)}`);
for (const r of rows) {
  const mb = r.chars / 1048576;
  console.log(
    `${r.label.padEnd(20)} ${String(r.chars).padStart(10)} ${(r.baseMs.toFixed(0) + 'ms').padStart(9)} ${(r.fastMs.toFixed(0) + 'ms').padStart(9)} ${(r.speedup.toFixed(2) + 'x').padStart(8)} ${(r.baseWall.toFixed(0) + 'ms').padStart(9)} ${(r.fastWall.toFixed(0) + 'ms').padStart(9)} ${(mb / (r.fastMs / 1000)).toFixed(0).padStart(7)}`,
  );
}

// Output equality at the byte level: the same JSON text, so a deterministic run cannot differ later.
const answersSlow = practice.map((c) => slow(c.input));
const answersFast = practice.map((c) => fast(c.input));
console.log(`\nanswers.json of the practice instance: ${JSON.stringify(answersFast) === JSON.stringify(answersSlow) ? 'byte-identical to the reference driver' : 'DIFFERS'}`);
if (global.gc) {
  global.gc();
  const before = process.memoryUsage().heapUsed;
  fast(practice[0].input);
  const after = process.memoryUsage().heapUsed;
  console.log(`heap growth over the largest case: ${((after - before) / 1048576).toFixed(1)} MiB (rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB, peak ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MiB)`);
}
