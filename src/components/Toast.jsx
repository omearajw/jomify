import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  // Above the player bar on desktop, and above the mini player, tabs and the phone's own bottom
  // inset on a phone, where a fixed 112px used to sit over the mini player
  return (
    <div className="fixed bottom-[calc(7.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[9000] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role="status"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.35, ease: [0.2, 0.75, 0.2, 1] }}
            className={`ui-plane pointer-events-auto flex items-center gap-5 px-5 py-2.5 text-[13px] ${t.tone === 'error' ? 'text-[rgb(240,160,160)]' : 'text-[var(--room-paper)]'}`}
          >
            <span className="max-w-[60vw] truncate">{t.message}</span>
            {t.action && <button type="button" onClick={() => { t.action.onClick(); dismiss(t.id); }} className="ui-word shrink-0">{t.action.label}</button>}
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-[var(--room-faint)] hover:text-[var(--room-paper)]"><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
