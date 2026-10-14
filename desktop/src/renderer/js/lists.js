'use strict';
(function () {
/**
 * Sidebar lists: Library (watch folders), Playlist and Recent.
 * All three render through the same row component so drag-and-drop, context
 * actions and keyboard navigation behave identically everywhere.
 */

const { $, $$, el, fmtTime, fmtSize, fmtAgo, debounce, toast, mediaSummary, baseName } = window.APMUtil;

const GLYPHS = {
  video: '<path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M17 10l4-2.2v8.4L17 14z" fill="currentColor"/>',
  audio: '<path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="7" cy="18" r="2.4" fill="currentColor"/><circle cx="17" cy="16" r="2.4" fill="currentColor"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8.5" cy="10" r="1.6" fill="currentColor"/><path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  subtitle: '<rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10h6M7 14h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  unknown: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};

function glyphFor(kind) {
  return `<svg viewBox="0 0 24 24" class="kind-glyph">${GLYPHS[kind] || GLYPHS.unknown}</svg>`;
}

const Lists = {
  _thumbs: new Map(),
  _thumbQueue: [],
  _thumbBusy: false,

  init() {
    $$('.side-tab').forEach((tab) => {
      tab.onclick = () => this.showPanel(tab.dataset.panel);
    });

    const filter = $('#sideFilter');
    filter.oninput = debounce(() => {
      State.filter = filter.value.trim().toLowerCase();
      this.render();
    }, 120);

    $('#btnClearList').onclick = () => {
      if (State.panel !== 'playlist') return;
      State.clearPlaylist();
      toast('Playlist cleared');
    };

    $('#btnSortList').onclick = () => this.sortMenu($('#btnSortList'));

    this.dropTarget = null;
    this.bindDropZone();
  },

  showPanel(name) {
    State.panel = name;
    $$('.side-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.panel === name));
    $('#btnClearList').style.visibility = name === 'playlist' ? 'visible' : 'hidden';
    $('#sideFilter').placeholder = name === 'library' ? 'Filter library' : name === 'playlist' ? 'Filter playlist' : 'Filter history';
    this.render();
  },

  get source() {
    switch (State.panel) {
      case 'playlist': return State.playlist.map((x) => ({ ...x, _panel: 'playlist' }));
      case 'recent': return State.recents.map((x) => ({ path: x.path, info: null, title: x.name, _meta: x, _panel: 'recent' }));
      default: return [...State.library, ...State.watching].map((x) => ({ ...x, _panel: 'library' }));
    }
  },

  render() {
    const host = $('#sideList');
    if (!host) return;
    let items = this.source;

    if (State.filter) {
      items = items.filter((it) => (it.title || it.name || '').toLowerCase().includes(State.filter));
    }

    items = this.sort(items);

    host.innerHTML = '';
    if (!items.length) {
      host.append(this.emptyState());
      this.updateFoot(0);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((it, i) => frag.append(this.row(it, i)));
    host.append(frag);
    this.updateFoot(items.length);
    this.pumpThumbs();
  },

  sort(items) {
    const s = State.sort;
    const byName = (a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || '', undefined, { numeric: true });
    const byDate = (a, b) => (b._meta ? b._meta.at : b.mtime || 0) - (a._meta ? a._meta.at : a.mtime || 0);
    const bySize = (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0);
    const byDuration = (a, b) => (b.info && b.info.durationSec || 0) - (a.info && a.info.durationSec || 0);
    const map = { name: byName, date: byDate, size: bySize, duration: byDuration, added: (a, b) => (a._panel === 'recent' ? 0 : 1) - (b._panel === 'recent' ? 0 : 1) };
    return [...items].sort(map[s] || byName);
  },

  sortMenu(anchor) {
    const opts = [
      { title: 'Sort by' },
      { label: 'Name', on: State.sort === 'name', onClick: () => { State.sort = 'name'; this.render(); } },
      { label: 'Date added / opened', on: State.sort === 'date', onClick: () => { State.sort = 'date'; this.render(); } },
      { label: 'Size', on: State.sort === 'size', onClick: () => { State.sort = 'size'; this.render(); } },
      { label: 'Duration', on: State.sort === 'duration', onClick: () => { State.sort = 'duration'; this.render(); } },
    ];
    window.APMDialogs.popover(anchor, opts);
  },

  row(item, index) {
    const isCurrent = item.path && State.path && item.path.toLowerCase() === State.path.toLowerCase();
    const info = item.info;

    const thumb = el('div', { class: 'it-thumb' });
    const cached = this._thumbs.get(item.path);
    if (cached) {
      thumb.style.backgroundImage = `url(${cached})`;
    } else {
      thumb.innerHTML = glyphFor(info ? info.kind : (item._panel === 'recent' ? 'unknown' : guessKind(item.name)));
    }

    const meta = [];
    if (item._panel === 'recent' && item._meta) {
      if (item._meta.position > 3 && item._meta.duration) {
        meta.push(`resume ${fmtTime(item._meta.position)} / ${fmtTime(item._meta.duration)}`);
      }
      meta.push(fmtAgo(item._meta.at));
    } else {
      const summary = mediaSummary(info);
      if (summary) meta.push(summary);
      if (item.sizeHuman) meta.push(item.sizeHuman);
    }

    const badges = el('div', { class: 'it-meta' });
    if (info && info.video && info.video.hdr) badges.append(el('span', { class: 'badge hdr' }, 'HDR'));
    if (info && info.subtitles && info.subtitles.length) badges.append(el('span', { class: 'badge' }, `${info.subtitles.length}CC`));
    badges.append(document.createTextNode(meta.join('  •  ')));

    const actions = el('div', { class: 'it-actions' });
    actions.append(
      this.iconBtn('<path d="M8 5l11 7-11 7z" fill="currentColor"/>', 'Play', () => this.playItem(item)),
      this.iconBtn('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 'Add to playlist', () => this.addItem(item)),
      this.iconBtn('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>', item._panel === 'playlist' ? 'Remove from playlist' : 'Remove from list', () => this.removeItem(item, index))
    );

    const body = el('div', { class: 'it-body' },
      el('div', { class: 'it-name' }, item.title || item.name || baseName(item.path)),
      badges);

    const row = el('div', {
      class: `item${isCurrent ? ' is-current' : ''}${isCurrent && State.playing ? ' is-playing' : ''}`,
      draggable: 'true',
      tabindex: '0',
      dataset: { index: String(index), panel: item._panel },
      title: item.path,
    },
      item._panel === 'playlist' ? el('div', { class: 'it-num' }, String(index + 1)) : null,
      thumb, body, actions);

    row.onclick = (e) => {
      if (e.target.closest('.it-actions')) return;
      this.activate(item);
    };
    row.ondblclick = () => this.playItem(item);
    row.onkeydown = (e) => {
      if (e.key === 'Enter') this.playItem(item);
      if (e.key === 'Delete') this.removeItem(item, index);
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      this.contextMenu(item, index, e.clientX, e.clientY);
    };

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-apm-index', String(index));
      e.dataTransfer.setData('application/x-apm-panel', item._panel);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      if (State.panel !== 'playlist') return;
      e.preventDefault();
      row.classList.add('drop-before');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
    row.addEventListener('drop', (e) => {
      if (State.panel !== 'playlist') return;
      e.preventDefault();
      row.classList.remove('drop-before');
      const from = Number(e.dataTransfer.getData('application/x-apm-index'));
      if (Number.isFinite(from)) State.moveInPlaylist(from, index);
    });

    return row;
  },

  iconBtn(svgInner, title, onClick) {
    return el('button', { class: 'it-btn', title, onclick: (e) => { e.stopPropagation(); onClick(); } },
      el('span', { html: `<svg viewBox="0 0 24 24">${svgInner}</svg>` }));
  },

  emptyState() {
    const messages = {
      library: ['Library is empty', 'Add a folder and APM will index every video and audio file inside it.'],
      playlist: ['Playlist is empty', 'Open files or drop them anywhere in the window.'],
      recent: ['Nothing played yet', 'Files you open show up here so you can jump back in.'],
    };
    const [h, p] = messages[State.panel];
    const box = el('div', { class: 'list-empty' }, el('strong', {}, h), el('div', {}, p));
    if (State.panel === 'library') {
      box.append(el('div', { style: { marginTop: '12px' } },
        el('button', { class: 'btn btn-sm', onclick: () => window.APMApp.addWatchFolder() }, 'Add folder')));
    }
    return box;
  },

  updateFoot(count) {
    const foot = $('#sideFoot');
    const label = { library: 'in library', playlist: 'in playlist', recent: 'played' }[State.panel];
    const total = State.panel === 'playlist'
      ? State.playlist.reduce((a, x) => a + (x.info && x.info.durationSec || 0), 0)
      : 0;
    foot.textContent = count
      ? `${count} ${label}${total > 0 ? `  •  ${fmtTime(total)}` : ''}`
      : '';
  },

  // ── actions ────────────────────────────────────────────────────────────
  activate(item) {
    if (item._panel === 'playlist') {
      Player.playIndex(State.playlist.findIndex((x) => x.path === item.path));
    }
  },

  async playItem(item) {
    if (State.panel === 'playlist') {
      const i = State.playlist.findIndex((x) => x.path === item.path);
      if (i >= 0) return Player.playIndex(i);
    }
    if (item._panel === 'library' || item._panel === 'recent') {
      const start = item._panel === 'recent' ? item._meta?.position || 0 : 0;
      const files = this.source.map((x) => x.path);
      const idx = files.indexOf(item.path);
      return Player.playFiles(files, { start: idx >= 0 && start ? start : 0 });
    }
  },

  async addItem(item) {
    State.addToPlaylist([{ path: item.path, info: item.info, title: item.title || item.name }]);
    toast('Added to playlist');
  },

  removeItem(item, index) {
    if (State.panel === 'playlist') {
      State.removeFromPlaylist(index);
    } else if (State.panel === 'recent') {
      window.apm.recent.forget(item.path);
      State.recents = State.recents.filter((r) => r.path !== item.path);
      this.render();
    } else {
      window.apm.library.remove(item.path);
      State.library = State.library.filter((x) => x.path !== item.path);
      this.render();
    }
  },

  contextMenu(item, index, x, y) {
    const opts = [
      { label: 'Play', onClick: () => this.playItem(item) },
      { label: 'Play next', onClick: () => { const c = State.playlist[State.playlistIndex]; State.playlist.splice(State.playlistIndex + 1, 0, { path: item.path, info: item.info, title: item.title || item.name }); if (!c) State.playlistIndex = 0; State.emit(true); } },
      { label: 'Add to playlist', onClick: () => this.addItem(item) },
      { sep: true },
      { label: 'Show in folder', onClick: () => window.apm.reveal(item.path) },
      { label: 'Media information', onClick: () => window.APMDialogs.openMediaInfo(item.path) },
      { sep: true },
      { label: item._panel === 'playlist' ? 'Remove from playlist' : 'Remove', onClick: () => this.removeItem(item, index) },
    ];
    window.APMDialogs.popoverAt(x, y, opts);
  },

  // ── thumbnails ─────────────────────────────────────────────────────────
  pumpThumbs() {
    if (this._thumbBusy) return;
    const need = this.source
      .filter((it) => it.path && it.info && it.info.hasVideo && !this._thumbs.has(it.path))
      .slice(0, 6);
    if (!need.length) return;

    this._thumbBusy = true;
    window.apm
      .thumbs(need.map((n) => ({ path: n.path, time: Math.min(30, (n.info.durationSec || 60) / 4) })))
      .then((map) => {
        for (const [p, dataUrl] of Object.entries(map)) {
          if (dataUrl) this._thumbs.set(p, dataUrl);
        }
        this.render();
      })
      .catch(() => {})
      .finally(() => {
        this._thumbBusy = false;
      });
  },

  // ── drag & drop ────────────────────────────────────────────────────────
  bindDropZone() {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      document.body.classList.add('is-dropping');
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) document.body.classList.remove('is-dropping');
    });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('is-dropping');

      const files = [...e.dataTransfer.files].map((f) => f.path || f.name);
      if (!files.length) return;
      window.APMApp.openPaths(files);
    });
  },
};

function guessKind(name) {
  const ext = window.APMUtil.fileExt(name);
  if (['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'ape', 'alac', 'dts', 'ac3', 'eac3'].includes(ext)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return 'image';
  if (['srt', 'ass', 'ssa', 'sub', 'vtt'].includes(ext)) return 'subtitle';
  return 'video';
}

window.Lists = Lists;
})();
