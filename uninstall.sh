#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
systemd_dir="${PALBOX_SYSTEMD_DIR:-/etc/systemd/system}"
data_dir="${PALBOX_DATA_DIR:-$app_dir/data}"
config_file="$data_dir/palbox/.env"

usage() {
  cat <<'EOF'
用法：sudo bash ./uninstall.sh

停止并取消开机启动，移除当前项目注册的 palbox.service。
保留整个数据目录（含配置和运行依赖）以及全部程序文件。
不删除系统用户或依赖，不要求 Node.js 和应用文件完整。

  -h, --help        查看帮助

重新安装：sudo bash ./install.sh
EOF
}
die() { echo "卸载失败：$*" >&2; exit 1; }
step() { echo "[PalBox] $*"; }
text_columns() {
  local text=$1 i char width=0
  for (( i = 0; i < ${#text}; i++ )); do
    char=${text:i:1}
    if [[ $char == [[:ascii:]] ]]; then width=$((width + 1)); else width=$((width + 2)); fi
  done
  printf '%s' "$width"
}
print_card() {
  local title=$1 line width title_width line_width gap dashes
  shift
  title_width=$(text_columns "$title")
  width=$title_width
  for line in "$@"; do
    line_width=$(text_columns "$line")
    if (( line_width > width )); then width=$line_width; fi
  done
  if (( width < 28 )); then width=28; fi
  gap=$((width - title_width - 1))
  if (( gap < 2 )); then width=$((title_width + 3)); gap=2; fi
  printf -v dashes '%*s' "$gap" ''
  printf '╭─ %s %s╮\n' "$title" "${dashes// /─}"
  for line in "$@"; do
    gap=$((width - $(text_columns "$line")))
    printf '│ %s%*s │\n' "$line" "$gap" ''
  done
  printf -v dashes '%*s' "$((width + 2))" ''
  printf '╰%s╯\n' "${dashes// /─}"
}

while (( $# )); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) die "卸载不接受其他选项：$1。使用 --help 查看用法。" ;;
  esac
done

[[ "$(id -u)" == 0 ]] || die '请使用 sudo bash ./uninstall.sh 执行。'
for directory in "$app_dir" "$systemd_dir"; do
  [[ "$directory" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "目录必须为不含空格的绝对路径：$directory"
done
systemd_dir="$(realpath -m -- "$systemd_dir")"
unit_file="$systemd_dir/palbox.service"
command -v systemctl >/dev/null || die '需要 systemd。'
systemctl show-environment >/dev/null 2>&1 || die 'systemd 未运行，请在正常启动的服务器上执行。'

if [[ ! -f "$unit_file" ]]; then
  echo
  print_card '卸载' \
    '状态：当前项目没有已注册的开机服务' \
    "程序目录：$app_dir" \
    "部署配置：$config_file" \
    "数据目录：$data_dir" \
    '配置、存档、备份和程序仍在以上目录。' \
    '再次启用：sudo bash ./install.sh'
  exit 0
fi

# Verify service ownership before stopping or disabling anything. Uninstall
# stays independent of the application, its Node runtime and its configuration.
registered="$(sed -n 's/^WorkingDirectory=//p' "$unit_file")"
[[ -n "$registered" ]] || die '无法确认 palbox 服务属于当前项目，已中止卸载。'
[[ "$(realpath -m -- "$registered")" == "$app_dir" ]] || die "已有 palbox 服务运行在 $registered。请在原项目目录中卸载。"
if systemctl is-active --quiet palbox.service; then
  step '正在停止服务。游戏停服可能需要几分钟。'
  systemctl stop palbox.service
fi
if systemctl is-enabled --quiet palbox.service; then systemctl disable palbox.service; fi
rm -f -- "$unit_file"
systemctl daemon-reload
systemctl reset-failed palbox.service >/dev/null 2>&1 || true

echo
print_card '卸载' \
  '状态：已停止并取消开机启动' \
  "已移除：$unit_file" \
  "程序目录：$app_dir" \
  "部署配置：$config_file" \
  "数据目录：$data_dir" \
  '配置、存档、备份和程序仍在以上目录。' \
  '再次启用：sudo bash ./install.sh'
