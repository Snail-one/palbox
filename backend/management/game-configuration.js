import { parse, decodeString } from '../../shared/domain/config.js';
import { failure } from './files.js';

/** Check the same management prerequisites before applying, importing or starting. */
export function validateManagedConfiguration(source, { gamePort = 8211, reservedPorts = [] } = {}) {
  let values;
  try { values = new Map(parse(source).entries.map(entry => [entry.key, entry.raw])); }
  catch (error) { throw failure(error.message); }
  const password = decodeString(values.get('AdminPassword') || '""');
  if (values.get('RESTAPIEnabled') !== 'True' || !password) throw failure('管理模式需要 RESTAPIEnabled=True 和非空管理员密码。');
  const port = Number(values.get('RESTAPIPort') ?? 8212);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === gamePort || reservedPorts.includes(port)) {
    throw failure('REST API 端口无效或与现有服务端口冲突。');
  }
  return { port, password };
}
