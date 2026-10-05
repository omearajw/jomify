import { create } from 'zustand';

let nextId = 1;

export const useToastStore = create((set) => ({
  toasts: [],

  // `action` is an optional { label, onClick } button (an Undo, usually); its toast stays up
  // a little longer so there is time to press it
  show: (message, { tone = 'info', duration, action = null } = {}) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone, action }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    }, duration ?? (action ? 6000 : 3500));
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }))
}));

// Callable from anywhere, including non-React code
export const toast = (message, options) => useToastStore.getState().show(message, options);
