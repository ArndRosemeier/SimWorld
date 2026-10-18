/**
 * A page left over from an earlier deploy (cached) asks for scripts and workers the server no longer has. Then the
 * page loads the new version, once per tab session, so a server that keeps answering 404 shows the message instead of
 * looping.
 */

/** Reload for the new version unless this tab already did; says what it does with `say`. Whether it reloads. */
export function reloadForUpdate(say: (text: string) => void): boolean {
  if (onceThisSession('simworld-reloaded-for-update')) return false;
  say('Total Town was updated: loading the new version…');
  location.reload();
  return true;
}

/** Whether `key` was already marked in this tab's session (and mark it). Storage may be off: then say yes. */
function onceThisSession(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, '1');
    return false;
  } catch { return true; }
}
