// The nearest ancestor that scrolls. An IntersectionObserver's rootMargin only widens its root,
// and the default root is the viewport, so a sentinel inside a scrolling <main> was clipped by
// <main> and only counted once fully on screen: the "load 800px early" never happened.
export function scrollParent(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}
