/**
 * Minimal PE export-table reader. Used to confirm which libmpv symbols the
 * shipped DLL actually exposes before we bind to them.
 * Usage: node tools/pe-exports.js <dll> [filter]
 */
const fs = require('fs');

function exportsOf(file) {
  const b = fs.readFileSync(file);
  const peOff = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE');
  const numSections = b.readUInt16LE(peOff + 6);
  const sizeOpt = b.readUInt16LE(peOff + 20);
  const optOff = peOff + 24;
  const magic = b.readUInt16LE(optOff);
  const pe32plus = magic === 0x20b;
  const dirOff = optOff + (pe32plus ? 112 : 96);
  const expRva = b.readUInt32LE(dirOff);
  const expSize = b.readUInt32LE(dirOff + 4);
  if (!expRva) return [];

  const secOff = optOff + sizeOpt;
  const sections = [];
  for (let i = 0; i < numSections; i++) {
    const o = secOff + i * 40;
    sections.push({
      va: b.readUInt32LE(o + 12),
      vsize: b.readUInt32LE(o + 8),
      raw: b.readUInt32LE(o + 20),
      rawSize: b.readUInt32LE(o + 16),
    });
  }
  const rva2off = (rva) => {
    for (const s of sections) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return s.raw + (rva - s.va);
    return null;
  };

  const eo = rva2off(expRva);
  const numNames = b.readUInt32LE(eo + 24);
  const namesRva = b.readUInt32LE(eo + 32);
  const namesOff = rva2off(namesRva);
  const out = [];
  for (let i = 0; i < numNames; i++) {
    const nameRva = b.readUInt32LE(namesOff + i * 4);
    const no = rva2off(nameRva);
    let end = no;
    while (b[end] !== 0) end++;
    out.push(b.toString('latin1', no, end));
  }
  return out;
}

const file = process.argv[2];
const filter = process.argv[3] || '';
const all = exportsOf(file);
const list = filter ? all.filter((n) => n.includes(filter)) : all;
console.log(`${file}\n  ${all.length} exports total, ${list.length} matching "${filter}"\n`);
for (const n of list.sort()) console.log('  ' + n);