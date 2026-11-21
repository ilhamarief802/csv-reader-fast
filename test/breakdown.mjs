// A one-off breakdown of where one run's time goes: reading and parsing the cases, answering them, and writing
// the answers. Prints CPU milliseconds per stage, so an optimisation is aimed at the stage that costs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { run } = await import(process.argv[2] ?? '../repo/solve.js');
const IN = process.argv[3] ?? '/home/ilham/work/csv/csv-reader-speed-01-run-20261121-kit/practice/input';
const OUT = process.argv[4] ?? '/tmp/breakdown.json';

const stage = [];
function timed(name, fn) {
  const before = process.cpuUsage();
  const value = fn();
  const after = process.cpuUsage(before);
  stage.push([name, (after.user + after.system) / 1000]);
  return value;
}

const cases = timed('read + JSON.parse', () => JSON.parse(readFileSync(join(IN, 'cases.json'), 'utf8')));
const answers = timed('run() x cases', () => cases.map((c) => run(c.input)));
const text = timed('JSON.stringify', () => JSON.stringify(answers));
timed('write', () => writeFileSync(OUT, text));
for (const [name, ms] of stage) console.log(`${name.padEnd(18)} ${ms.toFixed(0).padStart(6)} ms`);
console.log(`${'output bytes'.padEnd(18)} ${String(text.length).padStart(6)}`);
