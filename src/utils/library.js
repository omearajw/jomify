// Folder-tree helpers. This module must stay import-free: src/sync/transform.js imports it and
// is exercised under plain node by scripts/merge-cases.mjs.

const parentOf = (folder) => folder.parentId ?? null;

// Sparse numeric sort key with an id tiebreak so two devices always agree on an order. Only
// meaningful among siblings (folders sharing a parentId).
export const byOrder = (a, b) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Which playlists and albums are NOT inside any folder. One Set over every folder's items makes
// it one pass, and it is depth-agnostic.
export function getUnfolderedItems(playlists = [], albums = [], folders = []) {
  const foldered = new Set(folders.flatMap(f => f.playlistIds || []));
  return {
    playlists: playlists.filter(p => !foldered.has(p.id)),
    albums: (albums || []).filter(a => !foldered.has(a.id))
  };
}

export function childrenOf(folders, parentId = null) {
  return folders.filter(f => parentOf(f) === parentId).sort(byOrder);
}

function indexByParent(folders) {
  const ids = new Set(folders.map(f => f.id));
  const byParent = new Map();
  for (const folder of folders) {
    const parent = parentOf(folder);
    // A parent that isn't in the set (deleted elsewhere, or a broken import) renders as a root
    // rather than vanishing; repairFolderTree fixes the data, this fixes the display
    const key = parent !== null && ids.has(parent) ? parent : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(folder);
  }
  for (const list of byParent.values()) list.sort(byOrder);
  return byParent;
}

// { roots: Node[], byId: Map<id, Node> } with Node = { folder, depth, children }.
// Members of a parent cycle have no path to a root; they are surfaced as roots too, with the
// cycle cut at the first repeat, so nothing is ever silently dropped from the UI.
export function buildFolderTree(folders) {
  const byParent = indexByParent(folders);
  const byId = new Map();

  const visit = (list, depth, trail) => {
    const nodes = [];
    for (const folder of list) {
      if (trail.has(folder.id) || byId.has(folder.id)) continue;
      const node = { folder, depth, children: [] };
      byId.set(folder.id, node);
      const nextTrail = new Set(trail);
      nextTrail.add(folder.id);
      node.children = visit(byParent.get(folder.id) || [], depth + 1, nextTrail);
      nodes.push(node);
    }
    return nodes;
  };

  const roots = visit(byParent.get(null) || [], 0, new Set());
  const leftovers = folders.filter(f => !byId.has(f.id)).sort(byOrder);
  for (const folder of leftovers) {
    if (byId.has(folder.id)) continue;
    roots.push(...visit([folder], 0, new Set()));
  }
  return { roots, byId };
}

// Depth-first in sibling order, each entry carrying its ancestry as names, for path-labelled
// lists such as "Rock › 80s". Subtrees in `exclude` are skipped entirely.
export function flattenFolderTree(folders, { exclude = new Set() } = {}) {
  const out = [];
  const walk = (nodes, path) => {
    for (const node of nodes) {
      if (exclude.has(node.folder.id)) continue;
      const nextPath = [...path, node.folder.name];
      out.push({ folder: node.folder, depth: node.depth, path: nextPath });
      walk(node.children, nextPath);
    }
  };
  walk(buildFolderTree(folders).roots, []);
  return out;
}

// Root-first ancestors of a folder, ending with the folder itself. Stops at a repeat so a
// cycle in unrepaired data can't spin forever.
export function folderPath(folders, folderId) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const path = [];
  const seen = new Set();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = parentOf(current) !== null ? byId.get(parentOf(current)) : null;
  }
  return path;
}

// Every folder below `folderId`, depth-first in sibling order; never includes `folderId` itself.
export function descendantIds(folders, folderId) {
  const byParent = indexByParent(folders);
  const out = [];
  const seen = new Set([folderId]);
  const walk = (id) => {
    for (const child of byParent.get(id) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(folderId);
  return out;
}

export function isDescendant(folders, candidateId, ancestorId) {
  return descendantIds(folders, ancestorId).includes(candidateId);
}

// A folder's own items first, then its descendants' in tree order, de-duplicated. Used for
// cover art and counts, so a folder that only holds subfolders still shows what's inside.
export function descendantItemIds(folders, folderId) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const ordered = [folderId, ...descendantIds(folders, folderId)]
    .map(id => byId.get(id))
    .filter(Boolean)
    .flatMap(f => f.playlistIds || []);
  return [...new Set(ordered)];
}

export function nextSiblingOrder(folders, parentId = null) {
  const siblings = childrenOf(folders, parentId);
  if (siblings.length === 0) return 1000;
  return Math.max(...siblings.map(f => f.order ?? 0)) + 1000;
}

// Makes a folder list renderable after a cross-device merge. Two things can go wrong there
// because parentId merges independently of deletions:
//   orphans -- device A deletes P while device B moves C under P. C survives with a parent that
//              no longer exists. Adopted to the root.
//   cycles  -- A moves X under Y while B moves Y under X. Exactly one member of each cycle is
//              detached: the one with the newest parentId clock (the move that closed the loop),
//              tiebroken by the greatest id. Both criteria are values every device sees, so all
//              devices detach the same folder without talking to each other.
// Pure and deterministic; callers must NOT re-stamp clocks for what this changes, or devices
// would fight over it. Returns a new array; input is not mutated.
export function repairFolderTree(folders, { clockOf = () => 0 } = {}) {
  const live = new Set(folders.map(f => f.id));
  const repaired = folders.map(f => ({ ...f, parentId: parentOf(f) }));
  const byId = new Map(repaired.map(f => [f.id, f]));
  const orphans = [];
  const detached = [];

  for (const folder of repaired) {
    if (folder.parentId !== null && !live.has(folder.parentId)) {
      folder.parentId = null;
      orphans.push(folder.id);
    }
  }

  const handled = new Set();
  for (const start of repaired) {
    const trail = [];
    const seen = new Set();
    let current = start;
    while (current && current.parentId !== null && !seen.has(current.id)) {
      seen.add(current.id);
      trail.push(current.id);
      current = byId.get(current.parentId);
    }
    if (!current || current.parentId === null) continue;

    const loop = trail.slice(trail.indexOf(current.id));
    const key = [...loop].sort().join('|');
    if (handled.has(key)) continue;
    handled.add(key);

    let victim = loop[0];
    for (const id of loop) {
      const c = clockOf(id);
      const v = clockOf(victim);
      if (c > v || (c === v && id > victim)) victim = id;
    }
    byId.get(victim).parentId = null;
    detached.push(victim);
  }

  return { folders: repaired.sort(byOrder), orphans, detached };
}
