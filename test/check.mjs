// test/check.mjs — the answer, checked three ways, with no network and no build step:
//
//   1. the practice instance's 6 cases, against the reference answers the kit ships (expected.json);
//   2. a fixed list of hand-written cases, each aimed at one rule of the policy (BOM, empty lines, stray CR,
//      quoted CRLF, doubled quotes, junk after a quote, an unterminated quote, short/long rows, header on and
//      off, one record only, empty text);
//   3. a seeded fuzz corpus that builds texts out of the fragments that make the policy hard, and compares
//      every answer with csv-reader 1.0.0's on the same input.
//
// Answers are compared as JSON values: strings code unit for code unit, arrays in order, objects by key set and
// value (key order is not part of the answer).
//
//   node test/check.mjs [--fuzz N] [--seed S] [--quiet]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../solve.js';
import { readCsv } from '../vendor/csv-reader/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const FUZZ = Number(argOf('--fuzz', 4000));
const SEED = Number(argOf('--seed', 1));
const QUIET = args.includes('--quiet');
const PRACTICE = argOf('--practice', join(root, '..', 'csv-reader-speed-01-run-20261121-kit'));

/** A JSON value with every object's keys in code-unit order: two values are equal when these strings are. */
function canonical(v) {
  if (Array.isArray(v)) {
    let out = '[';
    for (let i = 0; i < v.length; i += 1) out += (i ? ',' : '') + canonical(v[i]);
    return `${out}]`;
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    let out = '{';
    for (let i = 0; i < keys.length; i += 1) out += (i ? ',' : '') + JSON.stringify(keys[i]) + ':' + canonical(v[keys[i]]);
    return `${out}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

let failures = 0;
let comparisons = 0;

/** Compares one input's answers; on a difference prints the smallest useful window around it. */
function same(label, input) {
  comparisons += 1;
  const want = canonical(readCsv(input));
  const got = canonical(run(input));
  if (want === got) return true;
  failures += 1;
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i += 1;
  const from = Math.max(0, i - 120);
  console.error(`\nFAIL ${label}`);
  console.error(`  input    ${JSON.stringify(input.text).slice(0, 240)}${textTail(input)}`);
  console.error(`  header   ${input.header}`);
  console.error(`  want ... ${want.slice(from, i + 160)}`);
  console.error(`  got  ... ${got.slice(from, i + 160)}`);
  return false;
}

const textTail = (input) => (input.text.length > 240 ? ` … (${input.text.length} chars)` : '');

// 1. The practice instance, against the reference answers the kit ships.
const practiceDir = join(PRACTICE, 'practice');
let practiceOk = true;
let practiceBytes = 0;
try {
  const cases = JSON.parse(readFileSync(join(practiceDir, 'input', 'cases.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(practiceDir, 'reference', 'expected.json'), 'utf8'));
  const byId = new Map(expected.cases.map((c) => [c.id, c.output]));
  for (const c of cases) {
    practiceBytes += c.input.text.length;
    if (!byId.has(c.id)) {
      failures += 1;
      practiceOk = false;
      console.error(`FAIL practice ${c.id}: the reference has no answer for it`);
      continue;
    }
    comparisons += 1;
    if (canonical(run(c.input)) !== canonical(byId.get(c.id))) {
      failures += 1;
      practiceOk = false;
      console.error(`FAIL practice ${c.id}: the answer is not the reference's`);
    }
  }
  if (!QUIET) console.log(`practice: ${cases.length} cases, ${practiceBytes} chars, ${practiceOk ? 'identical' : 'MISMATCH'}`);
} catch (error) {
  console.error(`practice: could not be checked (${error.message}): pass --practice <the unpacked kit>`);
  process.exitCode = 2;
}

// 2. Hand-written cases, one per rule.
const HAND = [
  ['empty text', { text: '', header: true }],
  ['one empty line', { text: '\n', header: true }],
  ['bom only', { text: '\uFEFF', header: true }],
  ['bom then header', { text: '\uFEFFa,b\n1,2\n', header: true }],
  ['bom mid text stays', { text: 'a\uFEFFb\n', header: false }],
  ['crlf records', { text: 'a,b\r\n1,2\r\n', header: true }],
  ['lone cr dropped', { text: 'a\rb,c\n', header: false }],
  ['cr at end', { text: 'a,b\r', header: false }],
  ['crlf then cr', { text: 'a\r\r\nb\n', header: false }],
  ['empty line no record', { text: 'a,b\n\n1,2\n', header: true }],
  ['blank line at end', { text: 'a\n\n', header: false }],
  ['line of stray crs only', { text: '\r\r\n\n', header: false }],
  ['quoted empty is a record', { text: '""\n', header: false }],
  ['quote inside unquoted', { text: 'a"b,c\n', header: false }],
  ['quoted comma', { text: '"a,b",c\n', header: false }],
  ['quoted crlf', { text: '"a\r\nb",c\n', header: false }],
  ['quoted lone cr', { text: '"a\rb"\n', header: false }],
  ['doubled quote', { text: '"a""b"\n', header: false }],
  ['junk after quote', { text: '"a"xy,c\n', header: false }],
  ['junk of spaces', { text: '"a"  \n', header: false }],
  ['junk with stray cr', { text: '"a"\r\rb\n', header: false }],
  ['unterminated', { text: '"a,b\n', header: false }],
  ['unterminated at end', { text: 'x,"', header: false }],
  ['unterminated then quotes', { text: 'x,"a"b\n', header: false }],
  ['short row padded', { text: 'a,b,c\n1,2\n', header: true }],
  ['long row cut', { text: 'a,b\n1,2,3\n', header: true }],
  ['header only', { text: 'a,b\n', header: true }],
  ['header false', { text: 'a,b\n1,2\n', header: false }],
  ['no trailing newline', { text: 'a,b\n1,2', header: true }],
  ['trailing comma', { text: 'a,b,\n', header: true }],
  ['empty fields', { text: ',,\n,,\n', header: true }],
  ['unicode', { text: '"héllo wörld",日本\n', header: false }],
  ['nul and controls', { text: 'a\u0000b,"\u0001"\n', header: false }],
  ['long line', { text: `${'x'.repeat(5000)},y\n`, header: false }],
  ['crlf after quoted', { text: '"a"\r\nb\n', header: false }],
  ['quote junk then crlf', { text: '"a"z\r\n', header: false }],
];
let handOk = true;
for (const [label, input] of HAND) if (!same(label, input)) handOk = false;
if (!QUIET) console.log(`hand-written: ${HAND.length} cases, ${handOk ? 'identical' : 'MISMATCH'}`);

// 3. A seeded fuzz corpus of the fragments the policy is made of.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FRAGMENTS = [
  ',', ',', ',', '\n', '\n', '\r\n', '\r', '\r', '""', '"', '"', 'a', 'ab', 'xyz', ' ', '0', '42', '-1.5',
  '"q"', '"a,b"', '"a""b"', '"a\r\nb"', '"a\rb"', '"a\nb"', '"a"junk', '"unterminated', '\uFEFF', '\u00e9', '\u65e5',
  '\u0000', '\t', '""""', '" "', ',,,', '""x', 'x"',
];
const random = rng(SEED);
let fuzzOk = true;
let fuzzChars = 0;
for (let n = 0; n < FUZZ; n += 1) {
  const parts = 1 + Math.floor(random() * 26);
  let text = random() < 0.15 ? '\uFEFF' : '';
  for (let i = 0; i < parts; i += 1) {
    // A fragment, sometimes repeated: runs are where a slice-based reader and a per-character one differ.
    const fragment = FRAGMENTS[Math.floor(random() * FRAGMENTS.length)];
    text += random() < 0.12 ? fragment.repeat(1 + Math.floor(random() * 8)) : fragment;
  }
  fuzzChars += text.length;
  if (!same(`fuzz #${n} (seed ${SEED})`, { text, header: random() < 0.5 })) {
    fuzzOk = false;
    if (failures > 6) break;
  }
}
if (!QUIET) console.log(`fuzz: ${FUZZ} cases, ${fuzzChars} chars, seed ${SEED}, ${fuzzOk ? 'identical' : 'MISMATCH'}`);

if (!QUIET) console.log(`\n${comparisons} comparisons, ${failures} failure(s)`);
if (failures > 0) process.exitCode = 1;
