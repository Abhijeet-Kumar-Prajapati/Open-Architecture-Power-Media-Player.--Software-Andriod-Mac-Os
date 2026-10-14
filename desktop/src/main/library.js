'use strict';
/**
 * Media library + recents.
 *
 * The library is a persisted list of probed files, optionally backed by
 * "watch folders" that are rescanned at startup so the user sees their whole
 * collection without importing anything.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const media = require('./media-info');

const MEDIA_RE = /\.(mkv|mp4|m4v|avi|mov|qt|wmv|asf|flv|f4v|webm|ts|m2ts|mts|m2v|vob|ogv|3gp|3g2|mpg|mpeg|mpe|m1v|rm|rmvb|divx|mxf|dv|nsv|swf|amv|tp|trp|roq|y4m|gif|mjpeg|mp3|aac|m4a|m4b|flac|wav|wave|ogg|oga|opus|spx|wma|aiff|aif|aifc|ape|wv|tta|tak|dts|ac3|eac3|ec3|mka|amr|awb|caf|dsf|dff|ra|ram|au|snd|mpc|voc|mid|midi|kar|mod|s3m|xm|it)$/i;

function walk(dir, opts = {}) {
  const out = [];
  const seen = new Set();
  const stack = [dir];

  const readDir = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (opts.recursive) stack.push(full);
      } else if (e.isFile()) {
        if (MEDIA_RE.test(e.name)) {
          const key = full.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            out.push(full);
          }
        }
      }
    }
  };

  let processed = 0;
  while (stack.length) {
    const d = stack.pop();
    readDir(d);
    processed++;
    if (opts.onProgress && processed % 20 === 0) opts.onProgress({ scanned: processed, found: out.length, dir: d });
  }
  return out;
}

/** Scan a directory for media files, probing each one as it goes. */
async function scanFolder(dir, opts = {}) {
  const paths = walk(dir, opts);
  const items = [];
  for (let i = 0; i < paths.length; i++) {
    const info = await media.probe(paths[i]);
    items.push({
      path: info.path,
      name: info.name,
      kind: info.kind,
      container: info.container,
      durationSec: info.durationSec,
      durationHuman: info.durationHuman,
      sizeBytes: info.sizeBytes,
      sizeHuman: info.sizeHuman,
      video: info.video || null,
      audio: (info.audio && info.audio[0]) || null,
      ok: info.ok,
      error: info.error || null,
    });
    if (opts.onProgress && i % 5 === 0) opts.onProgress({ phase: 'probe', done: i + 1, total: paths.length });
  }
  if (opts.onProgress) opts.onProgress({ phase: 'done', done: paths.length, total: paths.length });
  return items;
}

class Library {
  constructor(store, settings) {
    this.store = store;
    this.settings = settings;
    this._index = new Map();
    for (const it of store.get('items', [])) this._index.set(it.path.toLowerCase(), it);
  }

  list() {
    return [...this._index.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  addAll(items) {
    for (const it of items) this._index.set(it.path.toLowerCase(), it);
    this.save();
    return this.list().length;
  }

  remove(p) {
    this._index.delete(p.toLowerCase());
    this.save();
  }

  clear() {
    this._index.clear();
    this.save();
  }

  /** Files from the configured watch folders, newest first. */
  listWatching(folders) {
    if (!folders || !folders.length) return [];
    const roots = folders.map((f) => f.path).filter(Boolean);
    const known = new Set(this._index.keys());
    const out = [];
    for (const root of roots) {
      for (const p of walk(root, { recursive: true })) {
        if (!known.has(p.toLowerCase())) out.push(this._describe(p));
      }
    }
    return out;
  }

  _describe(p) {
    let st = null;
    try {
      st = fs.statSync(p);
    } catch (_) {}
    return {
      path: p,
      name: path.basename(p),
      kind: media.classify(media.extOf(p)),
      container: media.containerOf(media.extOf(p)),
      sizeBytes: st ? st.size : null,
      sizeHuman: st ? media.humanSize(st.size) : '',
      mtime: st ? st.mtimeMs : 0,
      ok: true,
    };
  }

  save() {
    this.store.set('items', [...this._index.values()]);
  }
}

/** Recently opened files with resume positions. */
class Recents {
  constructor(store, limit = 40) {
    this.store = store;
    this.limit = limit;
  }

  list() {
    return this.store.get('items', []);
  }

  touch(file, extra = {}) {
    const items = this.list().filter((i) => i.path.toLowerCase() !== file.toLowerCase());
    const prev = this.list().find((i) => i.path.toLowerCase() === file.toLowerCase());
    items.unshift({
      path: file,
      name: path.basename(file),
      at: Date.now(),
      position: prev ? prev.position : 0,
      duration: extra.duration ?? prev?.duration ?? 0,
    });
    this.store.set('items', items.slice(0, this.limit));
    return items[0];
  }

  touchAll(files) {
    for (const f of files) this.touch(f);
  }

  setResume(file, position) {
    const items = this.list();
    const hit = items.find((i) => i.path.toLowerCase() === file.toLowerCase());
    if (hit) {
      hit.position = position;
      hit.at = Date.now();
      this.store.set('items', items);
    }
  }

  getResume(file) {
    const hit = this.list().find((i) => i.path.toLowerCase() === file.toLowerCase());
    return hit ? hit.position || 0 : 0;
  }

  remove(file) {
    this.store.set('items', this.list().filter((i) => i.path.toLowerCase() !== file.toLowerCase()));
  }

  clear() {
    this.store.set('items', []);
  }
}

module.exports = { scanFolder, walk, Library, Recents, MEDIA_RE };