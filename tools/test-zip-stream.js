/**
 * Round-trips the streaming zip writer: writes a mixed set of small and large
 * files, extracts them again with .NET, and compares bytes and CRCs.
 *
 * A zip writer that silently mis-writes an offset produces an archive that
 * opens and then fails on the 40th entry. Cheaper to catch that here than
 * after a 500 MB build.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ZipWriter } = require('./lib/zip-stream');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-ziptest-'));
const srcDir = path.join(tmp, 'src');
const outZip = path.join(tmp, 'out.zip');
const backDir = path.join(tmp, 'back');
fs.mkdirSync(srcDir);
fs.mkdirSync(backDir);

function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const files = [
  ['tiny.txt', Buffer.from('hello')],
  ['empty.bin', Buffer.alloc(0)],
  // Incompressible: exercises the store-vs-deflate comparison.
  ['random.bin', crypto.randomBytes(300 * 1024)],
  // Highly compressible: exercises the deflate path.
  ['repeat.txt', Buffer.alloc(2 * 1024 * 1024, 'A')],
  ['nested/deep/unicode-हिन्दी-✓.txt', Buffer.from('unicode path test\n'.repeat(50))],
  // Above BUFFER_LIMIT (8 MB): exercises the streaming path with header patching.
  ['big.bin', crypto.randomBytes(9 * 1024 * 1024)],
  ['big-compressible.bin', Buffer.alloc(9 * 1024 * 1024, 0x5a)],
];

for (const [name, data] of files) {
  const p = path.join(srcDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

const zip = new ZipWriter(outZip);
for (const [name] of files) zip.addFile(path.join(srcDir, name), name);
zip.close();

// Let .NET extract it - an independent implementation, not our own reader.
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
  `[System.IO.Compression.ZipFile]::ExtractToDirectory('${outZip.replace(/'/g, "''")}', '${backDir.replace(/'/g, "''")}')`,
], { stdio: 'pipe' });

let failures = 0;
for (const [name] of files) {
  const a = sha(path.join(srcDir, name));
  const b = sha(path.join(backDir, name));
  const ok = a === b;
  if (!ok) failures++;
  const size = fs.statSync(path.join(srcDir, name)).size;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${(size / 1024).toFixed(1).padStart(9)} KB`);
}

const zipSize = fs.statSync(outZip).size;
const rawTotal = files.reduce((n, [, d]) => n + d.length, 0);
console.log(`\narchive ${(zipSize / 1024).toFixed(1)} KB from ${(rawTotal / 1024).toFixed(1)} KB of input`);
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);