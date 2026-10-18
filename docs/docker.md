# Docker 服务管理

前端容器运行网页与 API 代理，后端 `palbox` 容器运行管理 API、SteamCMD 和一个帕鲁专用服务器，支持 Linux amd64。前端没有游戏数据挂载，后端 HTTP 端口仅在 Compose 网络内开放。管理服务在游戏停服时继续运行，不需要 Docker socket。游戏文件首次运行时由 SteamCMD 下载，镜像本身不打包游戏文件。

后端镜像基于 `debian:13-slim`，从官方 `node:22-trixie-slim` 镜像复制 Node.js 22 运行时。SteamCMD 从 `client-update.steamstatic.com` 下载，配置下载重试与连接超时；使用系统自带的 `C.UTF-8`，不额外生成语言环境。除 `curl`、`ca-certificates`、`lib32gcc-s1`、`procps` 外，仅补充入口脚本需要的 `tini`、`gosu`，Node.js 运行库 `libstdc++6`、`libatomic1`，以及支持 `TZ` 的 `tzdata`。`tar` 和用户管理命令由 Debian 基础镜像提供。

前端镜像基于 `node:22-trixie-slim`，仅包含浏览器资源、共享领域模块和静态代理服务。Dockerfile 提供 `frontend` / `backend` 两个独立构建目标；Compose 会分别构建。单独构建时使用 `docker build --target frontend -t palbox-frontend:local .` 和 `docker build --target backend -t palbox:local .`。

GitHub Actions 在推送 Git tag 后发布两个 GHCR 镜像，同时保留原始 tag 和 `latest` 标签，也支持手动指定已有 tag 发布。在线部署只需独立的 `compose.ghcr.yaml`，使用 `docker compose -f compose.ghcr.yaml pull` 拉取，再执行 `docker compose -f compose.ghcr.yaml up -d` 启动，无需源码和 Dockerfile。固定版本时修改该文件中的两个镜像标签。完整步骤见 [GitHub CI/CD](ci-cd.md)。

## 启动

需要能运行 Docker Compose 的 Linux amd64 主机，以及帕鲁服务端需要的 CPU、内存和磁盘空间。官方列出推荐 4 核以上、16 GB 内存，较多玩家建议超过 32 GB，默认游戏端口为 UDP 8211：[官方运行要求](https://docs.palworldgame.com/getting-started/requirements/)。

所有容器配置都直接写在项目根目录的 `compose.yaml` 中，不再读取 `.env`。首次启动前编辑该文件：

- 确认 `volumes` 中的宿主机数据目录，默认 `./data`。
- 修改 `PALBOX_GAME_PORT` 时，同步修改 `ports` 中游戏端口映射的宿主机一侧。

随后启动：

```sh
docker compose up -d --build
docker compose logs -f frontend palbox
```

默认面板地址为 <http://127.0.0.1:8080>。**首次访问**会进入初始化页面，设置管理员用户名和至少 12 位密码，随后用该账号登录。进入「游戏管理」后点击「安装服务端」下载游戏服务端，安装完成后点击「启动」；安装进度可在「运行日志 → 安装与更新」查看。安装失败后面板仍可访问，可查看日志后重试。游戏管理员密码与面板登录密码独立，新的管理配置会生成随机游戏管理员密码并启用 REST API。

默认网页只绑定宿主机回环地址。需要从内网访问时，将 `compose.yaml` 中 `frontend.ports` 的 `127.0.0.1` 改成服务器内网 IP 或 `0.0.0.0`；公网使用 HTTPS 反向代理，并设置 `PALBOX_SECURE_COOKIE=true`。游戏 REST API 仅由管理后端通过容器内的回环地址访问，不映射到宿主机。

初始化完成前，只有来自回环或内网地址（RFC1918、IPv6 ULA、链路本地，包括可信反向代理转发的私网地址）的请求可以创建管理员；公网来源会返回 403。仍建议先在本机或可信内网完成初始化，再把端口暴露到更大范围。管理员登录失败按客户端地址计次，连续失败后仅短暂冷却，避免攻击者长期锁死登录。

前端静态页面与代理响应附带 CSP、X-Frame-Options、Referrer-Policy 和 Permissions-Policy；JSON API 与下载响应附带 `default-src 'none'` 的 CSP。JSON 请求体同时受大小上限和读取截止时间约束，超时连接会被关闭。TLS 终止、HSTS 和公网访问控制仍由反向代理负责。

已有 `settings.json` 时沿用其中的管理员账号。旧版 `settings.json`（`admin` 只有 `salt`/`hash`、没有 `username`）不兼容当前版本：启动会失败并提示先备份数据目录、删除对应的 `palbox/settings.json` 后重新初始化；配置库、存档、备份和日志不受影响。镜像入口以 root 处理挂载目录归属后，通过 gosu 切换到普通用户，游戏和 Node 均以该用户运行；默认使用 `1000:1000`，需要时可通过可选的 `PUID`/`PGID` 环境变量覆盖。

修改 Dockerfile 后，重新构建并更新容器：

```sh
docker compose up -d --build
```

此操作保留挂载的数据目录。安装日志若仍出现 `Missing configuration`，需继续排查 Steam 应用信息与网络访问；更换基础镜像或语言环境不能据此保证修复该错误。

## 目录

宿主机默认 `./data` 挂载到容器 `/data`：

```text
/app/backend/                          后端 API（palbox 容器）
/app/frontend/                         网页与代理（frontend 容器）
/app/shared/                           两个镜像各自包含的共享领域模块
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
│   ├── settings.json                  管理员用户名、密码哈希、完整备份保留设置、自动启动、启动参数
│   ├── tasks.json                     最近 40 个任务
│   └── imports/                       导入存档的临时暂存（1 小时后清理）
├── backups/
│   ├── manual/
│   ├── scheduled/                     升级前的定时归档（保留）
│   └── before-update/
└── logs/
    ├── palbox.log
    ├── steamcmd.log
    └── game.log                       游戏标准输出和错误输出
```

日志超过约 5 MB 时轮换为 `.log.1`。网页默认显示「全部日志」，在一个窗口按接收顺序展示游戏、安装更新和面板日志，并标注时间与来源，也可切换到单一来源。安装和更新通过伪终端运行 SteamCMD，进度按行实时写入；日志面板滚动到底部时会自动跟随新内容，向上滚动后保持当前位置。统一视图和三个分类视图均显示 UTC 毫秒时间戳，例如 `[2026-10-18 08:01:02.123 UTC]`。时间在接收日志时记录，同一行分块输出或进度回车覆盖沿用该行时间，刷新页面不会改变记录时间；旧记录缺少时间时保留原样。统一记录保存在 `logs/combined.jsonl`，同样按约 5 MB 轮换；首次使用时保留各来源最近的历史（旧日志没有统一时间，按来源归并），后续输出按接收顺序记录。网页通过独立的实时连接显示最近 64 KB 日志，不等待游戏状态接口；断线会自动重连，切换频道和离开日志页面时关闭旧连接。页面会清理终端颜色、标题及进度控制码，分类日志文件在行首写入时间戳，并保留其余输出内容与终端控制码。向上滚动时保留阅读位置，滚动到底部后继续跟随新日志。游戏自身的日志也可能写入 `Pal/Saved/Logs`。备份归档以 `Pal/Saved` 为根，包含配置、世界与玩家存档，不包含游戏二进制或面板登录资料。更换镜像或重建容器保留 `/data` 即可；游戏客户端更新由 SteamCMD 任务完成。

## 配置与生效

配置通过 HTTP API 自动保存到服务器的 `workspace.json`。多设备共享该配置库；并发编辑使用版本号检查，遇到冲突保留本页编辑并提示刷新，不静默覆盖其他设备的修改。

- 「保存中」：正在提交到服务器；「已保存」：服务器已确认写入。
- 「待生效」：当前选中配置与游戏配置或本次启动使用的配置不同。
- 「已写入」：停服状态下配置已写入游戏文件。
- 「已生效」：本次启动使用该配置，并且游戏 REST API 已就绪。

自动保存不直接修改游戏的 INI 文件。点击「应用配置」会先校验当前配置；如果游戏正在运行，会保存世界、正常停服、备份、写入 INI，再启动并等待 REST API 就绪。停服失败时中止后续文件修改。游戏处于停止状态时只备份并写入配置，不自动启动。

应用管理配置需要 `RESTAPIEnabled=True`、非空 `AdminPassword` 和有效的 `RESTAPIPort`。已导入且关闭 REST API 的配置需要先调整这几个参数；不会静默覆盖用户导入的配置。`PALBOX_GAME_PORT` 控制游戏进程的实际监听端口，修改时要同步修改 `compose.yaml` 中 `ports` 的宿主机端口；INI 中的 `PublicPort` 只负责公布端口。

游戏启动参数通过「游戏管理 → 服务器概况 → 游戏服务」中的「启动参数」按钮编辑，每行一个参数，保存到 `palbox/settings.json` 的 `gameArgs`。保存不会自动重启游戏服，将在下次启动或重启时生效；更新、应用配置、备份恢复等流程触发的自动重启同样使用新参数。`-port` 由 `PALBOX_GAME_PORT` 管理，不能在启动参数中填写。

同一区域的「安装参数」按钮显示完整 SteamCMD 参数并允许编辑，保存到 `settings.json` 的 `installArgs`，下次安装或更新时生效。安装目录、App ID `2394010` 和末尾的 `+quit` 由面板校验，其余参数可自定义。

「恢复输入配置」恢复面板中最初输入或导入的完整内容并自动保存，保留注释、未知字段与顺序；点击应用才影响游戏。已有 INI 配置可通过「配置管理」导入。服务端第一次建立配置库时，如果 `/data/server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini` 已存在，则将它作为初始输入；否则读取 `/data/server/DefaultPalWorldSettings.ini`。新建配置和「游戏默认配置」条目都以这个官方文件为输入，保留当前安装版本的游戏参数，仅设置 REST API、随机管理员密码与公布端口等管理必需项；默认条目的密码生成后会保留，不会随同步重新生成。存在「游戏默认配置」条目时，删除最后一个可编辑配置不会再新建副本，只有配置库为空时才从该官方文件创建新的可编辑默认配置。尚未安装时使用最少管理项占位，安装成功后导入官方默认文件；已编辑的配置保持原样。默认文件缺失或无效时明确提示，不使用内置游戏参数替代。

## 服务与备份

- 启动、停止、重启：管理游戏进程。停止优先调用官方 API 存档和关服，API 不可用时尝试 SIGTERM；未成功退出不会继续改写文件。正常停止失败时可使用「强制停止」，优先调用官方 `/stop`，必要时发送 SIGKILL。
- 关服倒计时：在同名设置窗口中编辑倒计时秒数（0–300 秒）和提示文字（1–500 个字符），保存在 `palbox/settings.json` 的 `shutdownWait`、`shutdownMessage`。正常关服调用[官方 `/shutdown`](https://docs.palworldgame.com/api/rest-api/shutdown/) 时传入这两项；保存后下次关服生效，不需要重启面板。旧设置自动沿用默认提示「Palbox 正在维护服务器」。
- 自动启动：在「服务器概况」标题栏的「任务记录」前切换「自动启动」滑块。启用后，后端启动并监听端口时会自动创建「启动」任务；服务端未安装、尚未完成管理员初始化或检测到游戏已在运行时跳过。设置保存在 `palbox/settings.json` 的 `autoStart`，默认关闭；执行 `docker compose restart palbox`、`up -d` 或宿主机重启后生效。
- 更新：先正常停服并创建更新前备份，再执行 SteamCMD `app_update 2394010 validate`；原先运行的游戏服会重新启动。「检查更新」优先通过 [SteamCMD.net API](https://api.steamcmd.net/v1/info/2394010) 查询最新 build，失败时回退 SteamCMD，并与本地 `appmanifest_2394010.acf` 对比，结果以「游戏版本」卡片旁的气泡显示。
- 官方自动备份：由 `bIsUseBackupSaveData=True` 启用，游戏运行中自行生成，无需面板停服。面板展示 `SaveGames/0/<世界 ID>/backup/world/<时间>/` 中完整的世界和玩家备份，支持在线下载。官方保留档位为每 30 秒 5 份、每 10 分钟 6 份、每 1 小时 12 份、每 1 天 7 份：[官方说明](https://docs.palworldgame.com/settings-and-operation/configuration/#about-bisusebackupsavedata)。
- 恢复官方备份：确认备份属于当前世界，复制并验证后保存、停服，先创建完整备份再替换世界和玩家存档。保留当前配置与官方备份历史，原先运行的游戏会重新启动。
- 导入存档：上传 `.tar.gz` / `.tgz` 官方存档（最大 1 GB，只能包含一个世界），支持快照根目录、`SaveGames/0/<世界 ID>` 和 `Pal/Saved/SaveGames/0/<世界 ID>` 布局。确认后立即保存世界、停服、创建完整备份并替换世界/玩家存档，完成后按原状态启动；`PalWorldSettings.ini`、`WorldOption.sav` 和官方备份历史保持不变。暂存文件位于 `palbox/imports/`，成功后删除，超过 1 小时自动清理。
- 创建完整备份：人工触发，运行中会先存档并停服，压缩完成后重新启动。面板不再执行定时停服备份，升级时会移除旧计划；已有定时归档继续保留。
- 删除完整备份：在归档条目中点击「删除」并确认，永久移除所选文件，自动更新列表数量和大小。无需停服，不改变当前世界；与其他管理任务串行执行，拒绝越界路径、目录和链接。
- 恢复备份：校验归档路径和文件类型，先保存并备份当前世界，在临时目录解压后整体替换 `Pal/Saved`。恢复后面板预设不变，可能显示「待生效」。可从页面下载备份留存。
- 保留数量：每类完整归档分别保留最近 1 到 100 份，默认 5 份；已有自定义保留数量继续沿用。不影响游戏维护的官方备份；恢复时正在使用的备份不会被恢复前备份的清理操作删除。
- 日志与玩家：概况集中显示服务状态，在线人数、FPS、运行时间、游戏版本与游戏端口在同一信息栏展示，安装、启停、更新、参数设置与强制停止按钮集中在同一操作栏，窄屏自动换行。玩家管理支持广播、带理由的移出/封禁、「已封禁玩家」列表与逐条解封，也可按 UserID 封禁/解封。列表优先读取部分新版本的 `Pal/Saved/SaveGames/Config/banlist.json`；该目录或文件不存在时（属正常情况）自动回退旧版 `Pal/Saved/SaveGames/banlist.txt`，兼容平台前缀 ID、旧版纯数字 Steam ID 以及 `steam_<ID>,<PlayerUID>` 迁移格式，停服时仍可查看；新版游戏在停服时才写回名单，运行中刚封禁的玩家会依据面板任务记录立即显示。解封使用[官方 REST `/unban`](https://docs.palworldgame.com/api/rest-api/unban/)，需要游戏管理接口就绪。昵称、理由和封禁时间可由最近的面板任务记录补充，缺少信息时显示 ID。名单读取失败时提示错误，不回退为成功空列表。本服原生名单位置参考[同类开源面板维护者的实现说明](https://github.com/palserver-gui/palserver-gui/releases/tag/v2.10.0)。游戏服务下方的「任务记录」保留最近任务及状态。

任务串行执行。更新、应用、备份和恢复期间其他管理任务会被拒绝。失败任务保留错误说明和日志，不会显示为成功；游戏异常退出后面板仍可访问，可以排查后手动启动。第一版不自动回滚游戏二进制或强制启动失败的进程。

执行 `docker compose stop` 会先停止接收新管理请求，再尝试保存并停止游戏进程；Compose 预留 120 秒退出时间。

## 配置项

Docker 部署的全部配置都在 `compose.yaml` 中，不再读取 `.env`。

| 位置 | 默认值 | 用途 |
| --- | --- | --- |
| `environment.PALBOX_GAME_PORT` | `8211` | 游戏进程监听端口，需同步修改 `ports` 的宿主机端口 |
| `environment.PALBOX_SECURE_COOKIE` | `false` | HTTPS 部署时为登录 Cookie 设置 Secure |
| `PUID` / `PGID`（可选） | `1000` / `1000` | 入口脚本默认使用 `1000:1000`，compose 中不再预置；需要自定义时再在 `environment` 中添加 |
| `TZ`（可选） | 容器默认时区 | 需要指定时区时再在 `environment` 中添加，镜像已安装 `tzdata` |
| `frontend.ports` | `127.0.0.1:8080:8080/tcp` | 网页绑定地址和宿主机端口 |
| `frontend.environment.PALBOX_API_URL` | `http://palbox:8081` | 前端代理访问的后端地址 |
| `palbox.ports` | `8211:8211/udp` | 游戏 UDP 端口映射 |
| `volumes` | `./data:/data` | 宿主机数据目录 |

直接运行镜像而不使用 Compose 时，需分别启动前后端，并把前端的 `PALBOX_API_URL` 指向可访问的后端地址。两个容器均通过 `HOST` / `PORT` 配置各自监听（前端默认 8080，后端默认 8081）；`PUID` / `PGID` 仅用于后端运行用户。管理员账号、游戏安装/启动和启动参数统一在网页中管理，不再通过环境变量提供。`npm start` / `dev.sh` 的开发流程同样使用环境变量配置其他参数。

使用现有存档时，可以在面板「存档管理 → 导入存档」上传官方快照 `.tar.gz`，也可以先将完整的 `Pal/Saved` 放入 `./data/server/Pal/Saved`，不要只复制单个 `Level.sav`。安装完成后检查输入配置与存档，再在面板中手动启动。

## 验证

```sh
npm test
npm run test:e2e
npm run test:e2e:managed
docker compose config --quiet
```

管理测试使用真实的临时子进程、HTTP API、文件写入和 tar 压缩恢复；SteamCMD 下载与实际游戏运行由模拟服务替代，测试不需要下载游戏，也不会连接现有游戏服。真实镜像构建和游戏启动仍需要在有 Docker 引擎权限、网络及足够资源的 Linux amd64 主机执行。

实现依据：[官方 SteamCMD 部署说明](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/)、[官方 REST API](https://docs.palworldgame.com/category/rest-api/)、[REST API 鉴权与访问说明](https://docs.palworldgame.com/api/rest-api/palwold-rest-api/)。
