'use strict';
/**
 * APM Open Player - media inspection
 * ---------------------------------------------------------------------------
 * Everything the UI shows about a file (container, duration, tracks, HDR,
 * chapters) comes from ffprobe, which ships alongside libmpv and reads every
 * container FFmpeg reads. mpv plays it; ffprobe describes it.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const binaries = require('./binary-resolver');

let ffprobe = binaries.ffprobe();
if (!ffprobe) {
  const vendored = path.join(__dirname, '..', '..', 'vendor', 'ffprobe');
  if (fs.existsSync(vendored)) ffprobe = vendored;
}

const MEDIA_EXTS = new Set([
  // video containers
  'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'qt', 'wmv', 'asf', 'flv', 'f4v',
  'ts', 'm2ts', 'mts', 'm2v', 'vob', 'ogv', '3gp', '3g2', 'mpg', 'mpeg',
  'mpe', 'm1v', 'm2v', 'rm', 'rmvb', 'divx', 'dv', 'fli', 'flc', 'nsv', 'mxf',
  'y4m', 'roq', 'tp', 'trp', 'm2p', 'm2ts', 'dvr-ms', 'qt', 'swf', 'amv',
  'drc', 'f4v', 'mng', 'gif', 'webp', 'mjpeg', 'avif', 'heif', 'heic', 'ivf',
  // audio containers
  'mp3', 'aac', 'm4a', 'm4b', 'flac', 'wav', 'ogg', 'oga', 'opus', 'spx',
  'wma', 'aiff', 'aif', 'aifc', 'ape', 'wv', 'tta', 'opus', 'dts', 'ac3',
  'eac3', 'ec3', 'mka', 'm3u', 'm3u8', 'pls', 'mid', 'midi', 'kar', 'amr',
  'awb', 'caf', 'mka', 'tak', 'tta', 'dsf', 'dff', 'wvp', 'spx', 'mod',
  's3m', 'xm', 'it', 'ra', 'ram', 'rmj', 'au', 'snd', 'voc', 'mpc', 'mp+',
  // subtitles
  'srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'smi', 'sami', 'txt', 'mpl',
  // playlists
  'm3u', 'm3u8', 'pls', 'cue', 'asx', 'wax', 'wvx',
]);

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'avif', 'heic', 'jxl']);

/** Container families, used to group the UI and to explain "why" support. */
const CONTAINERS = {
  mp4: ['mp4', 'm4v', 'm4a', 'm4b', 'mov', '3gp', '3g2'],
  matroska: ['mkv', 'mka', 'mks', 'webm'],
  avi: ['avi'],
  asf: ['asf', 'wmv', 'wma'],
  flv: ['flv', 'f4v'],
  mpegts: ['ts', 'm2ts', 'mts', 'm2t'],
  dvd: ['vob', 'ifo', 'bup', 'img'],
  realmedia: ['rm', 'rmvb', 'rma', 'rmj', 'ram', 'ra'],
  ogg: ['ogg', 'oga', 'ogv', 'opus', 'spx'],
  quicktime: ['mov', 'qt'],
  elementary: ['mpg', 'mpeg', 'mpe', 'm1v', 'm2v', 'h264', 'hevc', 'av1', 'vp9', 'm2p', 'm2a'],
  ape: ['ape'],
  wav: ['wav', 'wave'],
  aiff: ['aif', 'aiff', 'aifc', 'snd'],
  flac: ['flac'],
  dsf: ['dsf', 'dff'],
  m3u: ['m3u', 'm3u8'],
  pls: ['pls'],
  cue: ['cue'],
  subtitle: ['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'smi', 'sami'],
};

const CODEC_FAMILIES = {
  video: {
    'h264': 'H.264 / AVC', 'avc1': 'H.264 / AVC', 'h265': 'HEVC / H.265', 'hevc': 'HEVC / H.265',
    'hev1': 'HEVC / H.265', 'av01': 'AV1', 'vp8': 'VP8', 'vp9': 'VP9', 'mpeg2video': 'MPEG-2',
    'mpeg4': 'MPEG-4 Part 2', 'msmpeg4v3': 'MPEG-4 Part 2', 'msmpeg4': 'MPEG-4 Part 2',
    'wmv1': 'Windows Media Video 7', 'wmv2': 'Windows Media Video 8', 'wmv3': 'Windows Media Video 9',
    'vc1': 'VC-1', 'flv1': 'Sorenson H.263', 'h263': 'H.263', 'h263p': 'H.263+', 'theora': 'Theora',
    'prores': 'Apple ProRes', 'dnxhd': 'Avid DNxHD', 'dvvideo': 'DV', 'ffv1': 'FFV1',
    'utvideo': 'UTVideo', 'v210': 'v210', 'cfhd': 'CineForm', 'cinepak': 'Cinepak',
    'indeo': 'Indeo', 'realvideo': 'RealVideo', 'rv10': 'RealVideo 1.0', 'rv20': 'RealVideo 2.0',
    'vp8alpha': 'VP8', 'msmpeg1': 'MPEG-1', 'mpeg1video': 'MPEG-1', 'mjpeg': 'Motion JPEG',
    'qtrle': 'QuickTime RLE', 'rle': 'QuickTime RLE', 'rawvideo': 'Raw Video', 'bmp': 'BMP',
    'apng': 'APNG', 'png': 'PNG', 'hqx': 'Hqx', 'gif': 'GIF', 'dpx': 'DPX', 'exr': 'OpenEXR',
  },
  audio: {
    'aac': 'AAC', 'aac_latm': 'AAC', 'mp3': 'MP3', 'mp3float': 'MP3', 'flac': 'FLAC',
    'opus': 'Opus', 'vorbis': 'Vorbis', 'wmav1': 'WMA v1', 'wmav2': 'WMA v2', 'wmav3': 'WMA Pro',
    'wmapro': 'WMA Pro', 'wmalossless': 'WMA Lossless', 'ac3': 'Dolby Digital (AC-3)',
    'eac3': 'Dolby Digital Plus (E-AC-3)', 'ec3': 'Dolby Digital Plus (E-AC-3)',
    'truehd': 'Dolby TrueHD', 'mlp': 'Dolby TrueHD (MLP)', 'dts': 'DTS', 'dtshd': 'DTS-HD',
    'alac': 'Apple Lossless', 'ape': "Monkey's Audio", 'wavpack': 'WavPack',
    'tta': 'True Audio', 'wma': 'WMA', 'amr': 'AMR-NB', 'amrwb': 'AMR-WB', 'gsm': 'GSM',
    'speex': 'Speex', 'tak': "Tom's Audio Kompressor", 'mpc': 'Musepack', 'ra': 'RealAudio',
    's302m': 'MPEG S/302M', 'pcm_s16le': 'PCM (S16LE)', 'pcm_s16be': 'PCM (S16BE)',
    'pcm_s24le': 'PCM (S24LE)', 'pcm_s32le': 'PCM (S32LE)', 'pcm_f32le': 'PCM (float)',
    'pcm_u8': 'PCM (U8)', 'pcm_mulaw': 'PCM (mu-law)', 'pcm_alaw': 'PCM (A-law)',
    'adpcm_ima_wav': 'ADPCM', 'adpcm_ms': 'ADPCM', 'pcm_bluray': 'PCM (Blu-ray)',
    'pcm_dvd': 'PCM (DVD)', 'cook': 'Cook (RealAudio)', 'sipr': 'SIPR', 'atrac3': 'ATRAC3',
  },
  subtitle: {
    'subrip': 'SubRip (SRT)', 'srt': 'SubRip (SRT)', 'ass': 'ASS', 'ssa': 'SSA',
    'webvtt': 'WebVTT', 'vtt': 'WebVTT', 'mov_text': 'MOV text', 'text': 'Text',
    'microdvd': 'MicroDVD', 'subviewer': 'SubViewer', 'subviewer1': 'SubViewer',
    'pgs': 'PGS (Blu-ray)', 'hdmv_pgs_subtitle': 'PGS (Blu-ray)', 'dvdsub': 'VobSub',
    'dvbsub': 'DVB Subtitle', 'dvb_subtitle': 'DVB Subtitle', 'xsub': 'XSUB (DivX)',
    'subrip+': 'SubRip', 'eia_608': 'Closed Captions', 'hdmv_text_subtitle': 'HDMV Text',
    'pgssub': 'PGS', 'sami': 'SAMI', 'realtext': 'RealText', 'stl': 'EBU STL',
  },
};

const AUDIO_CODEC_EXTS = new Set([
  'mp3', 'aac', 'm4a', 'm4b', 'flac', 'wav', 'ogg', 'oga', 'opus', 'spx', 'wma',
  'aiff', 'aif', 'aifc', 'ape', 'wv', 'tta', 'tak', 'dts', 'ac3', 'eac3', 'ec3',
  'mka', 'amr', 'awb', 'caf', 'dsf', 'dff', 'ra', 'ram', 'au', 'snd', 'mpc',
]);

const SUB_EXTS = new Set(['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'smi', 'sami', 'mpl']);

function extOf(p) {
  return path.extname(p || '').replace('.', '').toLowerCase();
}

function containerOf(ext) {
  for (const [name, exts] of Object.entries(CONTAINERS)) {
    if (exts.includes(ext)) return name;
  }
  return 'raw';
}

function codecName(kind, codec) {
  if (!codec) return null;
  const map = CODEC_FAMILIES[kind] || {};
  return map[codec.toLowerCase()] || codec.toUpperCase();
}

function classify(ext) {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (SUB_EXTS.has(ext)) return 'subtitle';
  if (AUDIO_CODEC_EXTS.has(ext)) return 'audio';
  if (MEDIA_EXTS.has(ext)) return 'video';
  return 'unknown';
}

function parseRate(str) {
  if (!str) return null;
  if (str.includes('/')) {
    const [n, d] = str.split('/').map(Number);
    return d ? n / d : null;
  }
  const v = Number(str);
  return Number.isFinite(v) ? v : null;
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function humanTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

function pickLanguage(tags) {
  if (!tags) return null;
  const t = tags.language || tags.LANGUAGE || tags.languages;
  return t ? String(t).toUpperCase() : null;
}

function isHdr(stream) {
  const ct = String(stream.color_transfer || '').toLowerCase();
  const cp = String(stream.color_primaries || '').toLowerCase();
  const cp2 = String(stream.color_space || '').toLowerCase();
  return (
    ct.includes('2084') ||
    ct.includes('arib-std-b67') ||
    (cp.includes('2020') && cp2.includes('pq'))
  );
}

function promiseExec(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * Full inspection of a file. Never throws - an unreadable file comes back with
 * `ok: false` plus whatever we could learn from the filesystem.
 */
async function probe(file) {
  const ext = extOf(file);
  const base = {
    path: file,
    name: path.basename(file),
    ext,
    container: containerOf(ext),
    kind: classify(ext),
    ok: false,
  };
  try {
    const st = fs.statSync(file);
    base.sizeBytes = st.size;
    base.sizeHuman = humanSize(st.size);
    base.mtime = st.mtimeMs;
  } catch (_) {}

  if (!ffprobe) {
    // No ffprobe on this machine (common on macOS/Linux unless ffmpeg is
    // installed). Playback is unaffected; only the library panels degrade.
    base.error = 'ffprobe is not installed - metadata is unavailable';
    base.noProbe = true;
    return base;
  }

  const { err, stdout } = await promiseExec(ffprobe, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', '-i', file,
  ]);
  if (err || !stdout || !stdout.trim()) {
    base.error = (err && err.message) || 'ffprobe could not read this file';
    return base;
  }

  let json;
  try {
    json = JSON.parse(stdout);
  } catch (_) {
    base.error = 'ffprobe returned unreadable JSON';
    return base;
  }

  const streams = json.streams || [];
  const fmt = json.format || {};
  const videoStreams = streams.filter((s) => s.codec_type === 'video');
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const subStreams = streams.filter((s) => s.codec_type === 'subtitle');
  // Cover art is a video stream attached to a picture stream.
  const cover = videoStreams.find((s) => s.disposition && s.disposition.attached_pic);
  const realVideo = videoStreams.filter((s) => !(s.disposition && s.disposition.attached_pic));

  const duration = parseFloat(fmt.duration) || (realVideo[0] ? parseFloat(realVideo[0].duration) : null);
  base.durationSec = Number.isFinite(duration) ? duration : null;
  base.durationHuman = Number.isFinite(duration) ? humanTime(duration) : '--:--';
  base.bitrate = parseInt(fmt.bit_rate, 10) || null;
  base.sizeBytes = parseInt(fmt.size, 10) || base.sizeBytes;
  base.sizeHuman = humanSize(base.sizeBytes);
  base.formatLongName = fmt.format_long_name || null;
  base.nbStreams = streams.length;
  if (fmt.tags) base.tags = fmt.tags;

  base.hasVideo = realVideo.length > 0;
  base.hasAudio = audioStreams.length > 0;
  base.hasSubtitles = subStreams.length > 0;
  base.isImage = realVideo.length === 1 && (realVideo[0].codec_name === 'mjpeg' || realVideo[0].codec_name === 'png' || realVideo[0].codec_name === 'webp') && !base.hasAudio;
  base.kind = base.isImage ? 'image' : base.hasVideo ? 'video' : base.hasAudio ? 'audio' : base.kind;

  if (realVideo[0]) {
    const v = realVideo[0];
    const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate);
    const rot = v.side_data_list && v.side_data_list.find((d) => d.rotation !== undefined);
    base.video = {
      codec: v.codec_name,
      codecName: codecName('video', v.codec_name),
      profile: v.profile || null,
      width: v.width || null,
      height: v.height || null,
      rotation: rot ? Math.abs(Math.round(rot.rotation)) : 0,
      fps: fps ? Math.round(fps * 1000) / 1000 : null,
      bitrate: parseInt(v.bit_rate, 10) || null,
      pixelFormat: v.pix_fmt || null,
      hdr: isHdr(v),
      hdrScheme: String(v.color_transfer || '').includes('2084') ? 'HDR10 (PQ)' : String(v.color_transfer || '').includes('arib') ? 'HLG' : null,
      colorPrimaries: v.color_primaries || null,
      title: (v.tags && v.tags.title) || null,
    };
  }

  base.audio = audioStreams.map((s, i) => ({
    id: i,
    index: s.index,
    codec: s.codec_name,
    codecName: codecName('audio', s.codec_name),
    profile: s.profile || null,
    language: pickLanguage(s.tags),
    title: (s.tags && s.tags.title) || null,
    channels: s.channels || null,
    channelLayout: s.channel_layout || null,
    sampleRate: parseInt(s.sample_rate, 10) || null,
    bitrate: parseInt(s.bit_rate, 10) || null,
    default: !!(s.disposition && s.disposition.default),
  }));

  base.subtitles = subStreams.map((s, i) => ({
    id: i,
    index: s.index,
    codec: s.codec_name,
    codecName: codecName('subtitle', s.codec_name),
    language: pickLanguage(s.tags),
    title: (s.tags && s.tags.title) || null,
    forced: !!(s.disposition && s.disposition.forced),
    default: !!(s.disposition && s.disposition.default),
  }));

  base.chapters = (json.chapters || []).map((c, i) => ({
    index: i,
    timeSec: parseFloat(c.start_time) || 0,
    title: c.tags && c.tags.title ? c.tags.title : `Chapter ${i + 1}`,
  }));

  if (cover) base.coverArt = true;
  base.ok = true;
  return base;
}

/** Quick audio-only duration read used while scanning folders. */
async function probeDuration(file) {
  if (!ffprobe) return null;
  const { stdout } = await promiseExec(ffprobe, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', '-i', file]);
  const v = parseFloat((stdout || '').trim());
  return Number.isFinite(v) ? v : null;
}

module.exports = {
  probe,
  probeDuration,
  humanTime,
  humanSize,
  extOf,
  containerOf,
  classify,
  codecName,
  isSupportedExtension: (ext) => MEDIA_EXTS.has(String(ext).toLowerCase()),
  MEDIA_EXTS,
  IMAGE_EXTS,
  SUB_EXTS,
  CONTAINERS,
  CODEC_FAMILIES,
  ffprobePath: ffprobe,
};