/**
 * The sound control: a small button above What's new that opens a panel with the master volume,
 * mute and a slider per sound category (the mix is remembered by the engine). Pressing it is also
 * the gesture that lets the browser start audio.
 */
import { SOUND_CATEGORIES, type AudioEngine } from '../audio/engine';
import { el, onEscape } from './dom';

function slider(label: string, value: number, max: number, onInput: (v: number) => void): HTMLLabelElement {
  const row = el('label', 'snd-row');
  const input = el('input', '');
  input.type = 'range'; input.min = '0'; input.max = String(max); input.step = '0.01'; input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  row.append(el('span', '', label), input);
  return row;
}

export function soundButton(engine: AudioEngine): HTMLButtonElement {
  const b = el('button', 'snd-button');
  b.type = 'button';
  const label = (): void => { b.textContent = engine.muted || engine.volume === 0 ? 'Sound off' : 'Sound'; };
  label();
  let panel: HTMLDivElement | null = null;
  let stopKeys = (): void => {};
  const close = (): void => { panel?.remove(); panel = null; stopKeys(); removeEventListener('pointerdown', onOutside, true); };
  const onOutside = (e: PointerEvent): void => { if (panel && !panel.contains(e.target as Node) && e.target !== b) close(); };
  b.addEventListener('click', () => {
    engine.wake();
    if (panel) { close(); return; }
    panel = el('div', 'snd-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Sound');
    const mute = el('label', 'snd-row snd-mute');
    const box = el('input', '');
    box.type = 'checkbox';
    box.checked = engine.muted;
    box.addEventListener('change', () => { engine.setMuted(box.checked); label(); });
    mute.append(el('span', '', 'Mute'), box);
    panel.append(el('h2', '', 'Sound'), mute, slider('Volume', engine.volume, 1, (v) => { engine.setVolume(v); box.checked = engine.muted; label(); }));
    for (const c of SOUND_CATEGORIES) panel.append(slider(c.name, engine.mix[c.id], 1.5, (v) => engine.setMix(c.id, v)));
    document.body.append(panel);
    stopKeys = onEscape(close);
    addEventListener('pointerdown', onOutside, true);
  });
  return b;
}
