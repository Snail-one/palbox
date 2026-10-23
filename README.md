# Palbox

中文帕鲁（Palworld）服务管理面板与 `PalWorldSettings.ini` 配置编辑器，支持 Linux 直接安装和 Docker 部署。

[直接安装](#linux-直接安装) · [Docker 部署](#docker-部署) · [首次使用](#首次使用) · [数据与备份](#数据与备份) · [常见问题](#常见问题) · [开发与文档](#开发与文档)

- **游戏管理**：安装、更新、启停、自动启动、日志、公告聊天和玩家管理。
- **配置管理**：中文参数说明、搜索、多配置、INI 导入与自动保存。所有配置的输入源码只读，底层为官方默认配置，参数在可视化编辑或参数列表中修改。文件和粘贴导入均以游戏默认配置为底，覆盖导入参数，缺项沿用默认值，并创建独立配置。REST API 保持开启，管理员密码使用「游戏默认配置」已有的随机密码，不采用导入内容中的这两项。
- **存档管理**：官方自动备份、手动世界备份、恢复，以及 ZIP／7Z／tar.gz 存档导入。
- **账号管理**：管理员账号、登录记录和可选的 TOTP 二次验证。

## Linux 直接安装

适用于 **Ubuntu / Debian x86_64（amd64）和 systemd**。用已有普通用户下载项目，在项目根目录执行安装：

```sh
git clone https://github.com/Snail-one/palbox.git
cd palbox
sudo bash ./install.sh
```

脚本准备系统依赖和项目独立的 Node.js，注册后台服务并启用开机启动，无需提前安装 Node.js 或运行 `npm install`。主程序保留在当前项目目录，数据保存在其中的 `data/`；项目目录需要长期保留。SteamCMD 和游戏服务端通过网页另行安装。

默认面板地址为 **<http://127.0.0.1:8080>**。远程服务器可使用下方的 [SSH 隧道](#远程访问)，或修改监听地址。

### 安装与监听设置

以下命令均在项目根目录执行。重复运行会保留配置和数据、重新启动服务；未指定的参数沿用已有设置。

| 操作 | 命令 |
| --- | --- |
| 安装／重新注册服务 | `sudo bash ./install.sh` |
| 面板绑定所有 IPv4 网卡 | `sudo bash ./install.sh --host 0.0.0.0` |
| 面板恢复为仅本机访问 | `sudo bash ./install.sh --host 127.0.0.1` |
| 开放面板并修改端口为 8090 | `sudo bash ./install.sh --host 0.0.0.0 --port 8090` |
| 修改后端本机端口为 8091 | `sudo bash ./install.sh --api-port 8091` |
| 指定已有普通运行用户 | `sudo bash ./install.sh --user ubuntu` |
| 查看全部选项 | `bash ./install.sh --help` |

`0.0.0.0` 表示监听所有 IPv4 网卡，浏览器应访问 `http://服务器IP:端口`。云安全组和系统防火墙也需放行该 TCP 端口。游戏默认使用 UDP `8211`；后端 `8081` 和游戏 REST API 端口无需对公网开放。

运行用户必须已存在且能读写项目数据。应用禁止以 root 运行，`sudo` 仅用于安装和系统服务管理。更多权限规则见 [原生部署文档](docs/native.md)。

### 启停、日志与卸载

| 操作 | 命令 |
| --- | --- |
| 查看状态 | `sudo systemctl status palbox --no-pager` |
| 查看实时日志 | `sudo journalctl -u palbox -f` |
| 查看最近 100 条日志 | `sudo journalctl -u palbox -n 100 --no-pager` |
| 启动／停止／重启 | `sudo systemctl start palbox` ／ `sudo systemctl stop palbox` ／ `sudo systemctl restart palbox` |
| 取消开机启动并立即停止 | `sudo systemctl disable --now palbox` |
| 恢复开机启动并立即启动 | `sudo systemctl enable --now palbox` |
| 卸载后台服务 | `sudo bash ./uninstall.sh` |

独立卸载脚本会停止服务、取消开机启动并移除本项目的 `palbox.service`，保留程序和整个 `data/`（含配置及运行依赖）。重新安装执行 `sudo bash ./install.sh`。需要彻底删除时，先备份，再手动删除项目目录及自行配置的其他数据目录。

### 更新面板

先停止服务并 [备份数据](#数据与备份)，再更新代码、重新安装：

```sh
sudo systemctl stop palbox
# 备份完成后执行；适用于 Git 克隆且没有本地代码改动的部署。
git pull --ff-only
sudo bash ./install.sh
```

压缩包部署则替换程序文件，保留整个 `data/`（含配置及运行依赖），再执行安装脚本。**游戏服务端更新**在网页「游戏管理」中单独操作。

## Docker 部署

需要可运行 Docker Compose 的 **Linux amd64** 主机，前后端分别运行在两个容器中。

### 使用发布镜像

下载 [compose.ghcr.yaml](compose.ghcr.yaml) 到一个长期保留的部署目录，在该目录执行：

```sh
docker compose -f compose.ghcr.yaml pull
docker compose -f compose.ghcr.yaml up -d
```

无需下载源码或准备 Node.js。默认面板地址为 **<http://127.0.0.1:8080>**。主程序位于各自容器的 `/app/`，宿主机 `./data` 挂载到后端容器 `/data`。

需要直接通过服务器 IP 访问时，修改该文件的 `frontend.ports`：

```yaml
# 原值："127.0.0.1:8080:8080/tcp"
- "0.0.0.0:8080:8080/tcp"
```

然后重新执行 `docker compose -f compose.ghcr.yaml up -d`。修改游戏端口时，同时修改后端的 `PALBOX_GAME_PORT` 和 UDP 端口映射。

### 常用命令

以下命令均在所用 Compose 文件所在目录执行。

| 操作 | 发布镜像部署 | 源码构建部署 |
| --- | --- | --- |
| 启动／应用部署配置 | `docker compose -f compose.ghcr.yaml up -d` | `docker compose up -d --build` |
| 查看状态 | `docker compose -f compose.ghcr.yaml ps` | `docker compose ps` |
| 查看日志 | `docker compose -f compose.ghcr.yaml logs -f --tail=100 frontend palbox` | `docker compose logs -f --tail=100 frontend palbox` |
| 停止／再次启动 | `docker compose -f compose.ghcr.yaml stop` ／ `docker compose -f compose.ghcr.yaml start` | `docker compose stop` ／ `docker compose start` |
| 重启 | `docker compose -f compose.ghcr.yaml restart` | `docker compose restart` |
| 卸载容器和项目网络 | `docker compose -f compose.ghcr.yaml down` | `docker compose down` |

更新前先停止容器并 [备份数据](#数据与备份)。发布镜像部署重新执行 `pull` 和 `up -d`；源码构建部署在更新项目代码后执行 `docker compose up -d --build`。仅重启容器不会拉取新镜像或重新构建源码。

`down` 保留绑定挂载的 `./data`，也保留镜像和 Compose 文件。需要彻底删除时，先备份，再手动删除部署目录及自行挂载的其他数据目录。更多环境变量和网络设置见 [Docker 部署文档](docs/docker.md)。

## 首次使用

1. 打开面板，设置管理员用户名和至少 12 位密码；已有数据沿用原账号。
2. 在「游戏管理」中安装 SteamCMD（原生和 Docker 均通过网页安装），再安装游戏服务端并启动。
3. 在「配置管理」中新建或导入配置。有效修改自动保存。输入源码只读，请在参数表单中修改。
4. 点击「应用配置」才会写入游戏配置；游戏正在运行时会按需重启。

开启网页中的「自动启动」，可让面板启动后自动运行已安装的游戏服。完整操作见 [使用指南](docs/usage.md)。

### 远程访问

默认只监听服务器本机。可在自己的电脑上建立 SSH 隧道，无需修改监听设置：

```sh
ssh -N -L 18080:127.0.0.1:8080 登录用户@服务器IP
```

保持连接，在自己的电脑打开 **<http://127.0.0.1:18080>**。面板端口有修改时，将命令最后的 `8080` 换为实际端口。

首次管理员初始化需要来自本机或可信内网；仅有公网 IP 时先通过 SSH 隧道初始化。公网长期访问可使用 HTTPS 反向代理，具体设置见 [访问说明](docs/docker.md#只有-ip-的远程访问)。

## 数据与备份

直接安装以项目下的 `data/` 为数据根目录；Docker 默认以 Compose 文件旁的 `data/` 为根目录，对应容器 `/data/`。

| 内容 | 数据根目录下的相对路径 |
| --- | --- |
| 游戏服务端 | `server/` |
| 实际游戏配置 | `server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini` |
| 游戏存档 | `server/Pal/Saved/SaveGames/` |
| 面板账号、配置库和任务 | `palbox/` |
| 面板世界备份 | `backups/` |
| 面板、安装、游戏及登录日志 | `logs/` |
| SteamCMD | `steamcmd/`，原生和 Docker 均在数据目录内 |
| 部署配置（原生） | `palbox/.env` |
| Node.js 运行时（原生） | `runtime/node/` |
| 开发测试依赖、缓存和测试产物 | `dependencies/`、`cache/`、`test-results/` |
| 临时文件与操作事务 | `tmp/`、`palbox/transactions/` |

操作结束后删除事务暂存及空父目录；清理失败会每分钟重试，并在启动时继续清理。分盘操作在目标存档盘的 `.palbox-transactions/` 暂存，使用相同清理规则。`palbox/transaction-journal/` 记录清理状态，处理完毕后也会删除空目录。回滚失败或写操作中断的原数据副本会标记保留并在日志提示位置，确认恢复后再手动删除；普通清理不会删除它们。

**完整备份请先停止面板服务或容器，再复制整个数据根目录**，原生部署的配置及 Node.js 运行时已在数据目录内；Docker 另保存使用的 Compose 文件；备份放到部署目录之外。自定义挂载或 `PALBOX_DATA_DIR` 时，以实际路径为准。

网页中的「世界备份」（手动、恢复前、导入前、重置前）都打包当前世界目录和 `PalWorldSettings.ini`，不包含其他世界、日志、封禁名单、面板账号、配置库和程序。导入存档或恢复这些备份时，包内的 `PalWorldSettings.ini` 会按导入方式合并进「游戏默认配置」并写入游戏：以官方默认为底补全缺项，再用包内同名参数覆盖。REST API 保持开启，管理员密码沿用「游戏默认配置」已有的随机密码，不采用包内的这两项。没有该文件的包不改配置。迁移整个面板时需要完整数据备份。备份恢复操作见 [使用指南](docs/usage.md#官方自动备份与世界备份)。

所有网页导入和恢复都只使用一个世界的存档及游戏配置。旧 Saved 归档也只提取这两项；多个世界的包需先保留一个世界。存档恢复到当前世界，其他世界、封禁名单、日志和世界 ID 保留。仅配置的备份单独恢复配置。

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| 远程无法打开面板 | 检查监听地址、端口映射、云安全组和防火墙；默认 `127.0.0.1` 可通过 SSH 隧道访问。 |
| 安装后没有游戏服务端 | 安装脚本只准备面板，通过网页继续安装 SteamCMD 和游戏服务端。 |
| 提示不能以 root 启动 | 使用配置的普通用户；后台服务通过 `systemctl` 管理，终端启动不要加 `sudo`。 |
| 安装或更新游戏失败 | 查看「运行日志 → 安装与更新」，检查 Steam 网络连接和系统依赖后重试。 |
| 配置已保存但游戏没变化 | 点击「应用配置」；「已保存」只表示配置库已经存盘。 |
| 旧版账号配置无法启动 | 先备份数据，再按启动日志处理 `palbox/settings.json`；缺少用户名的旧版账号需重新初始化。 |

## 开发与文档

已有 **Node.js 22 或以上版本**时，可用普通用户在项目目录执行 `npm start` 前台运行，或用 `bash ./dev.sh` 开发；按 `Ctrl+C` 停止。调试已有部署前先停止 systemd 服务，避免两个实例操作同一份数据。生产运行无需安装 npm 依赖。

```sh
npm test                       # 单元与集成测试
npm run setup:tests            # 浏览器依赖和浏览器缓存安装到 data/ 内
npm run test:e2e               # 浏览器回归，使用临时测试数据
```

- [使用指南](docs/usage.md)：配置编辑、玩家管理、日志、存档与备份恢复。
- [Linux 原生部署](docs/native.md)：系统依赖、用户权限、运行目录和服务管理。
- [Docker 部署](docs/docker.md)：环境变量、挂载、网络和容器部署。
- [架构说明](docs/architecture.md)：项目结构、模块边界、数据流和测试。
- [GitHub CI/CD](docs/ci-cd.md)：镜像构建、发布与版本标签。
- [参数明细](docs/parameters.md) · [参数核对记录](docs/parameter-review.md)。
