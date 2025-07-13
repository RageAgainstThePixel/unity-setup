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
MOUNT_OUTPUT=$(hdiutil attach "unity-${VERSION}.dmg" || true)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep -o '/Volumes/[^ ]*' | head -n 1)
if [ -z "$MOUNT_POINT" ]; then
    echo "Failed to detect DMG mount point."
    exit 1
fi
# Wait up to 5 seconds for the mount point to appear
for _ in {1..5}; do
    if [ -d "$MOUNT_POINT" ]; then
        break
    fi
    sleep 1
done
if [ ! -d "$MOUNT_POINT" ]; then
    echo "Mount point $MOUNT_POINT does not exist after mounting. DMG may have failed to mount."
    exit 1
fi
echo "DMG mounted at $MOUNT_POINT"
UNITY_APP_PATH=$(find "$MOUNT_POINT" -name 'Unity.app' -type d -maxdepth 2 2>/dev/null | head -n 1)
if [ -z "$UNITY_APP_PATH" ]; then
    echo "Unity.app not found in mounted DMG."
    hdiutil detach "$MOUNT_POINT"
    exit 1
fi
echo "Installing Unity ${VERSION}..."
mkdir -p "$INSTALL_DIR/Unity ${VERSION}"
sudo cp -R "$UNITY_APP_PATH" "$INSTALL_DIR/Unity ${VERSION}/Unity.app"
echo "Unmounting DMG..."
hdiutil detach "$MOUNT_POINT"
echo "::endgroup::"
