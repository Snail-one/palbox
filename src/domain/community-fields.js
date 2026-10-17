// Community interpretations accepted for display, without claiming game behavior is verified.
const containerSource = 'https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md';
const managerSource = 'https://github.com/CubeCoders/AMPTemplates/blob/main/palworldconfig.json';

export const communityFields = [
  ['server', 'Difficulty', '游戏难度预设', 'select', '社区按难度预设解释；None 表示不指定预设。专用服务器是否覆盖单项倍率、当前版本支持的预设及生效顺序尚未验证。', { options: { None: '不指定预设', Casual: '休闲（Casual）', Normal: '普通（Normal）', Hard: '困难（Hard）' }, source: managerSource }],
  ['base', 'BuildObjectHpRate', '建筑生命值倍率', 'number', '社区解释为建筑生命值的倍率；当前版本是否实际生效尚未验证。', { unit: '×' }],
  ['combat', 'bEnableFriendlyFire', '允许友军伤害', 'boolean', '社区解释为友方单位间的伤害开关；具体受影响的单位和生效条件尚未验证。'],
  ['player', 'bEnableAimAssistKeyboard', '键盘鼠标瞄准辅助', 'boolean', '社区解释为 True 开启键鼠瞄准辅助；当前版本的具体效果尚未验证。'],
  ['world', 'DropItemMaxNum', '地面掉落物数量上限', 'number', '社区解释为世界中同时存在的地面掉落物数量上限；计数范围和其他清理规则尚未验证。'],
  ['world', 'DropItemAliveMaxHours', '掉落物保留时间', 'number', '社区按小时解释掉落物保留时长；1 通常理解为约一小时，其他清理规则可能使掉落物提前消失。', { unit: '小时' }],
  ['base', 'WorkSpeedRate', '工作速度倍率', 'number', '社区解释为工作速度的倍率，1 为标准、5 为五倍；具体影响的工作类型及当前版本效果尚未验证。', { unit: '×' }],
  ['server', 'CoopPlayerMaxNum', '合作模式人数上限', 'number', '社区解释为合作联机的人数上限；独立专用服务器人数使用 ServerPlayerMaxNum，该参数在专用服务器中的效果尚未验证。'],
  ['server', 'Region', '服务器地区标识', 'text', '社区解释为服务器列表的地区信息；填写地区标识不等于改变服务器的实际地理位置。'],
  ['server', 'bUseAuth', '启用玩家身份认证', 'boolean', '社区解释为玩家身份认证开关；认证实现及生效条件尚未验证，建议保留默认 True。'],
  ['server', 'BanListURL', '封禁名单来源地址', 'text', '社区解释为服务器读取封禁名单的来源；默认值使用官方地址，建议保留。下载、刷新与合并规则尚未验证。'],
  ['world', 'EnablePredatorBossPal', '启用掠食者帕鲁', 'boolean', '社区解释为地图中的掠食者帕鲁出现开关；当前版本的具体生成规则尚未验证。'],
  ['advanced', 'bActiveUNKO', '启用排泄物机制', 'boolean', '社区按 UNKO 的日语含义解释为排泄物机制。可能属于未完整启用的机制，当前实际效果存在争议，建议保留原值。', { source: managerSource }],
  ['advanced', 'DropItemMaxNum_UNKO', '排泄物掉落数量上限', 'number', '社区解释为 UNKO 机制的掉落物上限，样本默认 100；与普通掉落物上限分开，实际作用及机制是否启用尚未验证。'],
  ['advanced', 'AutoSaveSpan', '自动保存间隔', 'number', '社区工具以秒表示存档间隔，样本默认 30 通常理解为每 30 秒保存；专用服务器当前版本的读取与计时行为尚未完全验证。', { unit: '秒', source: managerSource }],
  ['advanced', 'bIsMultiplay', '启用合作多人模式', 'boolean', '社区解释为合作联机设置，样本默认 False；在专用服务器中可能没有实际作用，不代表专用服务器关闭多人联机。'],
  ['advanced', 'bEnableNonLoginPenalty', '启用长期未登录惩罚', 'boolean', '样本默认 True。社区解释为长期未登录惩罚开关，具体对象、触发条件及当前版本效果尚未验证。'],
  ['advanced', 'MaxBuildingLimitNumPerPlayer', '每名玩家建筑数量上限', 'number', '社区按每玩家建筑上限解释，0 通常理解为不限制；与 MaxBuildingLimitNum 的关系、优先级及生效范围尚未验证。', { source: managerSource }],
  ['advanced', 'PlayerDataPalStorageUpdateCheckTickInterval', '玩家帕鲁存储数据检查间隔', 'number', '社区推定为玩家帕鲁存储数据的更新检查间隔；秒为推定单位，样本默认 1，内部机制尚未验证，建议保留原值。', { unit: '秒*' }],
  ['advanced', 'AutoTransferMasterCheckIntervalSeconds', '公会会长自动转移检查间隔', 'number', '社区推定为会长自动转移的检查间隔；按秒解释，样本默认 3600 即一小时。具体检查与继任规则尚未验证，建议保留原值。', { unit: '秒' }],
  ['advanced', 'AutoTransferMasterThresholdDays', '公会会长自动转移离线阈值', 'number', '社区推定为会长离线后职位可转移的天数阈值，样本默认 14 天；离线判定及职位转移规则尚未验证。', { unit: '天' }],
  ['advanced', 'MaxGuildsPerFrame', '每帧处理公会数量上限', 'number', '社区推定为每帧处理公会任务的性能调度上限，样本默认 10；具体处理对象和机制未公开，建议保留原值。'],
  ['advanced', 'BuildingNameDisplayCacheTTLSeconds', '建筑名称及所有者缓存时间', 'number', '社区按显示信息缓存时间解释，样本默认 60 秒；实际缓存内容、失效和刷新规则尚未验证，建议保留原值。', { unit: '秒', source: managerSource }]
].map(([group, key, label, type, description, { source = containerSource, ...extra } = {}]) => ({
  group, key, label, type, description, ...extra,
  verification: {
    status: 'community',
    source: ['BuildObjectHpRate', 'EnablePredatorBossPal', 'MaxBuildingLimitNumPerPlayer', 'BuildingNameDisplayCacheTTLSeconds'].includes(key) ? 'user-provided' : source,
    checkedAt: '2026-10-17'
  }
}));
