#!/bin/bash
# Builds build/Daily 8.app (universal arm64 + x86_64) and build/Daily-8-<version>.dmg.
# Set SIGN_IDENTITY to a "Developer ID Application" identity to sign for distribution; the default is ad-hoc signing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
NAME="Daily 8"
APP="$BUILD/$NAME.app"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
BUILD_NUMBER="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)"
DMG="$BUILD/Daily-8-$VERSION.dmg"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"

mkdir -p "$BUILD"
python3 "$ROOT/scripts/build_demo.py"
python3 "$ROOT/scripts/build_web.py"

echo "→ Compiling"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13.0" "$ROOT/macos/main.swift" -o "$BUILD/Daily8-$arch" 2> >(grep -v -e "^ld: warning" >&2)
done

echo "→ Assembling $NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create "$BUILD/Daily8-arm64" "$BUILD/Daily8-x86_64" -output "$APP/Contents/MacOS/Daily8"
rm "$BUILD/Daily8-arm64" "$BUILD/Daily8-x86_64"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUMBER/" "$ROOT/macos/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" > /dev/null
mkdir -p "$APP/Contents/Resources/web" && cp "$ROOT/dist/index.html" "$APP/Contents/Resources/web/"

if [ ! -f "$BUILD/AppIcon.icns" ] || [ "$ROOT/macos/make_icon.swift" -nt "$BUILD/AppIcon.icns" ]; then
  echo "→ Drawing icon"
  ICONSET="$BUILD/AppIcon.iconset"
  rm -rf "$ICONSET" && mkdir -p "$ICONSET"
  swift "$ROOT/macos/make_icon.swift" "$BUILD/icon-1024.png"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$BUILD/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" > /dev/null
    sips -z $((s * 2)) $((s * 2)) "$BUILD/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" > /dev/null
  done
  iconutil -c icns "$ICONSET" -o "$BUILD/AppIcon.icns"
  rm -rf "$ICONSET"
fi
cp "$BUILD/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

echo "→ Signing ($SIGN_IDENTITY)"
if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --sign - "$APP"
else
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
fi
codesign --verify --strict "$APP"

echo "→ Packaging DMG"
STAGE="$BUILD/dmg"
rm -rf "$STAGE" "$DMG" && mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "$NAME" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 "$DMG"
rm -rf "$STAGE"
if [ "$SIGN_IDENTITY" != "-" ]; then codesign --force --sign "$SIGN_IDENTITY" "$DMG"; fi
hdiutil verify -quiet "$DMG"

echo "✓ $DMG ($(du -h "$DMG" | cut -f1))"
