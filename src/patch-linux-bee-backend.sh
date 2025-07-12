#!/bin/bash
set -e
# https://discussions.unity.com/t/linux-editor-stuck-on-loading-because-of-bee-backend-w-workaround/854480
UNITY_EDITOR_PATH="$1"
UNITY_EDITOR_DATA_PATH="$(dirname "$UNITY_EDITOR_PATH")/Data"
if [[ -f "$UNITY_EDITOR_DATA_PATH"/bee_backend && ! -f "$UNITY_EDITOR_DATA_PATH"/.bee_backend ]]; then
    mv "$UNITY_EDITOR_DATA_PATH"/{,.}bee_backend
    cat >"$UNITY_EDITOR_DATA_PATH"/bee_backend <<'EOF'
#!/usr/bin/env bash
args=("$@")
for ((i = 0; i < "${#args[@]}"; ++i)); do
    case ${args[i]} in
    --stdin-canary)
        unset "args[i]"
        break
        ;;
    esac
done
"$(dirname "$0")/.$(basename "$0")" "${args[@]}"
EOF
    chmod +x "$UNITY_EDITOR_DATA_PATH"/bee_backend
fi
