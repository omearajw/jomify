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
