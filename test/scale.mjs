// test/scale.mjs — the limits the container enforces (10 s wall, 1024 MB, 1 cpu), measured on one case at a few
// sizes: a shaped CSV with quoted fields, embedded commas, doubled quotes, CRLF inside quotes, empty values,
// numeric and text columns. Prints CPU, wall and peak RSS, and checks the answer against the reference.
//
//   node --expose-gc test/scale.mjs [--mb 10,30,60]

import { run as fast } from '../solve.js';
import { readCsv as ref } from '../vendor/csv-reader/index.js';

const args = process.argv.slice(2);
const idx = args.indexOf('--mb');
const sizes = (idx >= 0 ? args[idx + 1] : '10,30,60').split(',').map(Number);

/** A CSV of about `targetMb` megabytes, in the shapes a CSV reader is judged on. */
function corpus(targetMb) {
  const words = ['harbour', 'lantern', 'tide', 'market', 'salt', 'rope', 'anchor', 'gull', 'drum', '시장', 'café'];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = () => words[Math.floor(rnd() * words.length)];
  const parts = ['id,name,note,amount,flag,quoted\r\n'];
  let size = parts[0].length;
  let row = 0;
  while (size < targetMb * 1024 * 1024) {
    row += 1;
    const roll = rnd();
    let line;
    if (roll < 0.1) line = `${row},${pick()},,"${(rnd() * 1000).toFixed(2)}",\r\n`;
    else if (roll < 0.2) line = `${row},,"line one\r\nline two",${(rnd() * 1000).toFixed(2)},y\r\n`;
    else if (roll < 0.3) line = `${row},"${pick()}, ${pick()}",note with "quotes" inside,${(rnd() * 1000).toFixed(2)},n\r\n`;
    else if (roll < 0.34) line = `${row},${pick()},junk after a quote",${(rnd() * 1000).toFixed(2)},n\r\n`;
    else if (roll < 0.37) line = `${row},${pick()},short\r\n`;            // storage row: fewer fields
    else if (roll < 0.4) line = `${row},${pick()},wide,${(rnd() * 1000).toFixed(2)},y,extra,more\r\n`; // wider row
    else if (roll < 0.41) line = '\r\n';                                   // no record at all
    else if (roll < 0.42) line = `${row},"unterminated,${(rnd() * 1000).toFixed(2)},y\r\n`;
    else line = `${row},${pick()} ${row},${pick()} and ${pick()},${(rnd() * 1000).toFixed(2)},${row % 2 ? 'y' : 'n'}\r\n`;
    parts.push(line);
    size += line.length;
  }
  return { text: parts.join(''), header: true };
}

let worst = 0;
for (const mb of sizes) {
  const input = corpus(mb);
  // Reference first, so a memory figure for the entry is not inflated by the reference's own garbage.
  const refAnswer = ref(input);
  const before = process.memoryUsage().rss;
  global.gc?.();
  const cpu0 = process.cpuUsage();
  const wall0 = process.hrtime.bigint();
  const answer = fast(input);
  const wall = Number(process.hrtime.bigint() - wall0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  const rss = process.memoryUsage().rss;
  const same = JSON.stringify(answer) === JSON.stringify(refAnswer);
  const rows = answer.rows.length;
  const errors = answer.errors.length;
  worst = Math.max(worst, (cpu.user + cpu.system) / 1000);
  console.log(
    `${String(mb).padStart(3)} MB  chars ${String(input.text.length).padStart(9)}  rows ${String(rows).padStart(7)}` +
      `  errors ${String(errors).padStart(6)}  cpu ${((cpu.user + cpu.system) / 1000).toFixed(0).padStart(5)} ms` +
      `  wall ${wall.toFixed(0).padStart(5)} ms  rss ${(rss / 1048576).toFixed(0)} MB  same ${same ? 'yes' : 'NO'}` +
      `  (rss before ${(before / 1048576).toFixed(0)} MB)`,
  );
  if (!same) {
    console.log('MISMATCH against the reference');
    process.exit(1);
  }
}
console.log(`worst CPU over the shapes above: ${worst.toFixed(0)} ms (the container allows 10000 ms wall, 1024 MB)`);
