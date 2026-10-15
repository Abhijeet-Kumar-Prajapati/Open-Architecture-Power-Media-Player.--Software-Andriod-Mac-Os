# APM Open Player — verification report

Everything in this document was produced by running the code in this
repository, not by assertion.

---

## 1. Decoder inventory (measured from the shipped binary)

`node tools/spike-mpv.js` loads the exact `libmpv-2.dll` that is packaged with
the app and asks mpv what it can decode.

```
  mpv client API version: 20005 (2.0.5)
  mpv version: mpv v0.41.0-1151-g9d144e57b
  ffmpeg:     N-127491-g0eeb79fcc
  total decoders: 1580
```

Spot checks against that list — all present:

| Codec | Decoded by | Why it matters |
| --- | --- | --- |
| `h264`, `hevc`, `av1`, `vp9`, `vp8` | present | mainstream video |
| `mpeg2video`, `vc1`, `wmv3`, `mpeg4`, `theora` | present | DVD / WMV / DivX / OGV |
| `prores`, `dnxhd`, `ffv1`, `utvideo` | present | professional / lossless |
| **`eac3`** | present | **Dolby Digital Plus — rejected by most phones** |
| **`ac3`** | present | Dolby Digital |
| **`truehd`**, `mlp` | present | **Blu-ray TrueHD** |
| **`dts`** | present | **DTS** |
| `flac`, `alac`, `ape`, `wv`, `tta` | present | lossless audio |
| `opus`, `vorbis`, `aac`, `mp3` | present | mainstream audio |

Protocols: 78, including `http`, `https`, `rtsp`, `rtmp`, `udp`, `srt`, `mms`.

---

## 2. End-to-end decode test — 30 / 30

Real files were authored with ffmpeg, then played through the same libmpv the
app ships, with the clock checked to confirm decoding actually happened.

```bash
node tools/make-testmedia.js
node tools/test-decode.js
```

```
PASS  movie-h264-aac.mkv        matroska / H.264 / AAC
PASS  movie-h264-aac.mp4        mp4 / H.264 / AAC
PASS  movie-hevc-eac3.mkv       matroska / HEVC / E-AC-3
PASS  movie-hevc-ac3.mp4        mp4 / HEVC / AC-3
PASS  movie-av1-opus.webm       matroska / AV1 / Opus
PASS  movie-vp9-opus.webm       matroska / VP9 / Opus
PASS  movie-avi-mpeg4.mp3.avi   avi / MPEG-4 Part 2 / MP3
PASS  movie-flv-h263.mp3.flv    flv / Sorenson H.263 / MP3
PASS  movie-mpeg2ts.ts          mpegts / MPEG-2 / MP2
PASS  movie-prores-pcm.mov      mp4 / Apple ProRes / PCM
PASS  movie-wmv3.wmv            asf / Windows Media Video 8 / WMA v2
PASS  movie-theora.ogv          ogg / Theora / Vorbis
PASS  movie-1080p-hevc.mkv      matroska / HEVC 1080p / E-AC-3
PASS  movie-4k-hevc-eac3.mkv    matroska / HEVC 4K 2160p / E-AC-3
PASS  song-flac.flac   song-mp3.mp3   song-aac.m4a   song-opus.opus
PASS  song-vorbis.ogg song-wav.wav   song-aiff.aiff  song-ac3.ac3
PASS  song-eac3.eac3  song-truehd.mka song-dts.dts  song-alac.m4a
PASS  song-wavpack.wv song-wma.wma    song-opus-in-mkv.mka
PASS  smoke-60s.mp4

30 passed, 0 failed of 30
```

Re-run after the media generator gained `smoke-60s.mp4`, which is 60 seconds
rather than 3 — the short clips reach EOF before the clock can be sampled:

```
30 passed, 0 failed of 30
```

---

## 3. Application smoke test

`node tools/smoke-electron.js` launches the **real packaged-code Electron app**,
opens a file through the real IPC path, and verifies the pieces that a headless
decode test cannot reach — above all that the native Win32 video surface exists
and lines up with the UI.

```json
{
  "rendererReady":    true,
  "videoHostCreated": true,
  "hwndValid":        true,
  "videoRect":        { "x": 288, "y": 70, "width": 1162, "height": 615 },
  "videoVisible":     true,
  "fileLoaded":       true,
  "timePos":          4.48,
  "duration":         60,
  "pause":            false,
  "menu": {
    "opened":       1,
    "stacked":      2,
    "afterEscape":  0,
    "reopened":     1,
    "closed":       0,
    "submenuOpened": true
  },
  "errors":           [],
  "ok":               true
}
```

The `menu` block drives the control-bar rework directly: click **⋯**, open the
**Subtitles** submenu, press Escape, open it again. `stacked: 2` proves the
submenu did not replace its parent menu, `afterEscape: 0` proves Escape
actually closed both, and `reopened: 1` proves nothing was wedged shut. This
is the sort of breakage that leaves no error in any log.

The pass criteria deliberately include `videoRect` and `videoVisible`, not just
"no errors". An earlier revision reported `ok: true` while the video rectangle was
never sent to the main process — the app looked fine but played into a
zero-sized window. That regression is what the stricter check now catches.

Two independent artefacts are produced:

- **`smoke-ui.png`** — `webContents.capturePage()`, showing the whole interface:
  sidebar, transport bar, live seek position (`0:05 / 1:00`) and the
  now-playing strip reading `smoke-60s.mp4 · MP4 • H.264 / AVC • 640×360 ·
  AAC mono • 1:00` — metadata produced by ffprobe at runtime.

- **`smoke-frame.png`** — a frame decoded by mpv itself at `00:00:05.040`,
  proving pixels came out of the H.264 decoder.

---

## 4. Bugs found and fixed by these tests

These were all caught by the harnesses, not by inspection:

| Symptom | Root cause | Fix |
| --- | --- | --- |
| No events ever reached the UI | koffi returns pointers as `BigInt`; `ev + 16` threw and was swallowed by a `catch` | normalise every address with `asPtr()` |
| `time-pos` read as `1.4e-311` | decoded the double from the *address of* the value pointer instead of dereferencing it | read `mpv_event_property.data` as a pointer first |
| Access violation on `media-title` | `koffi.decode(ptr,'char *')` **dereferences**; unwrapping manually dereferenced twice | read the string straight from the value pointer |
| Access violation on NULL property | decoded from address 0 — not catchable | `validPtr()` guard before every dereference |
| Every `stop` reported as an error | assumed `mpv_end_file_reason` was 0,1,2,3,4 | checked `client.h`: **EOF=0, STOP=2, QUIT=3, ERROR=4** (1 unused) |
| Renderer dead on launch | four scripts each declared `const { $, $$ }` in one global scope | wrap every renderer file in an IIFE |
| `Unknown type name '__stdcall'` | koffi 3.x dropped the calling convention prefix | drop it (x64 has one convention) |
| `Duplicate type name 'APM_VideoHostProc'` | `koffi.proto` registers a global type | declare once, cache it |
| `recents.list is not a function` | raw `JsonStore` used where the `Recents` wrapper was needed | construct the wrapper |
| Log showed the literal string `"error"` | read `mpv_event_log_message.level` instead of `.text` | fix the struct offset |
| App "couldn't open" a valid file | test harness passed a path relative to the wrong cwd | resolve to absolute |
| Video never appeared after the control-bar rework | `info.videoEmbedded` was read from the live host object, which is created *after* the renderer boots — the UI concluded embedding was unsupported and gave up on positioning | report it as a property of the platform (`IS_WINDOWS`), not of whether the host exists yet |
| Renderer threw `SyntaxError: Unexpected identifier` on launch | an object-literal method was closed with `}` instead of `},` after the button-bar rewrite | `node --check` on every renderer file, as a CI step |
| Escape could not close a dialog | `isModalOpen()` still tested a `_pop` field that had been renamed to `_pops`, so it reported "nothing open" and the keydown handler returned early | test `this._pops.length`; the smoke test now drives the ⋯ menu and asserts Escape empties the layer |
| Opening "Subtitles" from the ⋯ menu erased the menu itself | the popover held a single `this._pop` slot, so a submenu replaced its parent | popovers stack in an array; `closePopover()` clears them all |
| Window title read `APMOpen Player` | two adjacent `<span>`s with no whitespace between them | literal space in the markup |
| `apm-debug.jks` shipped inside the source archive | the packaging script filtered `node_modules` and `dist` but never had a rule for signing material | exclude `keystore/` and any `.jks`/`.keystore`/`.p12`, **and** assert on the collected file list so the build fails rather than shipping a key |

---

## 5. Package size

The first build came out at **4.2 GB**, which is not something anybody downloads.
Almost none of that was the application. Measured:

| Directory | Size | Upload it? |
| --- | --- | --- |
| `desktop/node_modules` | 592 MB | no — dev dependency |
| `desktop/dist` | 971 MB | no — build output, the installer is the artifact |
| `android/app/build` | 649 MB | no — Gradle intermediates |
| `desktop/vendor` | 115 MB | no — libmpv, already inside the installer |
| `tools/testmedia` | 24 MB | no — test fixtures |
| **`release`** | **1847 MB** | the only one that matters |

The **source** is 354 KB compressed. The 4.2 GB was never something that needed to
be uploaded; it was build residue sitting next to it.

Two real reductions were made to the deliverable itself:

**APK 206 MB → 96.5 MB.** `libvlc.so` is 38–52 MB *per ABI*. The build was
shipping `armeabi-v7a`, `arm64-v8a`, `x86` and `x86_64`; the last two exist only
for emulators and added ~100 MB. They are now off, so the APK targets real
phones only. Anyone running an x86 emulator can rebuild with the two lines in
`android/app/build.gradle` re-enabled.

**Control bar cut from 16 buttons to 7 on desktop, and 10 to 5 on Android.**
Everything else moved into the ⋯ menu. This is a usability change, not a size
one, but it was the other thing the first build got wrong.

What could **not** be reduced, and why:

| Component | Size | Why it is irreducible |
| --- | --- | --- |
| Electron runtime, per platform | ~180 MB | Chromium + Node. A different UI toolkit would have to reimplement decoding, subtitles, playlist and hardware acceleration. |
| libmpv, Windows only | 115 MB | FFmpeg. This *is* the "plays every format" feature. |
| libVLC, 2 Android ABIs | ~85 MB | Same reason. |

A universal player is genuinely 100–200 MB per platform. VLC is smaller because
it ships fewer codecs and relies on the OS for some of them — that is the trade
being declined here. What *was* avoidable: the duplicated files. The first
`release` folder held both a 174 MB installer and a byte-identical 174 MB
portable exe, plus a standalone copy of the 115 MB `libmpv-2.dll` that the
installer already contains, plus a 924 MB zip containing all of the above.

### The shipped archive

```
APM-Open-Player-1.0.0-ALL-IN-ONE.zip            524.8 MB   <- the deliverable
  APM-Open-Player-1.0.0/APM-Open-Player-1.0.0-Windows-x64-Setup.exe
  APM-Open-Player-1.0.0/APM-Open-Player-1.0.0-macos-arm64.zip
  APM-Open-Player-1.0.0/APM-Open-Player-1.0.0-macos-x64.zip
  APM-Open-Player-1.0.0/APM-Open-Player-1.0.0.apk
  APM-Open-Player-1.0.0/APM-Open-Player-1.0.0-source.zip
  APM-Open-Player-1.0.0/README.txt  README.md  docs/
```

Extracted with .NET's `ZipFile.ExtractToDirectory` — an implementation
independent of the writer that produced it — and every binary compared by
SHA-256 against its original:

```
MATCH  APM-Open-Player-1.0.0-macos-arm64.zip          131200396
MATCH  APM-Open-Player-1.0.0-macos-x64.zip            134908024
MATCH  APM-Open-Player-1.0.0-source.zip                  365240
MATCH  APM-Open-Player-1.0.0-Windows-x64-Setup.exe        182555759
MATCH  APM-Open-Player-1.0.0.apk                      101210177
ALL BINARY CONTENTS IDENTICAL
```

The source archive is 89 files, 800 KB uncompressed, audited to contain no
signing material, no binaries and no local scratch output.

---

## 6. macOS bundles — built and structurally verified, never launched

electron-builder 26 refuses macOS targets on a non-macOS host, and an Electron
`.app` cannot be unpacked onto a Windows filesystem either (the framework
`Versions/Current` entries are symlinks, and creating symlinks here needs
Administrator or Developer Mode). So `tools/build-macos.js` never touches the
disk for the bundle: it reads the official Electron macOS zip into memory,
rewrites it, and emits a new zip with the symlink entries preserved.

What was checked programmatically in the produced `.zip`:

```
entries in output:                          695
Versions/Current symlinks preserved:        4   (mode 120755 -> "A")  ✓
Info.plist dict balance:                    23 / 23                     ✓
  CFBundleName            = APM Open Player
  CFBundleExecutable      = APM Open Player
  CFBundleIdentifier      = com.apm.openplayer
  CFBundleShortVersionString = 1.0.0
  CFBundleDocumentTypes   = 18 entries (so it appears in Finder "Open With")
MacOS executables:         APM Open Player + Electron Helper{, (GPU), (Renderer), (Plugin)}
app.asar present:          true
app.asar size:             6,043,963 bytes
asar entries:              151, including
  node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node
  node_modules/@koromix/koffi-darwin-x64/darwin_x64/koffi.node
app.asar.unpacked:         both native payloads
```

Both architectures built: `macos-arm64.zip` (125 MB) and `macos-x64.zip` (129 MB).

**What is NOT verified:** no macOS machine was available, so the app has never
been launched. If it fails, the first thing to check is the framework symlinks
and the `Info.plist` executable name — both of which are verified above — then
Gatekeeper (`right-click → Open`, or `xattr -cr`).

mpv itself is **not** bundled for macOS: there is no official prebuilt
`libmpv.2.dylib`, so the app resolves Homebrew's copy at runtime and tells the
user to run `brew install mpv`. `ffmpeg`/`ffprobe` are resolved from `PATH` the
same way. This is how mpv-based macOS apps normally ship.

---

## 7. What was *not* verified

Being explicit about this matters more than the green ticks:

- **Android APK** — compiled, packaged and signature-verified (v1+v2), but
  **not run on a device or emulator**. No Android device was available in the
  build environment. The Gradle build succeeding proves it compiles and
  packages; it does not prove playback on hardware. *First thing to check on a
  real phone:* play a file, confirm video appears and audio is routed, then
  switch apps and confirm the playback notification is there.
  **This APK will not install on an x86 emulator** — it ships `armeabi-v7a` and
  `arm64-v8a` only, to halve the download size. An x86 emulator user must
  rebuild or sideload a debug build.
- **macOS `.app`** — both architectures built and structurally verified, but
  **never launched** (no Mac available). *First thing to check:* the framework
  symlinks and Gatekeeper, then `brew install mpv`.
- **The `.dmg`** was not produced — it needs macOS tooling (`hdiutil`). The
  `.zip` bundles are the deliverable; a `.dmg` is only a wrapper around them.
- **Hardware decoding** — the default `hwdec=auto-safe` path was active, but
  which decoder the host GPU selected was not captured per machine.
- **Long-running playback** — clips are 3–60 s. Seek accuracy and A/V sync over
  multi-hour files were not measured.

---

## 8. Reproducing

```bash
node tools/make-testmedia.js        # author one real file per format
node tools/test-decode.js           # every sample expected PASS
node tools/smoke-electron.js        # launch the app, verify video + UI + menu
node tools/test-zip-stream.js       # round-trip the archive writer
node tools/package-release.js       # build release/
```

Each script exits non-zero on failure, so all of them work as CI gates.