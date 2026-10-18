# GitHub CI/CD 与镜像发布

## 触发方式

| 操作 | 行为 |
| --- | --- |
| 推送分支或创建、更新 PR | 运行 CI 测试和容器启动检查，不发布镜像 |
| 推送 Git tag | 校验 tag，直接构建并发布该提交的前后端镜像，不重复测试 |
| 手动运行 `CI` | 检查所选分支，不发布镜像 |
| 手动运行 `Build and publish containers`，tag 留空 | 构建所选分支，不登录 GHCR、不推送镜像 |
| 手动运行 `Build and publish containers`，填写已有 tag | 构建该 tag 对应提交，不登录 GHCR、不推送镜像 |

CI 在 Node.js 22 和 24 下运行 `npm test`，校验 Compose 配置，再分别构建 Dockerfile 的 `frontend` 和 `backend` 目标，以临时容器验证启动和健康检查。不会安装或启动真实游戏服务端，不执行浏览器界面测试。

先在分支或 PR 的 CI 中完成测试、容器构建和健康检查，确认通过后再给该提交打 tag。容器工作流只解析对应提交并构建镜像，不调用 CI，也不重复执行测试或容器健康检查；只有 tag 推送触发时才登录 GHCR 并发布，手动运行仅构建到临时 runner，本次任务结束后不保留镜像。构建和发布串行执行，避免同时修改 `latest`。

## 镜像与标签

镜像发布到 GitHub Container Registry（GHCR），使用仓库自带的 `GITHUB_TOKEN`，仅发布任务具有 `packages: write` 权限，不需要配置 Docker Hub 密码或额外的个人令牌。镜像通过 OCI source 标签关联当前 GitHub 仓库。

以本仓库推送 `v1.0.0` 为例，会生成：

```text
ghcr.io/snail-one/palbox:v1.0.0
ghcr.io/snail-one/palbox:latest
ghcr.io/snail-one/palbox-frontend:v1.0.0
ghcr.io/snail-one/palbox-frontend:latest
```

Git tag 原样保留，包括 `v` 前缀；tag 必须同时符合 Docker 标签格式：1–128 个字母、数字、下划线、点或连字符，且不能以点或连字符开头。不符合格式或不存在的 tag 会直接失败，不自动改名。

`latest` 指最近一次由 Git tag 推送触发的发布，不比较版本大小；预发布 tag 也会更新它。手动运行不会推送镜像，也不会改变仓库中的 `latest` 或版本标签。需要固定版本时，使用具体的版本标签。镜像当前只构建 `linux/amd64`，与游戏服务端的运行要求一致。

## 自动发布与手动构建

先把工作流文件提交、推送到 GitHub，确认需要发布的提交已通过 CI，再在该提交上创建 tag：

```sh
git tag v1.0.0
git push origin v1.0.0
```

仅创建本地 tag 不会发布，普通分支提交也不会更新镜像。GitHub Release 的创建或编辑不触发发布。

手动构建：进入仓库 **Actions → Build and publish containers → Run workflow**，选择含有工作流的分支。`tag` 留空时构建所选分支；也可填写已有 tag，例如 `v1.0.0`，仅验证该版本构建。两种手动方式均不会登录 GHCR 或推送镜像。若需要测试和容器健康检查，使用 **Actions → CI → Run workflow**。

自动发布完成后，可以在仓库 Packages 和 Actions 的任务摘要查看镜像、标签与 digest；手动构建的摘要会明确标注未推送。若要让其他人免登录拉取，首次发布后把两个容器包的可见性设置为 Public；私有包需要先登录 GHCR，并具备读取权限。

## 使用发布镜像

`compose.yaml` 用于本地构建。在线部署只需把独立的 `compose.ghcr.yaml` 放到部署目录，即可拉取已发布镜像，无需下载源码、Dockerfile 或其他 Compose 文件：

```sh
docker compose -f compose.ghcr.yaml pull
docker compose -f compose.ghcr.yaml up -d
docker compose -f compose.ghcr.yaml logs -f frontend palbox
```

需要指定版本时，把 `compose.ghcr.yaml` 中两个镜像的 `latest` 一起改为相同的 Git tag。端口、环境变量和数据目录直接在这个文件中修改；数据默认保存在该文件旁的 `./data`。默认网页绑定 `127.0.0.1:8080`，远程访问需改为服务器内网 IP 或 `0.0.0.0`。更新镜像时重新执行上面的 `pull` 和 `up -d`，保留原数据目录。

## 依赖更新机器人

`.github/dependabot.yml` 配置 GitHub 官方 Dependabot，每周检查 npm 依赖、Docker 基础镜像和 GitHub Actions，并分别合并同类依赖为更新 PR。机器人 PR 运行同一套 CI，不自动合并，也不会直接发布镜像；合并后仍须推送 tag 才会发布。

配置提交到默认分支后生效。版本更新由配置文件启用；安全告警和安全更新可另在仓库设置的 Code security 中启用。

工作流使用 GitHub 和 Docker 官方 Actions，固定到已核实的提交 SHA，依赖更新 PR 由 `dependabot[bot]` 创建。实现参考：[GitHub 镜像发布文档](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)、[Dependabot 配置参考](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)。
