#!/usr/bin/env bash
# Builds an unsigned MSIX from dist/win-unpacked (run `npm run dist:win` first).
# Needs makemsix from https://github.com/microsoft/msix-packaging (Linux build: ./makelinux.sh --pack),
# or on Windows use: makeappx pack /d build\msix-layout /p "dist\Cordoval Code 0.3.0.msix"
set -euo pipefail
cd "$(dirname "$0")/.."
MAKEMSIX=${MAKEMSIX:-makemsix}
VERSION=$(node -p "require('./package.json').version")
LAYOUT=build/msix-layout
rm -rf "$LAYOUT" && mkdir -p "$LAYOUT"
cp -r dist/win-unpacked/. "$LAYOUT/"
cp -r packaging/msix/Assets "$LAYOUT/Assets"
sed "s/@VERSION@/$VERSION/" packaging/msix/AppxManifest.xml.in > "$LAYOUT/AppxManifest.xml"
OUT="dist/Cordoval Code $VERSION.msix"
rm -f "$OUT"
"$MAKEMSIX" pack -d "$LAYOUT" -p "$OUT"
echo "Built $OUT (unsigned). Sign with signtool before sideloading; the Store signs submissions itself."
