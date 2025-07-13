#!/bin/bash
set -e
# This script is used to download and install older unity versions.
# https://discussions.unity.com/t/early-unity-versions-downloads/927331
# input arguments:
# 1. Unity Editor Version (Required)
# 2. Install Directory (Required)
# url example: https://beta.unity3d.com/download/unity-4.7.2.dmg
VERSION="$1"
INSTALL_DIR="$2"
if [ -z "$VERSION" ] || [ -z "$INSTALL_DIR" ]; then
    echo "Usage: $0 <Unity Version> <Install Directory>"
    exit 1
fi
if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
fi
URL="https://beta.unity3d.com/download/unity-${VERSION}.dmg"
echo "::group::Installing Unity ${VERSION}..."
curl -L -o "unity-${VERSION}.dmg" "$URL"
echo "Mounting DMG..."
hdiutil attach "unity-${VERSION}.dmg"
echo "Installing Unity ${VERSION}..."
mkdir -p "$INSTALL_DIR/Unity ${VERSION}"
sudo cp -R "/Volumes/Unity ${VERSION}/Unity.app" "$INSTALL_DIR/Unity ${VERSION}/Unity.app"
echo "Unmounting DMG..."
hdiutil detach "/Volumes/Unity ${VERSION}"
echo "::endgroup::"
