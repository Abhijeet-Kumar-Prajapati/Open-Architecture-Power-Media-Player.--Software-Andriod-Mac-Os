/**
 * Packs the generated PNG sizes into a Windows .ico.
 *
 * The ICO format can embed PNG data directly (supported since Vista), which
 * means we do not need an image library to re-encode anything - the icon we
 * already rendered is embedded byte for byte.
 *
 * Usage: node tools/make-ico.js
 */
const fs = require('fs');
const path = require('path');

const BUILD = path.resolve(__dirname, '..', 'desktop', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const images = [];
for (const s of SIZES) {
  const file = path.join(BUILD, `icon-${s}.png`);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file} - run tools/make-icon.ps1 first`);
    process.exit(1);
  }
  images.push({ size: s, data: fs.readFileSync(file) });
}

// ICONDIR
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

// ICONDIRENTRY x N, then the image payloads
const dir = Buffer.alloc(16 * images.length);
let offset = 6 + dir.length;
images.forEach((img, i) => {
  const o = i * 16;
  // 0 means 256 in the ICO directory.
  dir[o] = img.size >= 256 ? 0 : img.size;
  dir[o + 1] = img.size >= 256 ? 0 : img.size;
  dir[o + 2] = 0; // palette size
  dir[o + 3] = 0; // reserved
  dir.writeUInt16LE(1, o + 4); // colour planes
  dir.writeUInt16LE(32, o + 6); // bits per pixel
  dir.writeUInt32LE(img.data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += img.data.length;
});

const out = path.join(BUILD, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, dir, ...images.map((i) => i.data)]));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes, ${images.length} sizes)`);