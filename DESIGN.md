# Jomify design

The decisions behind Jomify's layout and look, and why. Kept so a later "shall we add a sidebar"
starts from what was decided rather than from scratch.

## 1. What Jomify is for

Jomify is for someone who already has a lot of music — albums, artists, their own playlists — and
mostly opens it to play what they know and keep it in order. Finding new music is there when they
want it, never in the way.

What it has to be, and how to tell:

1. **Quick.** Anything you listen to most is one tap from wherever you are, and the player is
   never more than a glance away. A screen that puts a second tap between you and the music has
   to justify it.
2. **Only what you use.** Jomify has the library, the player, lyrics, and the things Spotify
   can't do: Sevens, the unadded-songs check, parties. Anything that doesn't serve one of those
   is cut, however nice it is.
3. **Arranged your way.** Your music is ordered the way you order it — folders, pins, Sevens,
   your sort — not by what Spotify wants to sell you. The structure of the library belongs to
   the person using it.
4. **Nicer to be in.** Zen, the glass lyrics, the room for a song: the app should feel like a
   place to listen, not a shop. The look flows outward from there.

## 2. The jobs

Everything someone does in Jomify today, from the code. Each job has a guess at how often it
happens, how urgent it is when it does, and how long it takes. The guesses are mine, to be
corrected; the point is the ranking, not the numbers. A job that happens fifty times a day and
must take one tap deserves the screen; one that happens monthly can live two taps away.

Legend: **often** = several times a listening session; **daily**; **weekly**; **rare**.
**now** = it has to work the instant you reach for it; **soon** = within a few seconds is fine;
**whenever** = no urgency.

### Listening (the app is doing this 100% of the time it is open)

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| See what's playing (song, artist, art, progress) | constant | now | a glance |
| Play / pause | often | now | 1 tap |
| Skip / go back | often | now | 1 tap |
| Seek within the song | daily | now | 1 drag |
| Change the volume | daily | now | 1 drag |
| Choose where the music plays (this device, the phone, an Alexa group) | daily | soon | 2 taps |
| Like / unlike the playing song | often | soon | 1 tap |
| See / edit what's coming next (Jomify's queue: remove, soon reorder) | daily | soon | 1–2 taps |
| Add a song, album or playlist to the queue | often | soon | 2 taps (menu) |
| "Play from here" in the queue | weekly | soon | 1 tap |
| Shuffle / repeat | daily | soon | 1 tap |
| Set a sleep timer (minutes, or end of song) | rare | whenever | 3 taps |
| Decide what happens when a playlist ends (Spotify's choice / Liked / the artists / stop) | rare | whenever | settings |
| Bring a forgotten player back / recover when playback stalls | rare, automatic | now | 0 taps |

### Lyrics and Zen

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Get the lyrics up for the playing song, synced, word by word where available | often | soon | 1 tap |
| Go into Zen (full-screen room for the song: light, glass lyrics, controls, a scene for some songs) | daily | soon | 1 key / 1 tap |
| Turn Zen's lyrics on/off (remembered) | daily | soon | 1 tap |
| Project Zen onto a wall (projector mapping) | rare | whenever | key + setup |

### The library

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Open a playlist and play it (or shuffle it) | often | soon | 2 taps |
| Find a playlist among many (folders, search, sort, grid size) | often | soon | 1–3 taps |
| Open Liked Songs | daily | soon | 1 tap |
| Pin things you come back to | rare | whenever | menu |
| Organise playlists into folders (create, nest, move, import Spotify's folder tree) | rare | whenever | several |
| Sort a playlist's rows (custom / name / artist / date added) | weekly | soon | 2 taps |
| Reorder a playlist by hand (drag) | weekly | soon | drags |
| Select many rows and act on them (add elsewhere, remove, queue) | weekly | soon | several |
| Edit a playlist's name, description, cover, public/private; share it | rare | whenever | dialog |
| Save / remove someone else's playlist or an album | rare | whenever | menu |
| Browse an album or an artist's page (top songs, discography, follow) | weekly | soon | 2 taps |
| "Made for you" (Spotify-owned playlists, blocked for this app — shown with a note) | rare | whenever | — |

### Search

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Find a song / album / artist / playlist on Spotify and play or queue it | daily | soon | type + 1 tap |
| Search within your own library | daily | soon | type |
| Recent searches | daily | whenever | 1 tap |

### Sevens (the shared playlists with Dad — Jomify's own thing)

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| See whose turn it is, across every Seven | daily | soon | a glance (Home banner) |
| Stage seven songs, order them, send the batch | weekly | whenever | minutes |
| Find a song for the batch from the pool / search | weekly | whenever | type |
| Read the batches so far (who added what, when) | weekly | whenever | scroll |
| Set up a Seven (who it's with, settings) | rare | whenever | dialog |
| Sort mode: go through a pile of songs deciding where each goes | weekly | whenever | minutes |

### The unadded-songs check

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Find songs you've liked but never put in a playlist | weekly | whenever | 1 tap + wait |
| For each, see which playlist it would suit (ReccoBeats sound + your history) and add it | weekly | whenever | 1 tap per song |
| Choose which playlists the check considers | rare | whenever | settings |

### Party mode

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Start a party, pick the speaker and the fallback playlist, show the QR code | rare | whenever | 3 taps |
| Host controls on the phone: pause, skip, volume, add a song, pause requests, pin, remove, block | during a party, often | now | 1 tap |
| Guests (no account) open the link, search, request, vote, see what's playing | during a party, often | soon | type + tap |
| See who requested what; the fairness order | during a party | soon | a glance |
| End the party / rejoin after a reload | rare | whenever | 1 tap |

### Friends and people

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Add a friend by pasting their profile link; suggestions from Sevens partners and collaborators | rare | whenever | paste |
| See a friend's public playlists; follow / unfollow them | rare | whenever | 2 taps |
| Who's playing with you in a collaborative playlist (collaborator colours, "requested by") | daily | whenever | a glance |

### Home

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Jump back in (recently played) | daily | soon | 1 tap |
| Pinned things | daily | soon | 1 tap |
| The Sevens turn banner | daily | soon | a glance |
| Friends strip on the phone | rare | whenever | 1 tap |

### Account, settings, housekeeping

| Job | How often | Urgency | Takes |
| --- | --- | --- | --- |
| Sign in / out; a second Spotify account | rare | whenever | OAuth |
| Open-on page, Zen effects (full/lite/auto), what Zen moves to, playlist endings | rare | whenever | settings |
| Sync across devices (automatic: folders, pins, Sevens, friends, settings) | automatic | whenever | 0 taps |
| Import a Spotify folder tree from the desktop app's cache | once | whenever | dialog |
| Debug log, "Check Spotify" endpoints | rare | whenever | settings |
| Install as an app (PWA / desktop), update when a new build lands | rare | whenever | 1 tap |
| Keyboard shortcuts (space, arrows, Z for Zen, P for projector…) | often (desktop) | now | 1 key |

## 3. Things the inventory shows

- **The player is the real home page.** Nine of the ten most frequent jobs are listening jobs, and
  it is on screen the whole time. Today it is a bar along the bottom with a queue column beside the
  content — Spotify's shape. Worth questioning first.
- **Sevens, the unadded check and Party are Jomify's own.** They have no Spotify precedent to
  copy, which is freeing, and they are deliberate, minutes-long sessions rather than taps — they
  could be *modes* you enter, not tabs you flick between.
- **Lyrics and Zen are the most polished part** and the most distinct from Spotify. The visual
  language may want to flow from there outward rather than the other way round.
- **Search is two things** (Spotify's catalogue, and your own library) that currently live in
  different places.
- **Settings are few.** A settings screen barely earns a tab.
- **The phone and the Mac run the same code** but have different jobs: the phone is a controller
  and a party host; the Mac is where Zen and the Sevens workspace happen.

## 4. Architecture: three directions

Where things live and what is always on screen, before any visuals. Each is judged against the
four tests in §1. They are not exclusive; the answer may be one of them with a piece of another.

### A. The room (player-centred)

What's playing *is* the app. The base layer is the now-playing room: art, the song, the controls,
and beside it either the queue or the lyrics — a calmer, always-on cousin of Zen. Your library is
a layer that slides over the room (a sheet on the phone, a panel on the Mac) when you reach for
it, and goes away when you've chosen. Sevens, the unadded check and Party are *modes* entered
from a small launcher; each takes the screen while you're in it and returns you to the room.
One search field, searching your library first and Spotify after it.

- Quick: the music is never behind anything; the library is one gesture away. ✓✓
- Only what you use: the launcher holds exactly the three Jomify things. ✓
- Arranged your way: the library layer is your folders and pins, nothing else. ✓
- Nicer to be in: the room is the resting state, so the look is Zen's, all the time. ✓✓
- Risk: organising (folders, sorting, big playlists) happens in a layer, which can feel cramped
  on the Mac; the room must earn its space when you're not looking at it.

### B. The shelf (library-first, player as a dock)

Closest to today, cleaned up. Home is your library: pins and folders, as you arranged them, with
"jump back in" and the Sevens turn banner at the top. The player is a dock — a strip on the Mac,
a bar on the phone — that expands into the full room (and Zen) when tapped. Sevens, the unadded
check and Party are tabs beside the library. Search is a tab with both scopes.

- Quick: one tap to anything pinned; the player is always a glance away but small. ✓
- Only what you use: tabs for the three Jomify things, nothing else. ✓
- Arranged your way: strongest here — the home page is literally your arrangement. ✓✓
- Nicer to be in: the look lives mostly in the expanded player; the shelf itself is a grid. ~
- Risk: this is Spotify's shape with better contents. Distinct in feel only if the shelf is
  designed, not a grid of squares.

### C. Two halves

The screen is split: on the left, your music (pins, folders, the open playlist); on the right,
the music playing (art, controls, queue, lyrics), always. On the phone the two halves are two
pages you swipe between, with the controls persistent at the bottom. Sevens, the unadded check
and Party take over the whole screen as modes and return you to the halves. Search sits above
the left half and searches both scopes.

- Quick: both the library and the player are on screen at once on the Mac — zero taps. ✓✓
- Only what you use: the right half holds only what is playing; modes hold the rest. ✓
- Arranged your way: the left half is your arrangement, always visible. ✓✓
- Nicer to be in: the right half can be a permanent, smaller room. ✓
- Risk: a true split spends half the Mac screen on the player all the time, and the phone
  version is a different app in shape; two layouts to design and keep in step.

### Where I'd lean

A for the feel, with C's instinct that the player deserves real estate on the Mac. The deciding
question is what the Mac screen looks like when you're *organising* for ten minutes — if the room
can recede gracefully while the library takes the space, A works; if not, C.

## 5. Decisions

**2026-10-13 — Architecture: A, the room, with layers that can take the whole screen.**
The now-playing room is the base of the app and its resting state. Everything else — the library,
an open playlist, search — is a layer that slides in over the room and can be pulled all the way
across to take the whole screen when you're doing something for a while (organising, sorting a
big playlist), then slides back. Sevens, the unadded check and Party are modes entered from a
launcher; they take the screen and return you to the room. One search field, library first.
*Why:* A scored best on "quick" and "nicer to be in"; its one risk, cramped organising, is
answered by letting a layer expand rather than by giving the player up (C's cost). The player
keeps real estate by default and gives it up only when asked.

**2026-10-13 — The room: Take 1, wide.** Art large on the left, song and controls in the middle,
a tall side column on the right that is the queue or the lyrics, swapped with a tap. When the
library layer is pulled full width, that column is what stays (song, play/skip, queue ⇄ lyrics),
not a bottom bar. *Why:* round 1 of the wireframes; the column keeps the queue and lyrics
readable while organising, which Jack valued over the extra width.

**2026-10-13 — The launcher lives on the left edge and appears only when reached for.** At rest
the edge is bare but for a faint handle; a reach (hover near the edge or a small drag on the Mac,
a swipe from the edge on the phone) slides out a rail — Library, Search, Sevens, Unadded, Party —
which stays out while the library layer is open. Nothing permanent on screen, so nothing that
reads as a sidebar. *Why:* round 2/2b; Jack wanted the edge as the launcher's home but not a bar
that is always there. **Requirement:** the reveal must not be finicky. It opens on a deliberate
reach (a hold near the edge, or a drag of real distance), never on a mouse passing through; it
closes on a deliberate leave or a tap elsewhere, never because the pointer drifted off a pixel;
and the rail never moves the room. The behaviour is to be tried on the Mac and the phone for a
week before it is kept.

**Parked for the library rounds:** browser-style tabs *inside the library layer* (a Seven open
beside the playlist being pulled from) for long organising sessions. Rejected at the top level:
it would make the room one tab among peers and put a permanent strip at the top.

**2026-10-13 — The queue and the lyrics each have their own place, both on screen at once.**
The side column is the queue, always. The lyrics sit in the room's middle, between the song name
and the controls, when they are on; with the library half in they stay there, smaller; at full
width where they go is still open. *Why:* round 3; Jack wants them separate, not swapped, with
the art always on show. (First recorded wrongly as a Queue | Lyrics tab; corrected.)

**2026-10-13 — The phone.** The queue stays in the room (art, song, queue, controls): it is
edited, so it is not a swipe away, and the phone is the controller. Lyrics are a state of the
room on the phone only: the art shrinks up beside the song, the lyrics take the middle, the queue
steps aside while they are on. No edge rail on the phone (a left-edge swipe is the system's
"back"); the launcher — Library · Search · Sevens · Unadded · Party — is the head of the bottom
sheet. *Gesture rule:* what a drag does is decided by where it starts. On the handle (a real
target above the controls, clear of the home gesture) it moves the sheet between closed, half
and full; on the queue or the lyrics it scrolls them and never opens the sheet; inside the open
sheet it scrolls the library. Swipe down from the top is the notification shade, so nothing of
Jomify's lives there. *Why:* round 5/5b; the rail-then-sheet disconnect Jack noticed, and the
drag ambiguity he raised.

**2026-10-13 — Modes take everything but the queue column.** Sevens, Unadded and Party (on the
Mac) take the screen the way the library does at full width: the column becomes the strip (song,
play/skip, queue), so every take-over has one shape and the music is always in the same place.
Entered from the rail; leaving returns you to exactly where you were. On the phone the sheet goes
to full and the mode fills it. *Why:* round 6; consistency over the extra quarter of width.
*To test in the prototype:* Jack felt twice (rounds 1 and 6) that the strip on the right is the
consistent choice but a bar along the bottom might be lighter. Try the column for a week; if it
feels like wasted space while organising or in Sevens, the bottom bar is the fallback and the
decision is reopened.

**2026-10-14 — The room takes the screen back when you touch it.** The layer had no visible way
in or out: a hold at the edge to reveal the rail, then a pick; the same pick, or an unseen drag
handle, to close. Now the way out is the room itself: a click on its ground, at half or on the
strip at full, puts the layer away; controls on the room (Play, Next, a queue row, the progress
bar, the volume) still work as controls and close nothing. Escape does the same. The way in is
the hair of light at the left edge, a strip the height of the window: one click opens the layer
where it last was, no hold and no timer. `/` opens it with the search field ready, since finding a
playlist is the library's first job, and a second `/` (the field still empty) pulls it to full
instead of typing a slash; a third does nothing more. Escape is the other direction, one step at
a time: full → half, half → away (words in the field clear first). Each key means one direction,
so neither needs the panel's state to be predicted, and they keep their meanings from elsewhere:
`/` is "go to search", Escape "dismiss the topmost thing". (Decided 14 Oct over `/` cycling.) The reach zone for the rail and the edge is 48px, not a hair: nothing
lives at that edge to open by accident. Drag is only for half ↔ full. There is no close button, on
purpose: the thing you want is already on screen beside the layer, and touching it brings it
forward, as windows and sheets do everywhere else. The hover-hold reveal of the rail stays for
picking a mode without opening the layer, and nothing depends on it. If living with it shows the
missing "×" is felt, a mono Close at the head of the tree is the fallback. *Why:* Jack, 14 Oct:
"it feels a bit finicky that you have to drag it open and closed."

**2026-10-14 — The handle steps, it does not resize.** A short drag right on the layer's edge
swings it the whole way to the next state (half → full), a short drag left to the previous (full
→ half, half → away); the plane follows the finger a little so the drag reads, then goes. Free
resizing was finicky and the layer has only three sizes anyway. *Why:* Jack, 14 Oct.

**2026-10-14 — No text selection anywhere but fields.** The app is a thing to use, not a page to
copy from; a drag or a long press used to paint selection across rows. *Why:* Jack, 14 Oct.

**2026-10-14 — Between the room's states, things move; nothing fades but the lyrics.** Rest →
half already moved (the padding, the art's width, the column). Half → full used to fade the room
out and a separate strip in. Now the art, the song, the controls and the queue each carry one
identity in the room and in the strip (Framer's shared layout), so when the layer takes the
screen they travel to their places in the strip at the room's tempo, the art shrinking as it
goes. The lyrics fade: the stage draws them into a box that has no place in the strip, so they
are going away, not somewhere. The flick on the layer's edge has a dead zone of 60px where the
plane only tugs with the finger; a second step in the same pull needs a long drag (240px), so a
flick from full goes to half and a flick again puts it away. *Why:* Jack, 14 Oct: "I'd like them
to always move"; "you shouldn't need to let go of the drag"; "a bit of room where you can drag it
a little without it closing or opening."

**2026-10-14 — At full the room is a column, not a strip; every part travels.** The strip was a
second copy of the room (art, song, controls, three queue rows) that the room's parts travelled
to, and the parts with no copy there (lyrics, volume, progress) grew and faded in place, which
read as two things happening. Now there is one room: at full its own main becomes the right
column (24% of the width), stacked top to bottom: the cover (24vh), the song and artist under
it, the lyrics, the controls, the progress, then Up next with three rows at most, its foot
fading. Every part carries Framer's `layout`, so a change of state measures each part's old and
new place and moves it; nothing is transitioned by CSS any more (a CSS transition fights that
measurement). The lyrics still fade: the box moves with the rest but is empty for the move, since
the stage would otherwise re-set its type every frame as the box scales. The stage's type and the
lite lines are sized by the lyric box, not the window, so they fit the column. *Why:* Jack, 14
Oct: the non-moving parts "should still sort of move to the right and shrink and fade so it looks
more unified"; "the controls on the right when the panel is full could have more information…
make the album cover bigger at the top with the title and artist underneath, then lyrics, then
media controls, and progress bar."

**2026-10-14 — The lyrics travel too, and the queue takes what they leave.** The stage keeps each
lyric face in the lyric box's own space (sized from the box's settled layout, origin at its
corner) and maps them onto the screen through the box's rect as it draws, so when the room moves
the box the lines ride along in it, type and all, instead of fading out and back. The volume,
the progress and the queue dim while they travel. At full the queue is given whatever height the
lyrics leave: the column measures the queue's box and tells it how many rows fit, so with no
lyrics it grows and with them it drops back. *Why:* Jack, 14 Oct: "the lyrics fade in and out
instead of moving"; "the queue can expand when the lyrics are gone and then shrink back down."

**2026-10-14 — Back sits in the open thing's head, and steps through open things only.** The old
corner arrow belonged to a layout where the page was the whole screen; in the room it stepped the
right column's history while that column was off screen, and arrived late, shifting everything
down. Now Back is the first thing at the top-left of the right column, an arrow and the name of
where it goes ("← Late Night Drives"), present at full and nowhere else, on a line that is always
there so nothing shifts; "Library" stands in the line when there is nothing to go back to. Its
history is of open things, a playlist, an album, an artist, search, Liked Songs, never a mode,
the library page or the layer's size, so a trip through Sevens is stepped over. Alt+← is the
same Back and opens the layer at full so what it went back to is seen. A page with a state of its
own puts that state on Back first: from search's "All albums" Back reads "← Search" and returns
to the summary before it leaves the page. The column remembers where each page was scrolled, by
page and state, so coming back lands where you were. Top-left of the window was
considered and rejected: that corner belongs to nothing, and a control should sit on the thing it
changes; on the phone the one column makes the two the same. *Why:* Jack, 14 Oct, who asked for
the argument rather than agreement.

## 6. The library layer

What the layer has to do, from §2, in the order it matters:

1. **Get to a playlist you play often in one tap** — pins. The thing the layer opens on.
2. **Find a playlist among many** — folders (nested, yours), search within the library, sort
   (recently played / Spotify order / A–Z / by owner), a filter (playlists / albums / artists /
   folders), grid size.
3. **Open a playlist and play it** — the open playlist inside the layer: play / shuffle, rows,
   sort the rows, reorder by hand, select many, the row menu (queue, add elsewhere, remove),
   edit details, share; a collaborative playlist's colours and "requested by".
4. **Liked Songs** — the one list that is not a playlist, and the biggest.
5. **Albums and artists** — saved albums; artist pages (top songs, discography, follow).
6. **Search Spotify** — the second scope, from the same field: songs, albums, artists, playlists;
   play or queue a result; recent searches.
7. **Organise** — new folder, move playlists between folders, pin/unpin, import Spotify's folder
   tree (once). The ten-minute job that wants full width.
8. **"Made for you"** — Spotify-owned playlists, blocked for this app; shown with a note, or not.

Things the layer's shape must answer: what it opens on (pins? the last place you were?); how
half differs from full (the same thing narrower, or fewer things?); whether a playlist opens
*inside* the layer (a push, with a way back) or beside the library; where search lives and how it
shows two scopes; and whether more than one thing can be open at once (the parked tabs).

**2026-10-13 — The library layer is two columns.** A narrow tree on the left — pins, folders,
Liked Songs, albums, artists, with the search field at its head — and whatever is open on the
right: a playlist, search results, an album, an artist. At half only the tree shows (the quick
"find it" state); at full the right column appears for reading and organising. Nothing is pushed;
the tree stays in view while a playlist is open, because organising means moving songs between
the two. The desk (tabs on the right) is rejected: chrome that is empty most of the time. *Why:*
library round 1.

**2026-10-13 — The right column opens on what you last had open, within a while.** Pulling the
layer to full shows the playlist (or search, album, artist) you were in when you closed it, if
that was recent — a few hours; after longer it opens on pins and recently played instead. A
setting offers "Open the library on: what I was doing / pins", default what I was doing. The
same rule as "Open on: resume" at launch and the party rejoin window. *Why:* library round 2;
"quick" says the thing you were doing is the thing you want, and pins are already in the tree.
On the phone the right column opens *over* the tree (a push with a way back): there is no room
for two columns, so the phone library is the shelf in shape, with the same tree at its head.

**2026-10-13 — The open playlist keeps the hero: cover, name, facts, Play, then rows — with the
cover's light behind it.** Three rearrangements were tried (cover on the right, cover as a
backdrop instead of a cover, a sleeve column that stays while rows scroll) and a compact head and
rows-first. None beat it: the sleeve costs a quarter of the width for nothing, the wash loses the
cover itself, cover-on-the-right reads as untidy. The arrangement is the record-sleeve convention,
not Spotify's; it is kept under test 2 of §1 ("where it is the best way"). What makes it Jomify's
is the surface, for the visual-language phase: the cover's colour washing the head as Zen's light
does, a facts line that says "with Dad · your turn", the collaborator colours, the Play button.
Selecting rows turns the actions bar into the selection's actions (N selected · Add to… · Queue ·
Remove · Done). *Why:* library rounds 3 and 4.

**Decided by default (library):** search is one field at the head of the tree; results are one
list, "In your library" first, "On Spotify" (songs, then playlists · albums · artists) below.
The tree at half holds pins, folders, Liked Songs · Albums · Artists; sort, filter and grid
size belong to the "All playlists" section at full, not to the tree.

**2026-10-14 — Built: the open playlist and Liked Songs on the language.** The old pages were
split into a logic hook each (`usePlaylistView`, `useLikedSongsView`) and their markup; the room's
surfaces (`src/room/RoomPlaylist.jsx`, `RoomLikedSongs.jsx`) are second faces on the same hooks,
so a fix reaches both. The head is the record sleeve: cover, mono facts line, name, the white Play
disc, actions as mono words; find and sort share one hairline, sort as words with the current one
lit; rows on hairlines, the playing row a paper dot and full white, hearts paper not pink. Still
the old look inside: the row menu, the selection bar, the dialogs, the unadded pills (Unadded's).

**2026-10-14 — The library page: covers in sections, not cards and folder-tiles.** The grid stays
(a cover is a playlist's identity; a wall of them is a record shelf, older than Spotify) but the
cards go: a cover is a bare square with its name under it and the owner in mono, the white Play
disc on the cover on hover. Folders are sections with mono headings, sub-folders as sub-headings
with their path, then "Playlists" for the loose ones, "Albums", "Artists" and "Made for you"
greyed with its note, so the whole library is on one scroll, grouped the way it was grouped;
folder-tiles hid their contents, which defeated seeing everything at once. Sort, filter and size
are words on one hairline with New playlist, New folder and Import. A cover dragged onto a
section's heading moves there, onto "Playlists" comes out of any folder; Cmd/Shift-click selects
several and one drag moves them all. "All playlists" at the tree's head opens it; a pinned folder
opens it on that folder alone with "← Everything" to widen. Sections fold on a click of their
heading and stay folded; covers reorder by drag within a folder and folders by dragging one
heading beside another; columns stretch to fill the width, so no row leaves a cover's worth of
space unused. Back from a playlist opened here returns here. Built as `src/room/RoomLibrary.jsx`
on the old page's helpers (`libraryOrder.js`). *Why:* Jack, 14 Oct: "we could have some fun with
this, maybe think about moving away from the grid"; the answer was keep the grid, lose the cards.

**2026-10-14 — Built: search on the language.** The tree's field is the field: typing filters the
tree and, with search open on the right, searches Spotify as you type; there is no second box.
With search open the field says so: a "Search Spotify" label above it, bigger words, a brighter
line, "Clear" in place of "On Spotify ↵", since the one-field idea took Jack a minute to read.
The results are one list: "In your library" first (playlists, albums, artists by name, as rows),
then Songs as rows on hairlines with a word for "All songs", then Playlists, Albums and Artists
as covers with the same; one open section is the whole page, paging as it scrolls. Before
anything is typed, the recent searches as words. The old page was split into a hook
(`useBrowse`) and its markup, and the room's surface (`src/room/RoomSearch.jsx`) is the second
face on the hook. *Why:* §6's default, built.

## 7. Sevens

The shared playlists with Dad: you each add seven songs in turn. What the mode has to do:

1. **Whose turn** — across every Seven, at a glance (today: the Home banner). The one Sevens
   fact that matters when you are not in Sevens.
2. **Build the batch** — stage up to seven songs, see how many are staged, order them (move up
   and down, drag), remove one, send the batch. The job the mode exists for.
3. **Find songs for the batch** — from the pool (another playlist of yours, chosen per Seven,
   searched within) or from Spotify; each candidate marked if it is already in this Seven, or
   was ever sent to this partner on any Seven ("used").
4. **Read the Seven** — the batches so far, newest last: who added each, when, the seven rows,
   collaborator colours; play from any row; the playlist's own Play and Shuffle.
5. **Set up and settle** — which playlist is a Seven and with whom (the partner found from who
   added what), the pool playlist, how the pairing is shown; the Sevens page that lists them all.

Not Sevens: sort mode belongs to Unadded (one song at a time as a card, filed onto playlist
tiles).

What the mode's shape must answer: whether building and reading are one screen or two; where the
pool sits relative to the batch (beside, beneath, a sheet); what the mode opens on — the batch if
it is your turn, the Seven if it is not; and what the Sevens page (all of them) is for beyond
"whose turn".

**2026-10-13 — Sevens has two faces.** A *building* face — the batch (up to seven, ordered,
"Send the batch · 4 of 7") on the left, the pool with its search on the right, candidates marked
"used" or "in this Seven" — and a *reading* face — the batches so far as cards (who, when, the
rows), newest first, with Play and Shuffle. The mode opens on the face the turn calls for; one
tap flips, and the other face peeks at the edge. On the phone the two faces stack: batch above
pool when building. The Sevens page lists every Seven as a row — partner, whose turn, batches,
when — and is where one is set up. The workbench (three panes) was too dense and had no phone
shape; the tray over the Seven was unneeded. *Why:* Sevens round 1; the simplicity of B.

**2026-10-13 — Songs are dragged into and within the batch.** A pool row dragged across into the
batch lands at the position it is dropped; batch rows are dragged to reorder; a tap on a pool row
still adds it to the end, as a fallback and for the phone. Under the gesture rule (§5), a drag on
a list scrolls it, so the drag starts on a handle at the row's edge — the same answer as the
sheet. On the phone, where the faces stack, the drag goes up from the pool into the batch.
*Why:* Sevens round 2, in words; Jack chose drag.

**2026-10-14 — Sevens is a list, and takes the layer's shape.** The left column is every Seven as
a row: the playlist, "with Dad · Dad's turn" or "your turn" in paper, Finish/Resume on hover; a
"Set up" pick at its head opens the Sevens page on the right. A row opens that Seven's workspace
on the right, at full, with the column still there. At half the column alone answers "whose
turn" without entering the mode. `/` in Sevens opens this list, not the library. *Why:* the room
round of 14 Oct; one rule for every layer: a list on the left, the open thing on the right, half
is the list alone, and the list has to be worth having on its own.

**2026-10-14 — A Seven always takes the Sevens list.** A playlist keeps whichever list opened
it, which is right for an ordinary playlist, but a Seven opened by Back after the library or
search was keeping the library list and the rail's Library lit. A Seven is a Sevens thing: it
takes the Sevens list and lights Sevens however it was reached. *Why:* Jack, 14 Oct.

**2026-10-14 — Built: a Seven on the language, two faces.** The old workspace was split into a
hook (`useSevenView`) and its markup; the room's surface (`src/room/RoomSeven.jsx`) is the
second face. The head is the Seven: cover, "with Dad · 3 songs · Dad's turn" in mono, name,
Play and Shuffle, then two words, "Build · n of 7" and "The Seven so far", the lit one the face
shown; it opens on Build when it is your turn and the Seven is active. Building: the batch as
rows on hairlines with "Send the batch" as the one pill, and the pool beside it with a find
field, "The pool" / "On Spotify" as the two sources, the pool playlist chosen in a plain select,
each candidate marked "in this Seven", "sent before · <Seven>" or "in the batch" in mono; a
click adds to the end, a drag lands where it is dropped, batch rows drag to reorder. Reading:
the batches as sections, newest first, "Jack · 1 Jan 2026" as each heading. *Why:* §7, built.

**2026-10-14 — Seven slots, and the page is "Manage".** The batch is seven numbered slots, not a
growing list: a song can sit in slot five with four still empty, a drop on an empty slot lands
there, a drop on a taken one bumps its song to the next free slot, and the gaps close when the
batch is sent (the store keeps the compacted order; the slots are this device's). A pool song
already placed, in this Seven, or sent before is greyed with its mark, so the pool reads as what
is left. The Sevens page (add a Seven, who it is with, its pool, running or finished,
notifications) is on the language as `src/room/RoomSevensPage.jsx` over the shared
`useSevensSettings` hook, and is a Back step like the library page. The column's head word is
"Manage", not "Set up": the page is where Sevens are added, paired and finished, not a one-time
setup. *Why:* Jack, 14 Oct: "7 slots that songs can go in, so you can leave empty slots";
"greying out songs that have been added"; "the phrase 'Set up' doesn't quite describe what it is
that it does"; "it also needs to be included in the back button."

**2026-10-15 — The batch holds its place.** While building, the batch sticks to the top of the
column and only the pool moves when you scroll, so the seven slots are always in view to drop
onto. *Why:* Jack, 15 Oct.

**2026-10-14 — The batch shifts, a selection drags as one, the pool plays and reorders, and the
playlist has a face.** A song dropped on a slot takes that slot and the songs between its old
slot and the new one move one along, empties included (the seven slots are a list of seven,
some blank); never a swap. Songs from the pool land on the slot dropped on and the ones after,
each taking an empty slot to make room, the first empty below if there is one, else the last
above; a full batch takes nothing. Shift-click runs a selection in the batch or the pool,
Ctrl/Cmd-click toggles, a plain click on a batch row picks it alone, Escape lets go before it
steps the layer; a drag of a selected row carries the selection, in slot order, the grabbed song
landing where it is dropped. The pool is a real playlist: each row has Play on hover and plays
the pool as a context, and a drag between pool rows reorders the pool on Spotify (the local copy
moves first and moves back if Spotify refuses), only with the find field empty. "The playlist" is
a third face: the Seven in plain order, newest first, numbered from the oldest. The batch is sent
with slot 1 last, so it is the newest, which is how Jack and his dad read a Seven (newest at the
top). *Why:* Jack, 14 Oct: "shifting would be better"; "shift and ctrl selecting then dragging";
"a way to view the playlist itself"; "re-order the pool… play the songs from the pool"; the
order: "slot number 1 should be added last so that it is the newest."

## 8. Unadded

Songs you have liked but never put in a playlist, and where each should go. Today it is a
playlist named "unadded songs" with a "Find songs" button that fills it from Liked Songs, a
suggestion per row (ReccoBeats sound and your own history across the check playlists), and a
full-screen sort mode: one song at a time as a card, the check playlists as tiles, the suggested
ones large; drag the card onto a tile or tap it to file the song. What the mode has to do:

1. **Run the check** — find what is liked and in no check playlist; say how many; let it run
   while you do something else.
2. **File each song** — see the song (play it), see where it would suit, put it in one playlist
   or two, or skip it (skips remembered). The job the mode exists for.
3. **Keep the pile honest** — a filed song leaves the pile; the pile is kept as a playlist so it
   survives and syncs; the check can be rerun.
4. **Choose the check playlists** — which playlists count as "added" and are offered as targets.

What the mode's shape must answer: whether filing is a *list* you work down (every song visible,
a suggestion beside each) or a *deck* (one card at a time, tiles to file onto) — or both, and
which the mode opens on.

**2026-10-13 — Unadded: the playing song is the card.** The pile is a playlist you play; entering
the mode plays it from where you left it. The mode's screen is the targets: the check playlists
as tiles, the two the suggestions rank highest for the playing song large, the rest small; under
them, the rest of the pile as a list with its own suggestion chips, for a quick filing without
playing and to see what is coming (tap a row to play it next). To file, drag the playing song
out of the column onto a tile, or tap the tile; a second tile may be tapped before moving on; it
leaves the pile and the next plays. Skip is the column's skip, remembered. "Find songs" and
"Check playlists ▾" at the top. On the phone the drag is up from the song strip. The list, the
deck and both were drawn first; this take, Jack's, uses the column instead of drawing a card.
*Why:* Unadded round 2.
*Two refinements, agreed:* the pile is Jomify's own playlist, kept out of the library's list (it
exists on Spotify so it plays and syncs; the mode is the only place it shows); and the song that
just ended stays as a small "last: ⟵ *name*" ghost under the tiles for about ten seconds,
draggable like the current one, so a late decision needs no back button.

**2026-10-14 — Built: Unadded as a mode in the room.** The rail's Unadded opens a layer of its
own: the pile on the left as the list, each song with the two playlists the suggestions rank
highest as words (a quick filing without playing it), "Find songs" and "Check playlists · n" at
its head; the targets on the right as covers, the two suggested for the card large with the
reason under them, the rest small. The playing song is the card and sits in the room's own
column; at full its cover is a handle, dragged onto a target to file it, as is any row of the
pile; a click on a target files the card too, a second click on another target files it there
as well, and a target it is already in, clicked again, takes it back out. A filing adds to the
target and takes the song out of the pile; the first filing pins the card, so it stays until
Next (or "Move on after filing" is on). The song that just left stays under the targets for ten
seconds as "Last ⟵", draggable and with its own words. Skip is the word, or the column's Next:
leaving a waiting song before its end is remembered as a skip (dimmed in the pile), and the
card follows playback through the pile. The pile playlist is kept out of the library's lists.
The mode's state lives outside React (`src/room/unadded.js`) because the pile, the targets and
the room all read it and the follow logic must run whether or not either is on screen. Entering
the mode plays the card if nothing of the pile is playing; the pile continues from it. The old
sort mode stays for the old layout; "Sort songs" on the pile's playlist page opens this. *Why:*
§8's take, built; Jack, 14 Oct: "onto unadded then."

**2026-10-14 — The ranker's profiles are kept on the device and checked without a request.**
Every open of Unadded after a reload refetched every check playlist's songs (a page per hundred)
to profile them, which is what got Jomify rate limited. The profiles are now kept in storage by
snapshot id and checked against the snapshot id the library list already carries, so an
unchanged playlist costs nothing; a changed one costs its pages once. A rate limit is waited
out and the playlist tried again rather than skipped. *Why:* Jack, 14 Oct: "I'm getting spotify
rate limited… need to make our algorithm much more efficient."

**2026-10-14 — `/` reopens a mode's own list.** Escape twice from Unadded put the layer away;
`/` then brought the library up, because a mode used to have no list and `/` switched to the
library first. A mode has a list now, so `/` reopens it. *Why:* Jack, 14 Oct.

## 9. Party

Three screens for three people, in three places. They share a party, not a shape.

1. **The host's phone** — the controls that matter, huge: pause, skip, volume; add a song;
   the requests in their fair order with who asked, pin, remove, block, pause requests; the QR
   code to show people; and the set-up (which device plays, which speaker, the fallback
   playlist, a check that it all works). Today a full-screen view; in the new layout the Party
   mode on the phone.
2. **The guest's phone** — no account, just the code: pick a name, see what is playing and who
   asked for it, find a song, request it, vote, see where it sits. A page outside the app's
   layout altogether (`/p/<code>`); the room, the layers and the rail do not exist for it.
3. **The screen on the wall** — a TV or spare laptop: the join QR, what is playing and who asked,
   what comes next. No buttons. Also outside the layout; it is a display, not an app.
4. **The Mac** — the host's laptop is usually the device the music plays from (the conductor).
   What it shows while a party runs: the Party mode in the layout (the host's controls at
   desktop size, plus the set-up), with the room's column still there; or, with one key, the
   wall display itself.

What the round must answer: only the Mac, really — whether Party on the Mac is the host view in
the mode's frame, the wall display, or a switch between them; and whether the host's phone view
changes at all under the new layout (it is already its own full-screen thing with huge controls).

**2026-10-13 — Party on the Mac is the host view, with the display one deliberate switch away.**
Entering Party on the Mac shows the host view in the mode's frame (controls, requests, set-up,
the column still there). A key or a button turns the Mac into the wall display — the QR, what is
playing and who asked, what is next, nothing to press — and a key or a tap brings the host view
back. No idle timeout: the Mac might be the thing on the table or the thing in your hands, and
it must not change by itself. The host's phone is the Party mode in the sheet with the same huge
controls; the guest page and a dedicated wall screen are outside the layout and unchanged.
*Why:* Party round 1; Jack chose C without the idle switch.

**2026-10-14 — Party is a list too: the party's facts on the left, the host view on the right.**
The column is the code, its QR on a paper tile, the link, how many are in, and the wall screen
link; with no party on, a line of what it is and Start. Beside the room with the music playing
and the queue in the request order, half-open Party is nearly the wall display with the room
still there, the state for a Mac on the table. The host's controls and the set-up are the open
thing at full; the dedicated wall screen stays its own deliberate switch. *Why:* same round.

**2026-10-14 — Built: the host view on the language.** The old page was split into a hook
(`usePartyHost`) and its markup; the room's surface (`src/room/RoomParty.jsx`) is the second
face, with the check and the device parts in a plain module both share. With no party on: "Start
a party", a line of what it is, the fallback playlist as covers, one pill. Hosting: "Party JOMI"
with the link under it and the words Share the link, The wall screen, Pause requests, End the
party (armed on the first click); what is playing with Pause, Skip and volume that go through
the party (a skip feeds the next request) and "asked for by" beside the artist; a field to add
a song with Add and Play next on each hit; the requests on hairlines in their fair order, each
with Play next (Pinned when it is), Block (armed, then "Block Amy?") and Remove; then the set-up
as rows with a word each: the fallback playlist (Change shows the covers), the speaker (Choose
lists Spotify's devices), this device's part as three words, and the check (Run the check, the
rows marked ok, note or fix). A party left open from earlier asks to be resumed (the pill) or
ended (a word). *Why:* §9, built.

**2026-10-15 — The party's other screens on the language, and the requests everywhere.** The
guest page and the wall screen are on the room's language: ink and paper, mono labels, hairline
rows, words with their hair (Ask, Take back, a vote as "▲ 2"), one pill (Join). The guests'
requests show wherever the next music is shown: the wall screen, the Party column at half, and
the room's own queue during a party ("Requests" above Spotify's "Up next"), the request already
handed to Spotify first, as "Next". The wall screen no longer re-enters full screen on every
click: a "Full screen" word appears with the cursor when the mouse moves, and Escape leaves as
anywhere. *Why:* Jack, 15 Oct: "the guest webpage be on brand"; "the guest queue doesn't appear
anywhere on the party screen"; "the full screen mode … i can't get out of."

**2026-10-15 — The projector can have its own window.** For a laptop and a projector: the
projector opens in a second window (/projector, from the party's set-up or the projector's own
"Own window") that is dragged onto the projector's screen and made full screen there, while the
laptop keeps Jomify and its controls. The window is a display only: it never plays, polls or
renews the sign-in (a second renewal would rotate the token out from under the main window);
playback, the party and the up-next list reach it from the main window over a BroadcastChannel.
P opens the projector only from Zen now; in the room it opened from anywhere, black with the
cursor hidden. A movement brings the cursor back with a line on how to leave. *Why:* Jack, 15 Oct.

## 10. Lyrics and Zen

**2026-10-13 — Zen is the room with the chrome gone.** The lyrics live in the room (between the
song name and the controls on the Mac; the middle of the phone's room, the queue stepping aside).
Zen is a state of that room: the same lyrics, word-fill and art, with the layer, rail, column and
controls faded out and the light — or a song's own scene — behind; one key in, one key out; the
controls appear on a reach, as they do today. The lyrics toggle is one toggle for both. The
separate full lyrics page goes: the room's lyrics panel scrolls and seeks on a tap, which was the
page's whole job. *Why:* rounds 3–5 already put the lyrics in the room; a separate Zen page would
be the same thing with a different frame.

---

**The layout is settled end to end (13 Oct 2026).** Next phase: the visual language, starting
with the room at rest in real colour and type, built outward from Zen's light; then the layers
and modes inherit it; then a prototype of the room and the library layer to live with for a week.

**2026-10-15 — One referee decides every pause.** Eleven pieces used to guess, five of them
could press play, each on its own timer. Now one module (services/spotify/pauseReferee.js) gives
every pause of this browser's player exactly one cause and one rule:

| Cause | Read from | Rule |
|---|---|---|
| you | Jomify sent a pause (held until Spotify reports it, however slowly) | leave it |
| headphones | the audio outputs changed within ~2.5 s of the pause | leave it; also ends any network retry |
| elsewhere | Spotify says the music is on another device, or this player stopped being active | leave it |
| network | offline, the player off Spotify Connect, loading when it stopped, Spotify unreachable, or a network sign in the last 15 s | restart when the connection is back, retrying every 5 s for 2 min |
| stalled | the next song arrived paused right after the last was playing | start it after 1.5 s |
| unknown | none of the above | leave it |

Anything you do in Jomify ends a network retry, as does a change of audio outputs (the overlap
rule: headphones out during a drop must not end with the music blasting) or the music moving
elsewhere. Every decision is in the debug log as "<song> paused: <cause>". The party no longer
resumes pauses on its own: the same rules apply there, and a party on the Spotify app rarely has
a network pause at all. Opening the app no longer takes playback on Spotify's word alone that
nothing is playing: the device list must agree. Spotify gives no reason for a pause, and its
player buffers 12 s ahead, which Jomify cannot change (memory: jomify-sdk-internals). *Why:*
Jack, 15 Oct: "strip all of that out and think about what each problem is actually trying to
solve"; AirPods disconnecting pause the music on his Mac and must; "the headphone disconnect
should override."

## 11. The look

**What the first rounds taught (13 Oct 2026).** Five stills of the room were tried: the cover's
light (Zen's answer everywhere), paper and ink, cold glass with the brand gradient, and a flat
dark editorial take with the brand's three colours as solids. None landed. What did come out:
dark, not light (easier on the eyes; a light mode only if it is not blinding); flat beats glow,
but cold does not carry; the brand colours work as flat solids and plum is a ground, not an
accent; and — the real finding — the brief is **relaxing, cinematic, smooth**, which is a property
of *motion and time*, not of colour or corners. "Smooth" means slow, not round. A still cannot
show it, so from round 3 the look is judged as a living page: what moves, how slowly, what holds.
Round 3 is the room in motion: the light drifting in the cover's colours, lines arriving and
leaving over about a second with a long ease-out, words filling, the cover breathing, nothing
with an edge, nothing that cuts.

**Round 4 — the system, not the room (13 Oct 2026).** Jack's correction: the room at rest is
nearly Zen already; the design problem is how the overlapping parts look and work together. So
one language, chosen rather than offered, applied across the states on one living page: the
room; the library half in (the room reflows, the column narrows and stays); full with a playlist
open (the room becomes the strip); Sevens building; Unadded filing. The language: one colour,
the light from the cover; everything else off-white at four strengths (the thing, its detail,
its facts, its hairlines); the layer and each mode a single plane of slightly lighter dark that
slides over the room with no border, shadow or radius, a hair of light at its edge; Inter Tight
for anything read, JetBrains Mono small and capped for facts and labels; one tempo (1100 ms long
ease-out across the screen, 700 ms in place); lists are rows on hairlines everywhere, the playing
row alone in full white; buttons rare (Play a white disc, Send a white pill, tiles a lighter
plane). To be judged on whether it holds together, not on any one screen.

**2026-10-13 — The look is decided: the system from round 4.** One colour (the light, from the
cover), off-white at four strengths; planes that slide over the lit room, no borders or panels;
Inter Tight to read, JetBrains Mono for facts; one tempo; one row design; rare buttons. Jack:
"that is REALLY nice… keep it closer to what the actual app has as the current Zen mode." So the
light behind everything is Zen's real stage — its ribbons in the cover's palette, the glass
lyrics with the word fill — not the page's stand-in canvas; the room *is* Zen with its chrome on.
Zen itself is then the same room with the chrome faded, as §10 says.

**2026-10-15 — The rail stays.** The launcher no longer hides until reached for: it is always at
the left edge while the room has its chrome, and the room at rest starts after it. Zen, which
takes the chrome away, still hides it. *Why:* Jack, 15 Oct: "the navigation bar should stick."

**2026-10-15 — Tooltips, one for the whole app.** After the pointer rests on a control for about
half a second, a small solid plane names it: an icon-only control by its accessible name, a
control with a `title` by that (the native tooltip is held back), and a word whose meaning is
not plain from the word (Skip, Undo, Move on after filing, Find songs, Check playlists, Pause
requests, a Seven's three faces) by a hint written for it. A word that says what it does gets
no tooltip. Mouse and pen only; a press, a key or a scroll hides it. *Why:* Jack, 15 Oct:
"Tooltips would be ace."

**2026-10-14 — A word you can press carries a hair under it.** Words (`.ui-word`) and labels
(`.room-mono`) were both mono caps, told apart by colour alone, and on a surface with many of
each (Unadded) Jack could not tell "what is an option/button and what is just information."
Now every pressable word is underlined by a hair, which brightens with the word on hover and
when lit; a label never is. The column heads' proportional picks ("Manage", "The targets")
carry the same hair. Information that is neither a label nor a word (a song's tags, a tile's
reason) is plain sentence-case text. *Why:* Jack, 14 Oct: "we need to do something about the
information vs options."

**2026-10-14 — Reading: a high contrast mode, no text size of our own.** High contrast lifts every
strength of the off-white (paper to pure white, dim to 78%, faint to 60%), makes the plane solid,
thickens the hairlines and sets the mono labels at 12px; it follows the OS "more contrast" switch
unless set by hand (Settings → Contrast). There is no text size setting: Jack's dad scales the
whole system and would not use one, so the layouts have to hold up under OS scaling instead,
which is the phone layout's job. *Why:* Jack, 14 Oct: "we just need to make sure that our app
works on systems with text scaling on."

**2026-10-14 — Built: the pieces every screen shares, and Settings.** The row menu, the selection
bar, the toasts, the confirm and playlist dialogs, the device picker and the shortcuts sheet are
rebuilt on the language, not retinted (the first pass kept Spotify's shapes, rounded cards and
icon-and-label rows, and Jack said so): a solid plane with a hair of light at its edge and no
corners (`.ui-plane`), rows on hairlines with no icons (`.ui-row`), actions as mono words
(`.ui-word`) and one white pill for the main act (`.ui-pill`), fields as a line (`.ui-field`),
mono labels in place of titles and header bars, "Close" as a word not an ×, switches as On/Off
words; destructive entries keep a muted red as a safety signal.
Settings is rows on hairlines with each choice as words, the chosen one lit, its hint beneath.
One rule came out of it: a menu, a dialog or a selection on top takes Escape for itself, and the
layer steps only when nothing is over it. The phone keeps its sheets, restyled the same.

**2026-10-14 — Drag is the first way to organise; the menu's picker is a flat list.** A song or
a selection dragged from the open playlist onto a playlist in the tree is added; a playlist
dragged onto a folder moves there, or onto "Library" comes out of any folder; folders spring open
under a drag held over them. The menu's "Add to playlist" and "Move to" then swap its plane for a
search field and one flat list with nothing to expand: playlists last added to, then pinned, then
all A–Z, each with its folder beside the name; folders as rows with their path, "Out of any
folder" first when it is in one. A first version put a tree inside the menu, with rows that both
picked and expanded and an arrow that meant "open" where everywhere else it means "go"; Jack:
"can we actually design it and think it through." The hover flyout it replaced had a scroll of its
own and was lost on the way across. Move up / Move down left the menu: drag does it. "All
playlists" at the tree's head opens the grid page, the same pattern as Sevens' "Set up". *Why:*
Jack, 14 Oct.

---

**Design settled, end to end (13 Oct 2026).** Next: the prototype. Build the room and the library
layer for real on this language, run it on the Mac and the phone for a week, and keep a notes
file of every irritation; then the modes inherit it.
