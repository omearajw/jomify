import { useCallback, useRef, useState } from 'react';

// Several rows at once: Ctrl/Cmd-click toggles one, Shift-click extends from the last one
// clicked, and once anything is selected a plain tap toggles too (the phone's way in, after
// "Select" from the row menu). `keys` is the list in display order, for Shift ranges.
export function useSelection(keys) {
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);

  const toggle = useCallback((key, { range = false } = {}) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor.current !== null) {
        const a = keys.indexOf(anchor.current);
        const b = keys.indexOf(key);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(keys[i]);
          return next;
        }
      }
      if (next.has(key)) next.delete(key); else next.add(key);
      anchor.current = key;
      return next;
    });
  }, [keys]);

  const clear = useCallback(() => { setSelected(new Set()); anchor.current = null; }, []);
  // A click meant as a selection: a modifier, or a selection already under way
  const wantsSelect = (e) => Boolean(e?.shiftKey || e?.ctrlKey || e?.metaKey) || selected.size > 0;

  return { selected, count: selected.size, toggle, clear, has: (key) => selected.has(key), wantsSelect, active: selected.size > 0 };
}
