# Living with the room

Irritations, surprises and ideas from running the new layout day to day (Settings → Layout →
The room). One line each, dated; nothing is too small. These feed the next round.

## 2026-10-13

- (first run)

## 13 Oct, slice 1 running (room, rail, layer, queue column)

- Z into Zen is a cut, not a fade: the stage stays but the room grid is swapped for Zen's own
  main. Should be a crossfade of the chrome at the room's tempo (DESIGN.md: "Zen is the room with
  the chrome faded").
- The layer's insides are the old app views unchanged (Library's cards, Sevens' pills and
  gradient buttons) and look foreign on the plane. That is slice 2.
- "Up next" with nothing queued is a sentence; the column should probably show what plays next
  from the context instead of a hint.
- The art at rest has square corners and no shadow bleed into the room; may want the light of
  the cover to spill (the stage already does, so maybe fine).
- The rail's "Unadded" is in the design but has no view yet, so it is faint and does nothing.
- Window narrower than ~1100px has not been looked at.
- The right column shows the old views (PlaylistView, Browse, Library) in their old styling;
  their heroes and tables were laid out for the viewport, not a column, so some of it is
  cramped. Restyling them on the language is the next slice.
- Enter in the tree's search field opens Browse with the words, but if Browse is already open it
  keeps its old query (it reads the query once, at mount).
- The right column does not yet remember what you last had open; pulling to full with nothing
  open shows the old Library page (sort, filter, grid, organising).
- No drag and drop in the tree yet (moving things between folders is still the old Library page).

## 14 Oct, the open playlist and Liked Songs on the language

- The unadded "sort into" pills on rows are still the old pink chips; they move to Unadded (step 3).
- The context menu, the selection bar, the edit dialog and the confirm dialog are the old look.
- The check-playlists picker is a modal plane; fine for now, might become the right column.
- Album, artist and search pages are still the old pages inside the layer.
- Jack's Safari runs the lite scene (no WebGL stage): the room's light there is the cover
  pre-blurred, which read as a box on a wide window until 14 Oct (now it covers). It is a flat
  blur, nothing moves. If the room is going to be lived in on Safari, the lite light needs its
  own slow drift, cheap enough for WebKit.
- (Jack, 14 Oct) Lyrics between songs: a song with no lyrics followed by another with none goes
  "no lyrics" → "finding the lyrics" → "no lyrics", which looks messy. Assume the next song
  behaves like the last one, load silently, and only change the words when the answer differs;
  make every combination of the transition smooth (none→none, none→some, some→none, some→some).

## 14 Oct, Unadded as a mode

- (Jack, 14 Oct) On the Unadded surface "there is just lots of text and it's hard to tell what
  is an option/button and what is just information." The language puts both in mono caps: words
  (`.ui-word`, dim → paper on hover) and labels (`.room-mono`, faint). Moved the surface's
  information (tags, tile reasons, the ghost's line) to plain sentence-case text so mono caps
  there are words and section heads only. The wider question stands for every surface: whether
  words need a mark of their own (a hair under them, or sentence case) rather than relying on
  colour alone.
- The suggestions' profiles are built from every check playlist's songs plus genres for every
  artist in the pile; on a real pile that is slow, and its status was invisible. The pile now
  says "Working out where each would suit…" or "Couldn't work out… · Try again", and the status
  goes to the debug log (`unadded · suggestions`).
- (Jack, 14 Oct) In a browser tab that is not focused, the next song does not start. Not
  needed (it is the installed app 99% of the time). Likely cause: the remote-state poll stops
  while `document.hidden` (playbackController.js), so the queue's handover of the next
  hand-added song waits for the tab to come back; the SDK's own state events still arrive, so
  local playback in a context carries on. A fix would hand over on the SDK's end-of-song
  event, or keep one slow poll while hidden.
