/**
 * Generates a battery of real media files across containers/codecs so we can
 * prove the player actually decodes them - not just that mpv claims support.
 *
 * Usage: node tools/make-testmedia.js [outDir]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// These live in desktop/package.json, so they install into
// desktop/node_modules. Plain require() from tools/ walks tools/node_modules
// and then the repository root, never a sibling folder, so it cannot see
// them. Point at the install explicitly, the same way build-macos.js does.
const DESKTOP_MODULES = path.resolve(__dirname, '..', 'desktop', 'node_modules');
const ffmpeg = require(path.join(DESKTOP_MODULES, '@ffmpeg-installer', 'ffmpeg'));
const ffprobe = require(path.join(DESKTOP_MODULES, '@ffprobe-installer', 'ffprobe'));

const OUT = process.argv[2] || path.join(__dirname, '..', 'tools', 'testmedia');
const FFMPEG = ffmpeg.path;
const FFPROBE = ffprobe.path;

fs.mkdirSync(OUT, { recursive: true });

// [filename, ffmpeg output args, description]
const CASES = [
  ['movie-h264-aac.mkv', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest'], 'MKV / H.264 / AAC'],
  ['movie-h264-aac.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], 'MP4 / H.264 / AAC'],
  ['movie-hevc-eac3.mkv', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000',
    '-t', '4', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=none', '-pix_fmt', 'yuv420p', '-c:a', 'eac3', '-shortest'], 'MKV / HEVC(H.265) / E-AC-3  <- the one phones choke on'],
  ['movie-hevc-ac3.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000',
    '-t', '4', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=none', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-shortest'], 'MP4 / HEVC / AC3'],
  ['movie-av1-opus.webm', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=350:sample_rate=48000',
    '-t', '4', '-c:v', 'libaom-av1', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-shortest'], 'WebM / AV1 / Opus'],
  ['movie-vp9-opus.webm', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=350:sample_rate=48000',
    '-t', '4', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-shortest'], 'WebM / VP9 / Opus'],
  ['movie-avi-mpeg4.mp3.avi', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '4', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-shortest'], 'AVI / MPEG-4 ASP / MP3  <- classic DivX-era'],
  ['movie-flv-h263.mp3.flv', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '4', '-c:v', 'flv', '-c:a', 'libmp3lame', '-shortest'], 'FLV / Sorenson H.263 / MP3'],
  ['movie-mpeg2ts.ts', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'mpeg2video', '-c:a', 'mp2', '-shortest', '-f', 'mpegts'], 'MPEG-TS / MPEG-2 Video / MP2'],
  ['movie-prores-pcm.mov', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '3', '-c:v', 'prores_ks', '-profile:v', 'proxy', '-c:a', 'pcm_s16le', '-shortest'], 'MOV / ProRes / PCM'],
  ['movie-wmv3.wmv', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '4', '-c:v', 'wmv2', '-c:a', 'wmav2', '-shortest'], 'ASF / WMV3 / WMA'],
  ['movie-theora.ogv', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '4', '-c:v', 'libtheora', '-c:a', 'libvorbis', '-shortest'], 'Ogg / Theora / Vorbis'],
  ['movie-1080p-hevc.mkv', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '3', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=none', '-pix_fmt', 'yuv420p', '-c:a', 'eac3', '-shortest'], '1080p HEVC + E-AC-3'],
  // AV1 needs -strict -2 on older ffmpeg builds because libaom-av1 is still
  // flagged experimental; the spawn call adds it with the output options.
  // The tiling flags are deliberately not set: -tiles was removed in
  // FFmpeg 5 in favour of -tile-columns/-tile-rows, and carrying it meant
  // the same source built fine on a Windows runner and died with
  // "Option not found" on Linux. They only affect encoder speed, never
  // whether the resulting file decodes, which is what this file exists to
  // prove.
  //
  // rate=4 with -t 3 is twelve frames spread over three seconds rather than
  // twelve frames back to back. Same amount of encoding work, but the old
  // version produced a half-second file that probed as 0:00, and the decode
  // test reached EOF before it could read the clock.
  ['movie-4k-av1-eac3.mkv', ['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '3', '-c:v', 'libaom-av1', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-c:a', 'eac3', '-shortest'], '4K AV1 + E-AC-3  <- largest resolution test'],

  ['song-flac.flac', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:a', 'flac'], 'FLAC'],
  ['song-mp3.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:a', 'libmp3lame'], 'MP3'],
  ['song-aac.m4a', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'aac'], 'AAC in MP4/M4A'],
  ['song-opus.opus', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'libopus'], 'Opus'],
  ['song-vorbis.ogg', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'libvorbis'], 'Vorbis in Ogg'],
  ['song-wav.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'pcm_s16le'], 'PCM WAV'],
  ['song-aiff.aiff', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'pcm_s16be'], 'PCM AIFF'],
  ['song-ac3.ac3', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'ac3'], 'AC3'],
  ['song-eac3.eac3', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'eac3'], 'E-AC-3'],
  ['song-truehd.mka', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'truehd'], 'Dolby TrueHD in Matroska'],
  ['song-dts.dts', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'dts'], 'DTS'],
  ['song-alac.m4a', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'alac'], 'ALAC'],
  // NOTE: this ffmpeg build has no APE *muxer*, so we cannot author a .ape
  // sample here. WavPack is used instead; APE *decoding* is still covered by
  // the decoder inventory check in spike-mpv.js.
  ['song-wavpack.wv', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'wavpack'], 'WavPack'],
  ['song-wma.wma', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:a', 'wmav2'], 'WMA'],
  ['song-opus-in-mkv.mka', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:a', 'libopus'], 'Opus in Matroska'],
];

console.log(`ffmpeg : ${FFMPEG}`);
console.log(`ffprobe: ${FFPROBE}`);
console.log(`output : ${OUT}\n`);

const results = [];
for (const [name, args, desc] of CASES) {
  const dest = path.join(OUT, name);
  // Anything under 4 KB is a truncated leftover from a killed run, not a real
  // sample - force it to regenerate.
  if (fs.existsSync(dest) && fs.statSync(dest).size > 4096) {
    console.log(`  skip  ${name}`);
    results.push({ name, desc, ok: true, size: fs.statSync(dest).size });
    continue;
  }
  // -strict -2 must sit with the *output* options, otherwise ffmpeg applies it
// to the lavfi inputs and still refuses the experimental encoders (libaom-av1,
// truehd, dca).
const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args, '-strict', '-2', dest], { encoding: 'utf8' });
  if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    const kb = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`  OK    ${name.padEnd(28)} ${kb.padStart(6)} KB   ${desc}`);
    results.push({ name, desc, ok: true, size: fs.statSync(dest).size });
  } else {
    console.log(`  FAIL  ${name.padEnd(28)}        ${desc}`);
    if (r.stderr) console.log(`        ${r.stderr.trim().split('\n').slice(0, 3).join('\n        ')}`);
    results.push({ name, desc, ok: false, error: (r.stderr || '').slice(0, 300) });
  }
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} test files generated`);
process.exit(ok === results.length ? 0 : 1);