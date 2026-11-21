// Measures the entry alone — no reference answer held in memory — at a few input sizes, reading peak RSS from
// the process, so the memory a scored run needs is not confused with the reference's own.
//
//   node --expose-gc test/memory.mjs [--mb 10,30]

import { run } from '../solve.js';

const args = process.argv.slice(2);
const idx = args.indexOf('--mb');
const sizes = (idx >= 0 ? args[idx + 1] : '10,30').split(',').map(Number);

function corpus(targetMb) {
  const words = ['harbour', 'lantern', 'tide', 'market', 'salt', 'rope', 'anchor', 'gull', 'drum'];
  let seed = 99;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = () => words[Math.floor(rnd() * words.length)];
  const parts = ['id,name,note,amount,reference,flag\r\n'];
  let size = parts[0].length;
  let row = 0;
  while (size < targetMb * 1024 * 1024) {
    row += 1;
    const r = rnd();
    let line;
    if (r < 0.12) line = `${row},${pick()},,"${(rnd() * 1000).toFixed(2)}",TX${row},y\r\n`;
    else if (r < 0.2) line = `${row},"${pick()}, ${pick()}","said ""hi"" then left",${(rnd() * 1000).toFixed(2)},TX${row},n\r\n`;
    else if (r < 0.24) line = `${row},${pick()},"two\r\nlines",${(rnd() * 1000).toFixed(2)},TX${row},y\r\n`;
    else if (r < 0.26) line = `${row},${pick()},cut,${(rnd() * 1000).toFixed(2)}\r\n`;
    else if (r < 0.27) line = '\r\n';
    else line = `${row},${pick()},plain ${row},${(rnd() * 1000).toFixed(2)},TX${row},${row % 2 ? 'y' : 'n'}\r\n`;
    parts.push(line);
    size += line.length;
  }
  return { text: parts.join(''), header: true };
}

for (const mb of sizes) {
  const input = corpus(mb);
  global.gc?.();
  const before = process.memoryUsage().rss;
  const cpu0 = process.cpuUsage();
  const answer = run(input);
  const cpu = (process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000;
  const after = process.memoryUsage().rss;
  const peak = process.resourceUsage().maxRSS * 1024;
  console.log(
    `${String(mb).padStart(3)} MB  rows ${String(answer.rows.length).padStart(7)}  errors ${String(answer.errors.length).padStart(6)}` +
      `  cpu ${cpu.toFixed(0).padStart(5)} ms  rss ${(after / 1048576).toFixed(0).padStart(4)} MB (before ${(before / 1048576).toFixed(0)} MB)` +
      `  peak ${(peak / 1048576).toFixed(0)} MB`,
  );
  if (peak / 1048576 > 1000) console.log('  WARNING: peak RSS is past the 1024 MB the container allows');
}
