/**
 * Headless decode test: runs every sample in tools/testmedia through the same
 * libmpv build the app ships, with video/audio output nulled out, and checks
 * that the clock actually advances (i.e. the demuxer + decoder really ran).
 *
 * Usage: node tools/test-decode.js [dir]
 */
const fs = require('fs');
const path = require('path');
const { MpvEngine, MPV_END_FILE_REASON } = require('../desktop/src/main/mpv-engine');
const { probe, humanTime } = require('../desktop/src/main/media-info');

const DIR = process.argv[2] || path.join(__dirname, 'testmedia');
const PLAY_MS = 900; // how long we let each file play before judging it

const files = fs
  .readdirSync(DIR)
  .filter((f) => !f.endsWith('.json'))
  .map((f) => path.join(DIR, f))
  .filter((f) => fs.statSync(f).size > 4096);

console.log(`Testing ${files.length} files from ${DIR}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function testFile(file, info) {
  const engine = new MpvEngine({
    mpvOptions: {
      vo: 'null',
      ao: 'null',
      'hwdec': 'no',
      'audio-display': 'no',
    },
  });
  const problems = [];
  engine.on('warning', (m) => problems.push(m));

  const loaded = new Promise((resolve) => engine.once('mpv:file-loaded', resolve));
  const ended = new Promise((resolve) => engine.once('mpv:end-file', (e) => resolve(e)));

  engine.init();
  engine.loadFile(file);
  engine.set('pause', 'no');

  const loadedOk = await Promise.race([loaded.then(() => true), sleep(6000).then(() => false)]);
  if (!loadedOk) {
    engine.destroy();
    return { ok: false, reason: 'never reached file-loaded' };
  }

  await sleep(PLAY_MS);

  const pos = engine.getNumber('time-pos', 0);
  const duration = engine.getNumber('duration', 0);
  const vCodec = engine.getString('video-params/codec');
  const aCodec = engine.getString('audio-params/codec');

  engine.command('stop');
  const endEvt = await Promise.race([ended, sleep(2500).then(() => null)]);
  engine.destroy();

  if (!pos || pos <= 0) return { ok: false, reason: `clock stuck at ${pos}s`, problems, vCodec, aCodec };
  if (endEvt && endEvt.reason === MPV_END_FILE_REASON.ERROR)
    return { ok: false, reason: `playback error: ${endEvt.errorText}`, problems, vCodec, aCodec };

  return { ok: true, pos, duration, vCodec, aCodec, problems };
}

(async () => {
  let pass = 0;
  let fail = 0;
  const rows = [];

  for (const file of files) {
    const rel = path.basename(file);
    const info = await probe(file).catch(() => ({ ok: false }));
    const label = info.ok
      ? [
          info.container,
          info.video ? info.video.codecName : null,
          info.audio && info.audio.length ? info.audio[0].codecName : null,
          info.durationHuman,
        ].filter(Boolean).join(' / ')
      : 'unreadable';

    const r = await testFile(file, info);
    const mark = r.ok ? 'PASS' : 'FAIL';
    r.ok ? pass++ : fail++;
    rows.push({ rel, label, ...r });
    console.log(
      `  ${mark}  ${rel.padEnd(26)} ${String(label).padEnd(58)} ${r.ok ? `t=${(r.pos || 0).toFixed(2)}s d=${humanTime(r.duration || 0)}` : r.reason}`
    );
    if (r.ok && r.problems && r.problems.length) console.log(`        note: ${r.problems[0]}`);
  }

  console.log(`\n${pass} passed, ${fail} failed of ${files.length}`);
  fs.writeFileSync(path.join(DIR, 'decode-results.json'), JSON.stringify(rows, null, 2));
  process.exit(fail ? 1 : 0);
})();