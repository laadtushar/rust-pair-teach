/**
 * Extracting the code region that travels with a prompt.
 *
 * This is the privacy control (N3), so it is a real function with real tests rather than a comment
 * expressing an intention. The learner's whole file never leaves the machine — only the enclosing
 * block around the diagnostic, hard-capped in lines.
 */

export interface CodeRegion {
  /** 0-based line where the region starts in the original document. */
  startLine: number;
  text: string;
  /** True when the cap trimmed the region — surfaced to the learner in the "what was sent" view. */
  truncated: boolean;
}

const DEFAULT_MAX_LINES = 40;

/**
 * Take the smallest useful window around a line: outward to the enclosing brace block, then capped.
 *
 * Brace matching rather than a parser is deliberate for now — the design already flags tree-sitter
 * as the upgrade once the heuristics prove out, and a wrong-but-bounded region leaks less than a
 * right-but-unbounded one.
 */
export function extractRegion(
  text: string,
  line: number,
  maxLines: number = DEFAULT_MAX_LINES
): CodeRegion {
  const lines = text.split('\n');
  if (lines.length === 0) return { startLine: 0, text: '', truncated: false };

  const anchor = Math.max(0, Math.min(line, lines.length - 1));

  // Walk up to the line that opens the enclosing block.
  let start = anchor;
  let depth = 0;
  for (let i = anchor; i >= 0; i--) {
    const l = lines[i]!;
    depth += count(l, '}') - count(l, '{');
    if (depth < 0 || (i < anchor && /^\s*(pub\s+)?(fn|impl|struct|enum|trait)\b/.test(l))) {
      start = i;
      break;
    }
    start = i;
  }

  // Walk down until the block closes.
  let end = anchor;
  depth = 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]!;
    depth += count(l, '{') - count(l, '}');
    end = i;
    if (i >= anchor && depth <= 0) break;
  }

  const truncated = end - start + 1 > maxLines;
  if (truncated) {
    // Keep the anchor centred rather than truncating blindly from the top.
    const half = Math.floor(maxLines / 2);
    start = Math.max(start, anchor - half);
    end = Math.min(end, start + maxLines - 1);
  }

  return {
    startLine: start,
    text: lines.slice(start, end + 1).join('\n'),
    truncated,
  };
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}
