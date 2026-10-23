import { createWriteStream } from 'node:fs';
import { access, mkdir, symlink, lstat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { lookup } from 'node:dns/promises';
import diagnostics_channel from 'node:diagnostics_channel';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { failure } from './files.js';
import { replaceDirectory } from './replace-directory.js';
import { createTransaction, finishTransaction } from './transactions.js';

const DOWNLOAD_URL = 'https://client-update.steamstatic.com/installer/steamcmd_linux.tar.gz';
const MAX_DOWNLOAD = 64 * 1024 * 1024;
const READY_FILE = '.palbox-ready';
const downloadSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
export const defaultSteamcmd = directory => path.resolve(directory, 'steamcmd/steamcmd.sh');
export const managedSteamcmd = runtime => path.resolve(runtime.steamcmd) === defaultSteamcmd(runtime.directory);

const ipFamily = address => isIP(address) === 6 ? 'IPv6' : isIP(address) === 4 ? 'IPv4' : '';
const socketFamily = family => family === 'IPv6' ? 'IPv6' : family === 'IPv4' ? 'IPv4' : '未知';

export function formatLookup(hostname, records) {
  const list = records.map(record => `${record.family === 6 ? 'IPv6' : 'IPv4'} ${record.address}`).join('，');
  return `DNS ${hostname}：${list || '没有地址'}`;
}

export function connectionLog(message) {
  const socket = message.socket;
  const host = message.connectParams?.hostname || message.connectParams?.host || '';
  const remotePort = socket?.remotePort ? `:${socket.remotePort}` : '';
  const local = socket?.localAddress ? `本机 ${socketFamily(socket.localFamily)} ${socket.localAddress}${socket.localPort ? `:${socket.localPort}` : ''} -> ` : '';
  return `已连接 ${host}：${local}远端 ${socketFamily(socket?.remoteFamily)} ${socket?.remoteAddress || '未知地址'}${remotePort}`;
}

export function networkFailureText(error) {
  const details = [];
  const seen = new Set();
  const visit = current => {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current.errors)) for (const item of current.errors) visit(item);
    const family = current.address ? ipFamily(current.address) : '';
    const address = current.address ? `${current.address}${current.port ? `:${current.port}` : ''}` : '';
    const piece = [current.syscall, current.code, family, address].filter(Boolean).join(' ');
    if (piece) details.push(piece);
    visit(current.cause);
  };
  visit(error?.cause);
  const detail = [...new Set(details)].join('；');
  return detail ? `${error.message}（${detail}）` : error.message;
}

async function dnsLog(hostname) {
  try { return formatLookup(hostname, await lookup(hostname, { all: true, verbatim: true })); }
  catch (error) { return `DNS ${hostname}：解析失败 ${error.code || error.message}`; }
}

function watchConnections(log) {
  const connected = diagnostics_channel.channel('undici:client:connected');
  const failed = diagnostics_channel.channel('undici:client:connectError');
  const onConnected = message => log(connectionLog(message));
  const onFailed = ({ connectParams, error }) => {
    const family = error?.address ? ipFamily(error.address) : '';
    log(`连接失败 ${connectParams?.hostname || connectParams?.host || ''}：${[error?.code, family, error?.address].filter(Boolean).join(' ') || error?.message || '未知错误'}`);
  };
  connected.subscribe(onConnected);
  failed.subscribe(onFailed);
  return () => { connected.unsubscribe(onConnected); failed.unsubscribe(onFailed); };
}

export async function steamcmdStatus(runtime) {
  const managed = managedSteamcmd(runtime);
  let installed = false;
  try {
    await access(runtime.steamcmd, constants.R_OK | constants.X_OK);
    if (managed) {
      for (const file of [READY_FILE, 'linux32/steamcmd', 'linux64/steamclient.so']) await access(path.join(path.dirname(runtime.steamcmd), file), constants.R_OK);
    }
    installed = true;
  } catch { /* Missing or incomplete installations remain retryable. */ }
  const supported = process.platform === 'linux' && process.arch === 'x64';
  const reason = !supported ? '自动安装 SteamCMD 需要 Linux x86_64。'
    : !managed && !installed ? '自定义 SteamCMD 路径不可用，请修正 PALBOX_STEAMCMD，或取消该设置后使用自动安装。' : '';
  return { installed, canInstall: supported && managed, reason };
}

export async function installSteamcmd(runtime, { onProgress = () => {}, fetch: download = globalThis.fetch } = {}) {
  const status = await steamcmdStatus(runtime);
  if (status.installed) return;
  if (!status.canInstall) throw failure(status.reason, 409);
  if (runtime.closing) throw failure('面板正在关闭。', 503);
  if (runtime.game) throw failure('请先停止游戏服再安装 SteamCMD。', 409);
  const controller = new AbortController();
  runtime.steamcmdAbort = controller;
  const signal = controller.signal;
  const abortCommand = () => runtime.kill(runtime.command, 'SIGKILL');
  signal.addEventListener('abort', abortCommand, { once: true });
  let temporary;
  const phase = (name, message) => { onProgress(name, message); runtime.log('steamcmd', `${message}\n`); };
  try {
    await mkdir(runtime.directory, { recursive: true, mode: 0o700 });
    await access(runtime.directory, constants.R_OK | constants.W_OK | constants.X_OK);
    temporary = await createTransaction(runtime.directory, runtime.directory, '.steamcmd-', { recoverable: false });
    const archive = path.join(temporary, 'steamcmd.tar.gz');
    const unpacked = path.join(temporary, 'installation');
    await mkdir(unpacked);
    phase('steamcmd-downloading', '正在从 Valve 下载 SteamCMD。');
    let stopWatch = () => {};
    try {
      if (download === globalThis.fetch) {
        const target = new URL(DOWNLOAD_URL);
        runtime.log('steamcmd', `下载地址：${DOWNLOAD_URL}\n${await dnsLog(target.hostname)}\n`);
        stopWatch = watchConnections(line => runtime.log('steamcmd', `${line}\n`));
      }
      const response = await download(DOWNLOAD_URL, { signal });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw failure(`SteamCMD 下载失败（HTTP ${response.status}），请稍后重试。`, 502);
      }
      const declared = Number(response.headers.get('content-length'));
      const encoding = response.headers.get('content-encoding');
      // Fetch may decompress HTTP content, making its wire length unsuitable for a percentage.
      const total = Number.isSafeInteger(declared) && declared > 0 && declared <= MAX_DOWNLOAD && (!encoding || encoding === 'identity') ? declared : null;
      let bytes = 0, reportedAt = performance.now();
      const report = () => phase('steamcmd-downloading', `正在下载 SteamCMD 安装包：${downloadSize(bytes)}${total ? ` / ${downloadSize(total)}（${Math.min(99, Math.floor(bytes / total * 100))}%）` : '（总大小未知）'}。`);
      report();
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD) { callback(failure('SteamCMD 下载文件过大，已停止安装。', 502)); return; }
        const now = performance.now();
        // Report from incoming data, at most once per second; no polling timer.
        if (now - reportedAt >= 1000) { reportedAt = now; report(); }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
      phase('steamcmd-downloading', `SteamCMD 安装包下载完成：${downloadSize(bytes)}${total === bytes ? '（100%）' : ''}。`);
    } catch (error) {
      if (error.status) throw error;
      throw failure(`SteamCMD 下载失败，请检查服务器访问 Valve 的网络后重试：${networkFailureText(error)}`, 502);
    } finally { stopWatch(); }
    phase('steamcmd-installing', '正在解压 SteamCMD。');
    try {
      await runtime.run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', unpacked], 'steamcmd', { timeoutMs: 60000 });
    } catch (error) {
      throw failure(`SteamCMD 解压失败，请确认已安装 tar，并查看安装日志：${error.message}`, 500);
    }
    await access(path.join(unpacked, 'steamcmd.sh'), constants.R_OK | constants.X_OK);
    signal.throwIfAborted();
    // Only replace PalBox's dedicated SteamCMD directory, never a custom path.
    await replaceDirectory(unpacked, path.dirname(runtime.steamcmd), {
      stageDirectory: await createTransaction(runtime.directory, path.dirname(path.dirname(runtime.steamcmd)), 'steamcmd-swap-')
    });
    const sdk = path.join(runtime.directory, 'steam-home/.steam/sdk64');
    await mkdir(sdk, { recursive: true, mode: 0o700 });
    const library = path.join(sdk, 'steamclient.so');
    try { await lstat(library); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await symlink(path.join(path.dirname(runtime.steamcmd), 'linux64/steamclient.so'), library);
    }
    phase('steamcmd-initializing', '正在初始化并更新 SteamCMD，首次运行可能需要几分钟。');
    try {
      // Keep bootstrap descendants in the supervised process group so shutdown
      // can terminate the updater as well as its shell launcher.
      await runtime.run(runtime.steamcmd, ['+quit'], 'steamcmd', { cwd: path.dirname(runtime.steamcmd) });
      for (const file of ['linux32/steamcmd', 'linux64/steamclient.so']) await access(path.join(path.dirname(runtime.steamcmd), file), constants.R_OK);
    } catch (error) {
      throw failure(`SteamCMD 初始化失败。Ubuntu / Debian 请先执行 sudo apt-get update && sudo apt-get install -y lib32gcc-s1，再重试；网络错误请查看安装与更新日志。${error.message}`, 500);
    }
    signal.throwIfAborted();
    await writeFile(path.join(path.dirname(runtime.steamcmd), READY_FILE), 'ready\n', { mode: 0o600 });
    phase('steamcmd-ready', 'SteamCMD 安装完成，可以安装游戏服务端。');
  } catch (error) {
    if (signal.aborted) throw failure('面板正在关闭，SteamCMD 安装已中止。', 503);
    if (['EACCES', 'EPERM'].includes(error.code)) throw failure(`SteamCMD 安装目录无权读写：${runtime.directory}。请让运行 PalBox 的系统用户拥有 data 目录的读写权限，并使用安装时配置的同一用户启动程序。`, 403);
    throw error;
  } finally {
    signal.removeEventListener('abort', abortCommand);
    runtime.steamcmdAbort = null;
    if (temporary) await finishTransaction(temporary, { onCleanupError: error => runtime.log('steamcmd', `安装暂存清理失败：${error.message}\n`) });
  }
}
