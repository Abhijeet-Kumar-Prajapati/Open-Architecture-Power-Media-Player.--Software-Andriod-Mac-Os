/**
 * Builds the distributable set and the single all-in-one archive.
 *
 * Run after `npm --prefix desktop run dist:win`, `node tools/build-macos.js`
 * and `gradle assembleRelease`.
 *
 *   node tools/package-release.js
 *
 * Output, all in release/:
 *   APM-Open-Player-<v>-source.zip          repository snapshot, ~360 KB
 *   APM-Open-Player-<v>-Windows-Setup.exe   copied from desktop/dist
 *   APM-Open-Player-<v>-macos-arm64.zip     copied from release/
 *   APM-Open-Player-<v>-macos-x64.zip       copied from release/
 *   APM-Open-Player-<v>.apk                 copied from the Gradle output
 *   APM-Open-Player-<v>-ALL-IN-ONE.zip      all of the above + docs
 *   README.txt                              what to click on
 *
 * Notes that have bitten before:
 *  - The archives are written into the OS temp directory, never into release/.
 *    A zip created inside the directory it is zipping will try to include
 *    itself and either fail or produce an archive that cannot be opened.
 *  - Stale artifacts from earlier builds are removed first. The previous
 *    release folder held both a 174 MB installer and an identical 174 MB
 *    portable exe, plus a copy of the 115 MB libmpv-2.dll that the installer
 *    already contains - 1.8 GB of near-duplicate data.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ZipWriter } = require('./lib/zip-stream');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const PKG = require(path.join(ROOT, 'package.json'));
const V = PKG.version;

/**
 * Directories that are build residue or vendored binaries - never in source.
 *
 * Note there is no blanket `build` entry. `desktop/build/` is not output, it is
 * checked-in build *configuration* - installer.nsh wires the installer to the
 * video file extensions, and icon.ico / icon.icns are referenced by
 * electron-builder.yml. Dropping it means the source zip cannot produce a
 * Windows or macOS build at all. Only the generated Gradle output is excluded,
 * by exact path.
 */
const SOURCE_EXCLUDE = new Set([
  'node_modules', 'dist', '.gradle', '.git', 'vendor',
  'testmedia', 'release', '.idea', '.vscode', 'out',
  // Signing material. The debug keystore exists so a local build can be
  // signed at all; publishing it would hand anyone the ability to produce an
  // update that Android accepts as ours.
  'keystore',
]);

/** Generated output, matched by exact relative path rather than by name. */
const SOURCE_EXCLUDE_PATHS = new Set([
  'android/build',
  'android/app/build',
  'SETUPS',
]);

/** Loose files that are local machine state, not part of the project. */
const SOURCE_EXCLUDE_FILES = new Set([
  'smoke-ui.png', 'smoke-frame.png', 'smoke-report.json', '.DS_Store',
]);

/** Never ship these anywhere in the source archive, whatever the directory. */
const NEVER_SHIP = /\.(jks|keystore|p12|pfx|der|key)$/i;

function log(...a) { console.log('[package]', ...a); }

function mb(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

function copyInto(src, destName, { required = true } = {}) {
  if (!fs.existsSync(src)) {
    if (required) throw new Error(`missing artifact: ${path.relative(ROOT, src)}`);
    log(`  skip (optional): ${path.relative(ROOT, src)}`);
    return null;
  }
  const dest = path.join(RELEASE, destName);
  // The macOS bundles are built straight into release/, so they are already
  // where they belong. copyFileSync rejects a same-path copy, and letting it
  // run would destroy the file it was asked to preserve.
  if (path.resolve(src) === path.resolve(dest)) {
    log(`  ${destName.padEnd(46)} ${mb(fs.statSync(dest).size)} (already in place)`);
    return dest;
  }
  fs.copyFileSync(src, dest);
  log(`  ${destName.padEnd(46)} ${mb(fs.statSync(dest).size)}`);
  return dest;
}

/** Every file in the repository that belongs in the source archive. */
function collectSource(dir = ROOT, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      if (SOURCE_EXCLUDE.has(name)) continue;
      if (SOURCE_EXCLUDE_PATHS.has(rel)) continue;
      collectSource(full, out);
      continue;
    }
    if (SOURCE_EXCLUDE_FILES.has(name)) continue;
    if (NEVER_SHIP.test(name)) continue;
    // Anything still inside a generated Gradle tree.
    if (/^android\/(app\/)?build\//.test(rel)) continue;
    if (/\.(exe|apk|dll|so|dylib|7z|blockmap|zip)$/i.test(name)) continue;
    if (/\.log$|\.tmp$|\.out$/i.test(name)) continue;
    out.push(full);
  }
  return out;
}

const README = `APM Open Player ${V}
${'='.repeat(21 + String(V).length)}

Ek player. Har format. Har platform.

Is archive mein teen platforms ke installers hain. Apne hisaab se ek chuno.


  Windows   APM-Open-Player-${V}-Windows-Setup.exe    (~174 MB)
            Setup chalao, app install ho jayegi. .mkv .mp4 .avi jaise files
            "Open with" mein aa jayengi.

  macOS     APM-Open-Player-${V}-macos-arm64.zip      (~125 MB)
            Apple Silicon (M1/M2/M3/M4) waale Mac.

            APM-Open-Player-${V}-macos-x64.zip        (~129 MB)
            Purane Intel Mac.

            Dono .app ko drag karke "Applications" folder mein chhod do.
            Pehli baar chalane se pehle terminal mein:  brew install mpv
            (Gatekeeper warning aaye to right-click > Open dabao.)

  Android   APM-Open-Player-${V}.apk                  (~96 MB)
            Phone mein copy karo, tap karo, "Install anyway" allow karo.
            ARM phones ke liye (99% phones). x86 emulator pe nahi chalega.


Kahan se shuru karu?
---------------------
  * Koi bhi video ya gaana file khol ke chala sakte ho.
  * Mobile data bachana hai? Sirf apne platform ka file nikalo - wo alag se
    bhi rakha hai, poora archive download karne ki zaroorat nahi.


Size itna kyun hai?
--------------------
  Codecs. FFmpeg + Chromium runtime. "Har format chalta hai" yahi ka cost
  hai. Details: docs/VERIFICATION.md


README.md, docs/ aur poora source code bhi is archive mein hai
(APM-Open-Player-${V}-source.zip).
`;

function main() {
  fs.mkdirSync(RELEASE, { recursive: true });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-package-'));
  log(`staging in ${tmp}`);

  // 1. Clear anything left from an earlier run so the folder cannot grow.
  const keep = new Set([
    `APM-Open-Player-${V}-Windows-Setup.exe`,
    `APM-Open-Player-${V}-macos-arm64.zip`,
    `APM-Open-Player-${V}-macos-x64.zip`,
    `APM-Open-Player-${V}.apk`,
    `APM-Open-Player-${V}-source.zip`,
    `APM-Open-Player-${V}-ALL-IN-ONE.zip`,
    'README.txt',
  ]);
  let removed = 0;
  for (const name of fs.readdirSync(RELEASE)) {
    const p = path.join(RELEASE, name);
    if (fs.statSync(p).isDirectory()) {
      // An earlier run left a docs/ copy in here with stale content. The
      // archive builds its own docs/ from the repository, so these are just
      // clutter that would be mistaken for the real thing.
      fs.rmSync(p, { recursive: true, force: true });
      removed++;
      continue;
    }
    if (keep.has(name)) continue;
    fs.rmSync(p, { force: true });
    removed++;
  }
  if (removed) log(`removed ${removed} stale entry/entries from release/`);

  // 2. Collect the per-platform artifacts.
  log('collecting artifacts');
  const installer = copyInto(
    path.join(ROOT, 'desktop', 'dist', `APM Open Player Setup ${V}.exe`),
    `APM-Open-Player-${V}-Windows-Setup.exe`);
  const macArm = copyInto(
    path.join(RELEASE, `APM-Open-Player-${V}-macos-arm64.zip`),
    `APM-Open-Player-${V}-macos-arm64.zip`, { required: false });
  const macX64 = copyInto(
    path.join(RELEASE, `APM-Open-Player-${V}-macos-x64.zip`),
    `APM-Open-Player-${V}-macos-x64.zip`, { required: false });
  const apk = copyInto(
    path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    `APM-Open-Player-${V}.apk`, { required: false });

  const missing = [
    !installer && 'Windows installer',
    !macArm && 'macOS arm64',
    !macX64 && 'macOS x64',
    !apk && 'Android APK',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`not built yet: ${missing.join(', ')}\nRun the build steps in docs/BUILDING.md first.`);
  }

  // 3. Source archive.
  log('building source archive');
  const srcZipPath = path.join(tmp, `APM-Open-Player-${V}-source.zip`);
  const srcFiles = collectSource();

  // A filter that quietly stops matching is how the debug keystore ended up in
  // an earlier archive. Fail loudly rather than ship signing material.
  const leaked = srcFiles.filter((f) => NEVER_SHIP.test(f));
  if (leaked.length) {
    throw new Error(`refusing to package signing material:\n  ${leaked.join('\n  ')}`);
  }
  const sz = new ZipWriter(srcZipPath);
  for (const f of srcFiles) {
    sz.addFile(f, `APM-Open-Player/${path.relative(ROOT, f).split(path.sep).join('/')}`);
  }
  sz.close();
  const srcZip = path.join(RELEASE, `APM-Open-Player-${V}-source.zip`);
  fs.copyFileSync(srcZipPath, srcZip);
  log(`  ${srcFiles.length} files -> ${mb(fs.statSync(srcZip).size)}`);

  // 4. README.
  fs.writeFileSync(path.join(RELEASE, 'README.txt'), README, 'utf8');

  // 5. The all-in-one.
  log('building all-in-one archive');
  const allPath = path.join(tmp, `APM-Open-Player-${V}-ALL-IN-ONE.zip`);
  const az = new ZipWriter(allPath);

  const bundle = [
    `APM-Open-Player-${V}-Windows-Setup.exe`,
    `APM-Open-Player-${V}-macos-arm64.zip`,
    `APM-Open-Player-${V}-macos-x64.zip`,
    `APM-Open-Player-${V}.apk`,
    `APM-Open-Player-${V}-source.zip`,
  ];
  for (const name of bundle) {
    const p = path.join(RELEASE, name);
    if (!fs.existsSync(p)) continue;
    az.addFile(p, `APM-Open-Player-${V}/${name}`);
  }
  az.addFile(path.join(RELEASE, 'README.txt'), `APM-Open-Player-${V}/README.txt`);

  const docDir = path.join(ROOT, 'docs');
  for (const name of fs.readdirSync(docDir)) {
    const p = path.join(docDir, name);
    if (fs.statSync(p).isFile()) az.addFile(p, `APM-Open-Player-${V}/docs/${name}`);
  }
  for (const name of ['README.md']) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) az.addFile(p, `APM-Open-Player-${V}/${name}`);
  }
  az.close();

  const allDest = path.join(RELEASE, `APM-Open-Player-${V}-ALL-IN-ONE.zip`);
  fs.copyFileSync(allPath, allDest);
  const allName = path.basename(allDest);
  const allSize = fs.statSync(allDest).size;

  fs.rmSync(tmp, { recursive: true, force: true });

  // 6. Report.
  log('');
  log('release/ contents');
  let total = 0;
  for (const name of fs.readdirSync(RELEASE).sort()) {
    const p = path.join(RELEASE, name);
    if (!fs.statSync(p).isFile()) continue;
    const size = fs.statSync(p).size;
    total += size;
    log(`  ${name.padEnd(46)} ${mb(size).padStart(9)}`);
  }
  log(`  ${'TOTAL'.padEnd(46)} ${mb(total).padStart(9)}`);
  log('');
  log('WHAT TO UPLOAD TO GITHUB');
  log('-----------------------');
  log(`  1. ${allName}  (${mb(allSize)})`);
  log('     One download with every platform. Upload this to a GitHub *Release*.');
  log('');
  log('  2. APM-Open-Player-' + V + '-source.zip  (360 KB)');
  log('     Commit this to the repository instead - it is the whole source.');
  log('');
  log('  Optional: attach the individual files too, so people on mobile data can');
  log('  grab one platform instead of all 525 MB. Do not attach both the');
  log('  all-in-one and the individual files - it is the same content twice.');
  log('');
  log('  The ~1049 MB total above is local disk only. What goes on GitHub is');
  log('  either the 525 MB archive or the individual files, not both.');
}

try {
  main();
} catch (err) {
  console.error('[package] FAILED:', err.message);
  process.exit(1);
}