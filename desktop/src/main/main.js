'use strict';
/**
 * APM Open Player - Electron main process
 * ---------------------------------------------------------------------------
 * Owns the window, the native video host window, the libmpv instance and every
 * privileged operation (filesystem dialogs, thumbnails, transcoding, library
 * scanning). The renderer is sandboxed and talks to this file over IPC only.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const { MpvEngine, MPV_END_FILE_REASON } = require('./mpv-engine');
const { JsonStore } = require('./store');
const media = require('./media-info');
const { scanFolder, Library, Recents } = require('./library');
const { thumbnailFor } = require('./thumbs');
const { Transcoder } = require('./transcode');
const { buildMenu } = require('./menu');
const { SUPPORTED_FILTERS, SUPPORTED_EXTENSIONS } = require('./filters');
const win32 = require('./win32');

const IS_WINDOWS = process.platform === 'win32';
const DEV = process.argv.includes('--dev');
const SINGLE_INSTANCE = !process.argv.includes('--no-single-instance');

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let mainWindow = null;
let engine = null;
let videoHost = null;
let settings = null;
let library = null;
let recents = null;
let transcoder = null;
let pendingOpen = [];
let quitting = false;
const mainWindowReadyHooks = [];

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
if (SINGLE_INSTANCE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = extractFilesFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (files.length) handleOpenFiles(files);
    }
  });
}

function extractFilesFromArgv(argv) {
  return (argv || [])
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.url') === false)
    .filter((a) => {
      try {
        return fs.statSync(a).isFile();
      } catch (_) {
        return false;
      }
    });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const saved = settings.get('window', {});
  mainWindow = new BrowserWindow({
    width: saved.width || 1360,
    height: saved.height || 820,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: IS_WINDOWS
      ? { color: '#0d1017', symbolColor: '#c9d1e0', height: 44 }
      : undefined,
    trafficLightPosition: !IS_WINDOWS ? { x: 14, y: 15 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  // Attach the console bridge before the page loads so early renderer errors
  // (including the ones thrown during script evaluation) are never missed.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const where = `${sourceId}:${line}`;
    if (level >= 2) {
      console.error(`[renderer] ${message} (${where})`);
      if (smoke) smoke.errors.push(`renderer: ${message}`);
    } else {
      console.log(`[renderer] ${message} (${where})`);
    }
  });
  mainWindow.webContents.on('preload-error', (_e, p, err) => {
    console.error('[preload] ' + p + ' ' + err.message);
    if (smoke) smoke.errors.push(`preload: ${err.message}`);
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (saved.maximized) mainWindow.maximize();
    mainWindow.show();
    setTimeout(() => setupVideoHost(), 60);
  });

  mainWindow.webContents.once('did-finish-load', () => {
    for (const hook of mainWindowReadyHooks) {
      try { hook(); } catch (err) { console.error('[hook]', err); }
    }
    mainWindowReadyHooks.length = 0;
  });

  const persistBounds = debounce(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
    const b = mainWindow.getBounds();
    settings.set('window', { ...b, maximized: mainWindow.isMaximized() });
  }, 500);
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) mainWindow.on(ev, persistBounds);

  mainWindow.on('close', (e) => {
    if (quitting) return;
    if (settings.get('confirmOnQuit', false)) {
      e.preventDefault();
      dialog
        .showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          title: 'Quit APM Open Player',
          message: 'Close APM Open Player?',
          detail: 'Playback will stop and the player will close.',
        })
        .then(({ response }) => {
          if (response === 0) {
            quitting = true;
            mainWindow.close();
          }
        });
    } else {
      quitting = true;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  buildMenu({
    app,
    getWindow: () => mainWindow,
    engine: () => engine,
    renderer: () => mainWindow && mainWindow.webContents,
    settings,
    openFiles: () => handleOpenFiles(),
    openDialog: () => openFileDialog(),
    openFolderDialog: () => openFolderDialog(),
    openNetworkDialog: () => openNetworkDialog(),
    toggleFullscreen: () => toggleFullscreen(),
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
}

// ---------------------------------------------------------------------------
// Video host
// ---------------------------------------------------------------------------
function setupVideoHost() {
  if (!IS_WINDOWS || !mainWindow) return;
  // mpv binds to the host window at init time, so the host must exist exactly
  // once - recreating it would orphan the window mpv is parenting into.
  if (videoHost && videoHost.hwnd) {
    if (!engine) createEngine();
    return;
  }
  try {
    const parent = mainWindow.getNativeWindowHandle();
    const hwnd = Buffer.isBuffer(parent) ? Number(parent.readBigUInt64LE(0)) : Number(parent);
    if (!hwnd) throw new Error('could not read the window handle');

    videoHost = new win32.VideoHost(hwnd);
    videoHost.hide();

    videoHost.onCommand((name, arg) => {
      if (!mainWindow) return;
      mainWindow.webContents.send('video:pointer', { name, arg });
    });

    if (!engine) createEngine();
    else if (engine) {
      // engine already running: nothing to reattach, mpv keeps its wid.
    }
  } catch (err) {
    console.error('[video-host] falling back to windowed video:', err.message);
    dialog.showErrorBox('Video output problem', `Could not embed the video surface:\n${err.message}`);
  }
}

function createEngine() {
  let wid;
  if (videoHost && videoHost.hwnd) wid = videoHost.hwnd;

  const mpvOptions = {};
  const hwdec = settings.get('hwdec', 'auto-safe');
  if (hwdec && hwdec !== 'no') mpvOptions.hwdec = hwdec;
  const vo = settings.get('videoOutput', 'gpu');
  if (vo && vo !== 'auto') mpvOptions.vo = vo;

  if (process.platform === 'darwin') {
    // There is no embedded surface on macOS: mpv owns a real Cocoa window and
    // we size it to something sensible. The controller window stays on top of
    // the library/playlist, so this reads as a player with a companion panel.
    mpvOptions['force-window'] = 'immediate';
    mpvOptions['window-size'] = '1280x720';
    mpvOptions['geometry'] = '80%+0:0:0/85%+0:0:0';
    mpvOptions['autofit'] = '90%x80%+0+0';
    mpvOptions['background'] = '#000000';
    mpvOptions['osd-fractions'] = 'no';
  }

  engine = new MpvEngine({ wid, mpvOptions });
  engine.on('mpv:property', (e) => send('mpv:property', e));
  engine.on('mpv:file-loaded', () => {
    send('mpv:file-loaded');
    applySettingsToEngine();
    recordResume();
  });
  engine.on('mpv:end-file', (e) => {
    send('mpv:end-file', e);
    if (e.reason === MPV_END_FILE_REASON.ERROR) send('apm:error', { message: e.errorText || 'Playback failed.' });
    saveResumePosition();
  });
  engine.on('mpv:log', (t) => send('mpv:log', t));
  engine.on('warning', (t) => console.warn('[mpv]', t));

  try {
    engine.init();
  } catch (err) {
    // Most likely libmpv is not installed. Surface an actionable message
    // instead of a crash or a silent blank window.
    send('apm:fatal', { message: err.message });
    console.error('[engine]', err.message);
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'APM Open Player needs the mpv engine',
        message: 'The playback engine could not be loaded.',
        detail: err.message,
        buttons: ['OK'],
      });
    }
    throw err;
  }
  engine.set('volume', settings.get('volume', 80));
  return engine;
}

function applySettingsToEngine() {
  if (!engine) return;
  engine.setSubStyle(settings.get('subtitleStyle', {}));
  engine.setAudioFilter(settings.get('audioFilter', ''));
  engine.setAudioDelay(settings.get('audioDelay', 0));
  engine.setSubDelay(settings.get('subDelay', 0));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// Resume positions
// ---------------------------------------------------------------------------
function resumeKey(file) {
  return path.resolve(file).toLowerCase();
}

function recordResume() {
  if (!engine) return;
  const file = engine.getString('path');
  if (!file) return;
  recents.touch(file, {
    name: path.basename(file),
    duration: engine.getNumber('duration', 0),
  });
}

function saveResumePosition() {
  if (!engine) return;
  const file = engine.getString('path');
  const pos = engine.getNumber('time-pos', 0);
  if (!file) return;
  if (pos > 5) recents.setResume(file, pos);
  else recents.setResume(file, 0);
  recordResume();
}

// ---------------------------------------------------------------------------
// Opening media
// ---------------------------------------------------------------------------
async function openFileDialog() {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open media',
    properties: ['openFile', 'multiSelections'],
    filters: SUPPORTED_FILTERS,
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  return { canceled: false, files: res.filePaths };
}

async function openFolderDialog() {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Add folder to library',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  return { canceled: false, folders: res.filePaths };
}

async function openNetworkDialog() {
  const res = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Open network stream',
    message: 'Open a network stream',
    detail:
      'Paste a URL below in the "Network" box. Supported: http(s)://, rtsp://, rtmp://, rtmps://, udp://, tcp://, srt://, mms:// and HLS/DASH manifests.\n\n' +
      'The dialog will open in the app so you can paste.',
    buttons: ['OK'],
  });
  return { shown: res.response === 0 };
}

function handleOpenFiles(files, opts = {}) {
  if (!files || !files.length) return;
  pendingOpen = files;
  if (mainWindow) {
    send('media:open', { files, autoplay: opts.autoplay !== false });
    if (!engine) createEngine();
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      throw err;
    }
  });

  handle('app:info', async () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    isWindows: IS_WINDOWS,
    isMac: process.platform === 'darwin',
    // On macOS mpv owns a real Cocoa window; on Windows the video is embedded in a
    // child HWND. This is a property of the platform, not of whether the host
    // window happens to exist yet - the host is created slightly after the
    // renderer boots, so reporting it live would make the UI give up on
    // positioning the video for good.
    videoEmbedded: IS_WINDOWS,
    mpvVersion: engine ? engine.getString('mpv-version') : null,
    ffmpegVersion: engine ? engine.getString('ffmpeg-version') : null,
    userData: app.getPath('userData'),
    dev: DEV,
  }));

  handle('media:probe', async (paths) => {
    const list = Array.isArray(paths) ? paths : [paths];
    return Promise.all(list.map((p) => media.probe(p)));
  });

  handle('media:openDialog', () => openFileDialog());
  handle('media:openFolderDialog', () => openFolderDialog());
  handle('media:networkPrompt', () => openNetworkDialog());

  handle('media:reveal', async (p) => {
    shell.showItemInFolder(p);
    return true;
  });

  handle('media:parsePlaylist', async (file) => {
    const text = await fs.promises.readFile(file, 'utf8').catch(() => '');
    const dir = path.dirname(file);
    const entries = [];
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^[A-Za-z]+:/.test(line)) {
        entries.push({ path: line, name: path.basename(new URL(line).pathname) || line });
      } else {
        const full = path.resolve(dir, line);
        entries.push({ path: full, name: path.basename(full) });
      }
    }
    return entries;
  });

  // --- player -------------------------------------------------------------
  const ensureEngine = () => {
    if (!engine) createEngine();
    return engine;
  };

  handle('player:open', async (files, opts = {}) => {
    const e = ensureEngine();
    const list = Array.isArray(files) ? files : [files];
    const infos = await Promise.all(list.map((p) => media.probe(p)));
    recents.touchAll(list);
    return { infos, first: list[0], start: opts.start || 0 };
  });

  handle('player:command', async (name, args = {}) => {
    const e = ensureEngine();
    switch (name) {
      case 'play': e.play(); break;
      case 'pause': e.pause(); break;
      case 'togglePause': e.togglePause(); break;
      case 'stop': e.stop(); break;
      case 'quit':
        quitting = true;
        app.quit();
        break;
      case 'next': e.command('playlist-next'); break;
      case 'prev': e.command('playlist-prev'); break;
      case 'seek': e.seek(Number(args.to)); break;
      case 'seekRelative': e.seekRelative(Number(args.by)); break;
      case 'seekPercent': e.command(`seek ${Number(args.percent)} absolute+exact`); break;
      case 'jumpForward': e.command(`seek ${settings.get('jumpForward', 10)} absolute+exact`); break;
      case 'jumpBackward': e.command(`seek -${settings.get('jumpBackward', 10)} absolute+exact`); break;
      case 'jumpLongForward': e.command(`seek ${settings.get('jumpLongForward', 60)} absolute+exact`); break;
      case 'jumpLongBackward': e.command(`seek -${settings.get('jumpLongBackward', 60)} absolute+exact`); break;
      case 'jumpChapterForward': e.command('add chapter 1'); break;
      case 'jumpChapterBackward': e.command('add chapter -1'); break;
      case 'frameStep': e.seekExactFrame(1); break;
      case 'frameBackStep': e.seekExactFrame(-1); break;
      case 'volumeSet': e.setVolume(Number(args.value)); settings.set('volume', Number(args.value)); break;
      case 'volumeUp': e.command('add volume 5'); break;
      case 'volumeDown': e.command('add volume -5'); break;
      case 'muteToggle': e.command('cycle mute'); break;
      case 'speedSet': e.setSpeed(Number(args.value)); break;
      case 'speedReset': e.setSpeed(1); break;
      case 'speedUp': e.command('add speed 0.25'); break;
      case 'speedDown': e.command('add speed -0.25'); break;
      case 'audioTrack': e.setTrack('aid', args.id); break;
      case 'videoTrack': e.setTrack('vid', args.id); break;
      case 'subTrack': e.setTrack('sid', args.id); break;
      case 'audioTrackNext': e.cycleTrack('aid'); break;
      case 'subTrackNext': e.cycleTrack('sid'); break;
      case 'audioDelaySet': e.setAudioDelay(Number(args.value)); settings.set('audioDelay', Number(args.value)); break;
      case 'subDelaySet': e.setSubDelay(Number(args.value)); settings.set('subDelay', Number(args.value)); break;
      case 'audioSync': e.setAudioSync(args.mode || 'default'); break;
      case 'loadSubtitle': e.loadSubFile(args.path); break;
      case 'unloadSubtitle': e.set('sid', 'no'); break;
      case 'subtitleStyle': {
        const style = { ...settings.get('subtitleStyle', {}), ...args };
        settings.set('subtitleStyle', style);
        e.setSubStyle(style);
        break;
      }
      case 'subScale': e.setSubScale(Number(args.value)); break;
      case 'hwdec': e.setHwdec(args.value); settings.set('hwdec', args.value); break;
      case 'videoOutput': e.set('vo', args.value); settings.set('videoOutput', args.value); break;
      case 'audioDevice': e.setAudioOutput(args.value); break;
      case 'videoDevice': e.setVideoOutputDevice(args.value); break;
      case 'audioFilter': e.setAudioFilter(args.value || ''); settings.set('audioFilter', args.value || ''); break;
      case 'equalizer': e.setAudioFilter(args.filter || ''); settings.set('equalizer', args.values); break;
      case 'brightness': e.setBrightness(Number(args.value)); break;
      case 'contrast': e.setContrast(Number(args.value)); break;
      case 'saturation': e.setSaturation(Number(args.value)); break;
      case 'hue': e.setHue(Number(args.value)); break;
      case 'gamma': e.setGamma(Number(args.value)); break;
      case 'screenshot': {
        const out = args.path || path.join(app.getPath('pictures'), `APM-${Date.now()}.png`);
        e.screenshot(out);
        return { path: out };
      }
      case 'screenshotSubtitles': {
        const out = args.path || path.join(app.getPath('pictures'), `APM-${Date.now()}-subs.png`);
        e.screenshotSubtitles(out);
        return { path: out };
      }
      case 'loop': e.setLoop(args.mode || 'off'); settings.set('loopMode', args.mode || 'off'); break;
      case 'shuffle': e.playlistShuffle(); break;
      case 'property': e.set(args.name, args.value); break;
      case 'loadfile': e.command(args.string); break;
      case 'command': e.command(args.string); break;
      case 'getString': return e.getString(args.name);
      case 'getNumber': return e.getNumber(args.name);
      case 'getFlag': return e.getFlag(args.name);
      default:
        throw new Error(`unknown player command: ${name}`);
    }
    return true;
  });

  handle('player:state', async () => {
    if (!engine) return null;
    return {
      path: engine.getString('path'),
      mediaTitle: engine.getString('media-title'),
      timePos: engine.getNumber('time-pos', 0),
      duration: engine.getNumber('duration', 0),
      pause: engine.getFlag('pause', true),
      mute: engine.getFlag('mute', false),
      volume: engine.getNumber('volume', 0),
      speed: engine.getNumber('speed', 1),
      videoCodec: engine.getString('video-params/codec'),
      audioCodec: engine.getString('audio-params/codec'),
      width: engine.getNumber('video-params/w', 0),
      height: engine.getNumber('video-params/h', 0),
      audioDelay: engine.getNumber('audio-delay', 0),
      subDelay: engine.getNumber('sub-delay', 0),
      hwdec: engine.getString('hwdec-current'),
      playlistCount: engine.getNumber('playlist-count', 0),
      playlistPos: engine.getNumber('playlist-pos', -1),
    };
  });

  // --- video surface ------------------------------------------------------
  handle('video:setRect', async (rect) => {
    if (smoke) smoke.videoRect = rect;
    if (!videoHost) return false;
    const scale = IS_WINDOWS ? currentScaleFactor() : 1;
    videoHost.setRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    return true;
  });

  handle('video:setVisible', async (v) => {
    if (smoke) smoke.videoVisible = !!v;
    if (!videoHost) return false;
    v ? videoHost.show() : videoHost.hide();
    return true;
  });

  handle('video:raise', async () => {
    if (videoHost) videoHost.raise();
    return true;
  });

  // --- window -------------------------------------------------------------
  handle('window:minimize', () => mainWindow.minimize());
  handle('window:maximize', () => (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
  handle('window:close', () => mainWindow.close());
  handle('window:isMaximized', () => mainWindow.isMaximized());

  handle('window:fullscreen', async (on) => {
    mainWindow.setFullScreen(!!on);
    return mainWindow.isFullScreen();
  });

  handle('window:setAlwaysOnTop', async (on) => {
    mainWindow.setAlwaysOnTop(!!on, 'floating');
    return true;
  });

  handle('window:openDevTools', () => mainWindow.webContents.openDevTools({ mode: 'detach' }));

  // --- settings -----------------------------------------------------------
  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    settings.set(patch);
    applySettingsToEngine();
    return settings.get();
  });

  // --- library ------------------------------------------------------------
  handle('library:list', () => library.list());
  handle('library:watching', () => library.listWatching(settings.get('watchFolders', [])));
  handle('library:scan', async (dir, recursive) => {
    const found = await scanFolder(dir, { recursive: !!recursive, onProgress: (p) => send('library:progress', p) });
    library.addAll(found);
    return { added: found.length, total: library.list().length };
  });
  handle('library:remove', (p) => library.remove(p));
  handle('library:clear', () => library.clear());
  handle('library:settings', () => settings.get('watchFolders', []));

  // --- recents ------------------------------------------------------------
  handle('recent:list', () => recents.list());
  handle('recent:clear', () => recents.clear());
  handle('recent:resume', (file) => recents.getResume(file));
  handle('recent:forget', (file) => recents.remove(file));

  // --- thumbnails ---------------------------------------------------------
  handle('thumbs:get', async (items) => {
    const out = {};
    for (const it of items) out[it.path] = await thumbnailFor(it.path, it.time || 10, engine);
    return out;
  });

  // --- conversion ---------------------------------------------------------
  handle('convert:probe', async (file) => media.probe(file));
  handle('convert:start', async (job) => {
    transcoder.ensure();
    const id = transcoder.start(job, (p) => send('convert:progress', { id, ...p }), (r) => send('convert:done', r));
    return { id };
  });
  handle('convert:cancel', (id) => transcoder.cancel(id));
  handle('convert:presets', () => Transcoder.presets());
  handle('convert:pickOutput', async (job) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save converted file',
      defaultPath: path.join(job.outputDir || os.homedir(), Transcoder.defaultName(job)),
      filters: Transcoder.outputFilters(job),
    });
    return res.canceled ? null : res.filePath;
  });

  // --- misc ---------------------------------------------------------------
  handle('shell:openPath', async (p) => shell.openPath(p));
  handle('shell:showItem', (p) => shell.showItemInFolder(p));
  handle('clipboard:write', (t) => clipboard.writeText(String(t || '')));
  handle('supported:extensions', () => SUPPORTED_EXTENSIONS);
  handle('formats:report', () => formatReport());
  handle('dialog:error', (title, content) => {
    if (mainWindow) dialog.showMessageBox(mainWindow, { type: 'error', title, message: title, detail: content, buttons: ['OK'] });
  });
  handle('dialog:confirm', async (opts) => {
    const r = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['OK', 'Cancel'], cancelId: 1, ...opts });
    return r.response === 0;
  });
}

function currentScaleFactor() {
  try {
    const hwnd = videoHost && videoHost.parent;
    if (hwnd) return videoHost.scaleFactor;
    const b = mainWindow.getBounds();
    const d = screen.getDisplayMatching(b);
    return d.scaleFactor || 1;
  } catch (_) {
    return 1;
  }
}

/** Everything the player can open, for the Help/About "supported formats" page. */
function formatReport() {
  return {
    videoContainers: Object.entries(media.CONTAINERS)
      .filter(([k]) => !['subtitle', 'm3u', 'pls', 'cue'].includes(k))
      .map(([k, v]) => ({ name: k, exts: v })),
    videoCodecs: media.CODEC_FAMILIES.video,
    audioCodecs: media.CODEC_FAMILIES.audio,
    subtitleCodecs: media.CODEC_FAMILIES.subtitle,
    extensions: SUPPORTED_EXTENSIONS,
  };
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err);
  if (smoke) smoke.errors.push(`uncaught: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Automated smoke test
// ---------------------------------------------------------------------------
/**
 * When APM_SMOKE is set the app opens a known file, watches the native video
 * surface for a few seconds, prints a machine-readable result and exits. This
 * is how CI (and tools/smoke-electron.js) verify that the Electron UI, the
 * Win32 video host and libmpv are actually wired together - the headless
 * decode test cannot cover the window embedding.
 */
const smoke = process.env.APM_SMOKE ? { errors: [], started: Date.now(), fileLoaded: false, videoRect: null, videoVisible: false } : null;
if (smoke) {
  smoke.rendererReady = false;
  smoke.videoHostCreated = false;
  smoke.mpvWindowHandle = null;
  smoke.hwndValid = false;
  mainWindowReadyHooks.push(() => {
    smoke.rendererReady = true;
    // ready-to-show (which normally creates the host) may not have fired yet.
    if (!videoHost) {
      try { setupVideoHost(); } catch (err) { smoke.errors.push('videoHost: ' + err.message); }
    }
    if (videoHost && videoHost.hwnd) {
      smoke.videoHostCreated = true;
      smoke.mpvWindowHandle = String(videoHost.hwnd);
      smoke.hwndValid = !!videoHost.hwnd;
    }
    const e = ensureEngineForSmoke();
    e.on('mpv:file-loaded', () => { smoke.fileLoaded = true; });
    setTimeout(() => {
      e.loadFile(process.env.APM_SMOKE_FILE);
      // The renderer learns about the file through the normal IPC path; nudge
      // it to (re)measure the video surface once the file is open.
      send('media:open', { files: [process.env.APM_SMOKE_FILE], autoplay: true });
    }, 900);
    setTimeout(() => {
      smoke.timePos = e.getNumber('time-pos', -1);
      smoke.duration = e.getNumber('duration', -1);
      smoke.pause = e.getFlag('pause', null);
      smoke.enginePath = e.getString('path');
      smoke.engineIdle = e.getFlag('core-idle', null);

      // Visual evidence: ask mpv to decode one real frame, and capture the UI.
      const uiShot = path.resolve(app.getAppPath(), '..', 'smoke-ui.png');
      const frameShot = path.resolve(app.getAppPath(), '..', 'smoke-frame.png');
      try {
        e.screenshot(frameShot);
        smoke.frameShot = frameShot;
      } catch (err) {
        smoke.errors.push('screenshot: ${err.message}');
      }

      const probeRenderer =
        'JSON.stringify({apm:typeof window.apm,util:typeof window.APMUtil,state:typeof window.State,' +
        'player:typeof window.Player,lists:typeof window.Lists,dialogs:typeof window.APMDialogs,' +
        'app:typeof window.APMApp,rect:(function(r){return{x:Math.round(r.x),y:Math.round(r.y),' +
        'w:Math.round(r.width),h:Math.round(r.height)}})(document.getElementById("mediaArea").getBoundingClientRect()),' +
        'title:(document.getElementById("npTitle")||{}).textContent||"",' +
        'time:(document.getElementById("timeNow")||{}).textContent||"",' +
        'total:(document.getElementById("timeTotal")||{}).textContent||""})';

      const steps = [];
      // Controls auto-hide during playback; reveal them first so the capture
      // shows the full transport bar rather than only the video area. This has
      // to complete *before* capturePage, so the steps are chained.
      steps.push(mainWindow.webContents
        .executeJavaScript(
          // Stop the controls auto-hiding so a capture is deterministic.
          'window.Player && (Player._hideDelay = 1e9, Player._reveal && Player._reveal())'
        )
        .catch(() => {})
        .then(() => new Promise((r) => setTimeout(r, 350)))
        .then(() => mainWindow.webContents.capturePage())
        .then((img) => {
          // toPNG() returns a Buffer synchronously in current Electron.
          fs.writeFileSync(uiShot, img.toPNG());
          smoke.uiShot = uiShot;
        })
        .catch((err) => smoke.errors.push('capturePage: ' + err.message)));
      steps.push(mainWindow.webContents.executeJavaScript(probeRenderer)
        .then((v) => { smoke.rendererGlobals = JSON.parse(v); })
        .catch((err) => smoke.errors.push('executeJavaScript: ' + err.message)));

      // Exercise the ⋯ menu, because its submenu stacking is easy to break in
      // a way no other check notices: opening "Subtitles" replaces the parent
      // menu, and Escape stops closing anything.
      steps.push(mainWindow.webContents
        .executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const more = document.getElementById('btnMore');
          more.click();
          await sleep(120);
          const menuCount = () => document.querySelectorAll('#layerHost .popover').length;
          const opened = menuCount();

          // A submenu item: the parent menu must survive behind it.
          const subs = [...document.querySelectorAll('#layerHost .pop-item')]
            .find((b) => b.textContent.trim() === 'Subtitles');
          if (subs) subs.click();
          await sleep(120);
          const stacked = menuCount();

          // Escape must close everything, not be swallowed.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(120);
          const afterEscape = menuCount();

          // And the menu must reopen afterwards, i.e. nothing was wedged shut.
          more.click();
          await sleep(120);
          const reopened = menuCount();
          window.APMDialogs.closePopover();
          await sleep(60);
          const closed = menuCount();

          return JSON.stringify({ opened, stacked, afterEscape, reopened, closed,
                                 submenuOpened: !!subs });
        })()`)
        .then((v) => { smoke.menu = JSON.parse(v); })
        .catch((err) => smoke.errors.push('menu probe: ' + err.message)));

      Promise.all(steps).finally(finish);

      function finish() {
        const menu = smoke.menu || {};
        // Opening the menu, stacking a submenu behind it, and closing both with
        // one Escape is the whole contract.
        const menuOk = menu.opened === 1 && menu.stacked === 2 &&
                       menu.afterEscape === 0 && menu.reopened === 1 && menu.closed === 0;
        smoke.ok = smoke.rendererReady && smoke.videoHostCreated && smoke.hwndValid &&
                   smoke.fileLoaded && smoke.timePos > 0 &&
                   !!smoke.videoRect && !!smoke.videoVisible &&
                   menuOk &&
                   smoke.errors.length === 0;
        console.log('APM_SMOKE_RESULT ' + JSON.stringify(smoke));
        setTimeout(() => app.exit(smoke.ok ? 0 : 1), 300);
      }
    }, 7000);
  });
}

function ensureEngineForSmoke() {
  if (!engine) createEngine();
  return engine;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  settings = new JsonStore(userData, 'settings.json', {
    volume: 80,
    hwdec: 'auto-safe',
    videoOutput: 'gpu',
    jumpForward: 10,
    jumpBackward: 10,
    jumpLongForward: 60,
    jumpLongBackward: 60,
    resumePlayback: true,
    subtitleFontSize: 32,
    subtitleStyle: {
      font: '',
      size: 32,
      color: '#ffffff',
      outline: 2,
      bold: false,
      italic: false,
      shadow: true,
      bgOpacity: 0.6,
    },
    watchFolders: [],
    recentLimit: 40,
  });
  recents = new Recents(new JsonStore(userData, 'recents.json', { items: [] }), settings.get('recentLimit', 40));
  library = new Library(new JsonStore(userData, 'library.json', { items: [] }), settings);
  transcoder = new Transcoder(() => engine);

  nativeTheme.themeSource = settings.get('theme', 'dark');

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('open-file', (event, file) => {
  event.preventDefault();
  handleOpenFiles([file]);
});

app.on('before-quit', () => {
  quitting = true;
  saveResumePosition();
  if (engine) engine.destroy();
  if (recents) recents.saveNow();
  if (settings) settings.saveNow();
  if (library) library.save();
});

function toggleFullscreen() {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

// Files passed on the command line (file association / "open with").
const cliFiles = extractFilesFromArgv(process.argv);
if (cliFiles.length) {
  app.whenReady().then(() => handleOpenFiles(cliFiles));
  process.argv.push(...cliFiles);
}