// solve.js — a drop-in replacement for csv-reader 1.0.0, written for speed: the same answer, byte for byte,
// from one pass over the text, with no per-character string building on the paths that carry most bytes.
//
// The reference (vendor/csv-reader/index.js, kept here only for the differential tests) reads a character at a
// time and appends each one to the field being built. That is where its time goes: one cons string per
// character, plus a small object per field. This reader scans with charCodeAt and takes the field as one
// text.slice() when the field needs no rewrite, and only falls back to building characters when a field
// really changes on the way in: a carriage return inside quotes becomes LF, a doubled quote becomes one
// quote, a stray CR outside quotes is dropped, and junk after a closing quote is appended.
//
// The policy, exactly as the reference states it:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record (its stray_cr errors stay);
//   - outside quotes, a CR not followed by LF is dropped, with stray_cr, and does not advance the line;
//   - a field opening with a quote runs to the next quote that is not doubled, "" inside it one quote, and
//     CRLF or a lone CR inside it read as LF; what follows its closing quote up to a comma or line break is
//     appended as it stands, with quote_junk when anything was appended; a quote that never closes is a
//     literal character and the text after it is read again as unquoted, with unterminated_quote;
//   - a quote inside an unquoted field is a literal character; fields are never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are padded with '' (short_row) or cut
//     (long_row) to the first record's width; every error is {code, line, row} with the record's own line and
//     its index in rows (null for the header), in the order met.

const COMMA = 44;
const LF = 10;
const CR = 13;
const QUOTE = 34;
const BOM = 0xfeff;

const COMMA_END = 1;
const LINE_END = 2;
const TEXT_END = 3;

/**
 * One scan's state. A field reader leaves the field's text in value, the next position in p, the line the
 * scan reached in line, how the field ended in ended, and, for a field read after a closing quote, how many
 * characters the tail added, in added.
 */
function state() {
  return { p: 0, line: 1, value: '', ended: TEXT_END, added: 0 };
}

/** An unquoted field from st.p up to the next comma, line break or the end of the text. */
function readUnquoted(text, len, st, errors, recordLine, recordRow) {
  const start = st.p;
  let p = start;
  let c = 0;
  while (p < len) {
    c = text.charCodeAt(p);
    // The three characters that end an unquoted field; everything else is ordinary.
    if (c === COMMA || c === LF || c === CR) break;
    p += 1;
  }
  if (p === len) {
    st.value = text.slice(start, len);
    st.p = len;
    st.ended = TEXT_END;
    st.added = len - start;
    return;
  }
  if (c === COMMA) {
    st.value = text.slice(start, p);
    st.p = p + 1;
    st.ended = COMMA_END;
    st.added = p - start;
    return;
  }
  if (c === LF) {
    st.value = text.slice(start, p);
    st.p = p + 1;
    st.line += 1;
    st.ended = LINE_END;
    st.added = p - start;
    return;
  }
  // CR: a line break with LF after it, else a stray CR the field drops.
  if (p + 1 < len && text.charCodeAt(p + 1) === LF) {
    st.value = text.slice(start, p);
    st.p = p + 2;
    st.line += 1;
    st.ended = LINE_END;
    st.added = p - start;
    return;
  }
  // The scan stopped on a stray CR: the field so far is kept, and the tail reader goes on from the CR
  // itself, dropping it (and any other) with stray_cr. st.p must point there, or the tail would read the
  // field a second time.
  st.p = p;
  readUnquotedTail(text, len, st, text.slice(start, p), errors, recordLine, recordRow);
}

/**
 * The rest of an unquoted field from st.p when it has something to rewrite: a stray CR to drop, or a prefix
 * (junk after a closing quote, or the literal quote of an unterminated one) to put in front.
 */
function readUnquotedTail(text, len, st, prefix, errors, recordLine, recordRow) {
  const pieces = prefix === '' ? [] : [prefix];
  let added = 0;
  let p = st.p;
  while (p < len) {
    const c = text.charCodeAt(p);
    if (c === COMMA) {
      st.value = pieces.length === 0 ? '' : pieces.join('');
      st.p = p + 1;
      st.ended = COMMA_END;
      st.added = added;
      return;
    }
    if (c === LF) {
      st.value = pieces.length === 0 ? '' : pieces.join('');
      st.p = p + 1;
      st.line += 1;
      st.ended = LINE_END;
      st.added = added;
      return;
    }
    if (c === CR) {
      if (p + 1 < len && text.charCodeAt(p + 1) === LF) {
        st.value = pieces.length === 0 ? '' : pieces.join('');
        st.p = p + 2;
        st.line += 1;
        st.ended = LINE_END;
        st.added = added;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      p += 1;
      continue;
    }
    // An ordinary run, taken whole.
    let q = p + 1;
    while (q < len) {
      const d = text.charCodeAt(q);
      if (d === COMMA || d === LF || d === CR) break;
      q += 1;
    }
    pieces.push(text.slice(p, q));
    added += q - p;
    p = q;
  }
  st.value = pieces.length === 0 ? '' : pieces.join('');
  st.p = len;
  st.ended = TEXT_END;
  st.added = added;
}

/** A quoted field, its opening quote at st.p. */
function readQuoted(text, len, st, errors, recordLine, recordRow) {
  const open = st.p;
  const openLine = st.line;
  const start = open + 1;
  let p = start;
  let c = 0;
  while (p < len) {
    c = text.charCodeAt(p);
    if (c === QUOTE) {
      if (p + 1 < len && text.charCodeAt(p + 1) === QUOTE) break; // a doubled quote: rewritten
      st.value = text.slice(start, p);
      st.p = p + 1;
      // The closing quote is the field's end unless a comma, a line break or the text's end follows it,
      // and anything else there is junk appended to the field.
      if (st.p >= len) {
        st.ended = TEXT_END;
        return;
      }
      const after = text.charCodeAt(st.p);
      if (after === COMMA) {
        st.p += 1;
        st.ended = COMMA_END;
        return;
      }
      if (after === LF) {
        st.p += 1;
        st.line += 1;
        st.ended = LINE_END;
        return;
      }
      if (after === CR && st.p + 1 < len && text.charCodeAt(st.p + 1) === LF) {
        st.p += 2;
        st.line += 1;
        st.ended = LINE_END;
        return;
      }
      readUnquotedTail(text, len, st, st.value, errors, recordLine, recordRow);
      if (st.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
    if (c === LF) {
      st.line += 1;
      p += 1;
      continue;
    }
    if (c === CR) break; // CRLF or a lone CR inside quotes reads as LF: rewritten
    p += 1;
  }
  readQuotedTail(text, len, st, open, openLine, p, errors, recordLine, recordRow);
}

/** A quoted field from p on where something inside must be rewritten, or where the quote never closes. */
function readQuotedTail(text, len, st, open, openLine, p, errors, recordLine, recordRow) {
  const pieces = [];
  const start = open + 1;
  if (p > start) pieces.push(text.slice(start, p));
  let closed = false;
  let after = p;
  while (after < len) {
    const c = text.charCodeAt(after);
    if (c === QUOTE) {
      if (after + 1 < len && text.charCodeAt(after + 1) === QUOTE) {
        pieces.push('"');
        after += 2;
        continue;
      }
      after += 1;
      closed = true;
      break;
    }
    if (c === CR) {
      pieces.push('\n');
      st.line += 1;
      after += after + 1 < len && text.charCodeAt(after + 1) === LF ? 2 : 1;
      continue;
    }
    if (c === LF) st.line += 1;
    let q = after + 1;
    while (q < len) {
      const d = text.charCodeAt(q);
      if (d === QUOTE || d === CR || d === LF) break;
      q += 1;
    }
    pieces.push(text.slice(after, q));
    after = q;
  }
  if (!closed) {
    // The quote never closes: it is a literal character and the text after it is read again as unquoted.
    st.p = open + 1;
    st.line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    readUnquotedTail(text, len, st, '"', errors, recordLine, recordRow);
    return;
  }
  st.value = pieces.length === 0 ? '' : pieces.join('');
  st.p = after;
  if (st.p >= len) {
    st.ended = TEXT_END;
    return;
  }
  const c = text.charCodeAt(st.p);
  if (c === COMMA) {
    st.p += 1;
    st.ended = COMMA_END;
    return;
  }
  if (c === LF) {
    st.p += 1;
    st.line += 1;
    st.ended = LINE_END;
    return;
  }
  if (c === CR && st.p + 1 < len && text.charCodeAt(st.p + 1) === LF) {
    st.p += 2;
    st.line += 1;
    st.ended = LINE_END;
    return;
  }
  readUnquotedTail(text, len, st, st.value, errors, recordLine, recordRow);
  if (st.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
}

/** The answer for one case's input {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const len = text.length;
  const header = input.header === true;
  const errors = [];
  const rows = [];
  const st = state();
  let columns = null;
  let width = -1;
  let pos = len > 0 && text.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  while (pos < len) {
    // Lines left with no characters are no records.
    let p = pos;
    while (p < len) {
      const c = text.charCodeAt(p);
      if (c === LF) {
        p += 1;
        line += 1;
        continue;
      }
      if (c === CR && p + 1 < len && text.charCodeAt(p + 1) === LF) {
        p += 2;
        line += 1;
        continue;
      }
      break;
    }
    if (p >= len) break;
    pos = p;
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let quoted = false;
    let ended = COMMA_END;

    // The field loop. Its common case — an unquoted field ending at a comma or a line break — is written out
    // here rather than in a call, and writes no shared state: a field reader keeps its result in the state
    // object, which is three stores per field this path does not pay.
    do {
      const start = pos;
      let c = text.charCodeAt(start);
      if (c === QUOTE) {
        // A quoted field: the general reader handles escapes, junk and unterminated quotes.
        quoted = true;
        st.p = start;
        st.line = line;
        readQuoted(text, len, st, errors, recordLine, recordRow);
        fields.push(st.value);
        ended = st.ended;
        pos = st.p;
        line = st.line;
        continue;
      }
      quoted = false;
      p = start;
      while (p < len) {
        c = text.charCodeAt(p);
        if (c === COMMA || c === LF || c === CR) break;
        p += 1;
      }
      if (p === len) {
        fields.push(text.slice(start, len));
        pos = len;
        ended = TEXT_END;
        break;
      }
      if (c === COMMA) {
        fields.push(text.slice(start, p));
        pos = p + 1;
        ended = COMMA_END;
        continue;
      }
      if (c === LF) {
        fields.push(text.slice(start, p));
        pos = p + 1;
        line += 1;
        ended = LINE_END;
        break;
      }
      if (p + 1 < len && text.charCodeAt(p + 1) === LF) {
        fields.push(text.slice(start, p));
        pos = p + 2;
        line += 1;
        ended = LINE_END;
        break;
      }
      // A stray CR: the field so far is kept, the CR is dropped with stray_cr, and the tail reader goes on.
      st.p = p;
      st.line = line;
      readUnquotedTail(text, len, st, text.slice(start, p), errors, recordLine, recordRow);
      fields.push(st.value);
      ended = st.ended;
      pos = st.p;
      line = st.line;
    } while (ended === COMMA_END);

    // A line that held nothing but stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
