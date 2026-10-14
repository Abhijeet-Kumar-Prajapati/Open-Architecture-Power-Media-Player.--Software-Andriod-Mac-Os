'use strict';
/**
 * APM Open Player - libmpv engine
 * ---------------------------------------------------------------------------
 * libmpv is FFmpeg's demuxer/decoder stack wrapped in mpv's player core, so a
 * single instance decodes effectively every container and codec that exists:
 * MKV/AVI/MOV/TS/FLV/RMVB, H.264/HEVC/AV1/VP9/MPEG-2, MP3/AAC/FLAC/Opus,
 * and the ones phones usually refuse - E-AC-3, TrueHD, DTS-HD MA, PGS subs.
 *
 * We bind it with koffi (pure N-API, no compiler step) rather than a native
 * addon so the project builds anywhere Node runs.
 */

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const koffi = require('koffi');

// ---------------------------------------------------------------------------
// libmpv constants (from mpv/client.h)
// ---------------------------------------------------------------------------
const MPV_FORMAT = { NONE: 0, STRING: 1, OSD_STRING: 2, FLAG: 3, INT64: 4, DOUBLE: 5, NODE: 6 };
const MPV_EVENT = {
  NONE: 0,
  SHUTDOWN: 1,
  LOG_MESSAGE: 2,
  GET_PROPERTY_REPLY: 3,
  SET_PROPERTY_REPLY: 4,
  COMMAND_REPLY: 5,
  START_FILE: 6,
  END_FILE: 7,
  FILE_LOADED: 8,
  CLIENT_MESSAGE: 16,
  VIDEO_RECONFIG: 17,
  AUDIO_RECONFIG: 18,
  SEEK: 20,
  PLAYBACK_RESTART: 21,
  PROPERTY_CHANGE: 22,
  QUEUE_OVERFLOW: 24,
};
const MPV_WINDOW_PARAM_FORMAT = { NONE: 0, WID: 1, X11: 2, WIN32: 3 };

/**
 * koffi hands back native addresses as BigInt on 64-bit builds. Pointer
 * arithmetic on a BigInt throws, and mpv_event is a struct we read field by
 * field, so every address is normalised to a Number first. User-mode addresses
 * are always well below 2^53, so this is lossless.
 */
const asPtr = (v) => (typeof v === 'bigint' ? Number(v) : v);

/**
 * A property whose value is currently NULL arrives with data == 0. Reading
 * from address 0 is an access violation, not a catchable exception, so every
 * pointer coming out of an mpv struct is validated before it is dereferenced.
 */
const validPtr = (p) => {
  const n = asPtr(p);
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
};
/**
 * mpv_end_file_reason from mpv/client.h. Note these values are NOT the
 * obvious 0,1,2,3,4 sequence - upstream mpv deliberately left 1 unused:
 *   EOF = 0, STOP = 2, QUIT = 3, ERROR = 4, REDIRECT = 5
 * Verified against the header shipped with the libmpv build we bind to.
 */
const MPV_END_FILE_REASON = { EOF: 0, STOP: 2, QUIT: 3, ERROR: 4, REDIRECT: 5 };

const EVENT_SIZE = 24; // sizeof(mpv_event) on x64
const PROPERTY_EVENT_SIZE = 24; // sizeof(mpv_event_property) on x64

/**
 * Options applied before mpv_initialize(). These are what turn a bare mpv
 * core into a media player: GPU output, hwaccel, sane A/V sync, subtitle
 * discovery next to the media file.
 */
const BASE_OPTIONS = {
  terminal: 'no',
  'idle': 'yes',
  'force-window': 'no',
  'config': 'no',
  'ytdl': 'yes',
  'input-default-bindings': 'no',
  'input-vo-keyboard': 'no',
  'osc': 'no',
  'osd-level': '0',
  'osd-fractions': 'no',
  'keep-open': 'no',
  'loop-playlist': 'no',
  'idle-active': 'yes',
  'audio-display': 'no',
  'autoload-flavors': 'no',
  'audio-channels': 'auto-safe',
  'video-sync': 'audio',
  'interpolation': 'no',
  'hr-seek': 'yes',
  'hr-seek-framedrop': 'no',
  'sub-auto': 'all',
  'sub-file-paths': './,/,/usr/share/vlc/subs,/usr/share/libass/subs',
  'sub-auto-paths': '*',
  'sub-visibility': 'yes',
  'sub-ass-override': 'no',
  'sub-scale': '1',
  'secondary-sub-visibility': 'yes',
  'audio-spdif': 'no',
  'vd-lavc-threads': '0',
  'demuxer-max-bytes': '512MiB',
  'demuxer-max-back-bytes': '128MiB',
  'cache-secs': '300',
  'demuxer-readahead-secs': '30',
  'network-timeout': '30',
  'http-header-fields': 'User-Agent,APM-Open-Player/1.0',
  'tls-verify': 'no',
  'video-latency-hacks': 'yes',
  'gpu-api': 'auto',
  'gpu-context': 'auto',
  'hwdec-current-allow': 'no',
  'screenshot-format': 'png',
  'screenshot-template': '~/apm-shot-%06d',
};

class MpvEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.lib = null;
    this.api = null;
    this.ctx = null;
    this.ready = false;
    this.destroyed = false;
    this._pollTimer = null;
    this._observed = new Map(); // name -> last value we sent to the UI
    this._lastError = null;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  resolveDllPath() {
    if (this.options.dllPath) return this.options.dllPath;

    const isMac = process.platform === 'darwin';
    const names = isMac
      ? ['libmpv.2.dylib', 'libmpv.dylib']
      : process.platform === 'win32'
        ? ['libmpv-2.dll']
        : ['libmpv.so.2'];

    const roots = [
      path.join(__dirname, '..', '..', 'vendor', 'mpv'),
      path.join(process.resourcesPath || '', 'mpv'),
    ];

    // macOS: mpv is installed with Homebrew, and its dylib lives in the
    // prefix rather than next to the app. Apple Silicon and Intel use
    // different prefixes, so both are checked.
    if (isMac) {
      roots.push('/opt/homebrew/lib', '/usr/local/lib');
      roots.push('/opt/homebrew/Cellar/mpv');
    }

    const tried = [];
    for (const root of roots) {
      if (!root.includes('Cellar')) {
        for (const n of names) {
          const p = path.join(root, n);
          if (fs.existsSync(p)) return p;
          tried.push(p);
        }
      }
    }

    // Newer Homebrew keeps mpv under Cellar/mpv/<version>/lib.
    if (isMac) {
      const cellar = '/opt/homebrew/Cellar/mpv';
      try {
        for (const v of fs.readdirSync(cellar)) {
          for (const n of names) {
            const p = path.join(cellar, v, 'lib', n);
            if (fs.existsSync(p)) return p;
          }
        }
      } catch (_) {}
    }

    throw new Error(
      isMac
        ? `libmpv not found.\n\nAPM Open Player uses mpv to play every format.\n` +
          `Install it once with Homebrew:\n\n    brew install mpv\n\n` +
          `Then start APM again. (Looked in:\n  ${tried.slice(0, 6).join('\n  ')})`
        : `libmpv shared library not found. Looked for ${names.join(', ')} in:\n  ${tried.join('\n  ')}`
    );
  }

  load() {
    if (this.lib) return;
    const dll = this.resolveDllPath();
    this.lib = koffi.load(dll);

    const L = (sig) => this.lib.func(sig);

    this.api = {
      create: L('void *__cdecl mpv_create()'),
      // koffi resolves `void *` returns to BigInt; ask for a plain address.
      initialize: L('int __cdecl mpv_initialize(void *)'),
      destroy: L('void __cdecl mpv_destroy(void *)'),
      terminateDestroy: L('void __cdecl mpv_terminate_destroy(void *)'),
      setOptionString: L('int __cdecl mpv_set_option_string(void *, const char *, const char *)'),
      commandString: L('int __cdecl mpv_command_string(void *, const char *)'),
      setPropertyString: L('int __cdecl mpv_set_property_string(void *, const char *, const char *)'),
      getPropertyString: L('char *__cdecl mpv_get_property_string(void *, const char *)'),
      free: L('void __cdecl mpv_free(void *)'),
      observeProperty: L('int __cdecl mpv_observe_property(void *, uint64_t, const char *, int32_t)'),
      requestLogMessages: L('int __cdecl mpv_request_log_messages(void *, const char *)'),
      waitEvent: L('void *__cdecl mpv_wait_event(void *, double)'),
      errorString: L('const char *__cdecl mpv_error_string(int32_t)'),
      setWakeupCallback: L('int __cdecl mpv_set_wakeup_callback(void *, void *, void *)'),
      getWakeupPipe: L('void *__cdecl mpv_get_wakeup_pipe(void *)'),
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  init() {
    this.load();
    this.ctx = asPtr(this.api.create());
    if (!this.ctx) throw new Error('mpv_create() returned NULL');

    for (const [k, v] of Object.entries(BASE_OPTIONS)) {
      this.api.setOptionString(this.ctx, k, String(v));
    }
    for (const [k, v] of Object.entries(this.options.mpvOptions || {})) {
      this.api.setOptionString(this.ctx, k, String(v));
    }
    // Video surface. libmpv has no mpv_create_window(), but mpv's core still
    // understands --wid, so we hand it the HWND of the native container we
    // created inside the Electron window before initialisation.
    if (this.options.wid) {
      this.api.setOptionString(this.ctx, 'wid', String(this.options.wid));
    }

    const rc = this.api.initialize(this.ctx);
    if (rc < 0) {
      throw new Error(`mpv_initialize failed: ${rc} (${this.errorString(rc)})`);
    }

    this.api.requestLogMessages(this.ctx, 'warn');
    this._observeDefaults();
    this.ready = true;

    // mpv has no event callback we can use safely from JS, so drain its event
    // queue on a timer. 0 means non-blocking; we coalesce property changes and
    // only push what actually changed to the renderer.
    this._pollTimer = setInterval(() => this._drainEvents(), 16);
    return this;
  }

  errorString(code) {
    try {
      const s = this.api.errorString(code);
      return typeof s === 'string' && s.length ? s : `error ${code}`;
    } catch (_) {
      return `error ${code}`;
    }
  }

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------
  set(name, value) {
    if (!this.ctx) return;
    try {
      this.api.setPropertyString(this.ctx, name, value == null ? '' : String(value));
    } catch (err) {
      this.emit('warning', `set ${name}: ${err.message}`);
    }
  }

  getString(name) {
    if (!this.ctx) return null;
    // koffi already converts `char *` returns into JS strings.
    const v = this.api.getPropertyString(this.ctx, name);
    return typeof v === 'string' ? v : null;
  }

  getNumber(name, fallback = null) {
    const s = this.getString(name);
    if (s == null || s === 'no' || s === 'yes') return fallback;
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  getFlag(name, fallback = false) {
    const s = this.getString(name);
    if (s == null) return fallback;
    if (s === 'yes') return true;
    if (s === 'no') return false;
    return fallback;
  }

  /** Observe a property and forward changes as `mpv:property` events. */
  observe(name, format = MPV_FORMAT.DOUBLE) {
    if (!this.ctx) return;
    this.api.observeProperty(this.ctx, 0, name, format);
    this._observed.set(name, undefined);
  }

  _observeDefaults() {
    // double
    for (const p of ['time-pos', 'duration', 'volume', 'speed', 'chapter', 'demuxer-cache-time', 'audio-delay', 'sub-delay'])
      this.observe(p);
    // flag
    for (const p of ['pause', 'mute', 'eof-reached', 'core-idle', 'video-disabled-audio', 'paused-for-cache', 'demuxer-paused'])
      this.observe(p, MPV_FORMAT.FLAG);
    // string
    for (const p of ['media-title', 'path', 'video-params/codec', 'audio-params/codec', 'audio-params/channel-layout', 'video-params/pixelformat', 'sub-text', 'audio-device'])
      this.observe(p, MPV_FORMAT.STRING);
    // int
    for (const p of ['playlist-pos', 'playlist-count', 'video-params/w', 'video-params/h', 'dwidth', 'dheight'])
      this.observe(p, MPV_FORMAT.INT64);
  }

  // -------------------------------------------------------------------------
  // Event pump
  // -------------------------------------------------------------------------
  _drainEvents() {
    if (this.destroyed || !this.ctx) return;
    let guard = 0;
    for (;;) {
      let ev;
      try {
        ev = asPtr(this.api.waitEvent(this.ctx, 0));
      } catch (err) {
        this.emit('warning', `wait_event: ${err.message}`);
        return;
      }
      if (!ev) return;
      let id, error, data;
      try {
        id = koffi.decode(ev, 'int32', 1)[0];
      } catch (_) {
        return;
      }
      if (id === MPV_EVENT.NONE) return;
      try {
        error = koffi.decode(ev + 4, 'int32', 1)[0];
        data = asPtr(koffi.decode(ev + 16, 'void *', 1)[0]);
      } catch (_) {
        continue;
      }
      this._onEvent(id, error, data);
      if (++guard > 5000) return;
    }
  }

  _onEvent(id, error, data) {
    switch (id) {
      case MPV_EVENT.PROPERTY_CHANGE: {
        if (!validPtr(data)) return;
        // mpv_event_property { const char *name; mpv_format format; void *data; }
        // koffi decodes `char *` straight to a JS string.
        const name = koffi.decode(data, 'char *', 1)[0];
        if (!name) return;
        // mpv_event_property { const char *name; mpv_format format; void *data; }
        const format = koffi.decode(data + 8, 'int32', 1)[0];
        // `data` holds the ADDRESS OF the value, so it must be dereferenced
        // before the value itself can be read.
        const valuePtr = asPtr(koffi.decode(data + 16, 'void *', 1)[0]);
        const prev = this._observed.get(name);
        const value = this._readPropertyEvent(format, valuePtr);
        // `undefined` means "format we don't handle" - not a value change.
        if (value === undefined) return;
        if (prev !== value) {
          this._observed.set(name, value);
          this.emit('mpv:property', { name, value });
        }
        break;
      }
      case MPV_EVENT.FILE_LOADED:
        this.emit('mpv:file-loaded');
        break;
      case MPV_EVENT.END_FILE: {
        const reason = validPtr(data) ? koffi.decode(data, 'int32', 1)[0] : 0;
        const err = validPtr(data) ? koffi.decode(data + 4, 'int32', 1)[0] : 0;
        const entryId = validPtr(data) ? Number(koffi.decode(data + 8, 'int64', 1)[0]) : -1;
        this.emit('mpv:end-file', {
          reason,
          error: err,
          errorText: err < 0 ? this.errorString(err) : null,
          entryId,
        });
        break;
      }
      case MPV_EVENT.VIDEO_RECONFIG:
        this.emit('mpv:video-reconfig');
        break;
      case MPV_EVENT.SEEK:
        this.emit('mpv:seek');
        break;
      case MPV_EVENT.PLAYBACK_RESTART:
        this.emit('mpv:playback-restart');
        break;
      case MPV_EVENT.START_FILE:
        this.emit('mpv:start-file');
        break;
      case MPV_EVENT.LOG_MESSAGE:
        if (validPtr(data)) {
          // mpv_event_log_message { const char *prefix; const char *level;
          //                        const char *text; mpv_log_level log_level; }
          const level = koffi.decode(data + 8, 'char *', 1)[0] || '';
          const text = koffi.decode(data + 16, 'char *', 1)[0] || '';
          if (level === 'error' || level === 'fatal' || level === 'warn') {
            this.emit('mpv:log', `[${level}] ${text}`);
          }
        }
        break;
      default:
        break;
    }
  }

  /**
   * Decode the value pointer of a property-change event.
   *
   * We switch on the mpv_format mpv reports rather than on the property name:
   * the same property can change type over its lifetime (NULL -> flag ->
   * double), and guessing wrong means dereferencing a value pointer as the
   * wrong type, which is an access violation rather than a catchable error.
   */
_readPropertyEvent(format, dataPtr) {
    // NULL value: mpv is telling us the property is currently unset.
    if (!validPtr(dataPtr)) return null;
    try {
      switch (format) {
        case MPV_FORMAT.FLAG:
          return koffi.decode(dataPtr, 'int32', 1)[0] !== 0;
        case MPV_FORMAT.DOUBLE:
          return Number(koffi.decode(dataPtr, 'double', 1)[0]);
        case MPV_FORMAT.INT64:
          return Number(koffi.decode(dataPtr, 'int64', 1)[0]);
        case MPV_FORMAT.STRING:
        case MPV_FORMAT.OSD_STRING: {
          // `void *` reads the pointer value without following it, so it is
          // safe for a NULL check. koffi's `char *` decode *does* follow the
          // pointer, so the string must be read straight from dataPtr -
          // decoding it from the already-unwrapped address would dereference
          // twice and fault.
          const p = asPtr(koffi.decode(dataPtr, 'void *', 1)[0]);
          if (!validPtr(p)) return null;
          return koffi.decode(dataPtr, 'char *', 1)[0];
        }
        default:
          // NODE / NODE_ARRAY / BYTE_ARRAY would need mpv_node walking; we
          // do not observe any of those, so ignore rather than guess.
          return undefined;
      }
    } catch (_) {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // High level commands
  // -------------------------------------------------------------------------
  command(str) {
    if (!this.ctx) return -1;
    try {
      return this.api.commandString(this.ctx, str);
    } catch (err) {
      this.emit('warning', `command "${str}": ${err.message}`);
      return -1;
    }
  }

  // Playlist -----------------------------------------------------------------
  loadFile(file, opts = {}) {
    const sub = opts.subPath ? ` sub-files=${JSON.stringify(opts.subPath)}` : '';
    const start = opts.start ? ` start=${opts.start}` : '';
    this.command(`loadfile ${JSON.stringify(file)} replace${sub}${start}`);
  }
  appendFile(file) {
    this.command(`loadfile ${JSON.stringify(file)} append`);
  }
  playlistClear() {
    this.command('playlist-clear');
  }
  playlistMove(from, to) {
    this.command(`playlist-move ${from} ${to}`);
  }
  playlistRemove(idx) {
    this.command(`playlist-remove ${idx}`);
  }
  playlistShuffle() {
    this.command('playlist-shuffle');
  }
  setLoop(mode) {
    this.command(`loop-playlist ${mode === 'one' ? 'inf' : mode === 'all' ? 'inf' : 'no'}`);
    this.set('loop', mode === 'one' ? 'inf' : 'no');
  }
  jumpTo(idx) {
    this.command(`playlist-play-index ${idx}`);
  }

  // Transport ----------------------------------------------------------------
  play() {
    this.set('pause', 'no');
  }
  pause() {
    this.set('pause', 'yes');
  }
  togglePause() {
    this.command('cycle pause');
  }
  stop() {
    this.command('stop');
  }
  seek(sec, flags = 'absolute+exact') {
    this.command(`seek ${sec.toFixed(3)} ${flags}`);
  }
  seekRelative(delta) {
    this.command(`seek ${delta.toFixed(3)} relative+exact`);
  }
  setSpeed(x) {
    this.set('speed', x);
  }
  setVolume(v) {
    this.set('volume', Math.max(0, Math.min(150, v)));
  }
  setMuted(m) {
    this.set('mute', m ? 'yes' : 'no');
  }

  // Tracks -------------------------------------------------------------------
  setTrack(kind, id) {
    // kind: 'aid' | 'vid' | 'sid'  (or 'no' to disable)
    this.set(kind, id === 'no' ? 'no' : String(id));
  }
  cycleTrack(kind) {
    this.command(`cycle ${kind}`);
  }

  // Subtitles ----------------------------------------------------------------
  loadSubFile(path) {
    this.command(`sub-add ${JSON.stringify(path)} select`);
  }
  setSubScale(scale) {
    this.set('sub-scale', scale);
  }
  setSubDelay(sec) {
    this.set('sub-delay', sec);
  }
  setAudioDelay(sec) {
    this.set('audio-delay', sec);
  }
  setSubStyle({ font, size, color, outline, bold, italic, bg, bgOpacity, shadow, alignment } = {}) {
    if (font) this.set('sub-font', font);
    if (size) this.set('sub-font-size', size);
    if (color) this.set('sub-color', color);
    if (outline !== undefined) this.set('sub-outline', outline);
    if (bold !== undefined) this.set('sub-bold', bold ? 'yes' : 'no');
    if (italic !== undefined) this.set('sub-italic', italic ? 'yes' : 'no');
    if (bg) this.set('sub-back-color', bg);
    if (bgOpacity !== undefined) this.set('sub-opacity', bgOpacity);
    if (shadow !== undefined) this.set('sub-shadow', shadow ? 'yes' : 'no');
    if (alignment) this.set('sub-align-y', alignment);
  }

  // Video effects ------------------------------------------------------------
  setHwdec(mode) {
    this.set('hwdec', mode);
  }
  setGamma(v) {
    this.set('gamma', v);
  }
  setBrightness(v) {
    this.set('brightness', v);
  }
  setContrast(v) {
    this.set('contrast', v);
  }
  setSaturation(v) {
    this.set('saturation', v);
  }
  setHue(v) {
    this.set('hue', v);
  }
  setAudioFilter(filterStr) {
    this.set('af', filterStr || '');
  }
  setAudioSync(kind) {
    this.set('audio-sync', kind);
  }
  setAudioOutput(device) {
    this.set('audio-device', device || 'auto');
  }
  setVideoOutputDevice(key) {
    this.set('video-device', key || 'auto');
  }
  screenshot(path) {
    this.command(`screenshot-to-file ${JSON.stringify(path)} video`);
  }
  screenshotSubtitles(path) {
    this.command(`screenshot-to-file ${JSON.stringify(path)} subtitles`);
  }

  // Frames -------------------------------------------------------------------
  seekExactFrame(n) {
    this.command(`frame-step ${n}`);
  }

  destroy() {
    this.destroyed = true;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    if (this.ctx) {
      try {
        this.api.terminateDestroy(this.ctx);
      } catch (_) {
        try {
          this.api.destroy(this.ctx);
        } catch (__) {}
      }
      this.ctx = null;
    }
    this.ready = false;
  }
}

module.exports = { MpvEngine, MPV_FORMAT, MPV_EVENT, MPV_END_FILE_REASON, BASE_OPTIONS };