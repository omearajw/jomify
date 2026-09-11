// Turns the JSON emitted by the `spotifyfolders` CLI (mikez/spotify-folders, which reads the
// desktop app's local cache) into a folder plan the store can apply. The Spotify Web API has no
// notion of folders, so this file is the only bridge.
//
// Input shape, recursive:
//   { type: 'folder', name?, uri: 'spotify:user:<u>:folder:<hex>', children: [
//       { type: 'playlist', uri: 'spotify:playlist:<id>' },
//       { type: 'folder', ... } ] }
// The root is itself a folder whose children are the top level. Playlists carry only a uri.
//
// Pure and import-free so scripts/import-cases.mjs can run it under plain node.

export class ImportFormatError extends Error {}

const MAX_DEPTH = 32;
const MAX_NODES = 5000;

export function playlistIdFromUri(uri) {
  if (typeof uri !== 'string') return null;
  // Current form, plus the legacy user-scoped form older caches still contain
  const match = uri.match(/^spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]+)$/);
  return match ? match[1] : null;
}

// Deterministic Jomify id from Spotify's folder id, so a re-import updates the same folder
// instead of creating a twin. Cannot collide with `folder-<timestamp>-<random>`.
export function folderIdFromUri(uri) {
  if (typeof uri !== 'string') return null;
  const match = uri.match(/^spotify:user:[^:]+:folder:([0-9a-fA-F]+)$/);
  return match ? `folder-sp-${match[1].toLowerCase()}` : null;
}

function cleanName(raw) {
  let name = typeof raw === 'string' ? raw : '';
  // The CLI already URL-decodes; a literal "%" in a name must not throw here
  try { name = decodeURIComponent(name); } catch { /* keep as-is */ }
  name = name.trim();
  return name || 'Untitled folder';
}

export function parseSpotifyFolders(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportFormatError("That isn't valid JSON.");
  }

  const isObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  if (isObject && (parsed.app === 'jomify' || parsed.state?.customFolders)) {
    throw new ImportFormatError("That's a Jomify backup, not spotifyfolders output. Use Restore in the sidebar for backups.");
  }

  let root;
  if (Array.isArray(parsed)) root = { type: 'folder', children: parsed };
  else if (isObject && Array.isArray(parsed.children)) root = parsed;
  else throw new ImportFormatError("This doesn't look like spotifyfolders output. Expected a root folder object with a 'children' array.");

  let nodes = 0;
  let ignored = 0;

  const walk = (node, depth) => {
    nodes += 1;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) {
      throw new ImportFormatError('This folder tree is too large or too deeply nested to import.');
    }
    if (!node || typeof node !== 'object') { ignored += 1; return null; }
    if (node.type === 'playlist') return { type: 'playlist', uri: node.uri };
    if (node.type === 'folder') {
      const children = Array.isArray(node.children)
        ? node.children.map(child => walk(child, depth + 1)).filter(Boolean)
        : [];
      return { type: 'folder', name: cleanName(node.name), uri: node.uri, children };
    }
    ignored += 1;
    return null;
  };

  const children = root.children.map(child => walk(child, 1)).filter(Boolean);
  return { root: { type: 'folder', name: cleanName(root.name), uri: root.uri, children }, ignored };
}

// Builds the flat folder list importFolderTree expects, in depth-first order, with sibling
// `order` taken from the JSON order. Only playlists the user actually follows (present in
// `playlists`) are kept; the rest are reported so nothing vanishes silently.
export function planImport(root, { playlists = [], existingFolders = [], pinnedItems = [], mode = 'replace' } = {}) {
  const known = new Set(playlists.map(p => p.id));
  const existingIds = new Set(existingFolders.map(f => f.id));

  // In merge mode imported roots go after the folders that only exist in Jomify, so the
  // user's own ordering stays put and the import reads as an appended block
  const rootBase = mode === 'merge'
    ? Math.max(0, ...existingFolders
        .filter(f => (f.parentId ?? null) === null && !f.id.startsWith('folder-sp-'))
        .map(f => f.order ?? 0))
    : 0;

  const folders = [];
  const skippedUris = [];
  const ignoredUris = [];
  const claimed = new Set(); // an item lives in exactly one folder; first occurrence wins
  let playlistCount = 0;
  let noUri = 0;
  let rootPlaylists = 0;

  const walkFolder = (node, parentId, index, parentKey) => {
    let id = folderIdFromUri(node.uri);
    if (!id) {
      id = `folder-sp-${parentKey}-${index}`;
      noUri += 1;
    }

    const playlistIds = [];
    const childFolders = [];
    node.children.forEach((child, childIndex) => {
      if (child.type === 'folder') {
        childFolders.push([child, childIndex]);
        return;
      }
      const playlistId = playlistIdFromUri(child.uri);
      if (!playlistId) { ignoredUris.push(String(child.uri)); return; }
      if (!known.has(playlistId)) { skippedUris.push(child.uri); return; }
      if (claimed.has(playlistId)) return;
      claimed.add(playlistId);
      playlistIds.push(playlistId);
      playlistCount += 1;
    });

    folders.push({
      id,
      name: node.name,
      parentId,
      order: (parentId === null ? rootBase : 0) + (index + 1) * 1000,
      playlistIds
    });

    childFolders.forEach(([child, childIndex]) => walkFolder(child, id, childIndex, id));
  };

  root.children.forEach((child, index) => {
    if (child.type === 'folder') walkFolder(child, null, index, 'root');
    else rootPlaylists += 1; // top-level playlists aren't in any folder; nothing to import
  });

  const planned = new Set(folders.map(f => f.id));
  const removedIds = mode === 'replace' ? [...existingIds].filter(id => !planned.has(id)) : [];
  const removedSet = new Set(removedIds);

  return {
    folders,
    stats: {
      folders: folders.length,
      playlists: playlistCount,
      skipped: skippedUris.length,
      skippedUris,
      ignoredUris,
      noUri,
      rootPlaylists,
      created: folders.filter(f => !existingIds.has(f.id)).length,
      updated: folders.filter(f => existingIds.has(f.id)).length,
      removed: removedIds.length,
      removedPinned: pinnedItems.filter(p => removedSet.has(p.id)).length
    }
  };
}
