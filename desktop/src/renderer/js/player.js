'use strict';
(function () {
/**
 * Player controller: transport controls, the native video surface geometry,
 * keyboard shortcuts, track selection and fullscreen.
 *
 * IMPORTANT: mpv's video is a real Win32 child window stacked on top of
 * Chromium, so it covers whatever is painted underneath it. `layout()` keeps
 * it exactly aligned with #mediaArea, and any control that must be visible
 * while video plays is placed outside that rectangle.
 */

const { $, $$, el, fmtTime, debounce, throttle, toast, notice, clearNotice } = window.APMUtil;

const Player = {
  _seekDragging: false,
  _hideTimer: null,
  _hideDelay: 2600,
  _pip: false,
  _preFsBounds: null,

  init() {
    // bindTransport also wires the seek bar, volume, keyboard and auto-hide.
    this.bindTransport();
    this.bindPopovers();

    window.addEventListener('resize', debounce(() => this.layout(), 40));
    window.addEventListener('beforeunload', () => window.apm.setVideoVisible(false));

    // The renderer can lose the video surface when the window is occluded or
    // the GPU context resets; re-assert it whenever that happens.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.layout();
    });

    State.onCheap(() => this.paint());
    State.onFull(() => this.paintNowPlaying());
  },

  // ── transport wiring ───────────────────────────────────────────────────
  bindTransport() {
    const cmd = (n, a) => window.apm.command(n, a);

    $('#btnPlay').onclick = () => cmd('togglePause');
    $('#btnPrev').onclick = () => this.previous();
    $('#btnNext').onclick = () => this.next();
    $('#btnMute').onclick = () => cmd('muteToggle');
    $('#btnLoop').onclick = () => this.cycleLoop();
    $('#btnShuffle').onclick = () => this.toggleShuffle();
    $('#btnFullscreen').onclick = () => this.toggleFullscreen();
    $('#btnMore').onclick = (e) => this.moreMenu(e.currentTarget);

    // The seekbar already handles ±10s by dragging; the keys remain.
    this.bindSeekbar();
    this.bindVolume();
    this.bindKeyboard();
    this.bindAutoHide();
    this.bindWindowButtons();
  },

  // Everything that used to be a button on the control bar lives here now.
  // A player that shows sixteen buttons is intimidating; seven is obvious.
  moreMenu(anchor) {
    window.APMDialogs.popover(anchor, [
      { label: 'Jump back 10s', sub: '←', onClick: () => window.apm.command('jumpBackward') },
      { label: 'Jump forward 10s', sub: '→', onClick: () => window.apm.command('jumpForward') },
      { label: 'Stop', sub: 'S', onClick: () => window.apm.command('stop') },
      { sep: true },
      { label: `Playback speed (${Number(State.speed || 1).toFixed(2)}×)`, stays: true, onClick: (a) => this.speedMenu(a) },
      { label: 'Subtitles', stays: true, onClick: (a) => window.APMDialogs.subtitleMenu(a) },
      { label: 'Audio track', stays: true, onClick: (a) => window.APMDialogs.audioTrackMenu(a) },
      { label: 'Video track', stays: true, onClick: (a) => window.APMDialogs.videoTrackMenu(a) },
      { sep: true },
      { label: 'Take snapshot', onClick: () => window.apm.command('screenshot') },
      { label: 'Mini player', onClick: () => this.togglePip() },
      { label: 'Convert file', onClick: () => window.APMDialogs.openConverter() },
      { label: 'Effects (brightness, equaliser)', onClick: () => window.APMDialogs.openEffects() },
      { sep: true },
      { label: 'Add file…', onClick: () => window.APMApp.openFiles() },
      { label: 'Add folder…', onClick: () => window.APMApp.openFolder() },
      { label: 'Open network stream…', onClick: () => window.APMDialogs.openNetwork() },
      { sep: true },
      { label: 'Settings', onClick: () => window.APMDialogs.openPreferences() },
      { label: 'Keyboard shortcuts', onClick: () => window.APMDialogs.openShortcuts() },
      { label: 'Supported formats', onClick: () => window.APMDialogs.openFormats() },
    ]);
  },

  bindSeekbar() {
    const bar = $('#seekbar');
    const tip = $('#seekTip');

    const pctFromEvent = (e) => {
      const r = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };

    const showTip = (pct) => {
      const target = pct * State.duration;
      tip.hidden = false;
      tip.textContent = fmtTime(target);
      tip.style.left = `${pct * 100}%`;
    };

    bar.addEventListener('mousemove', (e) => {
      if (!State.duration) return;
      const pct = pctFromEvent(e);
      if (this._seekDragging || !bar.classList.contains('scrubbing')) showTip(pct);
    });
    bar.addEventListener('mouseleave', () => {
      if (!this._seekDragging) tip.hidden = true;
    });

    bar.addEventListener('mousedown', (e) => {
      if (!State.duration) return;
      this._seekDragging = true;
      bar.classList.add('dragging');
      const pct = pctFromEvent(e);
      showTip(pct);
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._seekDragging) return;
      const pct = pctFromEvent(e);
      showTip(pct);
      this._previewPct = pct;
    });

    window.addEventListener('mouseup', (e) => {
      if (!this._seekDragging) return;
      this._seekDragging = false;
      bar.classList.remove('dragging');
      tip.hidden = true;
      if (State.duration) window.apm.command('seek', { to: this._previewPct * State.duration });
    });

    bar.addEventListener('keydown', (e) => {
      if (!State.duration) return;
      const step = e.shiftKey ? 60 : 5;
      if (e.key === 'ArrowRight') { window.apm.command('seekRelative', { by: step }); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { window.apm.command('seekRelative', { by: -step }); e.preventDefault(); }
      if (e.key === 'Home') { window.apm.command('seek', { to: 0 }); e.preventDefault(); }
      if (e.key === 'End') { window.apm.command('seek', { to: State.duration }); e.preventDefault(); }
    });
  },

  bindVolume() {
    const bar = $('#volumeBar');
    const pctFrom = (e) => {
      const track = bar.querySelector('.vb-track');
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    let dragging = false;

    bar.addEventListener('mousedown', (e) => {
      dragging = true;
      window.apm.command('volumeSet', { value: pctFrom(e) * 125 });
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (dragging) window.apm.command('volumeSet', { value: pctFrom(e) * 125 });
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { window.apm.command('volumeUp'); e.preventDefault(); }
      if (e.key === 'ArrowDown') { window.apm.command('volumeDown'); e.preventDefault(); }
    });
  },

  bindWindowButtons() {
    $('#btnMin').onclick = () => window.apm.window.minimize();
    $('#btnMax').onclick = () => window.apm.window.maximize();
    $('#btnClose').onclick = () => window.apm.window.close();
  },

  bindAutoHide() {
    const reveal = () => {
      document.body.classList.remove('ctl-hidden');
      State.controlsVisible = true;
      clearTimeout(this._hideTimer);
      // Tests set this to a huge value so a capture always shows the controls.
      this._hideTimer = setTimeout(() => {
        if (State.playing && !this._pip) {
          document.body.classList.add('ctl-hidden');
          State.controlsVisible = false;
          this.layout();
        }
      }, this._hideDelay);
    };
    window.addEventListener('mousemove', reveal);
    window.addEventListener('mousedown', reveal);
    this._reveal = reveal;
    reveal();
  },

  // ── navigation ─────────────────────────────────────────────────────────
  async playIndex(i, { start = 0 } = {}) {
    if (i < 0 || i >= State.playlist.length) return;
    State.playlistIndex = i;
    State.emit(true);
    await this.loadCurrent(start);
  },

  async loadCurrent(start) {
    const item = State.current();
    if (!item) return;
    try {
      const info = item.info || (await window.apm.probe(item.path))[0];
      State.info = info;
      State.externalSubs = [];
      State.audioTracks = info.audio || [];
      State.videoTracks = info.video ? [info.video] : [];
      State.subtitleTracks = info.subtitles || [];

      await window.apm.command('loadfile', { string: `loadfile ${JSON.stringify(item.path)} replace` });
      State.emit(true);

      // Seek after the file is actually open - before that mpv drops it.
      if (start) setTimeout(() => window.apm.command('seek', { to: start }), 300);
    } catch (err) {
      toast(`Could not open ${item.path}: ${err.message}`, 'is-error', 6000);
    }
  },

  async playFiles(files, { start = 0 } = {}) {
    if (!files || !files.length) return;
    const isNetwork = typeof files[0] === 'string' && window.APMUtil.isNetworkUrl(files[0]);
    if (isNetwork) {
      State.playlist = files.map((u) => ({ path: u, info: null, title: decodeURIComponent(u.split('/').pop() || u) }));
      State.playlistIndex = 0;
      State.emit(true);
      await window.apm.command('loadfile', { string: `loadfile ${JSON.stringify(files[0])} replace` });
      return;
    }

    const infos = await window.apm.probe(files);
    const items = files.map((p, i) => ({ path: p, info: infos[i], title: infos[i].name }));
    State.setPlaylist(items, 0);
    await this.playIndex(0, { start });
  },

  next() {
    if (State.playlist.length <= 1) {
      if (State.loopMode === 'all' || State.loopMode === 'one') return;
      return window.apm.command('stop');
    }
    const i = State.playlistIndex + 1;
    if (i >= State.playlist.length) {
      if (State.loopMode === 'all') return this.playIndex(0);
      return window.apm.command('stop');
    }
    return this.playIndex(i);
  },

  previous() {
    // Standard player behaviour: restart the track unless we're near the start.
    if (State.timePos > 3) return window.apm.command('seek', { to: 0 });
    if (State.playlistIndex > 0) return this.playIndex(State.playlistIndex - 1);
    return window.apm.command('seek', { to: 0 });
  },

  // ── modes ──────────────────────────────────────────────────────────────
  cycleLoop() {
    const order = ['off', 'all', 'one'];
    const next = order[(order.indexOf(State.loopMode) + 1) % order.length];
    State.loopMode = next;
    window.apm.command('loop', { mode: next });
    window.apm.settings.set({ loopMode: next });
    toast(`Loop: ${next === 'off' ? 'off' : next === 'all' ? 'playlist' : 'one'}`);
    this.paint();
  },

  toggleShuffle() {
    State.shuffle = !State.shuffle;
    if (State.shuffle) {
      const cur = State.current();
      State.shufflePlaylist();
      if (cur) {
        const idx = State.playlist.findIndex((x) => x.path === cur.path);
        if (idx >= 0) State.playlistIndex = idx;
      }
      State.emit(true);
    }
    toast(`Shuffle ${State.shuffle ? 'on' : 'off'}`);
    this.paint();
  },

  speedMenu(anchor) {
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
    window.APMDialogs.popover(anchor, [
      { title: 'Playback speed' },
      ...speeds.map((s) => ({
        label: `${s.toFixed(2)}×`,
        on: Math.abs(State.speed - s) < 0.01,
        onClick: () => { State.speed = s; window.apm.command('speedSet', { value: s }); },
      })),
      { sep: true },
      { label: 'Reset to normal', onClick: () => { State.speed = 1; window.apm.command('speedSet', { value: 1 }); } },
    ]);
  },

  async toggleFullscreen() {
    State.fullscreen = !State.fullscreen;
    await window.apm.window.fullscreen(State.fullscreen);
    document.body.classList.toggle('is-fullscreen', State.fullscreen);
    document.title = State.fullscreen ? `${State.displayTitle} — APM Open Player` : 'APM Open Player';
    // mpv can resize its own surface when the aspect changes; let it settle.
    setTimeout(() => this.layout(), 220);
  },

  /**
   * Picture-in-picture. Electron has no Document PiP, so we implement the
   * familiar behaviour by shrinking the player into a small floating
   * always-on-top window - the video surface moves with it automatically.
   */
  async togglePip() {
    this._pip = !this._pip;
    if (this._pip) {
      window.apm.window.alwaysOnTop(true);
      State.alwaysOnTop = true;
      document.body.classList.add('is-pip');
      $('#btnPiP').classList.add('is-on');
    } else {
      window.apm.window.alwaysOnTop(State.alwaysOnTop);
      document.body.classList.remove('is-pip');
      $('#btnPiP').classList.remove('is-on');
    }
    // Let the layout settle before re-measuring the video area.
    setTimeout(() => this.layout(), 150);
  },

  // ── video surface geometry ─────────────────────────────────────────────
  async layout() {
    const area = $('#mediaArea');
    if (!area) return;
    const hasVideo = State.hasMedia && State.info && State.info.hasVideo !== false;

    document.body.classList.toggle('sidebar-hidden', !State.sidebarVisible);
    document.body.classList.toggle('ctl-hidden', !State.controlsVisible);
    area.classList.toggle('is-empty', !hasVideo);
    document.body.classList.toggle('video-external', !!State.externalVideoWindow);

    const rect = area.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    // On macOS there is no embedded surface - mpv owns its own Cocoa window -
    // so there is nothing to position.
    if (!State.videoEmbedded) return;

    try {
      await window.apm.setVideoRect({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      await window.apm.setVideoVisible(!!hasVideo);
      if (hasVideo) await window.apm.raiseVideo();
    } catch (err) {
      console.error('[layout]', err);
    }
  },

  // ── painting ───────────────────────────────────────────────────────────
  paint() {
    // seek bar
    const pct = State.duration ? Math.min(100, (State.timePos / State.duration) * 100) : 0;
    $('#seekFill').style.width = `${pct}%`;
    $('#seekKnob').style.left = `${pct}%`;
    $('#seekBuffer').style.width = `${Math.max(pct, State.bufferPct)}%`;
    $('#timeNow').textContent = fmtTime(State.timePos);
    $('#timeTotal').textContent = State.duration ? fmtTime(State.duration) : '--:--';

    // play button
    const icon = $('#playIcon');
    icon.innerHTML = State.playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'
      : '<path d="M8 5l11 7-11 7z" fill="currentColor"/>';
    $('#btnPlay').title = State.playing ? 'Pause (Space)' : 'Play (Space)';

    // volume
    const vpct = Math.max(0, Math.min(100, (State.volume / 125) * 100));
    $('#volFill').style.width = `${vpct}%`;
    $('#volKnob').style.left = `${vpct}%`;
    $('#volIcon').innerHTML = State.muted || State.volume === 0
      ? '<path d="M5 9h4l5-4v14l-5-4H5z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M5 9h4l5-4v14l-5-4H5z" fill="currentColor"/><path d="M17 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';

    // speed + loop
    const speed = $('#speedLabel');
    if (speed) speed.textContent = `${Number(State.speed || 1).toFixed(2)}×`;
    $('#btnLoop').classList.toggle('is-on', State.loopMode !== 'off');
    $('#btnLoop').title = `Repeat: ${State.loopMode === 'off' ? 'off' : State.loopMode}`;
    $('#btnShuffle').classList.toggle('is-on', State.shuffle);

    // Subtitle / track state now shows on the ⋯ menu rather than the bar.
    const subsOn = State.activeSubId !== null && State.activeSubId !== 'no';
    $('#btnMore').classList.toggle('is-on', subsOn);

    $('#emptyState').hidden = State.hasMedia;
    $('#npStrip').hidden = !State.hasMedia;
  },

  paintNowPlaying() {
    const info = State.info;
    if (!info) return;
    $('#npTitle').textContent = info.name;
    const bits = [];
    if (info.container) bits.push(info.container.toUpperCase());
    if (info.video) {
      bits.push(info.video.codecName || info.video.codec);
      if (info.video.width) bits.push(`${info.video.width}×${info.video.height}`);
      if (info.video.hdr) bits.push(info.video.hdrScheme || 'HDR');
    }
    if (info.audio && info.audio[0]) bits.push(`${info.audio[0].codecName}${info.audio[0].channelLayout ? ` ${info.audio[0].channelLayout}` : ''}`);
    if (info.durationHuman) bits.push(info.durationHuman);
    $('#npSub').textContent = bits.join('  •  ');
    Lists.render();
  },

  // ── keyboard ───────────────────────────────────────────────────────────
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const ctrl = e.ctrlKey || e.metaKey;
      const cmd = (n, a) => window.apm.command(n, a);

      // Shortcuts that must work even when focus is in a slider.
      if (e.key === ' ' || e.code === 'Space') { cmd('togglePause'); e.preventDefault(); return; }

      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case 'o': window.APMApp.openFiles(); e.preventDefault(); return;
          case 'f': window.APMApp.openFolder(); e.preventDefault(); return;
          case 'n': window.APMDialogs.openNetwork(); e.preventDefault(); return;
          case 'l': window.APMDialogs.addSubtitle(); e.preventDefault(); return;
          case 'e': window.APMDialogs.openEffects(); e.preventDefault(); return;
          case 'i': window.APMDialogs.openMediaInfo(); e.preventDefault(); return;
          case 'b': window.APMApp.toggleSidebar(); e.preventDefault(); return;
          case 'r': window.APMDialogs.openConverter(); e.preventDefault(); return;
          case 't': window.APMApp.toggleAlwaysOnTop(); e.preventDefault(); return;
          case ',': window.APMDialogs.openPreferences(); e.preventDefault(); return;
          case 'arrowright': cmd('jumpForward'); e.preventDefault(); return;
          case 'arrowleft': cmd('jumpBackward'); e.preventDefault(); return;
          case '=': case '+': cmd('speedUp'); e.preventDefault(); return;
          case '-': cmd('speedDown'); e.preventDefault(); return;
          case '0': cmd('speedReset'); e.preventDefault(); return;
          default: return;
        }
      }

      switch (e.key) {
        case 'ArrowRight': cmd('jumpForward'); e.preventDefault(); break;
        case 'ArrowLeft': cmd('jumpBackward'); e.preventDefault(); break;
        case 'ArrowUp': cmd('volumeUp'); e.preventDefault(); break;
        case 'ArrowDown': cmd('volumeDown'); e.preventDefault(); break;
        case 'Escape':
          // Close what is open first. Only a bare fullscreen video has nothing
          // to close, and then Escape leaves fullscreen.
          if (window.APMDialogs.isModalOpen()) window.APMDialogs.closeTop();
          else if (State.fullscreen) Player.toggleFullscreen();
          break;
        case 'Delete': {
          if (State.panel === 'playlist' && State.playlistIndex >= 0) {
            State.removeFromPlaylist(State.playlistIndex);
          }
          break;
        }
        default: break;
      }

      switch (e.key.toLowerCase()) {
        case 'f': if (!e.altKey) Player.toggleFullscreen(); break;
        case 's': cmd('stop'); break;
        case 'n': this.next(); break;
        case 'p': this.previous(); break;
        case 'm': cmd('muteToggle'); break;
        case 'b': cmd('nextAudioTrack'); break;
        case 'v': cmd('nextVideoTrack'); break;
        case 'j': cmd('subTrackNext'); break;
        case 't': Player.toggleFullscreen(); break;
        case 'e': Player.next(); break;
        case 'i': window.APMDialogs.openMediaInfo(); break;
        case 'h': cmd('subDelaySet', { value: (State.subDelay || 0) - 0.5 }); break;
        case 'k': cmd('subDelaySet', { value: (State.subDelay || 0) + 0.5 }); break;
        case '+': case '=': cmd('speedUp'); break;
        case '-': cmd('speedDown'); break;
        default: break;
      }
    });
  },

  bindPopovers() {
    // Outside click closes every popover in the stack. Escape is handled in
    // bindKeyboard, where it also has to fall back to leaving fullscreen.
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.popover') && !e.target.closest('.cbtn')) window.APMDialogs.closePopover();
    });
  },
};

window.Player = Player;
})();
