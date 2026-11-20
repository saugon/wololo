#!/bin/sh
# Builds Wololo in release, assembles app/dist/Wololo.app and signs it ad hoc.
#
#   app/scripts/build-app.sh             # leaves app/dist/Wololo.app
#   app/scripts/build-app.sh --install   # and copies it to ~/Applications
#
# --install replaces ~/Applications/Wololo.app only when it is a Wololo build
# (bundle id com.saugon.wololo-desk); anything else there is left alone and the script fails.
# It also removes ~/Applications/Wololo Desk.app, the app's former name, when it is one.
set -eu

bundle_id="com.saugon.wololo-desk"
app_name="Wololo.app"

install=0
case "$#:${1-}" in
  0:) ;;
  1:--install) install=1 ;;
  *)
    echo "usage: $0 [--install]" >&2
    exit 64
    ;;
esac

cd "$(dirname "$0")/.."

fail() {
  echo "build-app: $1" >&2
  exit 1
}

echo "→ Building WololoDesk (release)..."
swift build -c release --product WololoDesk || fail "swift build failed (needs Swift 5.9+ on macOS 14+)"
bin_dir="$(swift build -c release --show-bin-path)"
bin="$bin_dir/WololoDesk"
[ -x "$bin" ] || fail "no binary at $bin"
# Fonts, licences and the built-in themes, which the app looks for in Contents/Resources.
resources="$bin_dir/WololoDesk_WololoDesk.bundle"
[ -d "$resources" ] || fail "no resource bundle at $resources"

app="dist/$app_name"
echo "→ Assembling $app..."
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/WololoDesk"
ditto --norsrc --noextattr "$resources" "$app/Contents/Resources/WololoDesk_WololoDesk.bundle"
cp Resources/Info.plist "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"

echo "→ Signing ad hoc..."
codesign --force --sign - --entitlements Resources/WololoDesk.entitlements "$app" \
  || fail "codesign failed for $app"
codesign --verify --strict "$app" || fail "signature verification failed for $app"

built="$(pwd)/$app"
echo "✓ $built"

[ "$install" -eq 1 ] || exit 0

dest_dir="$HOME/Applications"
dest="$dest_dir/$app_name"
if [ -e "$dest" ]; then
  existing="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$dest/Contents/Info.plist" 2>/dev/null || true)"
  [ "$existing" = "$bundle_id" ] \
    || fail "$dest exists and is not Wololo (bundle id '${existing:-none}'): refusing to replace it"
  if pgrep -qf "$dest/Contents/MacOS/WololoDesk"; then
    echo "  Wololo is running from $dest: quit it and open it again to use the new build."
  fi
fi

# The app was called Wololo Desk: its old copy goes, so there is one app to open.
old="$dest_dir/Wololo Desk.app"
if [ -e "$old" ]; then
  old_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$old/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$old_id" = "$bundle_id" ]; then
    if pgrep -qf "$old/Contents/MacOS/WololoDesk"; then
      echo "  The old Wololo Desk is running: quit it and open Wololo."
    fi
    echo "→ Removing $old (the app's former name)..."
    rm -rf "$old"
  fi
fi

echo "→ Installing to $dest..."
mkdir -p "$dest_dir" || fail "cannot create $dest_dir"
rm -rf "$dest"
ditto "$built" "$dest" || fail "cannot copy $built to $dest"
echo "✓ $dest"
echo "  Open it with: open \"$dest\""
