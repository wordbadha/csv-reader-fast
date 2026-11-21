// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01-run-20261121).
// Returns exactly csv-reader's answer for every input, faster: fields are cut
// out with slice() over runs found by a charCodeAt scan instead of building
// every field one character at a time, and the hot paths keep no closures and
// no per-field object allocations beyond the result values themselves.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Field end codes: 0 comma, 1 line break, 2 end of text.
  while (true) {
    // Lines with no characters are no records (LF or CRLF only).
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = 0;

    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      if (!quoted) {
        // Read unquoted characters onto "" up to the next comma or line
        // break; a CR not followed by LF is dropped (stray_cr).
        value = '';
        for (;;) {
          const start = pos;
          while (pos < n) {
            const c = text.charCodeAt(pos);
            if (c === 44 || c === 10 || c === 13) break;
            pos++;
          }
          if (pos > start) value += text.slice(start, pos);
          if (pos >= n) {
            ended = 2;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos++;
            ended = 0;
            break;
          }
          if (c === 10) {
            pos++;
            line++;
            ended = 1;
            break;
          }
          if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line++;
            ended = 1;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos++;
        }
      } else {
        // Read a quoted field whose opening quote is at pos.
        const open = pos;
        const openLine = line;
        pos++;
        value = '';
        let closed = false;
        while (pos < n) {
          const start = pos;
          while (pos < n) {
            const c = text.charCodeAt(pos);
            if (c === 34 || c === 13 || c === 10) break;
            pos++;
          }
          if (pos > start) value += text.slice(start, pos);
          if (pos >= n) break;
          const c = text.charCodeAt(pos);
          if (c === 34) {
            if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) {
              value += '"';
              pos += 2;
              continue;
            }
            pos++;
            closed = true;
            break;
          }
          // CRLF and a lone CR inside quotes are each one LF.
          value += '\n';
          line++;
          pos += c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          value = '"';
          for (;;) {
            const start = pos;
            while (pos < n) {
              const c = text.charCodeAt(pos);
              if (c === 44 || c === 10 || c === 13) break;
              pos++;
            }
            if (pos > start) value += text.slice(start, pos);
            if (pos >= n) {
              ended = 2;
              break;
            }
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos++;
              ended = 0;
              break;
            }
            if (c === 10) {
              pos++;
              line++;
              ended = 1;
              break;
            }
            if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line++;
              ended = 1;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pos++;
          }
        } else if (pos >= n) {
          ended = 2;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos++;
            ended = 0;
          } else if (c === 10) {
            pos++;
            line++;
            ended = 1;
          } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line++;
            ended = 1;
          } else {
            // What follows the closing quote is appended as it stands, up
            // to the next comma or line break (quote_junk, when it adds).
            let added = 0;
            for (;;) {
              const start = pos;
              while (pos < n) {
                const ch = text.charCodeAt(pos);
                if (ch === 44 || ch === 10 || ch === 13) break;
                pos++;
              }
              if (pos > start) {
                value += text.slice(start, pos);
                added += pos - start;
              }
              if (pos >= n) {
                ended = 2;
                break;
              }
              const ch = text.charCodeAt(pos);
              if (ch === 44) {
                pos++;
                ended = 0;
                break;
              }
              if (ch === 10) {
                pos++;
                line++;
                ended = 1;
                break;
              }
              if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
                pos += 2;
                line++;
                ended = 1;
                break;
              }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              pos++;
            }
            if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record.
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
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
