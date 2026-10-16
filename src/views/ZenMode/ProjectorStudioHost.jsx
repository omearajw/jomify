import { Suspense, lazy } from 'react';
import { useProjectorStore } from './projectorStore';

const ProjectorStudio = lazy(() => import('./ProjectorStudio'));

// The projector editor, over whatever the main window shows, while it is open
export default function ProjectorStudioHost() {
  const open = useProjectorStore((s) => s.studioOpen);
  return open ? <Suspense fallback={null}><ProjectorStudio /></Suspense> : null;
}
