import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rm, symlink, lstat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { failure } from './files.js';
import { replaceDirectory } from './replace-directory.js';

const DOWNLOAD_URL = 'https://client-update.steamstatic.com/installer/steamcmd_linux.tar.gz';
const MAX_DOWNLOAD = 64 * 1024 * 1024;
const READY_FILE = '.palbox-ready';
export const defaultSteamcmd = directory => path.resolve(directory, 'steamcmd/steamcmd.sh');
export const managedSteamcmd = runtime => path.resolve(runtime.steamcmd) === defaultSteamcmd(runtime.directory);

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
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
  const abortCommand = () => runtime.kill(runtime.command, 'SIGKILL');
  signal.addEventListener('abort', abortCommand, { once: true });
  let temporary;
  const phase = (name, message) => { onProgress(name, message); runtime.log('steamcmd', `${message}\n`); };
  try {
    await mkdir(runtime.directory, { recursive: true, mode: 0o700 });
    await access(runtime.directory, constants.R_OK | constants.W_OK | constants.X_OK);
    temporary = await mkdtemp(path.join(runtime.directory, '.steamcmd-'));
    const archive = path.join(temporary, 'steamcmd.tar.gz');
    const unpacked = path.join(temporary, 'installation');
    await mkdir(unpacked);
    phase('steamcmd-downloading', '正在从 Valve 下载 SteamCMD。');
    try {
      const response = await download(DOWNLOAD_URL, { signal });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw failure(`SteamCMD 下载失败（HTTP ${response.status}），请稍后重试。`, 502);
      }
      let bytes = 0;
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_DOWNLOAD ? failure('SteamCMD 下载文件过大，已停止安装。', 502) : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
    } catch (error) {
      if (error.status) throw error;
      throw failure(`SteamCMD 下载失败，请检查服务器访问 Valve 的网络后重试：${error.message}`, 502);
    }
    phase('steamcmd-installing', '正在解压 SteamCMD。');
    try {
      await runtime.run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', unpacked], 'steamcmd', { timeoutMs: 60000 });
    } catch (error) {
      throw failure(`SteamCMD 解压失败，请确认已安装 tar，并查看安装日志：${error.message}`, 500);
    }
    await access(path.join(unpacked, 'steamcmd.sh'), constants.R_OK | constants.X_OK);
    signal.throwIfAborted();
    // Only replace PalBox's dedicated SteamCMD directory, never a custom path.
    await replaceDirectory(unpacked, path.dirname(runtime.steamcmd));
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
      // and timeouts can terminate the updater as well as its shell launcher.
      await runtime.run(runtime.steamcmd, ['+quit'], 'steamcmd', { cwd: path.dirname(runtime.steamcmd), timeoutMs: 300000 });
      for (const file of ['linux32/steamcmd', 'linux64/steamclient.so']) await access(path.join(path.dirname(runtime.steamcmd), file), constants.R_OK);
    } catch (error) {
      throw failure(`SteamCMD 初始化失败。Ubuntu / Debian 请先执行 sudo apt-get update && sudo apt-get install -y lib32gcc-s1 lib32stdc++6 ca-certificates tar，再重试；网络错误请查看安装与更新日志。${error.message}`, 500);
    }
    signal.throwIfAborted();
    await writeFile(path.join(path.dirname(runtime.steamcmd), READY_FILE), 'ready\n', { mode: 0o600 });
    phase('steamcmd-ready', 'SteamCMD 安装完成，可以安装游戏服务端。');
  } catch (error) {
    if (signal.aborted) throw failure(controller.signal.aborted ? '面板正在关闭，SteamCMD 安装已中止。' : 'SteamCMD 下载或初始化超时，请查看日志后重试。', controller.signal.aborted ? 503 : 504);
    if (['EACCES', 'EPERM'].includes(error.code)) throw failure(`SteamCMD 安装目录无权读写：${runtime.directory}。请让运行 PalBox 的系统用户拥有 data 目录的读写权限，并使用安装时配置的同一用户启动程序。`, 403);
    throw error;
  } finally {
    signal.removeEventListener('abort', abortCommand);
    runtime.steamcmdAbort = null;
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
