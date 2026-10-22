import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

test('所有 Node 启动入口先拒绝 root，伪造用户名也不会创建数据或启动服务', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palbox-root-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'root.mjs');
  await writeFile(preload, 'process.getuid = () => 0; process.geteuid = () => 0;\n');
  const data = path.join(directory, 'data');
  for (const entry of ['scripts/start.js', 'backend/index.js', 'frontend/index.js']) {
    await assert.rejects(run(process.execPath, ['--import', pathToFileURL(preload).href, path.join(root, entry)], {
      env: { ...process.env, USER: 'ubuntu', LOGNAME: 'ubuntu', SUDO_USER: 'ubuntu', PALBOX_SERVICE_USER: 'ubuntu', PALBOX_DATA_DIR: data },
      timeout: 5000
    }), error => {
      assert.equal(error.code, 1, entry);
      assert.match(error.stderr, /禁止以 root（UID 0）运行 PalBox/);
      assert.doesNotMatch(error.stdout, /已启动|游戏管理：http/);
      return true;
    });
  }
  await assert.rejects(access(data), { code: 'ENOENT' });
});
