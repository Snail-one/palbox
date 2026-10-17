import { communityFields } from './community-fields.js';

const groups = [
  { id: 'server', name: '服务器', icon: 'server', subtitle: '设置服务器身份、连接与管理方式' },
  { id: 'player', name: '玩家', icon: 'user', subtitle: '调整成长、体力与生存体验' },
  { id: 'pal', name: '帕鲁', icon: 'sparkles', subtitle: '打造适合你的捕捉与养成节奏' },
  { id: 'world', name: '世界与资源', icon: 'globe', subtitle: '控制昼夜、采集和世界事件' },
  { id: 'base', name: '据点与公会', icon: 'home', subtitle: '管理据点规模、生产和公会规则' },
  { id: 'combat', name: '战斗规则', icon: 'shield', subtitle: '调整战斗、死亡惩罚与多人规则' },
  { id: 'advanced', name: '高级设置', title: '高级设置', icon: 'code', subtitle: '以下参数有社区解释，行为未完全验证；内部机制相关的参数建议保留原值。' }
];
const fields = Object.create(null);
const configurationSource = 'https://docs.palworldgame.com/settings-and-operation/configuration/';
const pvpSource = 'https://docs.palworldgame.com/settings-and-operation/pvp/';
function add(group, key, label, type, description, extra = {}) {
  fields[key] = {
    group, key, label, type, description,
    verification: { status: 'verified', source: configurationSource, version: '1.0.4', checkedAt: '2026-10-17' },
    ...extra
  };
}
const text = (g, k, l, d, extra) => add(g, k, l, 'text', d, extra);
const num = (g, k, l, d, extra) => add(g, k, l, 'number', d, extra);
const bool = (g, k, l, d) => add(g, k, l, 'boolean', d);
const select = (g, k, l, d, options) => add(g, k, l, 'select', d, { options });
text('server', 'ServerName', '服务器名称', '显示在服务器列表中的名称。', { wide: true });
text('server', 'ServerDescription', '服务器简介', '让玩家了解这个世界。', { wide: true });
num('server', 'ServerPlayerMaxNum', '最大在线人数', '同时加入服务器的玩家上限。', { integer: true, min: 1, unit: '人' });
num('server', 'PublicPort', '服务器列表公布端口', '社区服务器列表对外公布的端口；修改此值不会改变服务器实际监听的端口。', { integer: true, min: 1, max: 65535 });
text('server', 'ServerPassword', '加入密码', '玩家连接服务器时使用的密码；留空表示不设置。', { secret: true });
text('server', 'AdminPassword', '管理员密码', '获取服务器管理权限时使用的密码。', { secret: true });
text('server', 'PublicIP', '公开 IP', '社区服务器对外公布的 IP，可留空。');
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
  ['pal', 'PalSpawnNumRate', '帕鲁出现倍率', '调整帕鲁的出现倍率，会影响服务器负载。'],
  ['pal', 'PalDamageRateAttack', '帕鲁攻击倍率', '帕鲁造成的伤害倍率。'],
  ['pal', 'PalDamageRateDefense', '帕鲁承伤倍率', '帕鲁受到的伤害倍率。'],
  ['pal', 'PalStomachDecreaceRate', '帕鲁饥饿速度', '帕鲁饱食度的消耗倍率。'],
  ['pal', 'PalStaminaDecreaceRate', '帕鲁体力消耗', '帕鲁体力的消耗倍率。'],
  ['pal', 'PalAutoHPRegeneRate', '帕鲁生命恢复', '帕鲁自然恢复生命值的速度倍率。'],
  ['pal', 'PalAutoHpRegeneRateInSleep', '帕鲁睡眠／帕鲁终端回血倍率', '帕鲁睡眠时的生命恢复倍率，官方特别注明帕鲁终端中的生命恢复。'],
  ['world', 'DayTimeSpeedRate', '白天流逝速度', '白天时间的流逝倍率，越高白天越短。'],
  ['world', 'NightTimeSpeedRate', '夜晚流逝速度', '夜晚时间的流逝倍率，越高夜晚越短。'],
  ['world', 'CollectionDropRate', '采集掉落倍率', '采集资源时获得的物品数量倍率。'],
  ['world', 'CollectionObjectHpRate', '采集物生命倍率', '树木、矿石等采集对象的生命值倍率。'],
  ['world', 'CollectionObjectRespawnSpeedRate', '资源重新生成间隔倍率', '调整采集资源重新生成的间隔。按间隔倍率理解，数值越小通常刷新越快。'],
  ['world', 'EnemyDropItemRate', '敌人掉落倍率', '击败敌人后掉落的物品数量倍率。'],
  ['world', 'ItemCorruptionMultiplier', '食物腐坏速度', '物品腐坏速度的倍率。'],
  ['base', 'BuildObjectDamageRate', '建筑承伤倍率', '建筑受到的伤害倍率。'],
  ['base', 'BuildObjectDeteriorationDamageRate', '建筑腐朽速度', '建筑自然腐朽的伤害倍率。'],
  ['base', 'MonsterFarmActionSpeedRate', '牧场生产速度', '帕鲁在牧场中生产物品的速度倍率。']
];
for (const [g, k, l, d] of rates) num(g, k, l, d, { min: 0, unit: '×' });
num('pal', 'PalEggDefaultHatchingTime', '巨大蛋孵化时间', '巨大蛋的基准孵化时间；其他蛋也受影响。', { min: 0, unit: '小时' });
select('pal', 'RandomizerType', '帕鲁随机模式', '控制野生帕鲁的随机生成方式。', { None: '不随机', Region: '区域随机', All: '完全随机' });
text('pal', 'RandomizerSeed', '帕鲁生成随机种子', '启用帕鲁生成随机模式时使用的种子值，用于帕鲁生成随机化，不用于改变地图地形。');
bool('pal', 'bIsRandomizerPalLevelRandom', '帕鲁等级完全随机', '开启时，野生帕鲁等级完全随机；关闭后仍会在各区域预期的等级范围内随机。');
bool('pal', 'bAllowGlobalPalboxExport', '允许全局终端导出', '允许将帕鲁存入全局帕鲁终端。');
bool('pal', 'bAllowGlobalPalboxImport', '允许全局终端导入', '允许从全局帕鲁终端取出帕鲁。');
num('world', 'SupplyDropSpan', '陨石与补给间隔', '陨石与补给事件的发生间隔。', { min: 0, unit: '分钟' });
num('world', 'FishingDifficultyRate', '钓鱼难度', '钓鱼难度系数。', { min: 0.1, max: 1, unit: '×' });
num('world', 'PhysicsActiveDropItemMaxNum', '启用物理模拟的掉落物数量上限', '限制可参与物理模拟的掉落物数量。默认特殊值 -1 的含义及其与 DropItemMaxNum 的关系尚未核实。', { integer: true, min: -1 });
bool('world', 'bEnableFastTravel', '允许快速旅行', '启用世界中的快速旅行。');
bool('world', 'bEnableFastTravelOnlyBaseCamp', '仅据点间快速旅行', '将快速旅行限制为据点之间。');
bool('world', 'bEnableInvaderEnemy', '启用据点袭击', '允许袭击敌人出现。');
num('base', 'BaseCampMaxNum', '全服据点上限', '整个服务器允许存在的据点数量。', { integer: true, min: 0 });
num('base', 'BaseCampMaxNumInGuild', '每公会据点上限', '提高数量会增加服务器负载。', { integer: true, min: 1, max: 10 });
num('base', 'BaseCampWorkerMaxNum', '每据点工作帕鲁', '每个据点允许的工作帕鲁数量。', { integer: true, min: 1, max: 50 });
num('base', 'GuildPlayerMaxNum', '公会人数上限', '每个公会允许的玩家数量。', { integer: true, min: 1, unit: '人' });
num('base', 'MaxBuildingLimitNum', '建筑数量上限', '官方文档定义为每位玩家的建筑数量上限，0 表示不限制；与 MaxBuildingLimitNumPerPlayer 的关系尚未核实。', { integer: true, min: 0 });
bool('base', 'bAutoResetGuildNoOnlinePlayers', '无人登录时自动清理公会基地', '公会所有成员均未登录达到设定阈值后，自动删除公会建筑和据点帕鲁；阈值由 AutoResetGuildTimeNoOnlinePlayers 设置。');
num('base', 'AutoResetGuildTimeNoOnlinePlayers', '公会无人登录清理阈值', '公会所有成员均未登录达到此时长后才触发清理；仅开启 bAutoResetGuildNoOnlinePlayers 时生效。官方未注明时间单位，单位尚未核实。', { min: 0 });
bool('base', 'bBuildAreaLimit', '限制建筑区域', '限制在快速旅行点等地点附近建造。');
bool('base', 'bAllowEnemyCampSpawnNearBaseCamp', '允许据点附近敌营', '允许在据点附近生成敌方营地。');
select('combat', 'DeathPenalty', '死亡惩罚', '设置死亡后掉落的物品和帕鲁。', { None: '不掉落', Item: '掉落物品（保留装备）', ItemAndEquipment: '掉落全部物品和装备', All: '掉落物品、装备与队伍帕鲁' });
bool('combat', 'bIsPvP', '启用 PvP', '玩家对战开关；官方要求同时开启玩家间伤害与据点防御其他公会玩家。');
bool('combat', 'bEnablePlayerToPlayerDamage', '允许玩家互相伤害', '启用玩家间伤害；官方 PvP 配置需同时开启 bIsPvP 与 bEnableDefenseOtherGuildPlayer。');
bool('combat', 'bHardcore', '硬核模式', '启用后死亡将无法重生。');
bool('combat', 'bPalLost', '死亡永久失去帕鲁', '启用死亡时永久失去帕鲁的规则。');
bool('combat', 'bCharacterRecreateInHardcore', '硬核模式允许重建', '允许硬核模式死亡后重新创建角色。');
num('combat', 'BlockRespawnTime', '重生冷却', '死亡后的基础重生等待时间。', { min: 0, unit: '秒' });
bool('player', 'bExistPlayerAfterLogout', '离线保留角色', '玩家退出后，角色在原地进入睡眠状态。');
bool('player', 'bEnableVoiceChat', '启用语音聊天', '启用游戏内语音聊天。');

// 官方用途说明；社区说明在独立元数据中维护，并始终显示未完全验证状态。
bool('player', 'bEnableAimAssistPad', '手柄瞄准辅助', 'True 启用手柄瞄准辅助；False 禁用。');
bool('player', 'bIsStartLocationSelectByMap', '允许在地图选择出生地点', 'True 允许玩家在开始游戏时选择出生地点。');
num('player', 'VoiceChatMaxVolumeDistance', '语音保持最大音量的距离', '语音在此距离内不衰减音量；官方未注明距离单位。', { min: 0 });
num('player', 'VoiceChatZeroVolumeDistance', '语音完全听不到的距离', '语音音量衰减至零的距离；官方未注明距离单位。', { min: 0 });
for (const [stat, label] of [['Health', '生命值'], ['Attack', '攻击'], ['Stamina', '体力'], ['Weight', '负重'], ['WorkSpeed', '工作速度']]) {
  bool('player', `bAllowEnhanceStat_${stat}`, `允许分配${label}属性点`, `True 允许玩家将属性点分配到${label}；False 禁止。`);
}
bool('server', 'bEnableBuildingPlayerUIdDisplay', '显示建筑创建者玩家 ID', 'True 在建筑上显示创建该建筑的玩家 ID。');
num('server', 'ServerReplicatePawnCullDistance', '帕鲁同步距离', '向玩家同步帕鲁的距离，官方范围为 5000～15000 厘米。', { min: 5000, max: 15000, unit: '厘米' });
num('server', 'ItemContainerForceMarkDirtyInterval', '容器物品强制同步间隔', '容器界面打开时，强制重新同步容器内容的间隔，单位为秒。', { min: 0, unit: '秒' });
num('base', 'GuildRejoinCooldownMinutes', '重新加入公会冷却时间', '玩家离开公会后，再次加入公会前需等待的分钟数；0 分钟表示不等待。', { min: 0, unit: '分钟' });
bool('base', 'bInvisibleOtherGuildBaseCampAreaFX', '隐藏其他公会据点范围效果', 'True 隐藏其他公会的据点范围效果；False 显示。');
bool('combat', 'bEnableDefenseOtherGuildPlayer', '允许据点防御其他公会玩家', '官方 PvP 配置的必要开关之一；三项 PvP 开关开启后，据点帕鲁会攻击闯入的敌对玩家。');
bool('combat', 'bCanPickupOtherGuildDeathPenaltyDrop', '允许拾取其他公会玩家的死亡掉落', 'True 允许拾取其他公会玩家死亡掉落的物品和帕鲁；实际掉落范围由 DeathPenalty 决定。');
add('combat', 'DenyTechnologyList', '禁用科技 ID 列表', 'raw', '填写游戏支持的科技 ID；例如 ("PALBOX","RepairBench")，留空表示不指定。', { wide: true });
num('combat', 'RespawnPenaltyDurationThreshold', '重生惩罚重置所需存活时间', '连续存活达到此秒数后，重生等待恢复基础值；在阈值内再次死亡时配合 RespawnPenaltyTimeScale 递增等待时间。', { min: 0, unit: '秒' });
num('combat', 'RespawnPenaltyTimeScale', '连续死亡重生冷却倍率', '短时间内再次死亡时，重生冷却按此倍率增加；连续存活达到 RespawnPenaltyDurationThreshold 后恢复基础等待时间。', { min: 0, unit: '×' });
bool('combat', 'bDisplayPvPItemNumOnWorldMap_BaseCamp', '地图显示据点 PvP 物品数量', 'PvP 中，在世界地图显示各据点持有的 PvP 专用物品数量。');
bool('combat', 'bDisplayPvPItemNumOnWorldMap_Player', '地图显示玩家 PvP 物品数量及位置', 'PvP 中，在世界地图显示玩家位置及其持有的 PvP 专用物品数量。');
bool('combat', 'bAdditionalDropItemWhenPlayerKillingInPvPMode', '启用 PvP 击杀额外掉落', 'True 在 PvP 中击杀玩家时，额外掉落指定物品；物品 ID 和数量由对应参数设置。');
text('combat', 'AdditionalDropItemWhenPlayerKillingInPvPMode', 'PvP 击杀额外掉落物品 ID', '额外掉落开关开启后使用的游戏物品 ID；默认配置中的 PlayerDropItem 为冠军徽章。');
num('combat', 'AdditionalDropItemNumWhenPlayerKillingInPvPMode', 'PvP 击杀额外掉落数量', '额外掉落开关开启后，每次击杀玩家掉落指定物品的数量。', { min: 0 });

for (const key of ['bIsPvP', 'bEnablePlayerToPlayerDamage', 'bEnableDefenseOtherGuildPlayer', 'bEnableAimAssistPad', 'bCanPickupOtherGuildDeathPenaltyDrop', 'bInvisibleOtherGuildBaseCampAreaFX', 'RespawnPenaltyDurationThreshold', 'RespawnPenaltyTimeScale', 'AdditionalDropItemWhenPlayerKillingInPvPMode']) {
  fields[key].verification.source = pvpSource;
}

for (const field of communityFields) fields[field.key] = field;

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

export { groups, fields, validate };
