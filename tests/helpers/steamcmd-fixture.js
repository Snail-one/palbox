import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

// Exercise the real download stream, tar extraction and bootstrap subprocess
// without contacting Valve or requiring the host's 32-bit runtime libraries.
export async function steamcmdArchive(directory, { failInitialization = false, gameInstaller } = {}) {
  const source = path.join(directory, 'steamcmd-fixture');
  await mkdir(path.join(source, 'linux32'), { recursive: true });
  await writeFile(path.join(source, 'linux32/steamcmd'), 'fixture', { mode: 0o755 });
  await writeFile(path.join(source, 'steamcmd.sh'), `#!/bin/sh
if [ "$1" = '+quit' ]; then
  echo 'SteamCMD fixture initialization'
  ${failInitialization ? 'exit 1' : "mkdir -p linux64\n  printf 'fixture-library' > linux64/steamclient.so\n  exit 0"}
fi
${gameInstaller ? `exec ${quote(gameInstaller)} "$@"` : 'exit 1'}
`, { mode: 0o755 });
  const archive = path.join(directory, 'steamcmd-fixture.tar.gz');
  await run('tar', ['-czf', archive, '-C', source, '--', 'steamcmd.sh', 'linux32']);
  return readFile(archive);
}
