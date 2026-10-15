/** Builds only the source archive. Used when the platform binaries are gone. */
const fs = require('fs');
const path = require('path');
const { ZipWriter } = require('./lib/zip-stream');

const ROOT = path.resolve(__dirname, '..');
const files = [];

const EXCLUDE_DIR = new Set([
  'node_modules', 'dist', '.gradle', '.git', 'vendor', 'testmedia',
  'release', '.idea', '.vscode', 'out', 'keystore', 'SETUPS',
]);
const EXCLUDE_PATH = new Set(['android/build', 'android/app/build']);
const EXCLUDE_FILE = new Set(['smoke-ui.png', 'smoke-frame.png', 'smoke-report.json', '.DS_Store']);
const NEVER_SHIP = /\.(jks|keystore|p12|pfx|der|key)$/i;

/**
 * The resized icon PNGs under desktop/build/ are generated from icon.ico by
 * tools/make-icon.ps1. They are gitignored, so CI never has them and its
 * archive came out eight files smaller than a local one - the same command
 * producing a different result depending on where it ran. icon.ico, icon.icns,
 * icon.png and installer.nsh are checked in and do ship.
 */
const GENERATED = /^desktop\/build\/icon-\d+\.png$/;

(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIR.has(name) || EXCLUDE_PATH.has(rel)) continue;
      walk(full);
      continue;
    }
    if (EXCLUDE_FILE.has(name) || NEVER_SHIP.test(name)) continue;
    if (/^android\/(app\/)?build\//.test(rel)) continue;
    if (GENERATED.test(rel)) continue;
    if (/\.(exe|apk|dll|so|dylib|7z|blockmap|zip)$/i.test(name)) continue;
    if (/\.log$|\.tmp$|\.out$/i.test(name)) continue;
    files.push(full);
  }
})(ROOT);

const leaked = files.filter((f) => NEVER_SHIP.test(f));
if (leaked.length) {
  console.error('refusing to package signing material:\n  ' + leaked.join('\n  '));
  process.exit(1);
}

const outDir = path.join(ROOT, 'release');
fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, 'APM-Open-Player-1.0.0-source.zip');

const z = new ZipWriter(dest);
for (const f of files) {
  z.addFile(f, 'APM-Open-Player/' + path.relative(ROOT, f).split(path.sep).join('/'));
}
z.close();

console.log('files:', files.length, ' size:', (fs.statSync(dest).size / 1024).toFixed(0), 'KB');