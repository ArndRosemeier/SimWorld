/** Small DOM helpers shared by the app's panels (What's new, sound). */

/** A new element with a class and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Call `close` when Escape is pressed; returns the function that stops listening. */
export function onEscape(close: () => void): () => void {
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', key);
  return () => removeEventListener('keydown', key);
}

/** A plain button (type "button") that calls `onClick`. */
export function button(cls: string, text: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A checkbox that calls `onChange` with its new state. */
export function checkbox(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const c = el('input', '');
  c.type = 'checkbox';
  c.checked = checked;
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}
