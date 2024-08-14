#!/bin/bash
set -e
dbus-uuidgen >/etc/machine-id && mkdir -p /var/lib/dbus/ && ln -sf /etc/machine-id /var/lib/dbus/machine-id
echo "::group::Installing Unity Hub..."
wget -qO - https://hub.unity3d.com/linux/keys/public | gpg --dearmor | sudo tee /usr/share/keyrings/Unity_Technologies_ApS.gpg >/dev/null
sudo sh -c 'echo "deb [signed-by=/usr/share/keyrings/Unity_Technologies_ApS.gpg] https://hub.unity3d.com/linux/repos/deb stable main" > /etc/apt/sources.list.d/unityhub.list'
sudo apt-get update
sudo apt-get install -y --no-install-recommends unityhub xvfb
sudo apt-get clean
sudo Xvfb :99 -screen 0 1024x768x24:32 &
export DISPLAY=:99
hubPath=$(which unityhub)
if [ -z "$hubPath" ]; then
    echo "Failed to install Unity Hub"
    exit 1
fi
sudo chmod -R 777 "$hubPath"
echo "UNITY_HUB /opt/unityhub/unityhub"
echo "::endgroup::"
