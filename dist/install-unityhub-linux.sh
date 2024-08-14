#!/bin/bash
set -e
echo "::group::Installing Unity Hub..."
wget -qO - https://hub.unity3d.com/linux/keys/public | gpg --dearmor | sudo tee /usr/share/keyrings/Unity_Technologies_ApS.gpg >/dev/null
sudo sh -c 'echo "deb [signed-by=/usr/share/keyrings/Unity_Technologies_ApS.gpg] https://hub.unity3d.com/linux/repos/deb stable main" > /etc/apt/sources.list.d/unityhub.list'
wget http://security.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.0.0_1.0.2g-1ubuntu4.20_amd64.deb
sudo dpkg -i libssl1.0.0_1.0.2g-1ubuntu4.20_amd64.deb
rm libssl1.0.0_1.0.2g-1ubuntu4.20_amd64.deb
sudo apt update
sudo apt install -y --no-install-recommends --allow-downgrades unityhub libnotify4 libunwind-dev
sudo apt-get clean
hubPath=$(which unityhub)
if [ -z "$hubPath" ]; then
    echo "Failed to install Unity Hub"
    exit 1
fi
sudo chmod -R 777 "$hubPath"
echo "UNITY_HUB /opt/unityhub/unityhub"
echo "::endgroup::"
