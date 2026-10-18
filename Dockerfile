FROM node:22-bookworm-slim

ARG TARGETARCH
RUN test "${TARGETARCH:-amd64}" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tar tini gosu passwd lib32gcc-s1 lib32stdc++6 libatomic1 libcurl4 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/steamcmd /home/node/.steam/sdk64 /data \
    && curl --fail --location --retry 3 https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz -o /tmp/steamcmd.tar.gz \
    && tar -xzf /tmp/steamcmd.tar.gz -C /opt/steamcmd \
    && rm /tmp/steamcmd.tar.gz \
    && ln -s /opt/steamcmd/linux64/steamclient.so /home/node/.steam/sdk64/steamclient.so \
    && chown -R node:node /opt/steamcmd /home/node /data

WORKDIR /app
COPY package.json ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY docker/entrypoint.sh /usr/local/bin/palbox-entrypoint
RUN chmod 755 /usr/local/bin/palbox-entrypoint

ENV NODE_ENV=production PALBOX_MODE=managed HOST=0.0.0.0 PORT=8080 \
    PALBOX_DATA_DIR=/data PALBOX_STEAMCMD=/opt/steamcmd/steamcmd.sh \
    PALBOX_AUTO_INSTALL=true PALBOX_AUTO_START=true HOME=/home/node

EXPOSE 8080/tcp 8211/udp
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/palbox-entrypoint"]
CMD ["node", "server/index.js"]
