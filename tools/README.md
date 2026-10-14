# Tools

Verification harnesses and build helpers. Everything here is runnable and exits
non-zero on failure, so it doubles as a CI gate (see
`.github/workflows/build.yml`).

---

## Verification

| Script | What it does |
| --- | --- |
| `make-testmedia.js` | Authors a **real** media file for every supported format using ffmpeg |
| `test-decode.js` | Plays each sample through the shipped libmpv and checks the clock advanced |
| `smoke-electron.js` | Launches the real app, verifies the native video window, captures UI + a decoded frame |
| `spike-mpv.js` | Reads the decoder/protocol inventory out of the shipped binary |
| `pe-exports.js` | Lists a DLL's exports — used to confirm which libmpv symbols exist |


```bash
node tools/make-testmedia.js
node tools/test-decode.js       # 30 passed, 0 failed of 30
node tools/smoke-electron.js    # ok: true
```

Smoke-test a **packaged** build rather than the dev binary:

```bash
node tools/smoke-electron.js tools/testmedia/smoke-60s.mp4 35 \
  "desktop/dist/win-unpacked/APM Open Player.exe"
```

## Build helpers

| Script | Purpose |
| --- | --- |
| `build-macos.js` | Assembles both macOS `.app` bundles. **Runs on Windows** — it rewrites the official Electron zip in memory rather than unpacking it, because an Electron `.app` contains symlinks that cannot be created on a Windows filesystem without Administrator or Developer Mode. |
| `package-release.js` | Copies the artifacts into `release/`, builds the source zip, and writes the single all-in-one archive |
| `lib/zip-stream.js` | Streaming zip writer used by `package-release.js` — see below |
| `test-zip-stream.js` | Round-trips `zip-stream.js` through .NET's extractor and compares hashes |
| `make-icon.ps1` | Renders the launcher icon PNGs (PowerShell + System.Drawing) |
| `make-ico.js` | Packs those PNGs into `icon.ico` |
| `make-icns.js` | Packs the same PNGs into `icon.icns`. electron-builder only converts `.ico`, so this one has to be built by hand or `npm run dist:mac` fails on a missing file. |
| `screenshot-app.ps1` | Captures the desktop while the app plays, for documentation |
| `wrap-renderer-scripts.js` | One-off: wraps renderer files in IIFEs (they are plain `<script>` tags) |

`build-macos.sh` builds the `.dmg` and needs macOS tooling (`hdiutil`), so it
cannot run on Windows.

### Why the zip writer is hand-rolled

`package-release.js` produces a ~500 MB archive. JSZip holds every entry in
memory; `archiver` is not vendored here. `lib/zip-stream.js` writes straight to
a file handle, streams entries over 8 MB without buffering, and compares the
deflated size against the original so already-compressed binaries are stored
rather than squeezed twice. `test-zip-stream.js` verifies the output with
.NET's `ZipFile.ExtractToDirectory` — an independent implementation, so a
mis-written offset cannot pass by being read back by the code that wrote it.

Two constraints worth remembering:

- Never write an archive into the directory being archived. `package-release.js`
  stages in the OS temp directory and moves the result into `release/`.
- Renderer files are plain `<script>` tags sharing one global scope, so every
  one of them must be wrapped in an IIFE. Four of them each declaring
  `const { $, $$ }` was a fatal `SyntaxError` at launch.

### Why there is no syntax-checking helper script

There was a `balance-check.js` here that counted bracket nesting to point at an
unbalanced `}`. It was deleted. It disagreed with the real parser, and the
places where it disagreed are exactly the ones that matter: a `/` is division
or a regex depending on what came before it, and a `` `${x.map(() => `y`)}` ``
nests one template literal inside another. No hand-written scanner handles
those, and a checker that sometimes reports "balanced" on a file that does not
compile is worse than no checker at all.

`node --check` is authoritative, costs nothing, and runs in CI over every
source and tools file. Use it.

## Notes

`tools/testmedia/` is generated, not committed (see `.gitignore`). Deleting it
is safe — `make-testmedia.js` recreates it in a few minutes.

---

## What the harnesses caught

They are worth keeping because they found real bugs that inspection did not.
Full detail in `docs/VERIFICATION.md`; the short version:

- koffi hands back pointers as `BigInt`, so struct arithmetic threw silently
- mpv's `end_file` reason enum is `EOF=0, STOP=2, QUIT=3, ERROR=4` — **not**
  `0,1,2,3` — and every `stop` was being reported as an error until this was
  read out of `client.h`
- `koffi.decode(ptr, 'char *')` dereferences, so manually unwrapping a string
  pointer dereferenced twice and faulted
- libVLC 3.7 dropped `Media.Subtitle`, `RendererProxy`, `seekTo`, `setRepeat`
  and `EndOfMedia`/`Error` events — all corrected against `javap` output
- `info.videoEmbedded` was read from the live host object, which is created
  *after* the renderer boots; the UI concluded embedding was unsupported and
  silently never positioned the video. The smoke test passed anyway, because
  "no errors" was the only thing it checked. It now asserts the video
  rectangle was actually sent.
- An object-literal method was closed with `}` instead of `},` after the
  control-bar rewrite — a `SyntaxError` at renderer boot that `node --check`
  catches instantly and a 500 MB package build does not.