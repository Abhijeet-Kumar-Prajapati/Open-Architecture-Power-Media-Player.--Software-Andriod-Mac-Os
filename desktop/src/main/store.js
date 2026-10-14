'use strict';
/**
 * Small JSON document store in the OS user-data directory. Used for settings,
 * the media library, recents and resume positions. Writes are atomic and
 * debounced so a crash mid-save cannot corrupt the file.
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dir, name, defaults = {}) {
    this.file = path.join(dir, name);
    this.defaults = defaults;
    this.data = this._read();
    this._timer = null;
    this._pending = false;
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...this.defaults, ...parsed };
    } catch (_) {
      return { ...this.defaults };
    }
  }

  get(key, fallback) {
    if (key === undefined) return this.data;
    const v = this.data[key];
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    if (typeof key === 'object' && key !== null) {
      Object.assign(this.data, key);
    } else {
      this.data[key] = value;
    }
    this.save();
    return this;
  }

  /** Merge a partial update into a namespaced section. */
  patch(section, partial) {
    this.data[section] = { ...(this.data[section] || {}), ...partial };
    this.save();
    return this.data[section];
  }

  save() {
    if (this._pending) return;
    this._pending = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._pending = false;
      this._flush();
    }, 400);
  }

  saveNow() {
    clearTimeout(this._timer);
    this._pending = false;
    this._flush();
  }

  _flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[store] failed to write ${this.file}:`, err.message);
    }
  }
}

module.exports = { JsonStore };