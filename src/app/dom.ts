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
