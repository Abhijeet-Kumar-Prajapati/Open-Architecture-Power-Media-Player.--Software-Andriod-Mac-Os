/**
 * Builds macOS .app bundles from Windows or Linux.
 *
 * Why this exists: electron-builder 26 refuses macOS targets on a non-macOS
 * host ("Build for macOS is supported only on macOS"), and an Electron .app
 * for macOS cannot be assembled on disk here either, because a macOS app
 * bundle is full of symlinks (Electron Framework.framework/Versions/Current,
 * …) and creating symlinks on Windows needs Administrator or Developer Mode.
 *
 * So the bundle is never written to the filesystem. The official macOS Electron
 * zip is read into memory, renamed, given our app.asar, and re-emitted as a
 * zip with the symlink entries intact. macOS restores those as real symlinks
 * when the user unzips it, which is exactly what a framework bundle needs.
 *
 * Produces:
 *   release/APM-Open-Player-<version>-macos-arm64.zip
 *   release/APM-Open-Player-<version>-macos-x64.zip
 *
 * NOT produced: the .dmg, which needs macOS tooling (hdiutil).
 * Both apps are unsigned, so the first launch needs right-click -> Open.
 *
 * Usage: node tools/build-macos.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const JSZip = require(path.resolve(__dirname, '..', 'desktop', 'node_modules', 'jszip'));

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop');
const RELEASE = path.join(ROOT, 'release');
const TMP = path.join(os.tmpdir(), 'apm-macos-build');
const APP_NAME = 'APM Open Player';
const BUNDLE_ID = 'com.apm.openplayer';

const pkg = require(path.join(DESKTOP, 'package.json'));
const ELECTRON_VERSION = require(path.join(DESKTOP, 'node_modules', 'electron', 'package.json')).version;

const TARGETS = [
  { arch: 'arm64', electronArch: 'darwin-arm64', npmPlatform: 'darwin', npmArch: 'arm64', label: 'Apple Silicon (M1/M2/M3/M4)' },
  { arch: 'x64', electronArch: 'darwin-x64', npmPlatform: 'darwin', npmArch: 'x64', label: 'Intel' },
];

// Mac document types, so the app shows up in Finder's "Open With".
const UTIS = [
  'public.movie', 'public.video', 'public.audio', 'public.mpeg-4',
  'public.matroska-video', 'public.avi', 'com.microsoft.wmv', 'public.flv',
  'public.mpeg', 'org.videolan.3gp', 'org.videolan.mkv', 'public.mp3',
  'public.flac-audio', 'com.microsoft.waveform-audio', 'public.aifc-audio',
  'public.mpeg-4-audio', 'org.xiph.ogg', 'com.apple.quicktime-movie',
];

function log(...a) { console.log('[macos-build]', ...a); }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw new Error(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
}

function npmCmd() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }
function runNpm(args, opts = {}) { run(npmCmd(), args, { ...opts, shell: true }); }

async function resolveTarballUrl(name, version) {
  const meta = await (await fetch(`https://registry.npmjs.org/${name}`)).json();
  if (meta.error) throw new Error(`${name}: ${meta.error}`);
  const v = meta.versions && meta.versions[version];
  if (!v) throw new Error(`${name}@${version} not published`);
  return v.dist.tarball;
}

async function downloadUrl(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  log('downloading', path.basename(url));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function fetchPackage(name, version, destDir) {
  const url = await resolveTarballUrl(name, version);
  const tgz = path.join(TMP, path.basename(new URL(url).pathname));
  await downloadUrl(url, tgz);
  const stage = path.join(TMP, 'pkg-' + name.replace(/[@/]/g, '-'));
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  run('tar', ['-xzf', tgz, '-C', stage]);
  const out = path.join(destDir, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.renameSync(path.join(stage, 'package'), out);
  return out;
}

/** Copy a directory tree into a zip under a given prefix. */
async function addDirToZip(zip, fromDir, prefix) {
  for (const e of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const src = path.join(fromDir, e.name);
    const dest = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await addDirToZip(zip, src, dest);
    } else if (e.isSymbolicLink()) {
      // Preserve symlinks in the output zip.
      zip.file(dest, fs.readlinkSync(src));
    } else {
      zip.file(dest, fs.readFileSync(src));
    }
  }
}

function setPlistKey(xml, key, value) {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (re.test(xml)) return xml.replace(re, `$1${value}$2`);
  return xml.replace('</dict>', `  <key>${key}</key>\n  <string>${value}</string>\n</dict>`);
}

function rewritePlist(xml) {
  for (const [k, v] of [
    ['CFBundleName', APP_NAME],
    ['CFBundleDisplayName', APP_NAME],
    ['CFBundleExecutable', APP_NAME],
    ['CFBundleIdentifier', BUNDLE_ID],
    ['CFBundleShortVersionString', pkg.version],
    ['CFBundleVersion', pkg.version],
  ]) {
    xml = setPlistKey(xml, k, v);
  }
  // Drop Electron's own document types before adding ours.
  xml = xml.replace(/\s*<key>CFBundleDocumentTypes<\/key>\s*<array>[\s\S]*?<\/array>/, '');
  const block = `
  <key>CFBundleDocumentTypes</key>
  <array>
${UTIS.map((t) => `    <dict>
      <key>CFBundleTypeName</key><string>${t}</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
    </dict>`).join('\n')}
  </array>`;
  return xml.replace('</dict>', `${block}\n</dict>`);
}

(async function main() {
  fs.mkdirSync(RELEASE, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  log(`APM Open Player ${pkg.version}, Electron ${ELECTRON_VERSION}`);

  // ---- 1. asar tool ------------------------------------------------------
  let asarCli = null;
  try {
    asarCli = require.resolve('@electron/asar/bin/asar.js', { paths: [path.join(DESKTOP, 'node_modules')] });
  } catch (_) {
    log('installing @electron/asar');
    runNpm(['install', '--no-save', '--no-audit', '--no-fund', '@electron/asar@^4'], { cwd: DESKTOP });
    asarCli = require.resolve('@electron/asar/bin/asar.js', { paths: [path.join(DESKTOP, 'node_modules')] });
  }

  // ---- 2. application payload -------------------------------------------
  const payload = path.join(TMP, 'payload');
  fs.rmSync(payload, { recursive: true, force: true });
  fs.mkdirSync(payload, { recursive: true });
  fs.copyFileSync(path.join(DESKTOP, 'package.json'), path.join(payload, 'package.json'));
  await addDirToZip(new JSZip(), path.join(DESKTOP, 'src'), ''); // no-op warmup
  fs.cpSync(path.join(DESKTOP, 'src'), path.join(payload, 'src'), { recursive: true });

  log('installing production dependencies');
  runNpm(['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: payload });

  // koffi needs a per-platform native binding; npm refuses to install the
  // Darwin ones from Windows (EBADPLATFORM), so fetch the tarballs directly.
  for (const t of TARGETS) {
    await fetchPackage(`@koromix/koffi-${t.npmPlatform}-${t.npmArch}`, '3.3.3', path.join(payload, 'node_modules'));
  }
  for (const t of TARGETS) {
    const dir = path.join(payload, 'node_modules', `@koromix/koffi-${t.npmPlatform}-${t.npmArch}`);
    if (!fs.existsSync(dir)) throw new Error(`native package missing for ${t.arch}`);
    log(`  native binding ready for ${t.arch}`);
  }

  // macOS users install ffmpeg/ffprobe with Homebrew; binary-resolver finds
  // them on PATH, so do not ship Windows binaries.
  for (const p of ['@ffmpeg-installer', '@ffprobe-installer']) {
    fs.rmSync(path.join(payload, 'node_modules', p), { recursive: true, force: true });
  }

  const appAsarPath = path.join(TMP, 'app.asar');
  log('packing app.asar');
  run('node', [asarCli, 'pack', payload, appAsarPath]);
  log(`  app.asar ${(fs.statSync(appAsarPath).size / 1024 / 1024).toFixed(1)} MB`);

  // ---- 3. per architecture ------------------------------------------------
  const outputs = [];
  for (const t of TARGETS) {
    log(`=== ${t.arch} — ${t.label} ===`);
    const zipName = `electron-v${ELECTRON_VERSION}-${t.electronArch}.zip`;
    const zipPath = await downloadUrl(
      `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${zipName}`,
      path.join(TMP, zipName)
    );

    const src = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const out = new JSZip();

    let symlinks = 0;
    let files = 0;

    for (const name of Object.keys(src.files)) {
      const entry = src.files[name];

      // Electron.app/... -> APM Open Player.app/...
      if (!name.startsWith('Electron.app/')) continue;
      let target = `${APP_NAME}.app/${name.slice('Electron.app/'.length)}`;

      // Electron.app/Contents/MacOS/Electron (+ helpers) -> APM Open Player
      const macOsPrefix = `${APP_NAME}.app/Contents/MacOS/`;
      if (target.startsWith(macOsPrefix)) {
        target = macOsPrefix + APP_NAME;
      }

      // The placeholder app that Electron ships is replaced by ours.
      if (target.endsWith('/Contents/Resources/default_app.asar')) continue;

      // Info.plist is rewritten below.
      if (target.endsWith('/Contents/Info.plist')) continue;

      if (entry.dir) {
        out.folder(target);
        continue;
      }

      const buf = await entry.async('nodebuffer');
      // S_IFLNK is 0o120000; the stored mode also carries permission bits, so the
      // file-type mask must be applied before comparing.
      const isSymlink = (entry.unixPermissions & 0o170000) === 0o120000;
      out.file(target, buf, {
        // Carry unixPermissions through so symlinks survive the round trip.
        unixPermissions: entry.unixPermissions,
        date: entry.date,
        createFolders: false,
      });
      if (isSymlink) symlinks++;
      else files++;
    }

    if (symlinks === 0) {
      throw new Error(
        'no symlinks preserved - a macOS .app needs its framework symlinks ' +
        '(.../Versions/Current) or it will not launch. Aborting.'
      );
    }

    log(`  copied ${files} files, preserved ${symlinks} symlinks`);

    out.file(`${APP_NAME}.app/Contents/Info.plist`, rewritePlist(src.file('Electron.app/Contents/Info.plist')
      ? await src.file('Electron.app/Contents/Info.plist').async('string')
      : '<plist/>'));
    log('  Info.plist rewritten');

    out.file(`${APP_NAME}.app/Contents/Resources/app.asar`, fs.readFileSync(appAsarPath));
    log('  app.asar added');

    // Native .node payloads must sit outside the asar to be loadable.
    await addDirToZip(out, path.join(payload, 'node_modules', 'koffi'),
      `${APP_NAME}.app/Contents/Resources/app.asar.unpacked/node_modules/koffi`);
    for (const t2 of TARGETS) {
      const n = `@koromix/koffi-${t2.npmPlatform}-${t2.npmArch}`;
      const p = path.join(payload, 'node_modules', n);
      if (fs.existsSync(p)) {
        await addDirToZip(out, p, `${APP_NAME}.app/Contents/Resources/app.asar.unpacked/node_modules/${n}`);
      }
    }
    log('  app.asar.unpacked added');

    out.file(`${APP_NAME}.app/Contents/Resources/mpv/README.txt`,
      'APM Open Player needs the mpv engine on macOS.\n\n' +
      'Install it once:\n\n    brew install mpv\n\n' +
      'The app then loads libmpv.2.dylib from /opt/homebrew/lib (Apple Silicon)\n' +
      'or /usr/local/lib (Intel). If the app cannot find it, it says so and tells\n' +
      'you this command.\n');

    const outName = `APM-Open-Player-${pkg.version}-macos-${t.arch}.zip`;
    const outPath = path.join(RELEASE, outName);
    fs.rmSync(outPath, { force: true });
    log('  writing', outName);
    const data = await out.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'UNIX', // writes the external attributes that encode symlinks
    });
    fs.writeFileSync(outPath, data);
    outputs.push(outName);
    log(`  ${outName}  ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log('');
  log('done:');
  for (const o of outputs) log('  release/' + o);
  log('');
  log('Not produced: the .dmg (needs macOS). Both apps are unsigned, so the first');
  log('launch needs right-click -> Open, or:  xattr -cr "APM Open Player.app"');
})().catch((err) => {
  console.error('[macos-build] FAILED:', err.message);
  process.exit(1);
});