/**
 * Launches the real Electron app with a test file already queued, waits, then
 * reports what the renderer and the main process actually saw. This is the
 * smoke test for the native video window, not just the decode path.
 *
 * Usage: node tools/smoke-electron.js <mediaFile> [seconds]
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const P = (s) => fs.writeSync(1, s + '\n');

// Electron runs with cwd = desktop/, so relative paths must be resolved here.
const file = path.resolve(process.argv[2] || path.resolve(__dirname, 'testmedia', 'movie-hevc-eac3.mkv'));
const seconds = Number(process.argv[3] || 12);
// Pass the path of a packaged build to smoke-test the real artifact instead of
// the development Electron binary.
const packaged = process.argv[4] ? path.resolve(process.argv[4]) : null;
const desktop = path.resolve(__dirname, '..', 'desktop');
const electron = packaged || path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(electron)) {
  P('electron binary missing at ' + electron);
  process.exit(1);
}

P(`launching ${packaged ? 'PACKAGED build' : 'electron'} with ` + path.basename(file));
const args = packaged ? ['--dev', '--no-single-instance'] : ['.', '--dev', '--no-single-instance'];
const child = spawn(electron, args, {
  cwd: desktop,
  env: { ...process.env, APM_SMOKE: '1', APM_SMOKE_FILE: file, NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write('[out] ' + d.toString()); });
child.stderr.on('data', (d) => { out += d.toString(); process.stderr.write('[err] ' + d.toString()); });

let exited = false;
child.on('exit', (code) => {
  if (exited) return;
  exited = true;
  P('electron exited with code ' + code);
  const report = path.resolve(__dirname, '..', 'smoke-report.json');
  const marker = 'APM_SMOKE_RESULT ';
  const line = out.split('\n').find((l) => l.startsWith(marker));
  if (line) {
    try {
      const r = JSON.parse(line.slice(marker.length));
      P('');
      P('--- smoke report -------------------------------------');
      P(`  renderer ready        : ${r.rendererReady}`);
      P(`  video host created    : ${r.videoHostCreated}`);
      P(`  video rect sent       : ${JSON.stringify(r.videoRect)}`);
      P(`  video visible         : ${r.videoVisible}`);
      P(`  mpv window handle     : ${r.mpvWindowHandle}`);
      P(`  file loaded           : ${r.fileLoaded}`);
      P(`  time-pos observed     : ${r.timePos}`);
      P(`  duration observed     : ${r.duration}`);
      P(`  pause                 : ${r.pause}`);
      P(`  window handle valid   : ${r.hwndValid}`);
      P(`  errors                : ${r.errors.length ? r.errors.join(' | ') : 'none'}`);
      P('-----------------------------------------------------');
      fs.writeFileSync(report, JSON.stringify(r, null, 2));
      P('report written to ' + report);
      process.exit(r.ok ? 0 : 1);
    } catch (e) {
      P('could not parse report: ' + e.message);
      process.exit(1);
    }
  }
  P('no smoke marker found in output');
  process.exit(1);
});

setTimeout(() => {
  P('timeout reached, killing electron');
  child.kill();
}, seconds * 1000);