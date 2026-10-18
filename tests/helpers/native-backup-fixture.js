import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function nativeBackupFixture(saved, { worldId = '0123456789ABCDEF0123456789ABCDEF', timestamp = '2026.10.17-12.00.00' } = {}) {
  const world = path.join(saved, 'SaveGames/0', worldId);
  const snapshot = path.join(world, 'backup/world', timestamp);
  await mkdir(path.join(world, 'Players'), { recursive: true });
  await mkdir(path.join(snapshot, 'Players'), { recursive: true });
  await mkdir(path.join(saved, 'Config/LinuxServer'), { recursive: true });
  await writeFile(path.join(saved, 'Config/LinuxServer/GameUserSettings.ini'), `[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=${worldId}\n`);
  await writeFile(path.join(world, 'Level.sav'), 'current-world');
  await writeFile(path.join(world, 'LevelMeta.sav'), 'current-meta');
  await writeFile(path.join(world, 'WorldOption.sav'), 'current-options');
  await writeFile(path.join(world, 'Players/current.sav'), 'current-player');
  await writeFile(path.join(snapshot, 'Level.sav'), 'official-world');
  await writeFile(path.join(snapshot, 'LevelMeta.sav'), 'official-meta');
  await writeFile(path.join(snapshot, 'Players/original.sav'), 'official-player');
  return { id: `${worldId}/${timestamp}`, worldId, timestamp, world, snapshot };
}
