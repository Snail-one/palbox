# Palbox

中文帕鲁（Palworld）服务管理面板与 `PalWorldSettings.ini` 配置编辑器。

支持在浏览器中编辑配置，也可通过 Docker 部署，管理游戏服务端的安装、启停、更新和备份。

[快速开始](#快速开始) · [Docker 部署](#docker-部署) · [使用指南](docs/usage.md) · [开发与测试](#开发与测试) · [文档](#文档)

## 功能

- **配置编辑**：分类表单、参数搜索、INI 导入、源码编辑与一键复制。
- **参数说明**：内置 122 项参数模板，区分官方说明、社区解释与未识别参数。
- **多配置管理**：新建、重命名、复制、删除、自动保存与恢复初始配置。
- **格式保留**：保留注释、参数顺序与未知字段，已识别数值按模板格式补齐小数位。
- **游戏服务管理**：安装、启动、停止、重启、更新，以及配置应用、日志和玩家操作。
- **备份与恢复**：手动备份、定时备份、更新前备份、归档下载与存档恢复。

## 运行模式

| | 配置编辑模式 | 服务管理模式 |
| --- | --- | --- |
| 适用场景 | 编辑并导出游戏配置 | 在服务器上管理游戏与配置 |
| 运行环境 | Node.js 22+ | Docker Compose，Linux amd64 |
| 配置存储 | 当前浏览器的 `localStorage` | 服务器持久化目录 |
| 应用配置 | 手动复制到游戏配置文件 | 面板写入游戏配置并按需重启 |
| 游戏安装、启停与备份 | — | 支持 |

配置编辑模式无需 Docker、第三方运行依赖或构建。服务管理模式的 Docker 镜像包含 Node.js 和 SteamCMD，一个容器管理一个游戏服务端。

## 快速开始

### 环境要求

- Node.js **22 或以上版本**。
- 支持 ES Modules 的现代浏览器。

### 本地启动

下载或克隆项目后，在项目根目录执行：

```sh
npm start
```

打开 **<http://127.0.0.1:8080>**，按 `Ctrl+C` 停止服务。也可使用 `node server/index.js` 启动。

默认仅监听本机。Linux / macOS 下可通过环境变量修改地址和端口：

```sh
HOST=127.0.0.1 PORT=8081 npm start
```

未设置 `PALBOX_MODE=managed` 时使用配置编辑模式。请通过 HTTP 访问页面，直接打开 HTML 文件无法正常加载完整应用。

### 编辑配置

1. 新建配置、导入 `.ini` 文件，或粘贴 `OptionSettings=(...)`。
2. 使用分类表单修改参数；编辑输入源码后，点击「应用源码」。
3. 点击「复制配置」，将输出写入游戏配置文件并重启游戏服。

有效修改自动保存；未应用源码和非法输入保留为页面草稿。配置编辑模式的数据保存在当前浏览器中，不会上传，清除网站数据会删除本地记录。

完整操作、保存状态、快捷键和游戏配置路径见 [使用指南](docs/usage.md)。

## Docker 部署

适用于需要从面板管理游戏服务端的场景。准备可运行 Docker Compose 的 **Linux amd64** 主机，并为游戏预留足够的 CPU、内存和磁盘空间。

在项目根目录复制环境变量模板：

```sh
cp .env.example .env
```

编辑 `.env`，将 `PALBOX_ADMIN_PASSWORD` 替换为自己的至少 12 位随机密码，并确认数据目录。随后启动：

```sh
docker compose up -d --build
docker compose logs -f palbox
```

打开 **<http://127.0.0.1:8080>**，使用设置的管理密码登录。默认首次启动会下载并启动游戏服务端，可在「运行日志 → 安装与更新」查看进度。

| 配置项 | 默认值 |
| --- | --- |
| 面板地址 | `http://127.0.0.1:8080` |
| 游戏端口 | UDP `8211` |
| 宿主机数据目录 | `/srv/palbox` |
| 容器数据目录 | `/data` |

管理模式中，「已保存」表示面板配置已存盘；点击「应用配置」才会写入游戏并按需重启。

目录结构、全部环境变量、网络访问、已有存档迁入及备份操作见 [Docker 部署文档](docs/docker.md)。

## 开发与测试

### 开发服务

```sh
npm run dev
```

服务端文件修改后自动重启；前端文件修改后刷新页面即可。

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
```

测试默认自行启动临时服务并在结束后关闭。管理测试使用模拟游戏进程，不会下载真实游戏。Playwright 仅用于开发测试，生产运行不依赖它。

`npm run test:browser` 是 `test:e2e` 的兼容别名。编辑器测试可通过 `PALBOX_BASE_URL` 指定已有服务，通过 `PALBOX_QA_OUTPUT` 指定截图和导入样例目录，默认输出到 `test-results/e2e`。

## 项目结构

```text
palbox/
├── public/             页面、样式和静态资源
├── src/
│   ├── domain/         配置解析、参数目录、模板与编辑状态
│   ├── application/    工作空间操作与持久化协调
│   ├── services/       存储、剪贴板、文件与管理 API 适配器
│   ├── ui/             页面组件与交互
│   ├── app.js          应用组装
│   └── main.js         浏览器入口
├── server/             HTTP 服务与游戏管理后端
├── docker/             容器入口脚本
├── tests/              单元、集成与浏览器测试
├── docs/               使用、部署与架构文档
├── Dockerfile          服务管理镜像
└── compose.yaml        Docker Compose 配置
```

前端使用原生 ES Modules，服务端使用 Node.js 内置模块，无构建步骤。模块职责、依赖边界和扩展方式见 [架构说明](docs/architecture.md)。

## 文档

- [使用指南](docs/usage.md)：配置编辑、保存与恢复、快捷键和游戏配置路径。
- [Docker 部署](docs/docker.md)：安装部署、环境变量、游戏服务管理和备份恢复。
- [参数明细](docs/parameters.md)：参数用途、说明来源和验证状态。
- [参数核对记录](docs/parameter-review.md)：参数与说明的核对依据。
- [架构说明](docs/architecture.md)：模块职责、数据流、存储兼容和扩展位置。
