// "Lives" picker on a game's start screen: 1, 3, 5, 10 or infinite.
// The choice is remembered per game.

const CHOICES = [1, 2, 3, 5, 10, Infinity];

/**
 * Fills `select` with the choices and returns a function that reads the
 * current choice (a number, or Infinity).
 */
export function livesPicker(select, storageKey, fallback = 3) {
  select.replaceChildren(
    ...CHOICES.map((n) => new Option(n === Infinity ? '∞ Infinite' : String(n), n === Infinity ? 'inf' : String(n))),
  );
  let saved = null;
  try { saved = localStorage.getItem(storageKey); } catch {}
  const fb = fallback === Infinity ? 'inf' : String(fallback);
  select.value = [...select.options].some((o) => o.value === saved) ? saved : fb;
  select.addEventListener('change', () => {
    try { localStorage.setItem(storageKey, select.value); } catch {}
  });
  return () => (select.value === 'inf' ? Infinity : Number(select.value) || fallback);
}

/** HUD text: filled and empty hearts, or "♥ ∞" for infinite lives. */
export function heartsText(lives, max) {
  if (max === Infinity) return '♥ ∞';
  return '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, max - lives));
}
