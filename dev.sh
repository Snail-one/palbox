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

node_bin=''
if [[ -x "$PWD/.runtime/node/bin/node" ]] && "$PWD/.runtime/node/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  node_bin="$PWD/.runtime/node/bin/node"
else node_bin="$(command -v node || true)"; fi
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

node_options=()
if [[ -f "$PWD/.palbox.env" ]]; then node_options+=("--env-file=$PWD/.palbox.env"); fi
echo '首次打开页面时请在浏览器中设置管理员用户名和密码。'
if [[ "$watch" == true ]]; then
  echo '前后端服务独立运行，服务代码修改自动重启，页面修改后刷新。按 Ctrl+C 停止。'
  exec "$node_bin" "${node_options[@]}" scripts/start.js --watch
fi

echo '按 Ctrl+C 停止服务。'
exec "$node_bin" "${node_options[@]}" scripts/start.js
