#!/usr/bin/env bash
set -euo pipefail

if (( EUID == 0 || UID == 0 )); then
  echo '启动失败：禁止以 root（UID 0）运行 PalBox。请使用普通用户启动；sudo 仅用于执行 install.sh。' >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
data_dir="${PALBOX_DATA_DIR:-$PWD/data}"
if [[ $data_dir != /* ]]; then data_dir="$PWD/$data_dir"; fi
config_file="$data_dir/palbox/.env"
if [[ ! -f "$config_file" && -f "$PWD/.palbox.env" ]]; then config_file="$PWD/.palbox.env"; fi

watch=true
if [[ "${1:-}" == '--no-watch' ]]; then
  watch=false
elif [[ $# -gt 0 ]]; then
  echo '用法：./dev.sh [--no-watch]' >&2
  exit 2
fi

node_bin=''
if [[ -x "$data_dir/runtime/node/bin/node" ]] && "$data_dir/runtime/node/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  node_bin="$data_dir/runtime/node/bin/node"
elif [[ -x "$PWD/.runtime/node/bin/node" ]]; then
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
if [[ -f "$config_file" ]]; then node_options+=("--env-file=$config_file"); fi
echo '首次打开页面时请在浏览器中设置管理员用户名和密码。'
if [[ "$watch" == true ]]; then
  echo '前后端服务独立运行，服务代码修改自动重启，页面修改后刷新。按 Ctrl+C 停止。'
  exec "$node_bin" "${node_options[@]}" scripts/start.js --watch
fi

echo '按 Ctrl+C 停止服务。'
exec "$node_bin" "${node_options[@]}" scripts/start.js
