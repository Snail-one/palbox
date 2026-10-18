# Docker 服务管理

一个容器运行 Palbox、SteamCMD 和一个帕鲁专用服务器，支持 Linux amd64。管理服务在游戏停服时继续运行，不需要 Docker socket。游戏文件首次运行时由 SteamCMD 下载，镜像本身不打包游戏文件。

镜像基于 `debian:13-slim`，从官方 `node:22-trixie-slim` 镜像复制 Node.js 22 运行时。SteamCMD 从 `client-update.steamstatic.com` 下载，配置下载重试与连接超时；使用系统自带的 `C.UTF-8`，不额外生成语言环境。除 `curl`、`ca-certificates`、`lib32gcc-s1`、`procps` 外，仅补充入口脚本需要的 `tini`、`gosu`，Node.js 运行库 `libstdc++6`、`libatomic1`，以及支持 `TZ` 的 `tzdata`。`tar` 和用户管理命令由 Debian 基础镜像提供。

## 启动

需要能运行 Docker Compose 的 Linux amd64 主机，以及帕鲁服务端需要的 CPU、内存和磁盘空间。官方列出推荐 4 核以上、16 GB 内存，较多玩家建议超过 32 GB，默认游戏端口为 UDP 8211：[官方运行要求](https://docs.palworldgame.com/getting-started/requirements/)。

```sh
cp .env.example .env
```

编辑 `.env`，将 `PALBOX_ADMIN_PASSWORD` 改成自己生成的至少 12 位随机密码，确认 `PALBOX_DATA_PATH`。例如使用 `openssl rand -hex 24` 生成密码。随后启动：

```sh
docker compose up -d --build
docker compose logs -f palbox
```

默认面板地址为 <http://127.0.0.1:8080>。用上述管理密码登录。首次启动自动安装并启动游戏服，安装进度查看页面的「运行日志 → 安装与更新」。安装失败后面板仍可访问，可查看日志并点击「安装服务端」重试。游戏管理员密码与面板登录密码独立，新的管理配置会生成随机游戏管理员密码并启用 REST API。

默认网页只绑定宿主机回环地址。需要从内网访问时，将 `PALBOX_WEB_BIND` 改成服务器内网 IP 或 `0.0.0.0`；公网使用 HTTPS 反向代理，并设置 `PALBOX_SECURE_COOKIE=true`。游戏 REST API 仅由管理后端通过容器内的回环地址访问，不映射到宿主机。

已有 `settings.json` 时沿用其中的密码哈希，修改 `PALBOX_ADMIN_PASSWORD` 不会重置已有面板密码。镜像入口以 root 处理挂载目录归属后，通过 gosu 切换到 `PUID/PGID` 指定的普通用户，游戏和 Node 均以该用户运行。

修改 Dockerfile 后，重新构建并更新容器：

```sh
docker compose up -d --build
```

此操作保留挂载的数据目录。安装日志若仍出现 `Missing configuration`，需继续排查 Steam 应用信息与网络访问；更换基础镜像或语言环境不能据此保证修复该错误。

## 目录

宿主机默认 `/srv/palbox` 挂载到容器 `/data`：

```text
/app/                                  Palbox 程序与网页
/opt/steamcmd/                          SteamCMD
/data/
├── server/                            游戏安装目录
│   ├── PalServer.sh
│   ├── steamapps/
│   └── Pal/Saved/
│       ├── Config/LinuxServer/PalWorldSettings.ini
│       ├── SaveGames/0/<世界 ID>/backup/world/  官方自动备份
│       └── Logs/
├── palbox/
│   ├── workspace.json                 配置库、输入基准与保存版本
│   ├── settings.json                  登录密码哈希、完整备份保留设置
│   └── tasks.json                     最近 40 个任务
├── backups/
│   ├── manual/
│   ├── scheduled/                     升级前的定时归档（保留）
│   └── before-update/
└── logs/
    ├── palbox.log
    ├── steamcmd.log
    └── game.log                       游戏标准输出和错误输出
```

日志超过约 5 MB 时轮换为 `.log.1`。游戏自身的日志也可能写入 `Pal/Saved/Logs`。备份归档以 `Pal/Saved` 为根，包含配置、世界与玩家存档，不包含游戏二进制或面板登录资料。更换镜像或重建容器保留 `/data` 即可；游戏客户端更新由 SteamCMD 任务完成。

## 配置与生效

配置通过 HTTP API 自动保存到服务器的 `workspace.json`。多设备共享该配置库；并发编辑使用版本号检查，遇到冲突保留本页编辑并提示刷新，不静默覆盖其他设备的修改。

- 「保存中」：正在提交到服务器；「已保存」：服务器已确认写入。
- 「待生效」：当前选中配置与游戏配置或本次启动使用的配置不同。
- 「已写入」：停服状态下配置已写入游戏文件。
- 「已生效」：本次启动使用该配置，并且游戏 REST API 已就绪。

自动保存不直接修改游戏的 INI 文件。点击「应用配置」会先校验当前配置；如果游戏正在运行，会保存世界、正常停服、备份、写入 INI，再启动并等待 REST API 就绪。停服失败时中止后续文件修改。游戏处于停止状态时只备份并写入配置，不自动启动。

应用管理配置需要 `RESTAPIEnabled=True`、非空 `AdminPassword` 和有效的 `RESTAPIPort`。已导入且关闭 REST API 的配置需要先调整这几个参数；不会静默覆盖用户导入的配置。`PALBOX_GAME_PORT` 控制游戏进程的实际监听端口和 Compose 映射，INI 中的 `PublicPort` 只负责公布端口。

「恢复输入配置」恢复面板中最初输入或导入的完整内容并自动保存，保留注释、未知字段与顺序；点击应用才影响游戏。已有 INI 配置可通过「配置管理」导入。服务端第一次建立配置库时，如果 `/data/server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini` 已存在，则将它作为初始输入；否则创建管理模板。

## 服务与备份

- 启动、停止、重启：管理游戏进程。停止优先调用官方 API 存档和关服，API 不可用时尝试 SIGTERM；未成功退出不会继续改写文件。
- 更新：先正常停服并创建更新前备份，再执行 SteamCMD `app_update 2394010 validate`；原先运行的游戏服会重新启动。
- 官方自动备份：由 `bIsUseBackupSaveData=True` 启用，游戏运行中自行生成，无需面板停服。面板展示 `SaveGames/0/<世界 ID>/backup/world/<时间>/` 中完整的世界和玩家备份，支持在线下载。官方保留档位为每 30 秒 5 份、每 10 分钟 6 份、每 1 小时 12 份、每 1 天 7 份：[官方说明](https://docs.palworldgame.com/settings-and-operation/configuration/#about-bisusebackupsavedata)。
- 恢复官方备份：确认备份属于当前世界，复制并验证后保存、停服，先创建完整备份再替换世界和玩家存档。保留当前配置与官方备份历史，原先运行的游戏会重新启动。
- 创建完整备份：人工触发，运行中会先存档并停服，压缩完成后重新启动。面板不再执行定时停服备份，升级时会移除旧计划；已有定时归档继续保留。
- 恢复备份：校验归档路径和文件类型，先保存并备份当前世界，在临时目录解压后整体替换 `Pal/Saved`。恢复后面板预设不变，可能显示「待生效」。可从页面下载备份留存。
- 保留数量：每类完整归档分别保留最近 1 到 100 份，默认 10 份，不影响游戏维护的官方备份；恢复时正在使用的备份不会被恢复前备份的清理操作删除。
- 日志与玩家：显示游戏版本、在线人数、FPS、运行时间，支持广播和移出玩家。

任务串行执行。更新、应用、备份和恢复期间其他管理任务会被拒绝。失败任务保留错误说明和日志，不会显示为成功；游戏异常退出后面板仍可访问，可以排查后手动启动。第一版不自动回滚游戏二进制或强制启动失败的进程。

执行 `docker compose stop` 会先停止接收新管理请求，再尝试保存并停止游戏进程；Compose 预留 120 秒退出时间。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PALBOX_ADMIN_PASSWORD` | 必填 | 首次初始化的管理密码，至少 12 位 |
| `PALBOX_ADMIN_PASSWORD_FILE` | 空 | 直接运行镜像时也可从文件读取首次密码 |
| `PALBOX_DATA_PATH` | `/srv/palbox` | Compose 宿主机持久化目录 |
| `PALBOX_WEB_BIND` | `127.0.0.1` | Compose 网页监听地址 |
| `PALBOX_WEB_PORT` | `8080` | Compose 网页宿主机端口 |
| `PALBOX_GAME_PORT` | `8211` | 游戏监听和宿主机 UDP 端口 |
| `PALBOX_AUTO_INSTALL` | `true` | 缺少服务端时自动安装 |
| `PALBOX_AUTO_START` | `true` | 安装完成或容器启动后自动启动游戏 |
| `PALBOX_GAME_ARGS` | `[]` | 额外启动参数，JSON 字符串数组 |
| `PALBOX_SECURE_COOKIE` | `false` | HTTPS 部署时为登录 Cookie 设置 Secure |
| `PUID` / `PGID` | `1000` / `1000` | 容器内运行用户与挂载数据归属 |

使用现有存档时，先将完整的 `Pal/Saved` 放入 `/srv/palbox/server/Pal/Saved`，不要只复制单个 `Level.sav`。首次部署可设置 `PALBOX_AUTO_START=false`，安装完成后检查输入配置与存档，再手动启动。

## 验证

```sh
npm test
npm run test:e2e
npm run test:e2e:managed
PALBOX_ADMIN_PASSWORD=test-compose-validation docker compose config --quiet
```

管理测试使用真实的临时子进程、HTTP API、文件写入和 tar 压缩恢复；SteamCMD 下载与实际游戏运行由模拟服务替代，测试不需要下载游戏，也不会连接现有游戏服。真实镜像构建和游戏启动仍需要在有 Docker 引擎权限、网络及足够资源的 Linux amd64 主机执行。

实现依据：[官方 SteamCMD 部署说明](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/)、[官方 REST API](https://docs.palworldgame.com/category/rest-api/)、[REST API 鉴权与访问说明](https://docs.palworldgame.com/api/rest-api/palwold-rest-api/)。
