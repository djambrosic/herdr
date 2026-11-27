#!/usr/bin/env bash
# Copies the files of this repo back from ~/.config/herdr-app, after editing them there. A new file
# of mine (another mod, a theme) has to be copied into the repo by hand once; after that it is
# kept up to date here.
set -euo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

while IFS= read -r file; do
  if [ ! -f "$source/$file" ]; then
    echo "missing in the app folder: $file"
    continue
  fi
  if cmp -s "$source/$file" "$repository/$file"; then continue; fi
  cp -p "$source/$file" "$repository/$file"
  echo "saved $file"
done < <(cd "$repository" && find layouts themes mods keys.json settings.json programs.json -type f | sort)

git -C "$repository" status --short
