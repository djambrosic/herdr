#!/usr/bin/env bash
# Puts my own Herdr files into ~/.config/herdr-app. They are copies, not links: Herdr only
# hot-reloads real files. Edit them in the app's folder and run ./save.sh to bring the repo up to
# date, or edit the repo and run this again.
#
# Only what is mine is in here: layouts, themes, mods, keys, settings and programs. Herdr's own
# files and the ones it writes (view.json, shared.json, the .d.ts files) stay where they are.
# Herdr itself is installed separately, and has to have started once so the folder exists.
set -euo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
today="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$target"

while IFS= read -r file; do
  source="$repository/$file"
  destination="$target/$file"
  mkdir -p "$(dirname "$destination")"

  # A link from an earlier version of this script is replaced by a real file.
  if [ -L "$destination" ]; then rm "$destination"; fi

  if [ -f "$destination" ]; then
    if cmp -s "$source" "$destination"; then continue; fi
    mv "$destination" "$destination.backup-$today"
    echo "kept your old $file as $file.backup-$today"
  fi

  cp -p "$source" "$destination"
  echo "copied $file"
done < <(cd "$repository" && find layouts themes mods keys.json settings.json programs.json -type f | sort)

echo "done. Switch to the office layout with: herdr-app do layout.switch '{\"name\":\"office\"}'"
