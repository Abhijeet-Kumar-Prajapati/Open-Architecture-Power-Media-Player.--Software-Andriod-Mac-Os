'use strict';
/**
 * Preload / context bridge.
 *
 * The renderer gets exactly this object and nothing else - no Node, no
 * require, no ipcRenderer. Every call is a named, validated channel.
 */

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  'mpv:property',
  'mpv:file-loaded',
  'mpv:end-file',
  'mpv:log',
  'media:open',
  'video:pointer',
  'library:progress',
  'convert:progress',
  'convert:done',
  'menu:command',
  'apm:error',
  'apm:fatal',
];

const api = {
  // --- app ---------------------------------------------------------------
  info: () => ipcRenderer.invoke('app:info'),

  // --- media -------------------------------------------------------------
  probe: (paths) => ipcRenderer.invoke('media:probe', paths),
  openDialog: () => ipcRenderer.invoke('media:openDialog'),
  openFolderDialog: () => ipcRenderer.invoke('media:openFolderDialog'),
  networkPrompt: () => ipcRenderer.invoke('media:networkPrompt'),
  reveal: (p) => ipcRenderer.invoke('media:reveal', p),
  parsePlaylist: (f) => ipcRenderer.invoke('media:parsePlaylist', f),

  // --- player ------------------------------------------------------------
  open: (files, opts) => ipcRenderer.invoke('player:open', files, opts),
  command: (name, args) => ipcRenderer.invoke('player:command', name, args || {}),
  state: () => ipcRenderer.invoke('player:state'),

  // --- video surface -----------------------------------------------------
  setVideoRect: (rect) => ipcRenderer.invoke('video:setRect', rect),
  setVideoVisible: (v) => ipcRenderer.invoke('video:setVisible', v),
  raiseVideo: () => ipcRenderer.invoke('video:raise'),

  // --- window ------------------------------------------------------------
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    fullscreen: (on) => ipcRenderer.invoke('window:fullscreen', on),
    alwaysOnTop: (on) => ipcRenderer.invoke('window:setAlwaysOnTop', on),
    devTools: () => ipcRenderer.invoke('window:openDevTools'),
  },

  // --- data --------------------------------------------------------------
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    watching: () => ipcRenderer.invoke('library:watching'),
    scan: (dir, recursive) => ipcRenderer.invoke('library:scan', dir, recursive),
    remove: (p) => ipcRenderer.invoke('library:remove', p),
    clear: () => ipcRenderer.invoke('library:clear'),
    folders: () => ipcRenderer.invoke('library:settings'),
  },
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    clear: () => ipcRenderer.invoke('recent:clear'),
    resume: (f) => ipcRenderer.invoke('recent:resume', f),
    forget: (f) => ipcRenderer.invoke('recent:forget', f),
  },
  thumbs: (items) => ipcRenderer.invoke('thumbs:get', items),

  // --- convert -----------------------------------------------------------
  convert: {
    presets: () => ipcRenderer.invoke('convert:presets'),
    start: (job) => ipcRenderer.invoke('convert:start', job),
    cancel: (id) => ipcRenderer.invoke('convert:cancel', id),
    pickOutput: (job) => ipcRenderer.invoke('convert:pickOutput', job),
  },

  // --- misc --------------------------------------------------------------
  formats: () => ipcRenderer.invoke('formats:report'),
  extensions: () => ipcRenderer.invoke('supported:extensions'),
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  },
  clipboard: (t) => ipcRenderer.invoke('clipboard:write', t),
  error: (title, content) => ipcRenderer.invoke('dialog:error', title, content),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),

  // --- events ------------------------------------------------------------
  on: (channel, listener) => {
    if (!EVENTS.includes(channel)) throw new Error(`unknown event channel: ${channel}`);
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('apm', api);