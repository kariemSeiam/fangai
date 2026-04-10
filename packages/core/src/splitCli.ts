/**
 * Split a shell-like command string into argv tokens (respects " and ').
 */
export function splitCli(cli: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQ: string | null = null;
  for (const ch of cli) {
    if (inQ) {
      if (ch === inQ) inQ = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      inQ = ch;
    } else if (ch === " " || ch === "\t") {
      if (cur) {
        parts.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}
