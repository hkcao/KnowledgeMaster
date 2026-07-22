#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
cd "$ROOT"
swift build -c release

APP="$ROOT/release/KnowledgeMaster.app"
MACOS="$APP/Contents/MacOS"
RESOURCES="$APP/Contents/Resources"
rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"
cp "$ROOT/.build/release/KnowledgeMaster" "$MACOS/KnowledgeMaster"
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/.build/release/KnowledgeMaster_KnowledgeMaster.bundle/ChatRenderer" "$RESOURCES/ChatRenderer"
xcrun swift "$ROOT/scripts/generate-icon.swift" "$RESOURCES/AppIcon.icns"

codesign --force --deep --sign - "$APP"
echo "$APP"
