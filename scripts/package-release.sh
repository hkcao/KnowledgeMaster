#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
APP="$ROOT/release/KnowledgeMaster.app"
PLIST="$ROOT/Resources/Info.plist"
VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST")

"$ROOT/scripts/build-app.sh"

BINARY="$APP/Contents/MacOS/KnowledgeMaster"
ARCH_INFO=$(file "$BINARY")
if [[ "$ARCH_INFO" == *"arm64"* && "$ARCH_INFO" == *"x86_64"* ]]; then
    ARCH="universal"
elif [[ "$ARCH_INFO" == *"arm64"* ]]; then
    ARCH="arm64"
elif [[ "$ARCH_INFO" == *"x86_64"* ]]; then
    ARCH="x86_64"
else
    echo "无法识别应用架构：$ARCH_INFO" >&2
    exit 1
fi

NAME="ZhiYu-$VERSION-$ARCH"
STAGING="$ROOT/release/.dmg-root"
DMG="$ROOT/release/$NAME.dmg"
CHECKSUM="$DMG.sha256"

rm -rf "$STAGING" "$DMG" "$CHECKSUM"
mkdir -p "$STAGING"
ditto "$APP" "$STAGING/KnowledgeMaster.app"
ln -s /Applications "$STAGING/Applications"

hdiutil create -volname "知屿" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
rm -rf "$STAGING"

DIGEST=$(shasum -a 256 "$DMG" | awk '{print $1}')
print -r -- "$DIGEST  ${DMG:t}" > "$CHECKSUM"

echo "$DMG"
echo "$CHECKSUM"
