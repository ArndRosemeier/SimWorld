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

/**
 * A modal dialog: `<prefix>-backdrop` holding `<prefix>-panel`, closed by `close`, Escape or a click outside. The
 * caller fills the panel (and places `close` in it). Returns null when one with this prefix is already open.
 */
export function openDialog(prefix: string, label: string, close: HTMLButtonElement): HTMLDivElement | null {
  if (document.querySelector(`.${prefix}-backdrop`)) return null;
  const backdrop = el('div', `${prefix}-backdrop`);
  const panel = el('div', `${prefix}-panel`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', label);
  backdrop.append(panel);
  const shut = (): void => { backdrop.remove(); stopKeys(); };
  const stopKeys = onEscape(shut);
  close.addEventListener('click', shut);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) shut(); });
  document.body.append(backdrop);
  queueMicrotask(() => close.focus());
  return panel;
}
