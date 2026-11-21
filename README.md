# csv-reader, faster

A drop-in replacement for make.fun's `csv-reader 1.0.0` for the
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty: `run(input)` in
`solve.js` returns exactly `csv-reader`'s answer — the same JSON value, byte for byte — and reads the same text
several times faster.

| | csv-reader 1.0.0 | this entry |
|---|---|---|
| practice instance, 6 cases, 10.2 MB of CSV | 975 ms CPU | **230 ms CPU** (4.2×) |
| the same, end to end (`read` + `JSON.parse` + answers + `JSON.stringify` + write) | 1.69 s | **0.67 s** |
| answers | reference | byte-identical |

Measured on this machine with `npm run bench` (warm, 5 rounds, `process.cpuUsage()` around the calls only); the
scored container is slower and its ratio is what decides the rank.

## Why it is faster

`csv-reader` builds every field with `value += c`, one character at a time, and returns a small object per field.
This reader takes one pass over the text, resolves each field to a `slice()` of it, and keeps the general
machinery (escapes, stray CRs, junk after a closing quote, unterminated quotes) on paths that only the text
needing them ever takes. The field loop's common case — an unquoted field ending at a comma or a line break — is
inlined and writes no shared state.

Two ideas were built, measured and **rejected** because they were slower or not faster: finding delimiters with
`String.prototype.indexOf` (3 native scans per field: 329 ms against 189 ms) and an inline fast path for quoted
fields (190–200 ms against 186–192 ms, not worth the extra code).

## The answer it must reproduce

`{columns, rows, errors}` exactly as `csv-reader`'s `readCsv` returns it, including every quirk: a lone CR
outside quotes is dropped with `stray_cr`, a CRLF or lone CR inside quotes reads as LF, `""` inside a quoted
field is one quote, text after a closing quote is appended with `quote_junk`, an unterminated quote is a literal
`"` and the text is read again as unquoted (`unterminated_quote`), rows are padded or cut to the first record's
width with `short_row`/`long_row`, lines that hold nothing are no record, and `line` counts every LF, CRLF and
lone CR inside quotes.

## Run it

```sh
npm test                # equivalence: practice instance + 36 hand-written cases + 4000 fuzz cases
npm run bench           # CPU/wall/MB-s against the reference, plus the byte-equality check
mkdir -p /tmp/out && MAKEFUN_INPUT_DIR=... MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

`main.ts` is the program the harness runs: it reads `/input/cases.json`, answers every case with `run()`, and
writes `/output/answers.json`. Outside a container `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for
`/input` and `/output`. `vendor/csv-reader/` is the reference, kept for the tests only — `main.ts` never imports
it.

## Tests

`test/check.mjs` compares this reader's answer with the reference on three corpora, comparing canonicalised JSON
so a difference in key order cannot hide one:

- the practice instance's 6 cases against the reference answers the kit ships (`expected.json`);
- 36 hand-written cases, one per quirk above plus BOM, empty text, a single comma, CR at the end, quoted empty
  fields, junk after a quote, unterminated quotes, and an empty line made only of stray CRs;
- 4000 randomly generated cases, built from fragments that stress quotes, CRLF and lone CR, doubled quotes,
  empty fields, trailing separators and non-ASCII text.

`test/bench.mjs` re-checks equivalence on every corpus it times, then reports CPU, wall clock and MB/s for both
readers plus heap growth, so a speed claim cannot outlive its correctness.

MIT licensed; `vendor/csv-reader/` keeps its own license and notice.
