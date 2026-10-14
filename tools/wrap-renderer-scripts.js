/**
 * Renderer scripts are plain <script> tags, so every top-level `const` shares
 * one global scope - four files each declaring `const { $, $$ }` is a fatal
 * SyntaxError. Wrapping each file in an IIFE gives every file its own scope
 * while keeping the deliberate `window.X = X` exports.
 *
 * Usage: node tools/wrap-renderer-scripts.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'desktop', 'src', 'renderer', 'js');
const HEADER = '(function () {';
const FOOTER = '})();';

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const full = path.join(dir, file);
  let src = fs.readFileSync(full, 'utf8');

  if (src.includes(HEADER)) {
    console.log(`  skip   ${file} (already wrapped)`);
    continue;
  }

  // Keep the 'use strict' directive first - it must be the very first
  // statement in the file, so it stays outside the IIFE.
  let body = src;
  let prefix = '';
  const strict = body.match(/^\s*'use strict';\s*\n/);
  if (strict) {
    prefix = strict[0];
    body = body.slice(strict[0].length);
  }

  fs.writeFileSync(full, `${prefix}${HEADER}\n${body.trimEnd()}\n${FOOTER}\n`, 'utf8');
  console.log(`  wrapped ${file}`);
}