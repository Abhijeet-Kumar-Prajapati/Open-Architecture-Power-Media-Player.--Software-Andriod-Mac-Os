# Release checklist

Everything that must be true before tagging a version, and how to get the
files in front of people.

---

## 1. Verify

```bash
node tools/make-testmedia.js     # author a sample per format
node tools/test-decode.js        # expect: every sample PASS
node tools/smoke-electron.js     # expect: ok: true
```

The smoke test is the one that matters. It asserts the native video window
exists, that its rectangle was actually sent to the main process, and that the
clock advanced — so a build that compiles but plays into a zero-sized window
fails instead of shipping. Run it against the **packaged** exe, not the dev
binary:

```bash
node tools/smoke-electron.js tools/testmedia/smoke-60s.mp4 35 \
  desktop/dist/win-unpacked/"APM Open Player.exe"
```

Use a clip of at least 60 seconds. A 3-second clip reaches EOF before the test
samples the clock and reports `ok: false` for the wrong reason.

## 2. Build

```bash
npm --prefix desktop run dist:win
node tools/build-macos.js            # both mac archs, runnable from Windows
cd android && gradle assembleRelease
```

## 3. Check the artifacts

| Check | Expected |
| --- | --- |
| APK signature | `apksigner verify --print-certs` → v1 + v2 |
| APK contents | `unzip -l app-release.apk \| grep lib/` → **2** ABIs × 3 libs |
| Installer exists | `dist/APM Open Player Setup <v>.exe`, ~174 MB |
| libmpv shipped | `dist/win-unpacked/resources/mpv/libmpv-2.dll` |
| App starts | run the packaged exe with a video file |
| macOS zips | `app.asar` present, `Versions/Current` symlinks intact |

Only two Android ABIs ship. `x86`/`x86_64` exist solely for emulators and cost
~100 MB of the download; re-enable them in `android/app/build.gradle` if you
need emulator support more than you need a small file.

## 4. Package

```bash
node tools/package-release.js
```

Produces `APM-Open-Player-<v>-ALL-IN-ONE.zip` plus the individual files in
`release/`. The combined zip is a plain store-and-deflate archive; the files
inside are already compressed, so it adds almost nothing on top of their sum.

## 5. Publish

**Source** — commit the repo. It is ~360 KB with `node_modules`, `dist`,
`build` and `vendor` gitignored. Nothing large belongs in git.

**Binaries** — use a GitHub Release, not a commit:

```bash
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 release/* --title "APM Open Player 1.0.0" --notes "See README.md"
```

GitHub's git layer rejects any file over **100 MB**; Releases accept up to
**2 GB** per asset. That is why the binaries are release assets and not commits.
If you prefer the web UI: Releases → Draft a new release → upload the zip.

Attach:

- `APM-Open-Player-<v>-ALL-IN-ONE.zip` — everything, one download
- `APM-Open-Player-<v>-Windows-Setup.exe`
- `APM-Open-Player-<v>-macos-arm64.zip`, `APM-Open-Player-<v>-macos-x64.zip`
- `APM-Open-Player-<v>.apk`
- `APM-Open-Player-<v>-source.zip`

## 6. Known limitations to state in the release notes

State these plainly. They are real, and a user who hits them having not been
warned will not come back.

- **Android was compiled and packaged but never run on a device** in the
  environment where it was built. Test on real hardware before recommending it.
- **macOS was assembled from Windows and never launched.** There is no Mac in
  the build environment. Check Gatekeeper first, and note that `brew install
  mpv` is required — there is no official prebuilt `libmpv.dylib` to bundle.
- **The `.dmg` is not produced.** It needs macOS tooling (`hdiutil`). The zips
  are the deliverable; a `.dmg` is only a wrapper around them.
- The APK is **ARM-only**, so it will not install on an x86 emulator.
- Builds are **unsigned** unless signing material is provided, so Windows
  SmartScreen and Android will warn on first launch.
- The bundled debug keystore is for local builds only. Never ship it.

---

## Version history

### 1.0.0 — first release

- Windows: NSIS installer, ~174 MB, verified end-to-end against the packaged exe
- macOS: `.app` for arm64 and x64, structurally verified, never launched
- Android: APK for `arm64-v8a` + `armeabi-v7a`, minSdk 21, ~96 MB
- Universal playback via libmpv (desktop) and libVLC (Android)
- Verified: every test format decoded; smoke test green on Windows