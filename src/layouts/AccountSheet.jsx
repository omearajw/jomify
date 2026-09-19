import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import AccountPanel from '../components/AccountPanel';

// The phone's way to the things the sidebar footer offers on desktop
export default function AccountSheet() {
  const isOpen = useUserStore((s) => s.isAccountOpen);
  const setAccountOpen = useUserStore((s) => s.setAccountOpen);
  if (!isOpen) return null;

  const close = () => setAccountOpen(false);
  return createPortal(
    <div className="fixed inset-0 z-[9002] flex items-end bg-black/70" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-neutral-950 border-t border-white/10 shadow-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] animate-fade-in"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Account</h2>
          <button type="button" onClick={close} aria-label="Close" className="w-11 h-11 flex items-center justify-center text-neutral-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <AccountPanel variant="sheet" />
      </div>
    </div>,
    document.body
  );
}
