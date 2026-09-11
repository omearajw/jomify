import { useUserStore } from '../store/userStore';
import { repairFolderTree } from '../utils/library';

// A deliberately dumb, self-contained backup of everything Jomify keeps locally that isn't a
// secret. This file must not import the sync engine or the merge function: its whole purpose is
// to be a copy of your data that still works if that code is wrong.

export const BACKUP_VERSION = 1;

// Everything here is user data. Secrets (token, refreshToken, tokenExpiresAt, verifier) are
// deliberately absent -- a backup file gets emailed to yourself or dropped in a Drive folder,
// and it must never carry credentials.
const BACKED_UP_KEYS = [
  'customFolders',
  'pinnedItems',
  'sevens',
  'sevensSeeded',
  'stagedSeven',
  'playlistSortSettings',
  'libraryGridSize',
  'savedVolume'
];

// Still living in its own localStorage key rather than the store
const LEGACY_UNADDED_KEY = 'jomify_unadded_check_playlists';

export function buildBackup() {
  const state = useUserStore.getState();
  const data = {};
  BACKED_UP_KEYS.forEach((key) => { data[key] = state[key]; });

  let unaddedCheckPlaylists = [];
  try {
    const raw = localStorage.getItem(LEGACY_UNADDED_KEY);
    if (raw) unaddedCheckPlaylists = JSON.parse(raw);
  } catch {
    // A corrupt legacy key must not stop the rest of the backup
  }

  return {
    app: 'jomify',
    kind: 'backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      folders: state.customFolders?.length ?? 0,
      pins: state.pinnedItems?.length ?? 0,
      sevens: state.sevens?.length ?? 0
    },
    data: { ...data, unaddedCheckPlaylists }
  };
}

export function downloadBackup() {
  const backup = buildBackup();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `jomify-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoking immediately can cancel the download in some browsers, so give it a moment
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return backup;
}

// Folders from an older build have no `order` field. Their sequence lives only in array
// position, so it must be converted before anything sorts them -- otherwise the id tiebreak
// would silently reshuffle them into an arbitrary order.
function normalizeFolders(folders) {
  if (!Array.isArray(folders)) return [];
  return folders.map((folder, index) => ({
    ...folder,
    parentId: folder.parentId ?? null,
    order: typeof folder.order === 'number' ? folder.order : (index + 1) * 1000
  }));
}

// Accepts a raw `jomify-storage` value copied straight out of another device's devtools
// (`copy(localStorage.getItem('jomify-storage'))`). That is the only way to move data off a
// device running a build that predates the backup button, so it needs to work.
function fromPersistBlob(state) {
  const data = {};
  BACKED_UP_KEYS.forEach((key) => {
    if (state[key] !== undefined) data[key] = state[key];
  });
  data.customFolders = normalizeFolders(state.customFolders);

  return {
    app: 'jomify',
    kind: 'backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'raw jomify-storage blob',
    counts: {
      folders: data.customFolders.length,
      pins: state.pinnedItems?.length ?? 0,
      sevens: state.sevens?.length ?? 0
    },
    data
  };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }

  // A backup file produced by the "Back up data" button
  if (parsed?.app === 'jomify' && parsed?.kind === 'backup') {
    if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
      throw new Error(`That backup was made by a newer version of Jomify (v${parsed.version}).`);
    }
    if (!parsed.data || typeof parsed.data !== 'object') {
      throw new Error('That backup file has no data in it.');
    }
    return { ...parsed, data: { ...parsed.data, customFolders: normalizeFolders(parsed.data.customFolders) } };
  }

  // A whole zustand persist blob: { state: {...}, version: n }
  if (parsed?.state && typeof parsed.state === 'object') {
    return fromPersistBlob(parsed.state);
  }

  // Or just the inner state object on its own
  if (Array.isArray(parsed?.customFolders)) {
    return fromPersistBlob(parsed);
  }

  throw new Error("That doesn't look like Jomify data. Use a backup file, or the value of the 'jomify-storage' localStorage key.");
}

// Restores a parsed backup over the current local state. This is intentionally a replace and not
// a merge: you reach for a backup when the live data is wrong, and a merge would preserve exactly
// the mess you are trying to undo.
export function applyBackup(parsed) {
  const { data } = parsed;
  const patch = {};

  BACKED_UP_KEYS.forEach((key) => {
    if (data[key] !== undefined) patch[key] = data[key];
  });

  // A backup taken before a folder was deleted elsewhere can carry children of that folder
  if (Array.isArray(patch.customFolders)) {
    patch.customFolders = repairFolderTree(patch.customFolders).folders;
  }

  useUserStore.setState(patch);

  if (Array.isArray(data.unaddedCheckPlaylists)) {
    try {
      localStorage.setItem(LEGACY_UNADDED_KEY, JSON.stringify(data.unaddedCheckPlaylists));
    } catch {
      // Non-fatal: the rest of the restore already succeeded
    }
  }

  return patch;
}
