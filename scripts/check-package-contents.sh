#!/usr/bin/env bash
# Assert the .vsix ships exactly what it should, and nothing else.
#
# Not a hypothetical. Three things had been shipping to end users unnoticed: the compiled
# integration-test harness in out/, this repository's CLAUDE.md, and a dev script. None of them
# broke anything, which is precisely why nobody would have looked.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build >/dev/null
npm run package >/dev/null
vsix=$(ls -t ./*.vsix | head -1)
echo "checking $vsix"

# Everything outside packs/, dist/ and media/ has to be on this list by name.
allowed=$(cat <<'EOF'
extension.vsixmanifest
[Content_Types].xml
extension/package.json
extension/readme.md
extension/LICENSE.txt
extension/changelog.md
EOF
)

unexpected=$(unzip -Z1 "$vsix" \
  | grep -vE '^extension/(packs|dist|media)/' \
  | grep -vxF "$allowed" || true)

if [ -n "$unexpected" ]; then
  echo "unexpected files in the published extension:" >&2
  echo "$unexpected" >&2
  echo "add them to .vscodeignore, or to the allow-list in $0 if they belong." >&2
  exit 1
fi

# The packs are the product; shipping a bundle without them is an extension that teaches nothing.
for required in \
  extension/dist/extension.js \
  extension/packs/rust-from-scratch/chapter.toml \
  extension/packs/python-common-errors/chapter.toml
do
  unzip -Z1 "$vsix" | grep -qxF "$required" || {
    echo "missing from the published extension: $required" >&2
    exit 1
  }
done

echo "package contents OK ($(unzip -Z1 "$vsix" | wc -l | tr -d ' ') files)"
