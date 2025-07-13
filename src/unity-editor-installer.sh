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
if [ -z "${VERSION}" ] || [ -z "${INSTALL_DIR}" ]; then
    echo "Usage: $0 <Unity Version> <Install Directory>"
    exit 1
fi
if [ ! -d "${INSTALL_DIR}" ]; then
    mkdir -p "${INSTALL_DIR}"
fi
url="https://beta.unity3d.com/download/unity-${VERSION}.dmg"
downloadPath="${RUNNER_TEMP}/unity-${VERSION}.dmg"
echo "::group::Installing Unity ${VERSION}..."
echo "Downloading Unity from ${url} to ${downloadPath}..."
wget -qO "${downloadPath}" "${url}"
if [ ! -f "${downloadPath}" ]; then
    echo "Failed to download Unity ${VERSION}"
    exit 1
fi
volume=$(hdiutil attach "${downloadPath}" -nobrowse | grep -o "/Volumes/.*" | head -n1)
if [ -z "${volume}" ]; then
    echo "Failed to mount ${downloadPath}"
    exit 1
fi
appPath=$(find "${volume}" -name "*.app" | head -n1)
if [ -z "${appPath}" ]; then
    echo "Failed to find Unity app in ${volume}"
    exit 1
fi
mkdir -p "${INSTALL_DIR}/Unity ${VERSION}"
cp -vrf "${appPath}" "${INSTALL_DIR}/Unity ${VERSION}"
sudo chmod -R 777 "${INSTALL_DIR}/Unity ${VERSION}/Unity.app"
hdiutil unmount "${volume}" -quiet
echo "::endgroup::"
