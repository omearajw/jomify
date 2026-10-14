import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import AccountPanel from '../components/AccountPanel';
import { useIsMobile } from '../hooks/useMediaQuery';

// Account, sync, notifications, backup and the debug log in one place: a bottom sheet on the
// phone (from the gear on Home or the Library header), a dialog on desktop (from the footer)
export default function AccountSheet() {
  const isOpen = useUserStore((s) => s.isAccountOpen);
  const setAccountOpen = useUserStore((s) => s.setAccountOpen);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, setAccountOpen]);

  if (!isOpen) return null;

  const close = () => setAccountOpen(false);
  return createPortal(
    <div className={`fixed inset-0 z-[9002] flex bg-black/60 ${isMobile ? 'items-end' : 'items-center justify-center p-6'}`} onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className={isMobile
          ? 'ui-plane w-full max-h-[85dvh] overflow-y-auto rounded-t-[10px] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-fade-in'
          : 'ui-plane w-full max-w-md max-h-[85vh] overflow-y-auto p-8 animate-fade-in'}
      >
        {isMobile && <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/25" aria-hidden="true" />}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="room-mono text-[var(--room-dim)]">Settings</h2>
          <button type="button" onClick={close} className="ui-word">Close</button>
        </div>
        <AccountPanel variant="sheet" />
      </div>
    </div>,
    document.body
  );
}
