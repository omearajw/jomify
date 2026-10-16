import { create } from 'zustand';
import { loadProjectorState, saveProjectorState } from './projectorLayouts';

// The projector's shared state, so the editor on the laptop and the picture on the wall are the
// same thing: the layouts, the guides the editor wants drawn on the wall (outlines, the corner
// being moved), and the size of the projector's screen, which the editor's stage takes its shape
// from. The window doing the editing owns the layouts and saves them; the projector's own window
// only receives them (projectorBridge.js).

export const useProjectorStore = create((set) => ({
  layouts: loadProjectorState(),
  // what the wall shows besides the content while editing: outlines, and what is selected
  guides: { on: false, wallId: null, corner: null, itemId: null },
  // the projector's screen as its window last reported it; 16:9 until one does
  frame: { w: 1920, h: 1080, reported: false },
  studioOpen: false,
  setLayouts: (fn) => set((s) => ({ layouts: typeof fn === 'function' ? fn(s.layouts) : fn })),
  setGuides: (patch) => set((s) => ({ guides: { ...s.guides, ...patch } })),
  setFrame: (w, h) => set((s) => (s.frame.w === w && s.frame.h === h && s.frame.reported ? s : { frame: { w, h, reported: true } })),
  setStudioOpen: (open) => set({ studioOpen: Boolean(open) })
}));

export const activeLayout = (layouts) => layouts.layouts.find((l) => l.id === layouts.activeId) || layouts.layouts[0];

// Saved whenever the layouts change, by the window that changed them
let saving = false;
export function persistProjectorLayouts() {
  if (saving) return;
  saving = true;
  useProjectorStore.subscribe((s, prev) => { if (s.layouts !== prev.layouts) saveProjectorState(s.layouts); });
}
