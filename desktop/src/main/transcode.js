'use strict';
/**
 * Convert / transcode.
 *
 * Wraps the bundled ffmpeg so the player can do the things VLC and KM Player
 * do in their "Convert/Save" panels: remux losslessly, re-encode to a
 * phone-friendly profile, extract audio, burn subtitles, resize, and fix the
 * things that actually break players (no faststart, no AAC, broken timestamps).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const binaries = require('./binary-resolver');

/**
 * Presets. `args` is inserted before the output path. `-y` and progress flags
 * are added by the runner.
 */
const PRESETS = [
  {
    id: 'remux-mkv',
    name: 'Remux to MKV (no re-encode)',
    hint: 'Copies both streams into Matroska. Fast, lossless, fixes broken MP4/MKV files.',
    args: ['-c', 'copy'],
    ext: 'mkv',
  },
  {
    id: 'remux-mp4',
    name: 'Remux to MP4 (no re-encode)',
    hint: 'Copies streams into MP4 and moves the index to the front for streaming.',
    args: ['-c', 'copy', '-movflags', '+faststart'],
    ext: 'mp4',
  },
  {
    id: 'mp4-h264',
    name: 'MP4 (H.264 + AAC) - universal',
    hint: 'The safest file on the planet: plays on phones, TVs, browsers and old cars.',
    args: [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-profile:v', 'high', '-level', '4.1',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    ],
    ext: 'mp4',
  },
  {
    id: 'mp4-h265-small',
    name: 'MP4 (HEVC + AAC) - small file',
    hint: 'Roughly half the size of H.264 at the same quality. Needs a newer device.',
    args: [
      '-c:v', 'libx265', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p',
      '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    ],
    ext: 'mp4',
  },
  {
    id: 'webm-vp9',
    name: 'WebM (VP9 + Opus) - web ready',
    hint: 'Open formats, no patent encumbered codecs.',
    args: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k'],
    ext: 'webm',
  },
  {
    id: 'audio-mp3',
    name: 'Extract audio to MP3',
    args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '320k'],
    ext: 'mp3',
  },
  {
    id: 'audio-flac',
    name: 'Extract audio to FLAC (lossless)',
    args: ['-vn', '-c:a', 'flac', '-compression_level', '8'],
    ext: 'flac',
  },
  {
    id: 'audio-aac',
    name: 'Extract audio to AAC (m4a)',
    args: ['-vn', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
    ext: 'm4a',
  },
  {
    id: 'resize-720p',
    name: 'Shrink to 720p',
    hint: 'Downscale keeping aspect ratio. Does not upscale smaller sources.',
    args: [
      '-vf', "scale='if(gt(iw,ih),-2,min(1280,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
    ],
    ext: 'mp4',
  },
  {
    id: 'resize-1080p',
    name: 'Shrink to 1080p',
    args: [
      '-vf', "scale='if(gt(iw,ih),-2,min(1920,iw))':'if(gt(iw,ih),min(1080,ih),-2)'",
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
    ],
    ext: 'mp4',
  },
  {
    id: 'fix-timestamps',
    name: 'Repair file (fix timestamps / headers)',
    hint: 'Rescans every stream and rewrites the container. For files that stutter or show wrong duration.',
    args: ['-c', 'copy', '-fflags', '+genpts+igndts', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart'],
    ext: 'mp4',
  },
  {
    id: 'burn-subs',
    name: 'Burn in subtitles (H.264)',
    hint: 'Renders the selected subtitle track permanently into the picture.',
    args: [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-vf', 'subtitles=filename=subtitles.ass',
      '-c:a', 'copy',
    ],
    ext: 'mp4',
    needs: 'subtitleFile',
  },
];

class Transcoder {
  constructor(getEngine) {
    this.getEngine = getEngine;
    this.jobs = new Map();
    this._seq = 1;
  }

  ensure() {
    if (!this.ffmpeg) {
      const bin = binaries.ffmpeg();
      if (!bin) {
        throw new Error(
          process.platform === 'darwin'
            ? 'ffmpeg is not installed.\n\nInstall it with Homebrew:\n\n    brew install ffmpeg\n\nThen try Convert again.'
            : 'ffmpeg was not found. Install it and make sure it is on your PATH, then restart APM Open Player.'
        );
      }
      this.ffmpeg = bin;
    }
    return this.ffmpeg;
  }

  static presets() {
    return PRESETS.map((p) => ({ id: p.id, name: p.name, hint: p.hint || '', ext: p.ext, needs: p.needs || null }));
  }

  static defaultName(job) {
    const preset = PRESETS.find((p) => p.id === job.presetId) || PRESETS[2];
    return `${path.basename(job.input, path.extname(job.input))}.apm.${preset.ext}`;
  }

  static outputFilters(job) {
    const preset = PRESETS.find((p) => p.id === job.presetId) || PRESETS[2];
    return [{ name: preset.name.toLowerCase(), extensions: [preset.ext] }, { name: 'All files', extensions: ['*'] }];
  }

  /**
   * Build the ffmpeg argv for a job.
   * @param {{input:string, output:string, presetId:string, subtitleFile?:string, start?:number, duration?:number, streamMap?:string}} job
   */
  buildArgs(job) {
    const preset = PRESETS.find((p) => p.id === job.presetId);
    if (!preset) throw new Error(`unknown preset: ${job.presetId}`);
    if (!job.output) throw new Error('no output path');

    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-stats'];
    if (job.start) args.push('-ss', String(job.start));
    args.push('-i', job.input);
    if (job.duration) args.push('-t', String(job.duration));

    let vf = null;
    const presetArgs = [...preset.args];
    if (job.subtitleFile && presetArgs.includes('subtitles=filename=subtitles.ass')) {
      const escaped = job.subtitleFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      vf = `subtitles=filename='${escaped}'`;
      for (let i = 0; i < presetArgs.length; i++) {
        if (presetArgs[i].startsWith('subtitles=')) presetArgs[i] = vf;
      }
    }
    if (job.videoFilter) {
      const idx = presetArgs.indexOf('-vf');
      if (idx >= 0) presetArgs[idx + 1] = job.videoFilter;
      else presetArgs.push('-vf', job.videoFilter);
    }

    return [...args, ...presetArgs, job.output];
  }

  start(job, onProgress, onDone) {
    const bin = this.ensure();
    const id = this._seq++;
    const args = this.buildArgs(job);
    const child = spawn(bin, args, { windowsHide: true });
    const record = { id, child, job, startedAt: Date.now() };
    this.jobs.set(id, record);

    let stderrTail = '';
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-4000);
      const t = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (t) {
        const seconds = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        let pct = null;
        if (job.durationSec) pct = Math.min(100, (seconds / job.durationSec) * 100);
        onProgress({ percent: pct, seconds, message: 'Encoding' });
      }
    });

    child.on('error', (err) => {
      this.jobs.delete(id);
      onDone({ id, ok: false, error: err.message });
    });

    child.on('close', (code) => {
      this.jobs.delete(id);
      const ok = code === 0 && fs.existsSync(job.output);
      onDone({
        id,
        ok,
        output: job.output,
        error: ok ? null : stderrTail || `ffmpeg exited with code ${code}`,
        seconds: (Date.now() - record.startedAt) / 1000,
      });
    });

    return id;
  }

  cancel(id) {
    const rec = this.jobs.get(id);
    if (!rec) return false;
    rec.child.kill();
    this.jobs.delete(id);
    return true;
  }
}

module.exports = { Transcoder, PRESETS };