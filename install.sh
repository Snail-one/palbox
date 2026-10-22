#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
systemd_dir="${PALBOX_SYSTEMD_DIR:-/etc/systemd/system}"
config_file="$app_dir/.palbox.env"
requested_user='' requested_host='' requested_port='' requested_api_port=''
temporary='' switched=false was_active=false was_enabled=false

usage() {
  cat <<'EOF'
用法：sudo bash ./install.sh [选项]

在当前项目目录安装并启动 PalBox，支持 Ubuntu / Debian x86_64 和 systemd。
自动使用项目所属的普通用户，数据保存在当前项目的 data/。
SteamCMD 和游戏服务端在安装完成后通过网页安装。

  --user 用户名     指定已有普通用户（默认沿用配置或项目属主）
  --host 地址       面板监听地址，默认 127.0.0.1
  --port 端口       面板端口，默认 8080
  --api-port 端口   后端本机端口，默认 8081
  -h, --help        查看帮助

程序不搬迁、不创建系统用户，不递归修改已有数据属主。
重复执行保留已有配置和 data/，重新注册并启动当前目录中的程序。
EOF
}
die() { echo "安装失败：$*" >&2; exit 1; }
step() { echo "[PalBox] $*"; }
while (( $# )); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --user|--host|--port|--api-port)
      (( $# >= 2 )) || die "$1 缺少参数。"
      case "$1" in
        --user) requested_user=$2 ;;
        --host) requested_host=$2 ;;
        --port) requested_port=$2 ;;
        --api-port) requested_api_port=$2 ;;
      esac
      shift 2 ;;
    *) die "未知选项：$1。使用 --help 查看用法。" ;;
  esac
done

[[ "$(id -u)" == 0 ]] || die '请使用 sudo bash ./install.sh 执行。'
[[ -r /etc/os-release ]] || die '无法识别系统。'
os_id="$(. /etc/os-release; printf '%s' "$ID")"
[[ "$os_id" == ubuntu || "$os_id" == debian ]] || die '仅支持 Ubuntu / Debian。'
[[ "$(dpkg --print-architecture)" == amd64 ]] || die '需要 x86_64 / amd64 服务器。'
command -v systemctl >/dev/null || die '需要 systemd。'
systemctl show-environment >/dev/null 2>&1 || die 'systemd 未运行，请在正常启动的服务器上执行。'
for entry in backend/index.js frontend/index.js shared/domain/config.js scripts/start.js dev.sh package.json; do
  [[ -f "$app_dir/$entry" ]] || die "项目文件不完整：缺少 $entry，请下载完整项目后执行。"
done
for directory in "$app_dir" "$systemd_dir"; do
  [[ "$directory" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "目录必须为不含空格的绝对路径：$directory"
done
systemd_dir="$(realpath -m -- "$systemd_dir")"
unit_file="$systemd_dir/palbox.service"
data_dir="$app_dir/data"

# Read configuration as data. Never source an application-owned file as root.
read_setting() {
  local key value result=''
  if [[ -f "$config_file" ]]; then
    while IFS='=' read -r key value || [[ -n "$key" ]]; do
      if [[ "$key" == "$1" ]]; then
        value="${value%$'\r'}"
        if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; fi
        result="$value"
      fi
    done < "$config_file"
  fi
  printf '%s' "$result"
}
service_user="${requested_user:-$(read_setting PALBOX_SERVICE_USER)}"
if [[ -z "$service_user" ]]; then
  if [[ "$(stat -c '%u' "$app_dir")" != 0 ]]; then service_user="$(stat -c '%U' "$app_dir")";
  else service_user="${SUDO_USER:-}"; fi
fi
[[ -n "$service_user" && "$service_user" != root ]] || die '无法推断普通运行用户。请在普通用户拥有的目录中部署，或通过 --user 用户名 指定已有普通用户。'
[[ "$service_user" =~ ^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$ ]] || die '运行用户名格式无效。'
id -u "$service_user" >/dev/null 2>&1 || die "运行用户 $service_user 不存在，请指定已有普通用户。"
[[ "$(id -u "$service_user")" != 0 ]] || die '不能以 root 用户运行游戏服务。'
service_group="$(id -gn "$service_user")"
runuser -u "$service_user" -- test -r "$app_dir/backend/index.js" && runuser -u "$service_user" -- test -x "$app_dir" || die "$service_user 无法访问项目目录。请把项目放在该用户能够访问的位置。"
listen_host="${requested_host:-$(read_setting HOST)}"
listen_port="${requested_port:-$(read_setting PORT)}"
api_port="${requested_api_port:-$(read_setting API_PORT)}"
listen_host="${listen_host:-127.0.0.1}"
listen_port="${listen_port:-8080}"
api_port="${api_port:-8081}"
[[ "$listen_host" =~ ^[A-Za-z0-9.:_-]+$ ]] || die '监听地址格式无效。'
for number in "$listen_port" "$api_port"; do
  [[ "$number" =~ ^[0-9]{1,5}$ ]] && (( 10#$number >= 1024 && 10#$number <= 65535 )) || die '端口必须为 1024–65535。'
done
listen_port=$((10#$listen_port))
api_port=$((10#$api_port))
[[ "$listen_port" != "$api_port" ]] || die '面板和后端必须使用不同端口。'
previous_data="$(read_setting PALBOX_DATA_DIR)"
[[ -z "$previous_data" || "$(realpath -m -- "$previous_data")" == "$(realpath -m -- "$data_dir")" ]] || die "已有配置使用其他数据目录：$previous_data。请先停服、备份并迁移到项目的 data/，避免切换到空数据。"
if [[ -f "$unit_file" ]]; then
  previous_app="$(sed -n 's/^WorkingDirectory=//p' "$unit_file")"
  [[ -z "$previous_app" || "$(realpath -m -- "$previous_app")" == "$app_dir" ]] || die "已有 palbox 服务运行在 $previous_app。请先处理原部署，再为当前目录注册服务。"
fi

cleanup() {
  local result=$?
  trap - EXIT
  set +e
  if (( result != 0 )) && [[ "$switched" == true ]]; then
    echo '[PalBox] 启动未完成，正在恢复原部署配置。' >&2
    systemctl stop palbox.service >/dev/null 2>&1 || true
    if [[ -f "$temporary/previous.env" ]]; then cp -p -- "$temporary/previous.env" "$config_file"; else rm -f -- "$config_file"; fi
    if [[ -f "$temporary/previous.service" ]]; then cp -p -- "$temporary/previous.service" "$unit_file"; else rm -f -- "$unit_file"; fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [[ "$was_enabled" == false ]]; then systemctl disable palbox.service >/dev/null 2>&1 || true; fi
    if [[ "$was_active" == true ]]; then systemctl start palbox.service >/dev/null 2>&1 || echo '[PalBox] 原服务未能重新启动，请执行 journalctl -u palbox 查看原因。' >&2; fi
  fi
  if [[ -n "$temporary" ]]; then rm -rf -- "$temporary"; fi
  if (( result != 0 )); then echo '[PalBox] 未删除游戏、存档或备份，请排查错误后重试。' >&2; fi
  exit "$result"
}
trap cleanup EXIT

step '安装系统依赖。'
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl lib32gcc-s1

temporary="$(mktemp -d /tmp/palbox-install.XXXXXX)"
install -d -m 0755 "$systemd_dir"
if [[ ! -e "$data_dir" ]]; then install -d -o "$service_user" -g "$service_group" -m 0700 "$data_dir"; fi
[[ -d "$data_dir" ]] || die 'data 路径不是目录。'
runuser -u "$service_user" -- test -r "$data_dir" && runuser -u "$service_user" -- test -w "$data_dir" && runuser -u "$service_user" -- test -x "$data_dir" || die "$service_user 无权读写 data/。请使用该数据所属的用户，不要混用运行用户；安装器不会自动修改已有数据属主。"
if [[ ! -e "$app_dir/.runtime" ]]; then install -d -o "$service_user" -g "$service_group" -m 0755 "$app_dir/.runtime"; fi
node_bin="$app_dir/.runtime/node/bin/node"
if [[ ! -x "$node_bin" ]] || ! runuser -u "$service_user" -- "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  step '下载并校验项目独立的 Node.js 24 LTS。'
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 300 \
    https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$temporary/SHASUMS256.txt"
  checksum='' node_archive=''
  while read -r sum name; do
    if [[ "$name" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ && "$sum" =~ ^[a-fA-F0-9]{64}$ ]]; then
      [[ -z "$node_archive" ]] || die 'Node.js 清单包含多个匹配版本。'
      checksum="$sum" node_archive="$name"
    fi
  done < "$temporary/SHASUMS256.txt"
  [[ -n "$node_archive" ]] || die '无法从官方清单确定 Node.js 安装包。'
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 600 \
    "https://nodejs.org/dist/latest-v24.x/$node_archive" -o "$temporary/$node_archive"
  printf '%s  %s\n' "$checksum" "$temporary/$node_archive" > "$temporary/node.sha256"
  sha256sum -c "$temporary/node.sha256" || die 'Node.js 校验失败，已中止安装。'
  install -d -m 0755 "$temporary/node"
  tar --no-same-owner -xJf "$temporary/$node_archive" --strip-components=1 -C "$temporary/node"
  chown -R "$service_user:$service_group" "$temporary/node"
  [[ ! -e "$app_dir/.runtime/node" ]] || mv -- "$app_dir/.runtime/node" "$app_dir/.runtime/node.previous-$(date +%s)-$$"
  mv -- "$temporary/node" "$app_dir/.runtime/node"
fi
runuser -u "$service_user" -- "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die 'Node.js 运行检查失败。'
runuser -u "$service_user" -- "$node_bin" --input-type=module -e 'import { isIP } from "node:net"; process.exit(isIP(process.argv[1]) || process.argv[1] === "localhost" ? 0 : 1);' "$listen_host" || die '请使用有效的 IPv4、IPv6 地址或 localhost。'

step "为当前项目配置后台服务，运行用户：$service_user。"
if [[ -f "$config_file" ]]; then
  cp -p -- "$config_file" "$temporary/previous.env"
  awk '!/^(PALBOX_SERVICE_USER|NODE_ENV|HOST|PORT|API_HOST|API_PORT|PALBOX_DATA_DIR)=/' "$config_file" > "$temporary/palbox.env"
else printf '# PalBox 配置，终端启动与 systemd 共用\n' > "$temporary/palbox.env"; fi
cat >> "$temporary/palbox.env" <<EOF
PALBOX_SERVICE_USER=$service_user
NODE_ENV=production
HOST=$listen_host
PORT=$listen_port
API_HOST=127.0.0.1
API_PORT=$api_port
PALBOX_DATA_DIR=$data_dir
EOF
cat > "$temporary/palbox.service" <<EOF
# Managed by PalBox install.sh
[Unit]
Description=PalBox
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$service_user
Group=$service_group
WorkingDirectory=$app_dir
ExecStart=/bin/bash $app_dir/dev.sh --no-watch
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=420
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
if [[ -f "$unit_file" ]]; then cp -p -- "$unit_file" "$temporary/previous.service"; fi
if systemctl is-active --quiet palbox.service; then was_active=true; fi
if systemctl is-enabled --quiet palbox.service; then was_enabled=true; fi
switched=true
if [[ "$was_active" == true ]]; then systemctl stop palbox.service; fi
install -o "$service_user" -g "$service_group" -m 0600 "$temporary/palbox.env" "$config_file"
install -m 0644 "$temporary/palbox.service" "$unit_file"
systemctl daemon-reload
systemctl start palbox.service
health_host="$listen_host"
case "$health_host" in 0.0.0.0) health_host=127.0.0.1 ;; ::) health_host=::1 ;; esac
if [[ "$health_host" == *:* ]]; then health_host="[$health_host]"; fi
healthy=false
for attempt in {1..30}; do
  if runuser -u "$service_user" -- "$node_bin" --input-type=module -e '
    const [frontend, backend] = process.argv.slice(1);
    try {
      const results = await Promise.all([
        fetch(frontend + "/api/bootstrap", { signal: AbortSignal.timeout(2000) }).then(async r => r.ok && (await r.json()).mode === "managed"),
        fetch(backend + "/healthz", { signal: AbortSignal.timeout(2000) }).then(r => r.ok)
      ]);
      process.exit(results.every(Boolean) ? 0 : 1);
    } catch { process.exit(1); }
  ' "http://$health_host:$listen_port" "http://127.0.0.1:$api_port"; then healthy=true; break; fi
  systemctl is-active --quiet palbox.service || break
  sleep 1
done
if [[ "$healthy" != true ]]; then
  journalctl -u palbox.service -n 30 --no-pager >&2 || true
  die '服务未通过启动检查，请查看以上日志。'
fi
systemctl enable palbox.service
switched=false

step '安装完成，PalBox 已启动并设置开机启动。'
echo "程序目录：$app_dir"
echo "运行用户：$service_user"
echo "面板地址：http://$health_host:$listen_port"
echo "部署配置：$config_file"
echo "数据目录：$data_dir"
echo "SteamCMD：$data_dir/steamcmd/steamcmd.sh（网页安装后生成）"
echo "游戏目录：$data_dir/server（网页安装后生成）"
echo '首次打开网页创建管理员，依次点击“安装 SteamCMD”“安装服务端”“启动”。'
if [[ "$listen_host" == 127.0.0.1 || "$listen_host" == ::1 || "$listen_host" == localhost ]]; then
  echo "远程访问：ssh -N -L 18080:$health_host:$listen_port 登录用户@服务器IP"
  echo '随后打开 http://127.0.0.1:18080'
else echo '请使用服务器对应的 IP 访问面板，并从本机或可信内网完成首次管理员初始化。'; fi
echo '游戏对外连接需放行 UDP 8211（默认），API 仅监听本机。'
echo '查看日志：sudo journalctl -u palbox -f'
echo '终端调试：先 sudo systemctl stop palbox，再以相同运行用户执行 bash ./dev.sh --no-watch'
