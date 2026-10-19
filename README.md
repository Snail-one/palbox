# Palbox

中文帕鲁（Palworld）服务管理面板与 `PalWorldSettings.ini` 配置编辑器。

支持在浏览器中编辑配置，也可通过 Docker 部署，管理游戏服务端的安装、启停、更新和备份。

[快速开始](#快速开始) · [Docker 部署](#docker-部署) · [使用指南](docs/usage.md) · [开发与测试](#开发与测试) · [文档](#文档)

## 功能

- **配置编辑**：分类表单、参数搜索、INI 导入、源码编辑与一键复制。
- **参数说明**：提供参数中文说明，区分官方说明、社区解释与未识别参数；默认配置读取游戏目录中的官方 `DefaultPalWorldSettings.ini`。
- **多配置管理**：内置「游戏默认配置」（自动生成管理员密码、输入源码只读、参数可修改并应用，未修改时随官方文件同步），以及新建、重命名、复制、删除、自动保存与恢复初始配置。
- **格式保留**：保留注释、参数顺序与未知字段，已识别数值按模板格式补齐小数位。
- **游戏服务管理**：安装、启动、自动启动、停止、强制停止、重启、更新检查，以及配置应用、统一实时日志与来源筛选、任务记录、玩家移出/封禁、封禁名单与解封，以及网页配置安装/启动参数。
- **备份与恢复**：官方自动存档备份的查看、在线下载与停服恢复，另提供手动完整备份、更新前备份，以及导入外部官方存档压缩包并自动恢复。

## 管理面板

项目只提供一个管理网页，包含「游戏管理」「存档管理」「配置管理」和独立的「登录日志」入口。「存档管理」下设「官方备份」「手动备份」两个二级菜单，分别管理游戏快照和完整归档。配置统一保存到服务器，登录后可以管理游戏服务、存档与备份。前后端独立运行：前端提供网页并代理 `/api/`，后端提供管理 API。Docker 使用独立前端容器和包含 Node.js、SteamCMD 的后端容器，一个后端管理一个游戏服务端。

## 快速开始

### 环境要求

- Node.js **22 或以上版本**。
- 支持 ES Modules 的现代浏览器。

### 本地启动

下载或克隆项目后，在项目根目录执行：

```sh
npm start
```

打开 **<http://127.0.0.1:8080>**，首次访问时在页面中设置管理员用户名和至少 12 位密码，随后用该账号登录，按 `Ctrl+C` 停止服务。已有 `data/` 数据沿用已有管理员账号，无需重新初始化；旧版 `settings.json`（没有用户名）会拒绝启动，按日志提示备份并删除该文件后重新初始化。

默认仅监听本机。Linux / macOS 下可通过环境变量修改地址和端口：

```sh
HOST=127.0.0.1 PORT=8090 API_PORT=8091 npm start
```

`npm start` 同时启动前端（默认 `127.0.0.1:8080`）和后端（默认 `127.0.0.1:8081`），通过 `API_HOST` / `API_PORT` 调整后端监听。配置保存在项目的 `data/` 目录；默认不自动下载或启动游戏。请通过 HTTP 访问页面。

### 编辑配置

1. 新建配置、导入 `.ini` 文件，或粘贴 `OptionSettings=(...)`。
2. 使用分类表单修改参数；编辑输入源码后，点击「应用源码」。
3. 点击「应用配置」，由管理后端写入游戏配置文件并按需重启游戏服；也可复制 INI 备份。

有效修改自动保存；未应用源码和非法输入保留为页面草稿。有效配置保存在服务器中，清除浏览器网站数据不会删除配置、存档与备份。

完整操作、保存状态、快捷键和游戏配置路径见 [使用指南](docs/usage.md)。

## Docker 部署

适用于需要从面板管理游戏服务端的场景。准备可运行 Docker Compose 的 **Linux amd64** 主机，并为游戏预留足够的 CPU、内存和磁盘空间。

本地构建使用 `compose.yaml`，在线镜像部署使用独立的 `compose.ghcr.yaml`。首次启动前按需修改所用文件的网页绑定地址、游戏端口和宿主机数据目录；修改 `PALBOX_GAME_PORT` 时，`ports` 里的 UDP 映射要一起改。

随后启动：

```sh
docker compose up -d --build
docker compose logs -f frontend palbox
```

打开 **<http://127.0.0.1:8080>**，首次访问时在页面中创建管理员用户名和至少 12 位密码，随后用该账号登录。可在侧栏「账号」绑定验证器，启用 TOTP 二次验证并保存一次性恢复码。进入「游戏管理」后点击「安装服务端」下载游戏服务端，安装完成后点击「启动」；安装进度可在「运行日志 → 安装与更新」查看。

只有服务器 IP 时，可保留默认回环监听，通过 [SSH 隧道](docs/docker.md#只有-ip-的远程访问) 加密访问，无需域名。TOTP 安全设置变更后自动轮换会话，旧 Cookie 立即失效。

> 旧版 `settings.json`（只有密码哈希、没有用户名）不兼容当前版本。升级时请先备份 `data/`，按启动日志提示删除 `palbox/settings.json` 后重新初始化管理员；配置、存档与备份不会受影响。

| 配置项 | 默认值 |
| --- | --- |
| 面板地址 | `http://127.0.0.1:8080` |
| 游戏端口 | UDP `8211` |
| 宿主机数据目录 | `./data` |
| 容器数据目录 | `/data` |

管理模式中，「已保存」表示面板配置已存盘；点击「应用配置」才会写入游戏并按需重启。

目录结构、全部环境变量、网络访问、已有存档迁入及备份操作见 [Docker 部署文档](docs/docker.md)。

### 使用 GitHub 发布镜像

普通提交和 PR 运行测试及容器启动检查，确认通过后再打 Git tag。只有推送 tag 时才构建并发布前后端镜像到 GHCR，同时标记原始 Git tag 和 `latest`，不重复测试。手动触发仅构建验证，可选择分支或填写已有 tag，不推送镜像、不更新仓库中的 `latest`。Dependabot 每周提交 npm、Docker 和 GitHub Actions 的依赖更新 PR。

只需下载 [compose.ghcr.yaml](compose.ghcr.yaml)，放到部署目录，无需源码或 Dockerfile。使用已发布镜像启动：

```sh
docker compose -f compose.ghcr.yaml pull
docker compose -f compose.ghcr.yaml up -d
docker compose -f compose.ghcr.yaml logs -f frontend palbox
```

具体镜像地址、发布步骤和手动运行方式见 [GitHub CI/CD](docs/ci-cd.md)。

## 开发与测试

### 开发服务

同时调试「游戏管理」和「配置管理」，可直接运行启动脚本：

```sh
./dev.sh
```

也可执行 `npm run dev:managed`。脚本会查找 PATH、fnm 或 nvm 中的 Node.js 22 及以上版本，无需安装 npm 依赖即可启动。默认监听 `127.0.0.1:8080`，首次访问时在页面中创建管理员用户名和至少 12 位密码，数据保存在项目的 `data/` 目录，默认不自动下载或启动游戏。已有数据沿用已有管理员账号。

可覆盖启动参数，例如：

```sh
PORT=8090 API_PORT=8091 ./dev.sh
```

也可使用标准开发命令启动同一管理面板：

```sh
npm run dev
```

前后端服务各自监听服务代码变更并自动重启；浏览器代码或样式修改后刷新页面即可。按 `Ctrl+C` 会停止两个服务。

也可在两个终端分别启动，独立调试或部署：

```sh
# 终端一：仅管理 API，默认 127.0.0.1:8081
npm run dev:backend

# 终端二：网页与 API 代理，默认 127.0.0.1:8080
PALBOX_API_URL=http://127.0.0.1:8081 npm run dev:frontend
```

生产独立启动使用 `npm run start:backend` / `npm run start:frontend`。两个入口各自读取 `HOST` 和 `PORT`；`PALBOX_API_URL` 是前端进程访问后端的 HTTP(S) 地址（仅 origin，不含路径）。浏览器统一请求当前站点的 `/api/`，上传、下载、登录 Cookie 与 CSRF 校验均经由代理。后端不提供 HTML 或静态文件，前端无需访问游戏数据目录。

### 单元与集成测试

仅使用 Node.js 内置模块，无需安装第三方依赖：

```sh
npm test
```

可分别运行 `npm run test:unit` 和 `npm run test:integration`。启动项目后，访问 `/tests/index.html` 也可运行浏览器共用配置测试。

### 浏览器测试

首次运行时安装开发依赖和 Chromium：

```sh
npm ci
npx playwright install chromium
```

运行编辑器和管理模式的浏览器回归：

```sh
npm run test:e2e
npm run test:e2e:managed
npm run test:e2e:logs
```

测试默认自行启动临时服务并在结束后关闭。管理测试使用模拟游戏进程，不会下载真实游戏。日志专项测试覆盖统一窗口的多来源合并与筛选、状态接口阻塞时的实时更新、中文与终端控制码、频道切换、断线重连和滚动位置。Playwright 仅用于开发测试，生产运行不依赖它。

`npm run test:browser` 是 `test:e2e` 的兼容别名。编辑器测试使用独立临时管理服务，可通过 `PALBOX_QA_OUTPUT` 指定截图和导入样例目录，默认输出到 `test-results/e2e`。

## 项目结构

```text
palbox/
├── frontend/
│   ├── public/         页面、样式和静态资源
│   ├── src/            浏览器应用、工作空间操作、API 适配器和界面
│   ├── http-server.js  静态资源服务与流式 API 代理
│   └── index.js        前端独立入口
├── backend/
│   ├── management/     认证、配置存储、游戏进程、任务与备份
│   ├── http-server.js  仅 API 和健康检查
│   └── index.js        后端独立入口
├── shared/domain/      前后端共用的配置解析、参数目录、模板与编辑规则
├── scripts/start.js    本地双进程启动与退出协调
├── docker/             后端容器入口脚本
├── .github/            CI、tag 镜像发布工作流和 Dependabot 配置
├── tests/              单元、集成与浏览器测试
├── docs/               使用、部署与架构文档
├── Dockerfile          frontend / backend 两个镜像目标
├── compose.yaml        前后端独立容器配置
└── compose.ghcr.yaml   独立的 GHCR 在线镜像部署配置
```

前端使用原生 ES Modules，服务端使用 Node.js 内置模块，无构建步骤。模块职责、依赖边界和扩展方式见 [架构说明](docs/architecture.md)。

## 文档

- [使用指南](docs/usage.md)：配置编辑、保存与恢复、快捷键和游戏配置路径。
- [Docker 部署](docs/docker.md)：安装部署、环境变量、游戏服务管理和备份恢复。
- [GitHub CI/CD](docs/ci-cd.md)：tag 发布镜像、手动运行、CI 检查和依赖更新机器人。
- [参数明细](docs/parameters.md)：参数用途、说明来源和验证状态。
- [参数核对记录](docs/parameter-review.md)：参数与说明的核对依据。
- [架构说明](docs/architecture.md)：模块职责、数据流、存储兼容和扩展位置。
