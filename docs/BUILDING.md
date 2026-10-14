# Building APM Open Player

Everything below was run to produce the binaries in `releases/`.

---

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 24.x | any recent LTS works |
| JDK | 17 | required by Gradle and electron-builder |
| Gradle | 8.11.1 | only for the Android build |
| Android SDK | platform 34, build-tools 34.0.0 | only for the Android build |

```bash
node --version      # v24+
java -version       # 17
```

---

## Desktop (Windows + macOS)

### 1. Install dependencies

```bash
cd desktop
npm install
```

If npm blocks the install scripts (some configurations do), approve them:

```bash
npm approve-scripts koffi
# or run the postinstall directly:
cd node_modules/koffi && node ./cnoke.cjs -P . -D src/koffi --prebuild --release
```

### 2. Provide libmpv

APM ships against the mpv project's official Windows build. Grab the newest
`mpv-dev-x86_64` archive and put `libmpv-2.dll` in `desktop/vendor/mpv/`.

There is no stable download URL for that archive. Upstream stamps the build
date and commit into the asset name — `mpv-dev-x86_64-20261014-git-<sha>.7z`
— so `releases/latest/download/mpv-dev-x86_64.7z` 404s as soon as they
publish. List the release and take the current file:

```bash
# 1. find the asset name in the newest release
curl -s https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest \
  | grep -o '"name": "mpv-dev-x86_64-[0-9][^"]*\.7z"' | head -1

# 2. download it (7z needed to extract)
curl -L -o mpv-dev.7z \
  "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/<tag>/<asset>.7z"

# 3. extract libmpv-2.dll into desktop/vendor/mpv/
```

The Windows workflow does exactly this, so if you only want the file the
simplest route is to let CI run and download `mpv-dev.7z` from the job log.

For macOS put `libmpv.2.dylib` in the same folder (Homebrew: `brew install mpv`,
then link `/opt/homebrew/lib/libmpv.2.dylib`).

**No libmpv?** The app will start and show a clear error. Everything except
video output (audio-only playback, library, conversion) still works.

### 3. Run it

```bash
npm start          # production
npm run dev        # with developer tools
```

### 4. Package

```bash
npm run dist:win       # NSIS installer + portable exe  -> desktop/dist/
npm run dist:portable  # portable exe only
npm run dist:mac       # .dmg + .zip for Intel and Apple Silicon
npm run dist:all       # both platforms (mac targets require macOS or a mac runner)
```

**macOS builds on Windows** are not possible — `dmg` bundling needs macOS.
Build on macOS, or in CI with a `macos-latest` runner. The configuration,
icon and entitlements are already in place.

### 5. Code signing

Unsigned builds are produced by default and will trigger a SmartScreen /
Gatekeeper warning. To sign:

```bash
# Windows: set CSC_LINK to your .pfx
set CSC_LINK=path\to\cert.pfx
set CSC_KEY_PASSWORD=...

# macOS: set an identity in electron-builder.yml, or
export CSC_LINK="Developer ID Application: Your Name (TEAMID)"
export CSC_KEY_PASSWORD=...
```

---

## Android

### 1. Install the SDK

```bash
# command-line tools
curl -L -o cmdline-tools.zip \
  https://dl.google.com/android/repository/commandlinetools-win-latest.zip
unzip cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools/latest

sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
sdkmanager --licenses      # accept all
```

Set `ANDROID_HOME` and `JAVA_HOME`.

### 2. Build the APK

```bash
cd android
gradle assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

### 3. Sign it properly

The build falls back to a debug keystore so it works immediately. For a real
release, create one and pass it in:

```bash
keytool -genkey -v -keystore keystore/apm-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias apm

gradle assembleRelease \
  -PAPM_STORE_FILE=keystore/apm-release.jks \
  -PAPM_STORE_PASSWORD=... -PAPM_KEY_ALIAS=apm -PAPM_KEY_PASSWORD=...
```

### 4. Install on a device

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

---

## Verification

```bash
node tools/make-testmedia.js       # generate a sample per format
node tools/test-decode.js          # decode every sample through the engine
node tools/smoke-electron.js       # launch the real app, check the video window
```

`test-decode.js` exits non-zero if any file fails to decode, so it works as a CI
gate. It prints a summary such as:

```
30 passed, 0 failed of 30
```

### Test media

`make-testmedia.js` authors real files with ffmpeg: MKV/MP4/AVI/FLV/TS/MOV/WMV/
OGV/WEBM, H.264/HEVC/AV1/VP9/MPEG-2/ProRes/H.263/WMV3, and MP3/AAC/FLAC/Opus/
Vorbis/PCM/ALAC/AC3/E-AC3/TrueHD/DTS/WavPack/WMA — including 4K/2160p HEVC and
the E-AC-3 tracks that Android's own media stack rejects.

---

## Troubleshooting

**`libmpv shared library not found`** — put `libmpv-2.dll` (Windows) or
`libmpv.2.dylib` (macOS) in `desktop/vendor/mpv/`.

**Video window is black but audio plays** — the GPU context could not be
created. Try `Settings → Hardware decoding → Disabled`, or force
`--gpu-api opengl` / `--gpu-context win` in the mpv options.

**`Duplicate type name` on startup** — a second `VideoHost` was created. This is
guarded against in `setupVideoHost()`; if you add call sites, keep it idempotent.

**Android build fails on licences** — `sdkmanager --licenses` must be run
non-interactively, or write the hashes into
`$ANDROID_HOME/licenses/android-sdk-license`.