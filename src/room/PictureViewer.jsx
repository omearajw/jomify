import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useUserStore } from '../store/userStore';

// A picture (an artist's, a profile's) large over the room: it grows out of the circle it sat in
// and squares off, over a dimmed room. A click anywhere or Escape puts it away, and so does Back
// (historySync, registered in App.jsx).

const EASE = [0.2, 0.75, 0.2, 1];

export default function PictureViewer() {
  const picture = useUserStore((s) => s.bigPicture);
  const setBigPicture = useUserStore((s) => s.setBigPicture);
  const reduce = useReducedMotion();
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    if (!picture) return undefined;
    // first, so the room's own Escape (put the layer away) does not run as well
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setBigPicture(null); } };
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); };
  }, [picture, setBigPicture]);

  // room under it for the name
  const side = Math.min(640, view.w - 32, view.h - 120);
  // where the circle was, as an offset from the middle of the screen and a scale of the full size
  const from = picture?.from;
  const start = from && !reduce
    ? { x: from.x + from.w / 2 - view.w / 2, y: from.y + from.h / 2 - view.h / 2, scale: from.w / side, borderRadius: side / 2, opacity: 1 }
    : { opacity: 0, scale: 0.96, borderRadius: 8 };

  return createPortal(
    <AnimatePresence>
      {picture && (
        <motion.div
          key={picture.url}
          role="dialog"
          aria-modal="true"
          aria-label={picture.name ? `Picture of ${picture.name}` : 'Picture'}
          onClick={() => setBigPicture(null)}
          className="fixed inset-0 z-[90] flex cursor-zoom-out items-center justify-center"
          style={{ fontFamily: 'var(--font-room)' }}
          initial={{ backgroundColor: 'rgba(7,7,11,0)', backdropFilter: 'blur(0px)' }}
          animate={{ backgroundColor: 'rgba(7,7,11,0.86)', backdropFilter: 'blur(14px)' }}
          exit={{ backgroundColor: 'rgba(7,7,11,0)', backdropFilter: 'blur(0px)' }}
          transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
        >
          <div className="relative">
          <motion.img
            src={picture.url}
            alt={picture.name || ''}
            draggable="false"
            className="block object-cover shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
            style={{ width: side, height: side }}
            initial={start}
            animate={{ x: 0, y: 0, scale: 1, borderRadius: 8, opacity: 1 }}
            exit={start}
            transition={{ duration: reduce ? 0 : 0.48, ease: EASE }}
          />
          {picture.name && (
            <motion.p
              className="room-mono absolute inset-x-0 top-full mt-4 truncate text-center text-[var(--room-dim)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: reduce ? 0 : 0.2, duration: 0.3 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              {picture.name}
            </motion.p>
          )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
