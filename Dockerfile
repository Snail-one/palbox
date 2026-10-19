# 从同一 Debian 系列的官方镜像取得 Node.js 22 运行时。
FROM node:26-trixie-slim AS node-runtime

# 固定 Debian 大版本，SteamCMD 和游戏文件在运行时安装。
FROM debian:13-slim AS backend

ARG TARGETARCH
ARG DEBIAN_FRONTEND=noninteractive

ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

# 保留下载、SteamCMD、游戏目录查询、Node.js、入口脚本及 TZ 所需的运行依赖。
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN test "${TARGETARCH:-amd64}" = amd64 \
    && test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates lib32gcc-s1 procps \
        tini gosu libstdc++6 libatomic1 tzdata util-linux xdg-user-dirs \
    && rm -rf /var/lib/apt/lists/* \
    && command -v xdg-user-dir \
    && node --version

# 保留 node 用户名，与入口脚本中的 PUID/PGID 权限调整保持一致。
RUN groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --create-home --home-dir /home/node --shell /bin/bash node \
    && mkdir -p /opt/steamcmd /home/node/.steam/sdk64 /data

# 下载器设置重试和连接超时，解包后由普通用户更新和运行。
RUN curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 \
        https://client-update.steamstatic.com/installer/steamcmd_linux.tar.gz \
        -o /tmp/steamcmd.tar.gz \
    && tar -xzf /tmp/steamcmd.tar.gz -C /opt/steamcmd \
    && rm /tmp/steamcmd.tar.gz \
    && ln -s /opt/steamcmd/linux64/steamclient.so /home/node/.steam/sdk64/steamclient.so \
    && chown -R node:node /opt/steamcmd /home/node /data

# 后端镜像仅包含管理 API 和共享领域模块。
WORKDIR /app
COPY package.json ./
COPY backend ./backend
COPY shared ./shared
COPY docker/entrypoint.sh /usr/local/bin/palbox-entrypoint
RUN chmod 755 /usr/local/bin/palbox-entrypoint

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8081 \
    PALBOX_DATA_DIR=/data PALBOX_STEAMCMD=/opt/steamcmd/steamcmd.sh \
    HOME=/home/node

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
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PALBOX_API_URL=http://palbox:8081
USER node
EXPOSE 8080/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "frontend/index.js"]
