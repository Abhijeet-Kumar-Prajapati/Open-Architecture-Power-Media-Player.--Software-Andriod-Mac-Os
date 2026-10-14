'use strict';
(function () {
/**
 * Renderer bootstrap: wire IPC events to state, wire menu commands, handle
 * the omni-search bar, and start the app.
 */

const { $, $$, el, debounce, throttle, toast, notice, isNetworkUrl, fileExt } = window.APMUtil;

const App = {
  async init() {
    const info = await window.apm.info();
    if (info.isMac) document.body.classList.add('is-mac');
    State.videoEmbedded = info.videoEmbedded !== false;

    State.settings = await window.apm.settings.get();
    if (State.settings.sidebarVisible === false) {
      State.sidebarVisible = false;
      document.body.classList.add('sidebar-hidden');
    }

    Player.init();
    Lists.init();

    this.bindSearch();
    this.bindGlobalButtons();
    this.bindIpc();
    this.bindMenuCommands();
    this.bindDragReorderGuard();

    await Promise.all([this.loadLibrary(), this.loadRecents()]);
    Player.layout();
  },

  // ── data ───────────────────────────────────────────────────────────────
  async loadLibrary() {
    try {
      State.library = await window.apm.library.list();
      State.watching = await window.apm.library.watching();
      Lists.render();
    } catch (err) {
      console.error('[library]', err);
    }
  },

  async loadRecents() {
    try {
      State.recents = await window.apm.recent.list();
      Lists.render();
    } catch (err) {
      console.error('[recents]', err);
    }
  },

  // ── opening ────────────────────────────────────────────────────────────
  async openFiles() {
    const r = await window.apm.openDialog();
    if (r.canceled || !r.files.length) return;
    await this.openPaths(r.files, { resume: true });
  },

  async openFolder() {
    const r = await window.apm.openFolderDialog();
    if (r.canceled || !r.folders.length) return;
    for (const f of r.folders) {
      const res = await window.apm.library.scan(f, true);
      toast(`Added ${res.added} file(s) from ${f.split(/[\\/]/).pop()}`, 'is-good', 3500);
    }
    await this.loadLibrary();
    Lists.showPanel('library');
  },

  async addWatchFolder() {
    const r = await window.apm.openFolderDialog();
    if (r.canceled || !r.folders.length) return;
    const settings = State.settings;
    const folders = settings.watchFolders || [];
    for (const p of r.folders) {
      if (!folders.some((f) => f.path.toLowerCase() === p.toLowerCase())) folders.push({ path: p, added: Date.now() });
    }
    settings.watchFolders = folders;
    await window.apm.settings.set({ watchFolders: folders });
    toast('Scanning folder…', '', 2000);
    await window.apm.library.scan(r.folders[0], true);
    await this.loadLibrary();
    Lists.showPanel('library');
    toast('Library updated', 'is-good');
  },

  async openPaths(paths, { resume = false } = {}) {
    if (!paths || !paths.length) return;
    const first = paths[0];

    if (isNetworkUrl(first)) {
      await Player.playFiles(paths);
      return;
    }

    // Playlist file → expand.
    if (['m3u', 'm3u8', 'pls', 'cue'].includes(fileExt(first))) {
      const entries = await window.apm.parsePlaylist(first);
      const local = entries.filter((e) => !isNetworkUrl(e.path)).map((e) => e.path);
      if (local.length) return this.openPaths(local, { resume });
      if (entries.length) return Player.playFiles(entries.map((e) => e.path));
      return toast('Playlist is empty', 'is-error');
    }

    // Subtitle dropped onto the window while playing.
    if (!State.hasMedia && ['srt', 'ass', 'ssa', 'sub', 'vtt'].includes(fileExt(first))) {
      return toast('Open a video first — a subtitle needs something to sit on', 'is-error');
    }

    let start = 0;
    if (resume && State.settings.resumePlayback) {
      const pos = await window.apm.recent.resume(first);
      if (pos > 5) start = pos;
    }

    await Player.playFiles(paths, { start });
    this.loadRecents();
  },

  // ── search / omni bar ──────────────────────────────────────────────────
  bindSearch() {
    const input = $('#searchInput');
    const clear = $('#searchClear');
    input.oninput = () => { clear.hidden = !input.value; };
    clear.onclick = () => { input.value = ''; clear.hidden = true; input.focus(); };
    input.onkeydown = async (e) => {
      const v = input.value.trim();
      if (e.key === 'Enter') {
        if (!v) return;
        if (isNetworkUrl(v)) {
          input.value = '';
          clear.hidden = true;
          return Player.playFiles([v]);
        }
        // Treat it as a quick filter across library + recents + playlist.
        State.filter = v.toLowerCase();
        $('#sideFilter').value = v;
        Lists.showPanel('library');
        return;
      }
      if (e.key === 'Escape') {
        input.value = '';
        clear.hidden = true;
        input.blur();
      }
    };
  },

  // ── global buttons ─────────────────────────────────────────────────────
  bindGlobalButtons() {
    $('#btnOpenFile').onclick = () => this.openFiles();
    $('#btnOpenNetwork').onclick = () => window.APMDialogs.openNetwork();
    $('#btnToggleSidebar').onclick = () => this.toggleSidebar();
    $('#btnEmptyOpen').onclick = () => this.openFiles();
    $('#btnEmptyFolder').onclick = () => this.openFolder();
    $('#btnEmptyFormats').onclick = () => window.APMDialogs.openFormats();
  },

  toggleSidebar() {
    State.sidebarVisible = !State.sidebarVisible;
    document.body.classList.toggle('sidebar-hidden', !State.sidebarVisible);
    $('#btnToggleSidebar').classList.toggle('is-on', !State.sidebarVisible);
    setTimeout(() => Player.layout(), 220);
    window.apm.settings.set({ sidebarVisible: State.sidebarVisible });
  },

  async toggleAlwaysOnTop() {
    State.alwaysOnTop = !State.alwaysOnTop;
    await window.apm.window.alwaysOnTop(State.alwaysOnTop);
    window.apm.settings.set({ alwaysOnTop: State.alwaysOnTop });
    toast(`Always on top ${State.alwaysOnTop ? 'on' : 'off'}`);
  },

  bindDragReorderGuard() {
    // Keep native drag from navigating the window when a file is dropped
    // outside the playlist list.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  },

  // ── IPC wiring ─────────────────────────────────────────────────────────
  bindIpc() {
    window.apm.on('mpv:property', ({ name, value }) => State.applyProperty(name, value));

    window.apm.on('mpv:file-loaded', async () => {
      Player.layout();
      const info = State.info;
      if (info) {
        State.audioTracks = info.audio || [];
        State.videoTracks = info.video ? [info.video] : [];
        State.subtitleTracks = info.subtitles || [];
      }
      State.emit(true);
      // Once a file is open the control bar should not auto-hide immediately.
      if (Player._reveal) Player._reveal();
    });

    window.apm.on('mpv:end-file', (e) => {
      // Reason values come straight from mpv: EOF=0, STOP=2, QUIT=3,
      // ERROR=4, REDIRECT=5 (note the gaps).
      if (e.reason === 4) {
        notice(`Playback error: ${e.errorText || 'unknown error'}`, 'error', null, 6000);
      }
      if (e.reason === 0) {
        // Reached the end of the file - advance unless this was the last one.
        if (State.playlist.length > 1 && State.playlistIndex < State.playlist.length - 1) {
          Player.next();
        } else if (State.loopMode === 'all') {
          Player.playIndex(0);
        } else {
          Player.paint();
        }
      }
      Player.layout();
    });

    window.apm.on('video:pointer', ({ name, arg }) => {
      if (name === 'double-click') return Player.toggleFullscreen();
      if (name === 'pointer-down') return window.apm.command('togglePause');
      if (name === 'wheel') {
        // Vertical wheel over the picture = volume; shift+wheel = brightness.
        const cmd = 'volumeSet';
        const current = State.volume;
        window.apm.command(cmd, { value: Math.max(0, Math.min(125, current + (arg > 0 ? -5 : 5))) });
      }
    });

    window.apm.on('media:open', ({ files }) => this.openPaths(files, { resume: true }));

    window.apm.on('library:progress', (p) => {
      if (p.phase === 'probe') notice(`Indexing ${p.done}/${p.total}…`, '', null, 0);
      if (p.phase === 'done') { window.APMUtil.clearNotice(); this.loadLibrary(); }
    });

    window.apm.on('apm:error', ({ message }) => toast(message, 'is-error', 6000));

    // A missing libmpv is fatal but recoverable: tell the user exactly what to
    // do rather than leaving a blank window.
    window.apm.on('apm:fatal', ({ message }) => {
      toast(message, 'is-error', 20000);
      window.APMDialogs.engineMissing(message);
    });

    // On macOS the picture lives in mpv's own window, so mark the media area
    // once a file with video is actually playing.
    if (!State.videoEmbedded) {
      window.apm.on('mpv:file-loaded', () => {
        const hasVideo = State.info && State.info.hasVideo !== false;
        State.externalVideoWindow = !!hasVideo;
        this.toggleMacVideoHint();
        Player.layout();
      });
    }

    window.apm.on('mpv:log', (text) => {
      const t = String(text).toLowerCase();
      if (t.includes('error') || t.includes('failed')) console.debug('[mpv]', text);
    });
  },

  // ── menu commands ──────────────────────────────────────────────────────
  bindMenuCommands() {
    window.apm.on('menu:command', ({ name, args }) => {
      const cmd = (n, a) => window.apm.command(n, a || {});
      switch (name) {
        case 'openMultiple': this.openFiles(); break;
        case 'openDisc': toast('Insert the disc, then use Open File to pick a title', '', 3500); break;
        case 'openNetwork': window.APMDialogs.openNetwork(); break;
        case 'openClipboardUrl': this.openClipboardUrl(); break;
        case 'savePlaylist': this.savePlaylist(); break;
        case 'openConverter': window.APMDialogs.openConverter(); break;
        case 'togglePause': cmd('togglePause'); break;
        case 'stop': cmd('stop'); break;
        case 'next': Player.next(); break;
        case 'prev': Player.previous(); break;
        case 'jumpForward': cmd('jumpForward'); break;
        case 'jumpBackward': cmd('jumpBackward'); break;
        case 'jumpLongForward': cmd('jumpLongForward'); break;
        case 'jumpLongBackward': cmd('jumpLongBackward'); break;
        case 'nextChapter': cmd('jumpChapterForward'); break;
        case 'prevChapter': cmd('jumpChapterBackward'); break;
        case 'speedUp': cmd('speedUp'); break;
        case 'speedDown': cmd('speedDown'); break;
        case 'speedReset': cmd('speedReset'); break;
        case 'volumeUp': cmd('volumeUp'); break;
        case 'volumeDown': cmd('volumeDown'); break;
        case 'muteToggle': cmd('muteToggle'); break;
        case 'nextAudioTrack': cmd('nextAudioTrack'); break;
        case 'nextSubTrack': cmd('subTrackNext'); break;
        case 'nextVideoTrack': cmd('nextVideoTrack'); break;
        case 'subDelay': cmd('subDelaySet', { value: (State.subDelay || 0) + (args.by || 0) }); break;
        case 'screenshot': this.snapshot(false); break;
        case 'screenshotSubtitles': this.snapshot(true); break;
        case 'openEffects': window.APMDialogs.openEffects(); break;
        case 'openMediaInfo': window.APMDialogs.openMediaInfo(); break;
        case 'openCodecInfo': window.APMDialogs.openCodecInfo(); break;
        case 'openPreferences': window.APMDialogs.openPreferences(); break;
        case 'openFormats': window.APMDialogs.openFormats(); break;
        case 'openShortcuts': window.APMDialogs.openShortcuts(); break;
        case 'openAbout': window.APMDialogs.openAbout(); break;
        case 'openLibrary': Lists.showPanel('library'); this.toggleSidebarIfHidden(); break;
        case 'togglePlaylist': Lists.showPanel('playlist'); this.toggleSidebarIfHidden(); break;
        case 'addWatchFolder': this.addWatchFolder(); break;
        case 'addSubtitle': window.APMDialogs.addSubtitle(); break;
        case 'toggleAlwaysOnTop': this.toggleAlwaysOnTop(); break;
        case 'record': toast('Recording is not implemented in this build', '', 3000); break;
        default: break;
      }
    });
  },

  toggleSidebarIfHidden() {
    if (!State.sidebarVisible) this.toggleSidebar();
  },

  /**
   * macOS only: the picture is rendered by mpv in its own window, so the media
   * area says so instead of showing an unexplained black rectangle.
   */
  toggleMacVideoHint() {
    const hint = document.getElementById('macVideoHint');
    if (hint) hint.hidden = !State.externalVideoWindow;
  },

  async openClipboardUrl() {
    try {
      const text = await navigator.clipboard.readText();
      const url = String(text).trim();
      if (isNetworkUrl(url)) return Player.playFiles([url]);
      toast('Clipboard does not contain a media URL', 'is-error');
    } catch (_) {
      toast('Could not read the clipboard', 'is-error');
    }
  },

  async savePlaylist() {
    if (!State.playlist.length) return toast('Playlist is empty', 'is-error');
    const lines = ['#EXTM3U'];
    for (const it of State.playlist) lines.push(it.path);
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'apm-playlist.m3u8';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Playlist saved as M3U8');
  },

  async snapshot(withSubs) {
    const r = withSubs
      ? await window.apm.command('screenshotSubtitles')
      : await window.apm.command('screenshot');
    if (r && r.path) {
      toast(`Snapshot saved: ${r.path.split(/[\\/]/).pop()}`, 'is-good', 4000);
      window.apm.shell.showItem(r.path);
    }
  },
};

window.APMApp = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init().catch((err) => {
    console.error('[boot]', err);
    toast(`Startup problem: ${err.message}`, 'is-error', 8000);
  });
});
})();
