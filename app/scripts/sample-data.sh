#!/bin/sh
# Writes a sample wololo data directory to <out-dir>, with its times stamped relative to now:
# every quoted "@now-N" in the templates becomes the epoch N seconds ago.
#
#   app/scripts/sample-data.sh <out-dir>
#   WOLOLO_DATA_DIR=<out-dir> .build/debug/WololoDesk
#
# Run it again right before each snapshot: heartbeats are a few seconds old when written, and after
# about 85 s every live run reads as orphaned.
#
# It also writes a sample goal to <out-dir>/goals, the copy of the planning goals that the app imports at
# launch. On a directory with the .wololo-sample marker the app imports it in memory only and writes no
# goals, unless WOLOLO_DESK_GOALS_DIR points it at a folder of its own.
#
# It replaces <out-dir>/runs and <out-dir>/goals, so it refuses a directory whose runs/ or goals/ it did not
# write itself (no .wololo-sample marker): pointed at a real data directory, it would wipe its history.
set -eu

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: $0 <out-dir>" >&2
  exit 64
fi

templates="$(cd "$(dirname "$0")/../Tests/Fixtures/sample-data" && pwd)"
out="$1"
now="$(date +%s)"

marker="$out/.wololo-sample"

for folder in runs goals; do
  if [ -e "$out/$folder" ] && [ ! -e "$marker" ]; then
    echo "$out/$folder exists and was not written by $(basename "$0") (no $marker): refusing to replace it" >&2
    exit 1
  fi
done

mkdir -p "$out"
touch "$marker"
rm -rf "$out/runs" "$out/goals"
cp -R "$templates/runs" "$out/runs"
cp -R "$templates/goals" "$out/goals"

find "$out/runs" "$out/goals" -type f \( -name '*.json' -o -name '*.jsonl' \) -exec \
  perl -pi -e 'BEGIN { $now = shift @ARGV } s/"\@now(?:-(\d+))?"/$now - ($1 || 0)/ge' "$now" {} +

echo "$out"
