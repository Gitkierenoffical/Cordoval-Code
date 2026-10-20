#!/usr/bin/env bash
# Downloads the MIT-licensed OpenCode engine binaries bundled inside Cordoval Code.
set -e
V=${ENGINE_VERSION:-1.19.0}
cd "$(dirname "$0")/.."
for pair in linux:linux-x64 win:windows-x64; do
  o=${pair%%:*}; p=${pair#*:}; mkdir -p vendor/$o tmpx
  (cd tmpx && npm pack opencode-$p@$V >/dev/null)
  tar xzf tmpx/opencode-$p-$V.tgz -C tmpx && cp tmpx/package/bin/* vendor/$o/ && rm -rf tmpx
done
