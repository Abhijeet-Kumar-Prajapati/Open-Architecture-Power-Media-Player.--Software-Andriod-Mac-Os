/**
 * Minimal streaming ZIP writer.
 *
 * Why this exists instead of a dependency: the release archive is ~500 MB of
 * already-compressed binaries. JSZip would hold every entry in memory, and
 * archiver is not vendored here. This writes straight to a file handle and
 * never buffers more than one small entry.
 *
 * Scope is deliberately narrow - store and deflate, no zip64, no encryption,
 * no directory entries. That covers everything this project ships; the writer
 * refuses anything larger than 4 GB rather than emitting a corrupt archive.
 */

const fs = require('fs');
const zlib = require('zlib');

/** Entries at or above this size stream with STORE instead of being buffered. */
const BUFFER_LIMIT = 8 * 1024 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const UINT32_MAX = 0xffffffff;

/** MS-DOS date/time, which is what the ZIP format still uses. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

class ZipWriter {
  /**
   * @param {string} outPath destination .zip
   * @param {{ level?: number }} [opts] deflate level, default 6
   */
  constructor(outPath, opts = {}) {
    this.fd = fs.openSync(outPath, 'w');
    this.offset = 0;
    this.level = opts.level ?? 6;
    this.entries = [];
    this.nameBuffer = Buffer.alloc(0);
  }

  #write(buf) {
    fs.writeSync(this.fd, buf);
    this.offset += buf.length;
  }

  #header(name, method, crc, compSize, uncompSize, dt, extra = Buffer.alloc(0)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(SIG_LOCAL, 0);
    h.writeUInt16LE(20, 4);          // version needed
    h.writeUInt16LE(0x0800, 6);      // UTF-8 names
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(dt.time, 10);
    h.writeUInt16LE(dt.date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(compSize, 18);
    h.writeUInt32LE(uncompSize, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(extra.length, 28);
    return { head: Buffer.concat([h, nameBuf, extra]) };
  }

  /**
   * Add one file. `arcName` is the path stored inside the archive, always with
   * forward slashes.
   *
   * @param {string} srcPath file on disk
   * @param {string} arcName path inside the archive
   */
  addFile(srcPath, arcName) {
    const stat = fs.statSync(srcPath);
    if (stat.size > UINT32_MAX) {
      throw new Error(`${arcName} exceeds 4 GB; zip64 is not implemented`);
    }

    const arc = arcName.split('\\').join('/');
    const dt = dosDateTime(stat.mtime);

    // Big files stream straight through. Every one of them in this project is
    // already deflate-compressed, so trying to squeeze them again just burns
    // CPU for a fraction of a percent.
    if (stat.size >= BUFFER_LIMIT) {
      return this.#addStreamed(srcPath, arc, stat, dt);
    }

    const raw = fs.readFileSync(srcPath);
    const deflated = zlib.deflateRawSync(raw, { level: this.level });
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const crc = crc32(raw);
    const localOffset = this.offset;

    this.#write(this.#header(arc, method, crc, data.length, raw.length, dt).head);
    this.#write(data);
    this.entries.push({ arc, method, crc, compSize: data.length, uncompSize: raw.length, dt, localOffset });
    return this;
  }

  #addStreamed(srcPath, arc, stat, dt) {
    // Sizes and CRC are unknown before reading, so seek back and patch the
    // local header afterwards. The central directory is written at the end and
    // holds the authoritative values either way.
    const headerAt = this.offset;
    const nameBuf = Buffer.from(arc, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(SIG_LOCAL, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(METHOD_STORE, 8);
    h.writeUInt16LE(dt.time, 10);
    h.writeUInt16LE(dt.date, 12);
    // CRC and sizes are zero here; bit 3 of the flag set would normally mark
    // them as streamed, but patching is simpler than honouring that flag.
    h.writeUInt32LE(0, 14);
    h.writeUInt32LE(0, 18);
    h.writeUInt32LE(0, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    this.#write(h);
    this.#write(nameBuf);

    const dataStart = this.offset;
    const src = fs.openSync(srcPath, 'r');
    const chunk = Buffer.alloc(1024 * 1024);
    let crc = ~0;
    let read = 0;
    try {
      for (;;) {
        const n = fs.readSync(src, chunk, 0, chunk.length, null);
        if (n <= 0) break;
        const slice = chunk.subarray(0, n);
        // CRC has to run byte by byte regardless of chunk size; it is the one
        // part of this that cannot be vectorised by hand cheaply.
        for (let i = 0; i < n; i++) {
          crc ^= slice[i];
          for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
        this.#write(slice);
        read += n;
      }
    } finally {
      fs.closeSync(src);
    }
    const finalCrc = ~crc >>> 0;

    // Patch the three header fields we had to leave blank.
    fs.writeSync(this.fd, Buffer.from([
      finalCrc & 0xff, (finalCrc >>> 8) & 0xff, (finalCrc >>> 16) & 0xff, (finalCrc >>> 24) & 0xff,
      read & 0xff, (read >>> 8) & 0xff, (read >>> 16) & 0xff, (read >>> 24) & 0xff,
      stat.size & 0xff, (stat.size >>> 8) & 0xff, (stat.size >>> 16) & 0xff, (stat.size >>> 24) & 0xff,
    ]), 0, 12, headerAt + 14);

    this.entries.push({ arc, method: METHOD_STORE, crc: finalCrc, compSize: read, uncompSize: stat.size, dt, localOffset: headerAt });
    return this;
  }

  /** Write the central directory and close the file. */
  close() {
    const cdStart = this.offset;

    for (const e of this.entries) {
      const nameBuf = Buffer.from(e.arc, 'utf8');
      const c = Buffer.alloc(46);
      c.writeUInt32LE(SIG_CENTRAL, 0);
      c.writeUInt16LE(20, 4);          // version made by
      c.writeUInt16LE(20, 6);          // version needed
      c.writeUInt16LE(0x0800, 8);      // UTF-8 names
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.dt.time, 12);
      c.writeUInt16LE(e.dt.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compSize, 20);
      c.writeUInt32LE(e.uncompSize, 24);
      c.writeUInt16LE(nameBuf.length, 28);
      c.writeUInt16LE(0, 30);          // extra
      c.writeUInt16LE(0, 32);          // comment
      c.writeUInt16LE(0, 34);          // disk number
      c.writeUInt16LE(0, 36);          // internal attrs
      c.writeUInt32LE(0o644 << 16, 38); // external attrs
      c.writeUInt32LE(e.localOffset, 42);
      this.#write(c);
      this.#write(nameBuf);
    }

    const cdSize = this.offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_EOCD, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    this.#write(end);

    fs.closeSync(this.fd);
    return this;
  }
}

module.exports = { ZipWriter, crc32 };