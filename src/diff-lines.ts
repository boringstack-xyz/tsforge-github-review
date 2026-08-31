/** Parses a unified diff (`git diff` output) into, per file, the set of line
 *  numbers on the NEW-file side that are either added or unchanged context —
 *  the only lines GitHub's Reviews API will accept an inline comment on. */
export function validLines(diffText: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();

  let currentFile: string | null = null;
  let newLine = 0;

  for (const rawLine of diffText.split("\n")) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(rawLine);

    if (fileMatch !== null) {
      currentFile = fileMatch[1] ?? null;
      continue;
    }

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);

    if (hunkMatch !== null) {
      newLine = Number(hunkMatch[1]);
      continue;
    }

    if (currentFile === null || newLine === 0) {
      continue;
    }

    if (rawLine.startsWith("+")) {
      addLine(result, currentFile, newLine);
      newLine += 1;
    } else if (rawLine.startsWith(" ")) {
      addLine(result, currentFile, newLine);
      newLine += 1;
    }
    // Lines starting with "-" are removed from the old file only; they don't
    // advance newLine and don't get a valid new-file line number.
  }

  return result;
}

function addLine(map: Map<string, Set<number>>, file: string, line: number): void {
  const set = map.get(file);

  if (set === undefined) {
    map.set(file, new Set([line]));
  } else {
    set.add(line);
  }
}
