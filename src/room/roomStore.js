import { create } from 'zustand';

// What the open thing wants the layer to know: the cover's light behind it, so the layer can
// draw it from the plane's top, outside the column's own scrolling and clipping.
export const useRoomStore = create((set) => ({
  light: null,
  setLight: (light) => set({ light }),
  // what is typed in the tree's field, for the search surface when it is open
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  // a page with a state of its own (search's "All albums") puts its own step on Back
  back: null,
  setBack: (back) => set({ back }),
  // ...and names that state, so the column remembers where it was scrolled per state
  pageSuffix: '',
  setPageSuffix: (pageSuffix) => set({ pageSuffix })
}));
