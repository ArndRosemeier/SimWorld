/**
 * Reads CHANGELOG.md (written only by tools/changelog.mjs after each merge) into releases for the
 * What's new panel. Pure, so it is tested headless; src/app/whatsNew.ts feeds it the file.
 */

/** One version: `## v0.009 — Title` and its `- ` bullets. */
export interface Release {
  version: string;
  title: string;
  notes: string[];
}

/** Newest first, as the file lists them. Markdown emphasis and code marks are dropped. */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const head = /^## (v\d+\.\d{3})\b(?:\s+[—-]\s+(.*))?$/.exec(line);
    if (head) { out.push({ version: head[1], title: plain(head[2] ?? ''), notes: [] }); continue; }
    const cur = out[out.length - 1];
    if (!cur) continue;
    if (line.startsWith('- ')) cur.notes.push(plain(line.slice(2)));
    else if (/^\s+\S/.test(line) && cur.notes.length) cur.notes[cur.notes.length - 1] += ` ${plain(line)}`;
  }
  return out;
}

const plain = (s: string): string => s.replace(/\*\*|__|`/g, '').trim();
