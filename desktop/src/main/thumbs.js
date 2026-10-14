'use strict';
/**
 * Thumbnail generation.
 *
 * Two paths: if libmpv is already running we ask it for a real decoded frame
 * (instant, exact); otherwise we shell out to ffmpeg and cache the JPEG.
 * Results are cached on disk under userData/thumbs so a library with 5000
 * items costs one decode per item, once.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const binaries = require('./binary-resolver');

const ffmpeg = binaries.ffmpeg() || path.join(__dirname, '..', '..', 'vendor', 'ffmpeg');

const CACHE_DIR = path.join(require('electron').app.getPath('userData'), 'thumbs');
const WIDTH = 320;

function cacheFile(file, time) {
  let st = { size: 0, mtimeMs: 0 };
  try {
    st = fs.statSync(file);
  } catch (_) {}
  const key = crypto
    .createHash('sha1')
    .update(`${path.resolve(file)}|${Math.round(time)}|${st.size}|${Math.round(st.mtimeMs)}`)
    .digest('hex');
  return path.join(CACHE_DIR, `${key}.jpg`);
}

function ensureCache() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (_) {}
}

function readAsDataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function runFfmpeg(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(ffmpeg, args, { timeout, windowsHide: true }, (err, _stdout, stderr) => resolve({ err, stderr: stderr || '' }));
  });
}

/**
 * @param {string} file   media path
 * @param {number} time   seconds into the file
 * @param {object} engine optional live MpvEngine (used for the current file)
 */
async function thumbnailFor(file, time = 10, engine = null) {
  ensureCache();
  const out = cacheFile(file, time);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return readAsDataUrl(out);

  // Grab the frame from the live player when it's the file we're showing -
  // that is the exact frame the user is looking at, and it costs no decode.
  if (engine) {
    const current = engine.getString('path');
    if (current && path.resolve(current).toLowerCase() === path.resolve(file).toLowerCase()) {
      try {
        engine.screenshot(out.replace(/\.jpg$/, '.png'));
        const png = out.replace(/\.jpg$/, '.png');
        await waitForFile(png, 3000);
        if (fs.existsSync(png) && fs.statSync(png).size > 0) {
          await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', png, '-vf', `scale=${WIDTH}:-2`, '-q:v', '6', out]);
          try {
            fs.unlinkSync(png);
          } catch (_) {}
          if (fs.existsSync(out)) return readAsDataUrl(out);
        }
      } catch (_) {}
    }
  }

  const { err } = await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.max(0, time)),
    '-i', file,
    '-frames:v', '1',
    '-vf', `scale=${WIDTH}:-2`,
    '-q:v', '6',
    out,
  ]);
  if (err && !fs.existsSync(out)) return null;
  return fs.existsSync(out) ? readAsDataUrl(out) : null;
}

function waitForFile(file, timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return resolve(true);
      if (Date.now() - started > timeout) return resolve(false);
      setTimeout(tick, 80);
    };
    tick();
  });
}

module.exports = { thumbnailFor, CACHE_DIR };