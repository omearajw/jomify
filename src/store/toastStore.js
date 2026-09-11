import { create } from 'zustand';

let nextId = 1;

export const useToastStore = create((set) => ({
  toasts: [],

  show: (message, { tone = 'info', duration = 3500 } = {}) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    }, duration);
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }))
}));

// Callable from anywhere, including non-React code
export const toast = (message, options) => useToastStore.getState().show(message, options);
