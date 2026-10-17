(function (root) {
  'use strict';
  const groups = [
    { id: 'server', name: '服务器', icon: 'server', subtitle: '设置服务器身份、连接与管理方式' },
    { id: 'player', name: '玩家', icon: 'user', subtitle: '调整成长、体力与生存体验' },
    { id: 'pal', name: '帕鲁', icon: 'sparkles', subtitle: '打造适合你的捕捉与养成节奏' },
    { id: 'world', name: '世界与资源', icon: 'globe', subtitle: '控制昼夜、采集和世界事件' },
    { id: 'base', name: '据点与公会', icon: 'home', subtitle: '管理据点规模、生产和公会规则' },
    { id: 'combat', name: '战斗规则', icon: 'shield', subtitle: '调整战斗、死亡惩罚与多人规则' }
  ];
  const fields = Object.create(null);
  function add(group, key, label, type, description, extra = {}) {
    fields[key] = { group, key, label, type, description, ...extra };
  }
  const text = (g, k, l, d, extra) => add(g, k, l, 'text', d, extra);
  const num = (g, k, l, d, extra) => add(g, k, l, 'number', d, extra);
  const bool = (g, k, l, d) => add(g, k, l, 'boolean', d);
  const select = (g, k, l, d, options) => add(g, k, l, 'select', d, { options });
  text('server', 'ServerName', '服务器名称', '显示在服务器列表中的名称。', { wide: true });
  text('server', 'ServerDescription', '服务器简介', '让玩家了解这个世界。', { wide: true });
  num('server', 'ServerPlayerMaxNum', '最大在线人数', '同时加入服务器的玩家上限。', { integer: true, min: 1, unit: '人' });
  num('server', 'PublicPort', '公开端口', '社区服务器对外显示的端口，不修改实际监听端口。', { integer: true, min: 1, max: 65535 });
  text('server', 'ServerPassword', '加入密码', '玩家连接服务器时使用的密码；留空表示不设置。', { secret: true });
  text('server', 'AdminPassword', '管理员密码', '获取服务器管理权限时使用的密码。', { secret: true });
  text('server', 'PublicIP', '公开 IP', '社区服务器对外公布的 IP，可留空。');
  text('server', 'Region', '服务器地区', '保留服务器配置使用的地区值。');
  add('server', 'CrossplayPlatforms', '允许连接的平台', 'platforms', '选择允许加入服务器的平台。', { wide: true });
  bool('server', 'bAllowClientMod', '允许客户端 Mod', '允许启用 Mod 的玩家加入。');
  bool('server', 'bIsUseBackupSaveData', '自动备份世界', '开启世界备份，会增加磁盘读写。');
  bool('server', 'bShowPlayerList', '显示玩家列表', '在游戏 ESC 菜单中显示玩家列表。');
  bool('server', 'bIsShowJoinLeftMessage', '显示进出消息', '玩家加入或离开时显示游戏内消息。');
  bool('server', 'RCONEnabled', '启用 RCON', '允许通过 RCON 管理服务器。');
  num('server', 'RCONPort', 'RCON 端口', 'RCON 服务使用的端口。', { integer: true, min: 1, max: 65535 });
  bool('server', 'RESTAPIEnabled', '启用 REST API', '允许使用服务器 REST API。');
  num('server', 'RESTAPIPort', 'REST API 端口', 'REST API 的监听端口。', { integer: true, min: 1, max: 65535 });
  num('server', 'ChatPostLimitPerMinute', '聊天频率上限', '每分钟允许发送的最大消息数量。', { integer: true, min: 0, unit: '条 / 分钟' });
  select('server', 'LogFormatType', '日志格式', '服务器日志的输出格式。', { Text: '文本', Json: 'JSON' });

  const rates = [
    ['player', 'ExpRate', '经验获取倍率', '经验值获得速度。'],
    ['player', 'PlayerDamageRateAttack', '玩家攻击倍率', '玩家造成的伤害倍率。'],
    ['player', 'PlayerDamageRateDefense', '玩家承伤倍率', '玩家受到的伤害倍率，越高受到的伤害越多。'],
    ['player', 'PlayerStomachDecreaceRate', '玩家饥饿速度', '玩家饱食度的消耗倍率。'],
    ['player', 'PlayerStaminaDecreaceRate', '玩家体力消耗', '玩家体力的消耗倍率。'],
    ['player', 'PlayerAutoHPRegeneRate', '玩家生命恢复', '玩家自然恢复生命值的速度倍率。'],
    ['player', 'PlayerAutoHpRegeneRateInSleep', '玩家睡眠恢复', '玩家睡眠时的生命恢复倍率。'],
    ['player', 'ItemWeightRate', '物品重量倍率', '背包物品的重量倍率。'],
    ['player', 'EquipmentDurabilityDamageRate', '装备耐久消耗', '装备耐久度的消耗倍率。'],
    ['pal', 'PalCaptureRate', '帕鲁捕捉倍率', '帕鲁捕捉成功率的倍率。'],
    ['pal', 'PalSpawnNumRate', '帕鲁生成倍率', '帕鲁生成数量倍率，会影响服务器负载。'],
    ['pal', 'PalDamageRateAttack', '帕鲁攻击倍率', '帕鲁造成的伤害倍率。'],
    ['pal', 'PalDamageRateDefense', '帕鲁承伤倍率', '帕鲁受到的伤害倍率。'],
    ['pal', 'PalStomachDecreaceRate', '帕鲁饥饿速度', '帕鲁饱食度的消耗倍率。'],
    ['pal', 'PalStaminaDecreaceRate', '帕鲁体力消耗', '帕鲁体力的消耗倍率。'],
    ['pal', 'PalAutoHPRegeneRate', '帕鲁生命恢复', '帕鲁自然恢复生命值的速度倍率。'],
    ['pal', 'PalAutoHpRegeneRateInSleep', '帕鲁睡眠恢复', '帕鲁在终端内睡眠时的生命恢复倍率。'],
    ['world', 'DayTimeSpeedRate', '白天流逝速度', '白天时间的流逝倍率，越高白天越短。'],
    ['world', 'NightTimeSpeedRate', '夜晚流逝速度', '夜晚时间的流逝倍率，越高夜晚越短。'],
    ['world', 'CollectionDropRate', '采集掉落倍率', '采集资源时获得的物品数量倍率。'],
    ['world', 'CollectionObjectHpRate', '采集物生命倍率', '树木、矿石等采集对象的生命值倍率。'],
    ['world', 'CollectionObjectRespawnSpeedRate', '资源刷新间隔', '采集对象重新生成的间隔倍率。'],
    ['world', 'EnemyDropItemRate', '敌人掉落倍率', '击败敌人后掉落的物品数量倍率。'],
    ['world', 'ItemCorruptionMultiplier', '食物腐坏速度', '物品腐坏速度的倍率。'],
    ['base', 'WorkSpeedRate', '工作速度倍率', '据点生产工作的速度倍率。'],
    ['base', 'BuildObjectHpRate', '建筑生命倍率', '建筑的生命值倍率。'],
    ['base', 'BuildObjectDamageRate', '建筑承伤倍率', '建筑受到的伤害倍率。'],
    ['base', 'BuildObjectDeteriorationDamageRate', '建筑腐朽速度', '建筑自然腐朽的伤害倍率。'],
    ['base', 'MonsterFarmActionSpeedRate', '牧场生产速度', '帕鲁在牧场中生产物品的速度倍率。']
  ];
  for (const [g, k, l, d] of rates) num(g, k, l, d, { min: 0, unit: '×' });
  num('pal', 'PalEggDefaultHatchingTime', '巨大蛋孵化时间', '巨大蛋的基准孵化时间；其他蛋也受影响。', { min: 0, unit: '小时' });
  select('pal', 'RandomizerType', '帕鲁随机模式', '控制野生帕鲁的随机生成方式。', { None: '不随机', Region: '区域随机', All: '完全随机' });
  text('pal', 'RandomizerSeed', '随机种子', '帕鲁随机模式使用的种子值。');
  bool('pal', 'bIsRandomizerPalLevelRandom', '随机帕鲁等级', '关闭时，随机等级限制在区域预期范围内。');
  bool('pal', 'bAllowGlobalPalboxExport', '允许全局终端导出', '允许将帕鲁存入全局帕鲁终端。');
  bool('pal', 'bAllowGlobalPalboxImport', '允许全局终端导入', '允许从全局帕鲁终端取出帕鲁。');
  num('world', 'SupplyDropSpan', '陨石与补给间隔', '陨石与补给事件的发生间隔。', { min: 0, unit: '分钟' });
  num('world', 'FishingDifficultyRate', '钓鱼难度', '钓鱼难度系数。', { min: 0.1, max: 1, unit: '×' });
  num('world', 'DropItemMaxNum', '掉落物数量上限', '世界中掉落物的最大数量。', { integer: true, min: 0 });
  num('world', 'PhysicsActiveDropItemMaxNum', '物理掉落物上限', '可启用物理行为的掉落物数量，保留 -1 特殊值。', { integer: true, min: -1 });
  num('world', 'DropItemAliveMaxHours', '掉落物保留时间', '掉落物在世界中保留的时间。', { min: 0, unit: '小时' });
  bool('world', 'bEnableFastTravel', '允许快速旅行', '启用世界中的快速旅行。');
  bool('world', 'bEnableFastTravelOnlyBaseCamp', '仅据点间快速旅行', '将快速旅行限制为据点之间。');
  bool('world', 'bEnableInvaderEnemy', '启用据点袭击', '允许袭击敌人出现。');
  bool('world', 'EnablePredatorBossPal', '启用掠食者帕鲁', '保留并编辑模板中的掠食者开关。');
  num('base', 'BaseCampMaxNum', '全服据点上限', '整个服务器允许存在的据点数量。', { integer: true, min: 0 });
  num('base', 'BaseCampMaxNumInGuild', '每公会据点上限', '提高数量会增加服务器负载。', { integer: true, min: 1, max: 10 });
  num('base', 'BaseCampWorkerMaxNum', '每据点工作帕鲁', '每个据点允许的工作帕鲁数量。', { integer: true, min: 1, max: 50 });
  num('base', 'GuildPlayerMaxNum', '公会人数上限', '每个公会允许的玩家数量。', { integer: true, min: 1, unit: '人' });
  num('base', 'MaxBuildingLimitNum', '建筑数量限制', '模板中的建筑数量限制，0 表示不限制。', { integer: true, min: 0 });
  num('base', 'MaxBuildingLimitNumPerPlayer', '每玩家建筑限制', '保留模板中的每玩家建筑上限，0 表示不限制。', { integer: true, min: 0 });
  bool('base', 'bAutoResetGuildNoOnlinePlayers', '清理无人登录公会', '达到离线时间后清理公会建筑与据点帕鲁。');
  num('base', 'AutoResetGuildTimeNoOnlinePlayers', '无人登录清理时间', '仅启用无人登录公会清理时生效。', { min: 0, unit: '小时' });
  bool('base', 'bBuildAreaLimit', '限制建筑区域', '限制在快速旅行点等地点附近建造。');
  bool('base', 'bAllowEnemyCampSpawnNearBaseCamp', '允许据点附近敌营', '允许在据点附近生成敌方营地。');
  select('combat', 'DeathPenalty', '死亡惩罚', '设置死亡后掉落的物品和帕鲁。', { None: '不掉落', Item: '掉落物品（保留装备）', ItemAndEquipment: '掉落全部物品和装备', All: '掉落物品、装备与队伍帕鲁' });
  bool('combat', 'bIsPvP', '启用 PvP', '启用玩家对战规则。');
  bool('combat', 'bEnablePlayerToPlayerDamage', '允许玩家互相伤害', '保留模板中的玩家间伤害开关。');
  bool('combat', 'bEnableFriendlyFire', '允许友军伤害', '保留模板中的友军伤害开关。');
  bool('combat', 'bHardcore', '硬核模式', '启用后死亡将无法重生。');
  bool('combat', 'bPalLost', '死亡永久失去帕鲁', '启用死亡时永久失去帕鲁的规则。');
  bool('combat', 'bCharacterRecreateInHardcore', '硬核模式允许重建', '允许硬核模式死亡后重新创建角色。');
  num('combat', 'BlockRespawnTime', '重生冷却', '死亡后的基础重生等待时间。', { min: 0, unit: '秒' });
  bool('player', 'bExistPlayerAfterLogout', '离线保留角色', '玩家退出后，角色在原地进入睡眠状态。');
  bool('player', 'bEnableVoiceChat', '启用语音聊天', '启用游戏内语音聊天。');

  function validate(key, raw) {
    const field = fields[key];
    if (!field) return null;
    if (field.type === 'boolean' && !/^(True|False)$/.test(raw)) return '请使用 True 或 False。';
    if (field.type === 'text' && !/^"(?:[^"\\\r\n]|\\.)*"$/.test(raw)) return '文本值需要用双引号包裹。';
    if (field.type === 'number') {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) return '请输入有效数字。';
      const value = Number(raw);
      if (field.integer && !Number.isInteger(value)) return '请输入整数。';
      if (field.min !== undefined && value < field.min) return `不能小于 ${field.min}。`;
      if (field.max !== undefined && value > field.max) return `不能大于 ${field.max}。`;
    }
    return null;
  }
  const api = { groups, fields, validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PalSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
