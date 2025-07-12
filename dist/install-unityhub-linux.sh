#!/bin/bash
set -e
sudo sh -c 'dbus-uuidgen >/etc/machine-id && mkdir -p /var/lib/dbus/ && ln -sf /etc/machine-id /var/lib/dbus/machine-id'
echo "::group::Installing Unity Hub..."
wget -qO - https://hub.unity3d.com/linux/keys/public | gpg --dearmor | sudo tee /usr/share/keyrings/Unity_Technologies_ApS.gpg >/dev/null
sudo sh -c 'echo "deb [signed-by=/usr/share/keyrings/Unity_Technologies_ApS.gpg] https://hub.unity3d.com/linux/repos/deb stable main" > /etc/apt/sources.list.d/unityhub.list'
echo "deb https://archive.ubuntu.com/ubuntu jammy main universe" | sudo tee /etc/apt/sources.list.d/jammy.list
sudo apt-get update
sudo apt-get install -y --no-install-recommends unityhub ffmpeg libgtk2.0-0 libglu1-mesa libgconf-2-4
sudo apt-get clean
# Unity 2019.x/2020.x
curl -LO https://archive.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.0g-2ubuntu4_amd64.deb
sudo dpkg -i libssl1.1_1.1.0g-2ubuntu4_amd64.deb
# https://discussions.unity.com/t/linux-editor-stuck-on-loading-because-of-bee-backend-w-workaround/854480
UNITY_EDITOR_DATA_PATH="$(dirname "$UNITY_EDITOR_PATH")"/Data
if [[ -f "$UNITY_EDITOR_DATA_PATH"/bee_backend && ! -f "$UNITY_EDITOR_DATA_PATH"/.bee_backend ]]; then
    mv "$UNITY_EDITOR_DATA_PATH"/{,.}bee_backend
    cat >"$UNITY_EDITOR_DATA_PATH"/bee_backend <<'EOF'
#!/usr/bin/env bash
args=("$@")
for ((i = 0; i < "${#args[@]}"; ++i)); do
    case ${args[i]} in
    --stdin-canary)
        unset args[i]
        break
        ;;
    esac
done
"$(dirname "$0")/.$(basename "$0")" "${args[@]}"
EOF
    chmod +x "$UNITY_EDITOR_DATA_PATH"/bee_backend
fi
sudo sed -i 's/^\(.*DISPLAY=:.*XAUTHORITY=.*\)\( "\$@" \)2>&1$/\1\2/' /usr/bin/xvfb-run
sudo printf '#!/bin/bash\nxvfb-run --auto-servernum /opt/unityhub/unityhub "$@" 2>/dev/null' | sudo tee /usr/bin/unity-hub >/dev/null
sudo chmod 777 /usr/bin/unity-hub
hubPath=$(which unityhub)
if [ -z "$hubPath" ]; then
    echo "Failed to install Unity Hub"
    exit 1
fi
sudo chmod -R 777 "$hubPath"
echo "UNITY_HUB /opt/unityhub/unityhub"
echo "::endgroup::"
