#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

watch=true
if [[ "${1:-}" == '--no-watch' ]]; then
  watch=false
elif [[ $# -gt 0 ]]; then
  echo '用法：./dev.sh [--no-watch]' >&2
  exit 2
fi

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
  for candidate in \
    "${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}"/node-versions/*/installation/bin/node \
    "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
      node_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$node_bin" ]] || ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo '启动失败：需要 Node.js 22 或以上版本，请安装或切换 Node 版本后重试。' >&2
  exit 1
fi

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8080}"
export PALBOX_DATA_DIR="${PALBOX_DATA_DIR:-$PWD/data}"
export PALBOX_AUTO_INSTALL="${PALBOX_AUTO_INSTALL:-false}"
export PALBOX_AUTO_START="${PALBOX_AUTO_START:-false}"

echo "游戏管理：http://$HOST:$PORT/#game"
echo "配置管理：http://$HOST:$PORT/#configuration"
echo '登录时使用首次初始化设置的管理密码。'
echo "数据目录：$PALBOX_DATA_DIR（已有数据沿用原登录密码）"
if [[ "$watch" == true ]]; then
  echo '后端修改自动重启，前端修改后刷新页面。按 Ctrl+C 停止。'
  exec "$node_bin" --watch server/index.js
fi

echo '按 Ctrl+C 停止服务。'
exec "$node_bin" server/index.js
