/**
 * Builds desktop/build/icon.icns from the PNGs produced by make-icon.ps1.
 *
 * electron-builder.yml points `mac.icon` at build/icon.icns, but nothing in the
 * toolchain creates one - so `npm run dist:mac` fails on a missing file, and
 * anyone reading the config is misled into thinking an icon exists.
 *
 * ICNS is a simple container: an 'icns' magic plus total length, then a series
 * of chunks, each a 4-character OSType, a big-endian length that includes the
 * 8-byte chunk header, and the image data. PNG payloads are accepted for the
 * ic07/ic08/ic09 types, which means no resizing is needed - the PNGs made by
 * make-icon.ps1 can be copied in verbatim.
 *
 *   node tools/make-icns.js
 */

const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'desktop', 'build');

/** [OSType, source png, human size] */
const CHUNKS = [
  ['icp4', 'icon-16.png', '16x16'],
  ['icp5', 'icon-32.png', '32x32'],
  ['ic07', 'icon-128.png', '128x128'],
  ['ic08', 'icon-256.png', '256x256'],
  ['ic09', 'icon-512.png', '512x512'],
];

const parts = [];
for (const [type, file, label] of CHUNKS) {
  const p = path.join(BUILD, file);
  if (!fs.existsSync(p)) {
    console.error(`missing ${file} - run tools/make-icon.ps1 first`);
    process.exit(1);
  }
  const png = fs.readFileSync(p);

  const head = Buffer.alloc(8);
  head.write(type, 0, 4, 'ascii');
  // Length counts the type, the length field and the payload.
  head.writeUInt32BE(8 + png.length, 4);

  parts.push(head, png);
  console.log(`  + ${type}  ${label.padEnd(9)} ${(png.length / 1024).toFixed(1)} KB`);
}

const body = Buffer.concat(parts);
const out = Buffer.alloc(8 + body.length);
out.write('icns', 0, 4, 'ascii');
out.writeUInt32BE(out.length, 4);
body.copy(out, 8);

const dest = path.join(BUILD, 'icon.icns');
fs.writeFileSync(dest, out);
console.log(`\nicon.icns written: ${(out.length / 1024).toFixed(1)} KB (declared ${out.length}, actual ${out.length})`);