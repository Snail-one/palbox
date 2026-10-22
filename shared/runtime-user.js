/** All server entry points reject real or effective root, regardless of env. */
export function assertNonRoot(identity = process) {
  if (identity.getuid?.() === 0 || identity.geteuid?.() === 0) {
    throw new Error('禁止以 root（UID 0）运行 PalBox。请使用普通用户启动；sudo 仅用于执行 install.sh。');
  }
}
