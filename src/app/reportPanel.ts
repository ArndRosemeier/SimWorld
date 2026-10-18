/**
 * The "Report this spot" window (debug menu, F8): a note to type, the report as it will be pasted, Copy, and the
 * save as a file to attach when the report says the world cannot be rebuilt from seed and time alone. The text
 * comes from src/game/report.ts; docs/REPORTS.md says how a thread uses it.
 */
import { button, el, openDialog } from './dom';
import { reportText, type ReportFacts } from '../game/report';

/** The save, made on request: its file name and bytes (gzipped). */
export type SaveFile = () => Promise<{ name: string; bytes: Uint8Array } | null>;

export function openReport(facts: ReportFacts, saveFile: SaveFile): void {
  const close = button('rp-close', 'Close', () => {});
  const panel = openDialog('rp', 'Report this spot', close);
  if (!panel) return;
  let saved: string | null = null;
  const note = el('textarea', 'rp-note');
  note.placeholder = 'What is wrong here? (optional)';
  note.rows = 3;
  const text = el('pre', 'rp-text');
  const said = el('span', 'rp-said');
  const show = (): void => { text.textContent = reportText(facts, note.value, saved); };
  note.addEventListener('input', show);
  const copy = button('rp-copy', 'Copy report', () => void copyText(text.textContent ?? '').then((ok) => {
    said.textContent = ok ? 'Copied: paste it into the project chat' : 'Could not copy: select the text and copy it by hand';
  }));
  const save = button('rp-save', 'Download the save too', () => {
    save.disabled = true;
    said.textContent = 'Saving…';
    void saveFile().then((f) => {
      save.disabled = false;
      if (!f) { said.textContent = 'Could not save here'; return; }
      download(f.name, f.bytes);
      saved = f.name;
      show();
      said.textContent = `Downloaded ${f.name}: attach it to your chat message`;
    });
  });
  const hint = facts.notExact.length
    ? 'This world cannot be rebuilt from seed and time alone, so download the save and attach it with the report.'
    : 'The repro link rebuilds this exact world; the save is only needed for something the link cannot show.';
  const row = el('div', 'rp-buttons');
  row.append(copy, save, close);
  panel.append(el('h2', '', 'Report this spot'), note, el('p', 'rp-hint', hint), text, row, said);
  show();
  queueMicrotask(() => note.focus());
}

async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* not allowed here: the old way */ }
  const ta = el('textarea', '');
  ta.value = t;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/gzip' }));
  const a = el('a', '');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
