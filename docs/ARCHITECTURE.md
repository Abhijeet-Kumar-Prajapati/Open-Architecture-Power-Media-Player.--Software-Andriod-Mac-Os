# Architecture

Two applications share one idea — *never let the operating system's media stack
decide what a file is* — but they are built very differently.

```
┌──────────────────────── DESKTOP (Electron) ─────────────────────────┐
│                                                                      │
│  renderer (sandboxed, no Node)                                       │
│    index.html · app.css · util/state/player/lists/dialogs/app.js      │
│         ▲  IPC (preload contextBridge)        │ measure media area   │
│         │                                     ▼                      │
│  main process                                    rect                 │
│    main.js ── window, menus, IPC, library, convert                   │
│      │                                                                  │
│      ├─ mpv-engine.js ──── koffi ──────────► libmpv-2.dll            │
│      │                                          (mpv core + FFmpeg)  │
│      └─ win32.js ──────── koffi ──────────► user32.dll              │
│         VideoHost: native child window that mpv parents its          │
│         rendering surface inside; positioned to match the UI.         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────── ANDROID (Java) ────────────────────────────┐
│  MainActivity ── SurfaceView ◄── IVLCVout ◄── MediaPlayer ◄── LibVLC│
│       │                                    (FFmpeg)                 │
│       ├── PlaylistAdapter (RecyclerView)                           │
│       ├── Prefs (resume positions, settings, recents)               │
│       └── PlaybackService (foreground service, media notification)  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Why libmpv and libVLC rather than the platform decoders

The brief was "nothing should be unsupported". That rules out:

- **Chromium / HTML5 `<video>`** — no E-AC-3, TrueHD, DTS, MKV demux, AVI, FLV.
- **Android MediaCodec** — refuses half of Blu-ray audio and lots of containers.
- **AVFoundation** (macOS) — surprisingly narrow.

Both engines used here are FFmpeg-based, so one decoder set covers everything:

| | Desktop | Android |
| --- | --- | --- |
| Engine | libmpv 0.41 (mpv core + FFmpeg) | libVLC 3.7.7 (VLC core + FFmpeg) |
| Binding | koffi (N-API, no compiler) | official Java API |
| Decoders | 1580 in the shipped build | same FFmpeg inventory |

The decoder count is measured at runtime, not asserted — `spike-mpv.js` reads
`decoder-list` out of the binary that actually ships.

---

## The Windows video embedding problem

This is the part that is genuinely hard, and the reason the UI is laid out the
way it is.

**The constraint.** Electron renders its UI in a Chromium child window. mpv
renders video in its own Win32 window. A child window always draws *above* its
siblings, so any HTML drawn over the video is hidden — no CSS z-index can help,
because Chromium and mpv are not in the same compositing tree.

**Approaches rejected:**

1. *`<video>` + MSE + a JS demuxer* — still bound by Chromium's decoder list,
   which is the exact thing we are trying to escape.
2. *Separate always-on-top mpv window positioned over the Electron window* —
   still blocks the mouse, and still hides the UI underneath.
3. *Electron `capturePage` / `webContents.captureStream`* — capture only, not
   real-time output.

**What APM does.** Create a plain Win32 child window and hand it to mpv's
`--wid` option. mpv creates its rendering surface *inside* it and subclasses the
parent so it tracks resize:

```js
// win32.js
this.hwnd = CreateWindowExA(0, 'STATIC', 'APMVideoHost',
                           WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, ...)
```

```js
// mpv-engine.js - set before mpv_initialize()
mpv_set_option_string(ctx, 'wid', String(hwnd))
```

The renderer then measures `#mediaArea` and reports its rectangle:

```
renderer ── video:setRect {x:288, y:70, width:1102, height:615} ──► main
main     ── scale by GetDpiForWindow()/96 ──► SetWindowPos(hwnd, …)
```

**The design consequence.** Anything that must be readable *while video plays*
cannot live inside that rectangle. So:

- transient messages go in a `.notice-strip` **above** the video
- the now-playing metadata line sits **below** it
- transport controls are a bar **below** that
- in fullscreen the video expands to fill, and only shrinks while the
  auto-hiding control bar is on screen

That is a genuine constraint, and the layout is built around it deliberately
rather than working around it with hacks.

**Input.** Because the native window swallows the mouse, its class is subclassed
through a koffi callback; clicks, double-clicks and the scroll wheel are
forwarded to the renderer, which decides what they mean (toggle pause,
fullscreen, volume).

---

## Talking to libmpv without a C toolchain

Binding libmpv the usual way means a native addon, `node-gyp`, and a matching
C++ toolchain — three extra failure points before `npm install` succeeds.

APM uses **koffi**, which binds native functions from pure JavaScript over
Node-API. No compile step, and the same binary works under Node and Electron.

Three details that cost real debugging time and are worth recording:

1. **Pointers come back as `BigInt`.** `mpv_event` is a struct read field by
   field, and `BigInt + 16` throws. Normalise every address to `Number` first.
2. **`char *` decodes by dereferencing.** `koffi.decode(ptr, 'char *', 1)`
   follows the pointer. Unwrapping a string value pointer by hand and then
   decoding it double-dereferences and faults.
3. **Value pointers must be dereferenced.** `mpv_event_property.data` holds the
   *address of* the value. Reading the double straight from the struct field
   returns the pointer's own bytes — a plausible-looking denormal, not a crash.

Events are polled with `mpv_wait_event(ctx, 0)` on a 16 ms timer and property
changes are de-duplicated before reaching the renderer, so the UI gets at most
one repaint per changed value.

---

## Two engines, one feature list

The desktop and Android apps deliberately expose the same features even though
the implementations differ, so the app behaves like one product:

| Capability | Desktop | Android |
| --- | --- | --- |
| Universal decode | libmpv | libVLC |
| Playlist + shuffle/loop | mpv playlist + mirrored UI | in-app deque |
| Track / subtitle selection | via property changes | `RendererProxy` tracks |
| Resume positions | `recents.json` | `SharedPreferences` |
| Background playback | continue while window closed | foreground service |
| Convert | bundled ffmpeg | — (desktop-only) |
| Equaliser | `af=equalizer` | simplified |

---

## State flow (desktop)

```
libmpv property ──► mpv-engine._drainEvents ──► emit('mpv:property')
                                                     │
                                    preload contextBridge │  (sandboxed)
                                                     ▼
                                              State.applyProperty()
                                                     │
                            State.emit(cheap) ───────┴──────► State.emit(full)
                                    │                              │
                            Player.paint()                  Lists.render()
                            (seek bar, icons)               (sidebar rows)
```

`emit(full)` is split so that a 60 Hz `time-pos` update repaints four DOM
properties instead of rebuilding the playlist.