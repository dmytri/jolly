// Render a captured PTY byte stream the way a terminal renders it.
//
// Feature 027's interrupt scenarios assert ON-SCREEN properties: the setup-stage
// progress rows "stay readable, with Jolly's closing line below them rather than
// drawn over them". That is a property of the terminal's screen, not of the byte
// stream: a live progress region redraws by moving the cursor up and erasing, so
// the same row is written many times and the raw stream carries every draft. A
// regex over the stream can only guess which draft survived, and an assertion on
// the escape sequences themselves would red on any legal renderer that clears and
// reprints. Replaying the control stream into a grid answers the scenario's own
// question: what does the human see when the run ends.
//
// The grid grows downward instead of scrolling, so the whole session's final
// rendering is available and "below" stays decidable past 24 rows.

const DEFAULT_COLUMNS = 80;

interface Cursor {
  row: number;
  col: number;
}

function ensureRow(rows: string[][], index: number): void {
  while (rows.length <= index) rows.push([]);
}

function put(
  rows: string[][],
  cursor: Cursor,
  char: string,
  columns: number,
): void {
  ensureRow(rows, cursor.row);
  const row = rows[cursor.row]!;
  while (row.length < cursor.col) row.push(" ");
  row[cursor.col] = char;
  cursor.col += 1;
  if (cursor.col >= columns) {
    cursor.col = 0;
    cursor.row += 1;
  }
}

/**
 * Replay a captured terminal stream and return the screen as lines, top to
 * bottom, trailing blank lines removed. Index in the returned array IS vertical
 * position, so "below" is a comparison of indices.
 */
export function renderTerminal(
  stream: string,
  columns: number = DEFAULT_COLUMNS,
): string[] {
  const rows: string[][] = [];
  const cursor: Cursor = { row: 0, col: 0 };

  for (let i = 0; i < stream.length; i += 1) {
    const char = stream[i]!;

    if (char === "\x1b") {
      // OSC (ESC ]) — hyperlinks and title sets carry no glyphs; skip to ST.
      if (stream[i + 1] === "]") {
        let j = i + 2;
        while (j < stream.length) {
          if (stream[j] === "\x07") break;
          if (stream[j] === "\x1b" && stream[j + 1] === "\\") {
            j += 1;
            break;
          }
          j += 1;
        }
        i = j;
        continue;
      }
      // CSI (ESC [) — the cursor and erase control the progress region uses.
      if (stream[i + 1] === "[") {
        const match = /^\x1b\[([0-9;?]*)([ -/]*)([@-~])/.exec(stream.slice(i));
        if (!match) continue;
        const [whole, rawParams, , final] = match as unknown as [
          string,
          string,
          string,
          string,
        ];
        i += whole.length - 1;
        if (rawParams.startsWith("?")) continue; // mode toggles: cursor visibility etc.
        const params = rawParams.split(";").map((p) => (p === "" ? 0 : Number(p)));
        const first = params[0] ?? 0;
        switch (final) {
          case "A":
            cursor.row = Math.max(0, cursor.row - Math.max(1, first));
            break;
          case "B":
            cursor.row += Math.max(1, first);
            break;
          case "C":
            cursor.col += Math.max(1, first);
            break;
          case "D":
            cursor.col = Math.max(0, cursor.col - Math.max(1, first));
            break;
          case "G":
            cursor.col = Math.max(0, (first || 1) - 1);
            break;
          case "H":
          case "f":
            // Absolute positioning is screen-relative; with no scrolling model the
            // closest honest reading is the top of the current rendering.
            cursor.row = Math.max(0, (first || 1) - 1);
            cursor.col = Math.max(0, (params[1] ?? 1) - 1);
            break;
          case "K": {
            ensureRow(rows, cursor.row);
            const row = rows[cursor.row]!;
            if (first === 0) row.length = Math.min(row.length, cursor.col);
            else if (first === 1) for (let c = 0; c <= cursor.col && c < row.length; c += 1) row[c] = " ";
            else row.length = 0;
            break;
          }
          case "J": {
            ensureRow(rows, cursor.row);
            if (first === 0) {
              const row = rows[cursor.row]!;
              row.length = Math.min(row.length, cursor.col);
              rows.length = cursor.row + 1;
            } else if (first === 1) {
              for (let r = 0; r < cursor.row; r += 1) rows[r] = [];
            } else {
              rows.length = 0;
              ensureRow(rows, cursor.row);
            }
            break;
          }
          default:
            break; // SGR and everything else changes no glyph position
        }
        continue;
      }
      continue; // lone ESC or a two-character sequence with no screen effect
    }

    if (char === "\r") {
      cursor.col = 0;
      continue;
    }
    if (char === "\n") {
      cursor.row += 1;
      ensureRow(rows, cursor.row);
      continue;
    }
    if (char === "\b") {
      cursor.col = Math.max(0, cursor.col - 1);
      continue;
    }
    if (char === "\x07") continue;

    put(rows, cursor, char, columns);
  }

  const lines = rows.map((row) => row.join("").replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
