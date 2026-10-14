'use strict';
/**
 * Locates the bundled helper binaries (ffmpeg, ffprobe).
 *
 * The npm installer packages only ship the binary for the platform they were
 * installed on. On macOS and Linux those packages are usually absent, so we
 * fall back to a binary on PATH (Homebrew, apt, …) and finally to a vendored
 * copy. Everything degrades rather than crashing: the library and thumbnails
 * need ffprobe, playback does not.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';

function fromPackage(name) {
  try {
    return require(name).path;
  } catch (_) {
    return null;
  }
}

/** Look for an executable on PATH without throwing if PATH is unset. */
function fromPath(binary) {
  const names = IS_WINDOWS ? [binary, `${binary}.exe`] : [binary];
  const pathEnv = process.env.PATH || '';
  const exts = IS_WINDOWS ? (process.env.PATHEXT || '.EXE').split(';') : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      for (const ext of exts) {
        const p = path.join(dir, n + ext);
        try {
          if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch (_) {}
      }
    }
  }
  return null;
}

/** Common install prefixes used by the platform package managers. */
function fromCommonLocations(binary) {
  const candidates = IS_WINDOWS
    ? []
    : process.platform === 'darwin'
    ? [
        `/opt/homebrew/bin/${binary}`,
        `/usr/local/bin/${binary}`,
        `/opt/homebrew/opt/ffmpeg/bin/${binary}`,
      ]
    : ['/usr/bin/' + binary, '/usr/local/bin/' + binary, '/snap/bin/' + binary];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function resolve(binary, packageName) {
  return (
    fromPackage(packageName) ||
    fromPath(binary) ||
    fromCommonLocations(binary) ||
    null
  );
}

/** Absolute path to ffmpeg, or null. */
function ffmpeg() {
  return resolve('ffmpeg', '@ffmpeg-installer/ffmpeg');
}

/** Absolute path to ffprobe, or null. */
function ffprobe() {
  return resolve('ffprobe', '@ffprobe-installer/ffprobe');
}

/** True when ffprobe is usable; the library UI depends on it. */
function hasFfprobe() {
  return !!ffprobe();
}

module.exports = { ffmpeg, ffprobe, hasFfprobe };