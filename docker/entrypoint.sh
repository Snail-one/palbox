#!/bin/sh
set -eu

if [ "$(id -u)" = 0 ]; then
  task_uid=${PUID:-1000}
  task_gid=${PGID:-1000}
  case "$task_uid:$task_gid" in *[!0-9:]*|:*|*:) echo 'PUID 和 PGID 必须为正整数。' >&2; exit 1;; esac
  if [ "$task_uid" -eq 0 ] || [ "$task_gid" -eq 0 ]; then echo '游戏和管理服务需要以非 root 用户运行。' >&2; exit 1; fi
  groupmod -o -g "$task_gid" node
  usermod -o -u "$task_uid" node
  mkdir -p /data /home/node/.steam/sdk64
  if [ "$(stat -c '%u:%g' /data)" != "$task_uid:$task_gid" ]; then chown -R "$task_uid:$task_gid" /data; fi
  chown -R "$task_uid:$task_gid" /home/node /opt/steamcmd
  exec gosu node "$@"
fi

exec "$@"
