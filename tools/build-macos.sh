#!/usr/bin/env bash
#
# Builds the macOS artifacts (.app, .dmg and .zip) on macOS.
#
# electron-builder cannot produce a .dmg from Windows or Linux, so this script
# has to run on a Mac. It installs libmpv from Homebrew, links it into
# vendor/mpv, and packages both universal architectures.
#
# Usage:  ./tools/build-macos.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Checking host"
if [[ "$(uname)" != "Darwin" ]]; then
  echo "error: macOS artifacts can only be built on macOS (this is $(uname))."
  echo "       Use the macos-latest job in .github/workflows/build.yml instead."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "error: Homebrew is required. Install it from https://brew.sh"
  exit 1
fi

echo "==> Installing mpv (provides libmpv)"
brew install mpv 2>/dev/null || brew upgrade mpv

MPV_PREFIX="$(brew --prefix mpv)"
MPV_LIB="$MPV_PREFIX/lib/libmpv.2.dylib"
if [[ ! -f "$MPV_LIB" ]]; then
  echo "error: expected libmpv at $MPV_LIB"
  ls -l "$MPV_PREFIX/lib" || true
  exit 1
fi

echo "==> Linking libmpv into desktop/vendor/mpv"
mkdir -p desktop/vendor/mpv
rm -f desktop/vendor/mpv/libmpv.2.dylib
ln -s "$MPV_LIB" desktop/vendor/mpv/libmpv.2.dylib
ls -l desktop/vendor/mpv

echo "==> Installing desktop dependencies"
npm --prefix desktop install
npm --prefix desktop approve-scripts --yes koffi 2>/dev/null || true

echo "==> Generating icons"
powershell_equivalent=powershell
if command -v "$powershell_equivalent" >/dev/null 2>&1; then
  pwsh tools/make-icon.ps1 2>/dev/null || echo "  (icon generation skipped)"
fi

echo "==> Packaging for macOS (x64 + arm64)"
npm --prefix desktop run dist:mac

echo
echo "==> Done. Artifacts in desktop/dist/:"
ls -lh desktop/dist/ | grep -E '\.(dmg|zip)$' || true
echo
echo "Both builds are unsigned. To distribute them you need a Developer ID:"
echo "  export CSC_LINK='Developer ID Application: Your Name (TEAMID)'"
echo "  export CSC_KEY_PASSWORD='...'"
echo "  and a notarisation profile. Unsigned builds trigger a Gatekeeper warning."