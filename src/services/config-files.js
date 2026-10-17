import { parse } from '../domain/config.js';

export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export function validateImport(source) {
  if (new TextEncoder().encode(source).length > MAX_CONFIG_BYTES) throw new Error('配置超过 2 MB，请检查粘贴的内容。');
  parse(source);
  return source;
}

export async function readConfigFile(file) {
  if (file.size > MAX_CONFIG_BYTES) throw new Error('文件超过 2 MB，请选择服务器 INI 配置文件。');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  return validateImport(source);
}
