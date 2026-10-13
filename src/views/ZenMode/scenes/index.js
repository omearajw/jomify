// Scenes made for one song. There is no menu for these: a song that has one gets it, and the
// scene is responsible for its own entrance and exit around Zen's usual stage.
import { createRoomScene } from './virtualInsanity.js';
import { buildSchedule, stateAt } from './planner.js';

const plain = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, "'").replace(/\s+/g, ' ').trim();

const SCENES = [
  {
    id: 'virtual-insanity',
    matches: (track) => /virtual insanity/.test(plain(track?.name)) && (track?.artists || []).some((a) => /jamiroquai/.test(plain(a?.name))),
    create: createRoomScene,
    schedule: ({ lines, durationMs, trackId }) => buildSchedule({ lines, durationMs, seed: trackId }),
    stateAt
  }
];

export function sceneFor(track) {
  if (!track) return null;
  return SCENES.find((s) => s.matches(track)) || null;
}
