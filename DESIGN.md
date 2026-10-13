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
