import { AnimatePresence, motion } from 'framer-motion';
import { Check, AlertTriangle, X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

const TONES = {
  info: 'bg-neutral-900/95 border-white/10 text-white',
  success: 'bg-neutral-900/95 border-[var(--brand-mid)]/40 text-white shadow-[0_0_30px_rgba(249,19,98,0.15)]',
  error: 'bg-neutral-900/95 border-red-500/40 text-white'
};

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    // Sits just above the 96px player bar, out of the way of the main content
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[9000] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role="status"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full border backdrop-blur-xl shadow-2xl text-sm font-medium ${TONES[t.tone] || TONES.info}`}
          >
            {t.tone === 'success' && <Check className="w-4 h-4 text-[var(--brand-mid)] shrink-0" />}
            {t.tone === 'error' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
            <span className="max-w-[60vw] truncate">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-neutral-500 hover:text-white transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
