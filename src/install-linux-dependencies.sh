#!/bin/bash
## installs additional dependencies required for Unity on Linux
## usage: install-linux-dependencies.sh <unity-version>
set -e

unityVersion="$1"

if [ -z "$unityVersion" ]; then
    echo "Usage: $0 <unity-version>"
    exit 1
fi

# Unity 2019.{1,2}
case "$unityVersion" in
    2019.1.*|2019.2.*)
    curl -LO https://archive.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.0.0_1.0.2g-1ubuntu4.20_amd64.deb
    sudo dpkg -i libssl1.0.0_1.0.2g-1ubuntu4.20_amd64.deb
    rm libssl1.0.0_1.0.2g-1ubuntu4.20_amd64.deb
    ;;
esac

# Unity 2019.{3,4}/2020.*
case "$unityVersion" in
    2019.3.*|2019.4.*|2020.*)
    curl -LO https://archive.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.0g-2ubuntu4_amd64.deb
    sudo dpkg -i libssl1.1_1.1.0g-2ubuntu4_amd64.deb
    rm libssl1.1_1.1.0g-2ubuntu4_amd64.deb
    ;;
esac
