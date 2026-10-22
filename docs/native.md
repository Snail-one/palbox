# Ubuntu / Debian 原生部署

支持运行 systemd 的 Ubuntu / Debian x86_64（amd64）服务器。程序保留在下载的项目目录中，后台服务、SteamCMD 和游戏进程使用同一个已有普通用户，数据统一保存在该目录的 `data/`。

## 一键安装并启动

用普通用户下载或上传完整项目，在项目根目录执行：

```sh
sudo bash ./install.sh
```

例如项目放在 `/home/ubuntu/palbox` 并归 `ubuntu` 所有，脚本会配置 `ubuntu` 作为运行用户。脚本安装系统依赖，将校验后的独立 Node.js 24 LTS 准备到 `.runtime/node/`，创建 `data/` 并设置该用户权限，写入 `.palbox.env`，注册并启动 systemd 服务，检查前后端连通后设置开机启动。生产运行无需 `npm install`。

脚本使用管理员权限处理依赖和系统服务，应用进程使用普通用户。它不会创建系统用户、搬迁程序、创建版本链接或递归修改已有数据的属主。系统已有 Node.js 不会被替换，重复安装会复用项目中兼容的 Node.js。

脚本默认只监听本机，完成后会输出地址、运行用户、数据位置、日志命令和 SSH 隧道用法。首次安装需要访问系统软件源和 `nodejs.org`；网页安装 SteamCMD 和游戏需要访问 Valve / Steam 下载服务。

## 用户与权限

运行用户按以下顺序确定：`--user` 显式指定、项目配置中已有的 `PALBOX_SERVICE_USER`、项目目录的普通用户属主；项目归 root 时，还可以使用执行 sudo 的普通用户。运行用户必须已经存在，UID 不能是 0。

直接以 root 登录且项目也归 root 时，指定已有普通用户：

```sh
bash ./install.sh --user ubuntu
```

这个用户需要能访问整个项目路径。建议将项目放到该用户的目录中，例如 `/home/ubuntu/palbox`，不要放在无法进入的 `/root` 下。脚本不会为了运行程序修改 `/root` 或其他父目录的权限。

新建 `data/` 时自动设置为运行用户所有。已有 `data/` 会先检查读、写和进入权限，权限不匹配则中止并提示，不会自动接管目录。所有服务启动入口（包括前后端独立入口）都会按实际 UID / 有效 UID 拒绝 root，在写数据和监听端口前退出；修改 `USER`、`SUDO_USER` 等环境变量不能绕过。终端启动还会检查当前系统用户是否与 `.palbox.env` 一致。`sudo bash ./install.sh` 仍可用于系统安装，注册后的服务以普通用户运行。

## 目录与游戏安装

项目在 `/home/ubuntu/palbox` 时，目录如下：

```text
/home/ubuntu/palbox/
├── backend/
├── frontend/
├── .runtime/node/     项目独立 Node.js
├── .palbox.env        终端启动与后台服务共用配置
└── data/
    ├── steamcmd/      网页安装的 SteamCMD
    ├── steam-home/    SteamCMD 独立运行主目录
    ├── server/        游戏服务端
    │   └── Pal/Saved/ 游戏配置和存档
    ├── backups/       面板备份
    ├── logs/          日志
    └── palbox/        面板账号、配置及任务
```

面板地址默认为 `http://127.0.0.1:8080`。远程服务器在自己的电脑上执行：

```sh
ssh -N -L 18080:127.0.0.1:8080 登录用户@服务器IP
```

保持 SSH 连接，打开 `http://127.0.0.1:18080`，创建管理员用户名和至少 12 位密码，登录后依次点击：

1. **安装 SteamCMD**：安装到 `data/steamcmd/`，失败时查看「安装与更新」日志并重试。
2. **安装服务端**：下载到 `data/server/`。
3. **启动**：运行游戏服。开启网页的「自动启动」后，服务器重启时也会启动已安装的游戏服。

根据防火墙、云安全组和路由情况，放行游戏 UDP 8211（默认）。API 默认监听本机，不需要开放 8081 或游戏 REST 管理端口。

## 配置与访问

安装时可以修改监听地址和端口：

```sh
sudo bash ./install.sh --host 0.0.0.0 --port 8090 --api-port 8091
```

`--host` 默认 `127.0.0.1`，`--port` 默认 `8080`，`--api-port` 默认 `8081`。两个端口必须不同，范围为 1024–65535。项目路径使用不含空格的绝对路径；数据始终使用当前项目下的 `data/`。

配置保存在项目的 `.palbox.env`，仅运行用户可读写，不提交到 Git。`dev.sh` 优先使用 `.runtime/node/` 中的 Node.js，并通过 Node.js 的 `--env-file` 加载配置；环境变量可覆盖文件中的对应值。后台服务也调用 `dev.sh --no-watch`，因此后台和终端启动共用入口、运行时与配置。

首次管理员初始化只接受本机或可信内网来源；只有公网 IP 时先用 SSH 隧道初始化。公网长期访问使用 HTTPS 反向代理，并在 `.palbox.env` 设置 `PALBOX_SECURE_COOKIE=true` 和相应的可信代理地址。

## 服务管理、调试和更新

```sh
sudo systemctl status palbox --no-pager
sudo journalctl -u palbox -f
sudo systemctl restart palbox
sudo systemctl stop palbox
sudo systemctl start palbox
```

终端调试时先停止后台服务，再使用配置的普通用户，在同一个项目目录执行：

```sh
bash ./dev.sh --no-watch
```

已有可用 npm 时，也可执行 `npm start`，它调用相同启动入口。请勿使用 sudo 启动面板或同时启动两个实例。

更新前备份 `data/`，停止服务，更新当前目录中的程序，再启动；依赖或服务配置需要更新时重新执行 `sudo bash ./install.sh`。重复安装保留配置和 `data/`，显式选项修改相应配置。启动检查失败会恢复原部署配置并尝试恢复原服务状态；程序代码和应用已经写入的数据不由安装器回退。

项目目录需要长期保留。移动目录时先停用并移除旧服务注册，保留程序与数据，移动后同步修改 `.palbox.env` 中的 `PALBOX_DATA_DIR`，再执行安装脚本注册新位置。安装器检测到已有服务指向其他目录或配置指向其他数据位置时会中止，避免接管另一份部署或生成空世界。迁移旧部署的数据时也应先停服、备份并确认用户权限，安装器不会自动搬迁或删除旧数据。
