// Makes a clickable <div> reachable and operable from the keyboard without changing its layout
// to a <button>. Spread onto any track row that has an onClick.
export function rowButtonProps(onActivate) {
  return {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    }
  };
}
