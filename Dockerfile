# 从同一 Debian 系列的官方镜像取得 Node.js 运行时。
FROM node:26-trixie-slim AS node-runtime

# 固定 Debian 大版本，SteamCMD 和游戏文件在运行时安装。
FROM debian:13-slim AS backend

ARG TARGETARCH
ARG DEBIAN_FRONTEND=noninteractive

ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC

# 保留下载、SteamCMD、游戏目录查询、Node.js、入口脚本及 TZ 所需的运行依赖。
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN test "${TARGETARCH:-amd64}" = amd64 \
    && test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates lib32gcc-s1 procps 7zip \
        tini gosu libstdc++6 libatomic1 tzdata util-linux xdg-user-dirs \
    && rm -rf /var/lib/apt/lists/* \
    && command -v xdg-user-dir \
    && node --version

# 保留 node 用户名，与入口脚本中的 PUID/PGID 权限调整保持一致。
RUN groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --create-home --home-dir /data/steam-home --shell /bin/bash node \
    && mkdir -p /data/tmp /data/cache \
    && chown -R node:node /data

# 后端镜像仅包含管理 API 和共享领域模块。
WORKDIR /app
COPY package.json ./
COPY backend ./backend
COPY shared ./shared
COPY docker/entrypoint.sh /usr/local/bin/palbox-entrypoint
RUN chmod 755 /usr/local/bin/palbox-entrypoint

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8081 \
    PALBOX_DATA_DIR=/data HOME=/data/steam-home TMPDIR=/data/tmp XDG_CACHE_HOME=/data/cache

EXPOSE 8081/tcp 8211/udp
VOLUME ["/data"]
STOPSIGNAL SIGTERM
# 游戏停服时面板仍需可用，健康检查使用面板接口。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# 入口先处理挂载目录权限，再通过 gosu 以普通用户运行服务。
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/palbox-entrypoint"]
CMD ["node", "backend/index.js"]

# 前端独立部署，无需 SteamCMD 或游戏数据目录。
FROM node-runtime AS frontend
WORKDIR /app
COPY package.json ./
COPY frontend ./frontend
COPY shared ./shared
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PALBOX_API_URL=http://palbox:8081 TZ=UTC
USER node
EXPOSE 8080/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "frontend/index.js"]
