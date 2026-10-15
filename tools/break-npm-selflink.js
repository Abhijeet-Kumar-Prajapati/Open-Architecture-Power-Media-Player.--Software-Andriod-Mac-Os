/**
 * Removes the junction npm 10 leaves behind at
 * desktop/node_modules/<this package's own name>, pointing back at the
 * repository root.
 *
 * Why this matters enough for its own file:
 *
 *   npm --prefix desktop install
 *
 * On npm 11 that is all you need - no stray link. On npm 10, which is what
 * CI runs because setup-node pins Node 22, npm links the project it just
 * installed into its own node_modules:
 *
 *   desktop/node_modules/apm-open-player  ->  <repository root>   (junction)
 *
 * electron-builder then walks node_modules to collect dependencies, follows
 * the junction, and finds the entire repository: tools, docs, android, .git,
 * release/ - and desktop/dist/win-unpacked, which electron-builder is writing
 * at that exact moment. The result was a 313.7 MB installer where the real
 * one is 174.1 MB, and it grew every run because each build's own output was
 * packed into the next one.
 *
 * The junction also makes the build non-reproducible in a second way: the
 * installer shipped a copy of the source tree and the git history of the
 * machine that built it, whether or not anyone wanted that in a download.
 *
 * electron-builder.yml excludes the path as well, so the installer is correct
 * even if this is not run. This exists so the failure is loud and immediate
 * instead of silent and 140 megabytes larger.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop', 'node_modules');
const PKG = require(path.join(ROOT, 'package.json'));
const SELF = PKG.name;

const link = path.join(DESKTOP, SELF);

if (!fs.existsSync(link)) {
  console.log(`[selflink] nothing to do - ${SELF} is not linked into desktop/node_modules`);
  process.exit(0);
}

/* Only a link is removed. A real directory with real dependencies in it is
   left alone and reported, because deleting it would be data loss and this
   script has no business doing that. */
const stat = fs.lstatSync(link);

if (!stat.isSymbolicLink()) {
  console.error(
    `[selflink] ${path.relative(ROOT, link)} is a real directory, not a link.\n` +
    '  Refusing to delete it. If this is an npm regression, exclude it from\n' +
    '  electron-builder.yml instead.');
  process.exit(1);
}

fs.rmSync(link, { recursive: true, force: true });

if (fs.existsSync(link)) {
  console.error(`[selflink] could not remove ${path.relative(ROOT, link)}`);
  process.exit(1);
}
console.log(`[selflink] removed ${path.relative(ROOT, link)} (pointed at ${stat.isSymbolicLink() ? 'the repository root' : 'somewhere'})`);

/* Confirm nothing was taken with it. On Windows a junction can be removed by
   recursing into its target, which would delete the repository. */
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
  console.error('[selflink] the repository root is gone - the junction was followed and deleted');
  process.exit(1);
}
console.log('[selflink] repository root intact');
