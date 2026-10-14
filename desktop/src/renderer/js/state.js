'use strict';
(function () {
/**
 * Central renderer state.
 *
 * One object, one change-notification. mpv property updates land here at up to
 * 60 Hz, so listeners are split into "cheap" (control bar repaints) and
 * "expensive" (list rebuilds) to keep seeking smooth.
 */

const State = {
  // playback
  path: null,
  info: null,            // ffprobe result for the current file
  playlist: [],          // [{ path, info, title }]
  playlistIndex: -1,
  playing: false,
  timePos: 0,
  duration: 0,
  bufferPct: 0,
  volume: 80,
  muted: false,
  speed: 1,
  loopMode: 'off',       // off | one | all
  shuffle: false,
  subDelay: 0,
  audioDelay: 0,

  // tracks
  audioTracks: [],
  videoTracks: [],
  subtitleTracks: [],
  activeAudioId: null,
  activeVideoId: null,
  activeSubId: null,
  externalSubs: [],

  // ui
  panel: 'library',      // library | playlist | recent
  sidebarVisible: true,
  controlsVisible: true,
  fullscreen: false,
  filter: '',
  sort: 'name',
  alwaysOnTop: false,

  settings: {},
  library: [],
  watching: [],
  recents: [],

  // Windows embeds the video in a child HWND that tracks the media area.
  // macOS gives mpv a real window instead, so the UI must not try to position
  // anything - it only controls playback.
  videoEmbedded: true,
  externalVideoWindow: false,

  _cheap: new Set(),
  _full: new Set(),

  onCheap(fn) { this._cheap.add(fn); return () => this._cheap.delete(fn); },
  onFull(fn) { this._full.add(fn); return () => this._full.delete(fn); },

  emit(full = false) {
    for (const fn of this._cheap) { try { fn(this); } catch (e) { console.error(e); } }
    if (full) for (const fn of this._full) { try { fn(this); } catch (e) { console.error(e); } }
  },

  current() { return this.playlist[this.playlistIndex] || null; },

  get hasMedia() { return !!this.path; },

  get displayTitle() {
    const c = this.current();
    if (!c) return '';
    return c.info ? c.info.name : c.title;
  },

  setPlaylist(items, startIndex = 0) {
    this.playlist = items;
    this.playlistIndex = startIndex;
    this.emit(true);
  },

  addToPlaylist(items, { play = false } = {}) {
    this.playlist.push(...items);
    if (play && this.playlistIndex < 0) this.playlistIndex = 0;
    this.emit(true);
  },

  removeFromPlaylist(index) {
    if (index < 0 || index >= this.playlist.length) return;
    const wasCurrent = index === this.playlistIndex;
    this.playlist.splice(index, 1);
    if (wasCurrent) this.playlistIndex = Math.min(this.playlistIndex, this.playlist.length - 1);
    else if (index < this.playlistIndex) this.playlistIndex--;
    this.emit(true);
  },

  moveInPlaylist(from, to) {
    if (from === to) return;
    const [it] = this.playlist.splice(from, 1);
    this.playlist.splice(to, 0, it);
    if (this.playlistIndex === from) this.playlistIndex = to;
    else if (from < this.playlistIndex && to >= this.playlistIndex) this.playlistIndex--;
    else if (from > this.playlistIndex && to <= this.playlistIndex) this.playlistIndex++;
    this.emit(true);
  },

  clearPlaylist() {
    this.playlist = [];
    this.playlistIndex = -1;
    this.emit(true);
  },

  shufflePlaylist() {
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }
    this.emit(true);
  },

  /** Apply an mpv property-change event. */
  applyProperty(name, value) {
    switch (name) {
      case 'time-pos': this.timePos = value || 0; break;
      case 'duration': this.duration = value || 0; break;
      case 'pause': this.playing = !value; break;
      case 'mute': this.muted = value; break;
      case 'volume': this.volume = value; break;
      case 'speed': this.speed = value; break;
      case 'path': this.path = value; break;
      case 'media-title': if (this.current()) this.current().title = value; break;
      case 'demuxer-cache-time':
        this.bufferPct = this.duration ? Math.min(100, ((value || 0) / this.duration) * 100) : 0;
        break;
      case 'playlist-pos': {
        const idx = Number(value);
        if (Number.isFinite(idx) && idx !== this.playlistIndex) {
          this.playlistIndex = idx;
          this.emit(true);
          return;
        }
        break;
      }
      default: break;
    }
    this.emit(false);
  },
};

window.State = State;
})();
