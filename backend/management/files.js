import { mkdir, open, rename, readFile, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(file, value, { beforeCommit = () => {}, exclusive = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(value); await handle.sync(); }
    finally { await handle.close(); }
    beforeCommit();
    // Publish the complete file without replacing an existing destination.
    // Unlike an existence check followed by rename, link is atomic across processes.
    if (exclusive) await link(temporary, file);
    else await rename(temporary, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export const jsonWrite = (file, value, options) => atomicWrite(file, JSON.stringify(value, null, 2) + '\n', options);
export const failure = (message, status = 400) => Object.assign(new Error(message), { status });
