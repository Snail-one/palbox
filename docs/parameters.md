# 参数用途与说明来源

记录日期：2026-10-17。范围：用户提供的 122 项默认配置快照；本次查阅的官方说明显示版本 1.0.4。

按本次用户要求，区分“官方明确说明”和“模板包含、已有社区解释”；仍无用途说明的新字段属于未识别参数。显示中文名称不等于官方确认全部行为。

| 状态 | 当前数量 | 页面处理 |
| --- | --- | --- |
| 官方明确说明 | 99 | 两行名称，显示“官方说明”铭牌；点击展开说明 |
| 社区解释／用户补充 | 23 | 两行名称与控件，显示“未验证”铭牌；点击展开说明 |
| 未识别 | 0 | 用途未收录的新字段显示原名，统计并允许高级编辑，不猜测用途 |

模板本身不赋予参数“官方确认”状态。社区解释必须有明确的中文含义、来源记录，并且该字段存在于当前默认模板。新增陌生字段仍计入未识别统计。统计随导入文件而变化。

社区字段的 12 项按用途放入普通分类，另 11 项放入“高级设置”。内部机制参数提示建议保留原值，不锁定控件，也不自动重写参数。单位推定、机制争议和版本适用性均写入说明。

社区字段只做基本值类型检查，不加入尚未确认的游戏范围限制。原始配置的默认值、注释、顺序和额外字段保持不变；既有配置不自动补参或迁移覆盖。

来源：

- [官方配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/)
- [官方 PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/)
- [容器项目维护者的参数说明](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md)：社区解释中包含明确标为推测的条目，因此统一保留未完全验证提示。
- [AMP 配置模板](https://github.com/CubeCoders/AMPTemplates/blob/main/palworldconfig.json)：用于参考已有编辑器如何命名、呈现字段，不代表游戏行为已经实测。
- 用户本次补充：部分字段在已查阅项目中仅有名称和类型，或未找到完整解释，在元数据及本文记录为用户补充，不附上不包含该解释的外部链接。页面仅展示状态铭牌，来源不在页面显示。

关键边界：

- MaxBuildingLimitNum 官方说明为每玩家建筑上限、0 不限制；MaxBuildingLimitNumPerPlayer 使用社区解释，二者关系和优先级仍待验证。
- AutoSaveSpan 以社区解释显示秒，30 通常理解为每 30 秒保存，不能据此保证当前版本专用服务器行为。
- UNKO 相关说明保留机制争议，不声称游戏一定会产生排泄物。
- PlayerDataPalStorageUpdateCheckTickInterval 的“秒*”表示社区推定单位，具体检查内容待验证。
- AutoResetGuildTimeNoOnlinePlayers 与语音距离的单位，官方未注明，继续显示单位待核实。
- BanListURL 中文名称为封禁名单来源地址；官方地址是样本默认值，不将此参数限制为只能使用官方来源。
- 此处说明来自文档、社区解释及用户补充，未通过实际游戏服务器逐项验证。

以下按原配置顺序列出。

| 参数 | 状态 | 中文名称与用途 | 来源 |
| --- | --- | --- | --- |
| `Difficulty` | 行为未完全验证 | 游戏难度预设：社区按难度预设解释；None 表示不指定预设。专用服务器是否覆盖单项倍率、当前版本支持的预设及生效顺序尚未验证。 | [社区参考](https://github.com/CubeCoders/AMPTemplates/blob/main/palworldconfig.json) |
| `RandomizerType` | 官方明确说明 | 帕鲁随机模式：控制野生帕鲁的随机生成方式。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `RandomizerSeed` | 官方明确说明 | 帕鲁生成随机种子：启用帕鲁生成随机模式时使用的种子值，用于帕鲁生成随机化，不用于改变地图地形。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bIsRandomizerPalLevelRandom` | 官方明确说明 | 帕鲁等级完全随机：开启时，野生帕鲁等级完全随机；关闭后仍会在各区域预期的等级范围内随机。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `DayTimeSpeedRate` | 官方明确说明 | 白天流逝速度：白天时间的流逝倍率，越高白天越短。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `NightTimeSpeedRate` | 官方明确说明 | 夜晚流逝速度：夜晚时间的流逝倍率，越高夜晚越短。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ExpRate` | 官方明确说明 | 经验获取倍率：经验值获得速度。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalCaptureRate` | 官方明确说明 | 帕鲁捕捉倍率：帕鲁捕捉成功率的倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalSpawnNumRate` | 官方明确说明 | 帕鲁出现倍率：调整帕鲁的出现倍率，会影响服务器负载。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalDamageRateAttack` | 官方明确说明 | 帕鲁攻击倍率：帕鲁造成的伤害倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalDamageRateDefense` | 官方明确说明 | 帕鲁承伤倍率：帕鲁受到的伤害倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerDamageRateAttack` | 官方明确说明 | 玩家攻击倍率：玩家造成的伤害倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerDamageRateDefense` | 官方明确说明 | 玩家承伤倍率：玩家受到的伤害倍率，越高受到的伤害越多。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerStomachDecreaceRate` | 官方明确说明 | 玩家饥饿速度：玩家饱食度的消耗倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerStaminaDecreaceRate` | 官方明确说明 | 玩家体力消耗：玩家体力的消耗倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerAutoHPRegeneRate` | 官方明确说明 | 玩家生命恢复：玩家自然恢复生命值的速度倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerAutoHpRegeneRateInSleep` | 官方明确说明 | 玩家睡眠恢复：玩家睡眠时的生命恢复倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalStomachDecreaceRate` | 官方明确说明 | 帕鲁饥饿速度：帕鲁饱食度的消耗倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalStaminaDecreaceRate` | 官方明确说明 | 帕鲁体力消耗：帕鲁体力的消耗倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalAutoHPRegeneRate` | 官方明确说明 | 帕鲁生命恢复：帕鲁自然恢复生命值的速度倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalAutoHpRegeneRateInSleep` | 官方明确说明 | 帕鲁睡眠／帕鲁终端回血倍率：帕鲁睡眠时的生命恢复倍率，官方特别注明帕鲁终端中的生命恢复。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `BuildObjectHpRate` | 行为未完全验证 | 建筑生命值倍率：社区解释为建筑生命值的倍率；当前版本是否实际生效尚未验证。 | 用户补充（本次会话） |
| `BuildObjectDamageRate` | 官方明确说明 | 建筑承伤倍率：建筑受到的伤害倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `BuildObjectDeteriorationDamageRate` | 官方明确说明 | 建筑腐朽速度：建筑自然腐朽的伤害倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `CollectionDropRate` | 官方明确说明 | 采集掉落倍率：采集资源时获得的物品数量倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `CollectionObjectHpRate` | 官方明确说明 | 采集物生命倍率：树木、矿石等采集对象的生命值倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `CollectionObjectRespawnSpeedRate` | 官方明确说明 | 资源重新生成间隔倍率：调整采集资源重新生成的间隔。按间隔倍率理解，数值越小通常刷新越快。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `EnemyDropItemRate` | 官方明确说明 | 敌人掉落倍率：击败敌人后掉落的物品数量倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `DeathPenalty` | 官方明确说明 | 死亡惩罚：设置死亡后掉落的物品和帕鲁。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bEnablePlayerToPlayerDamage` | 官方明确说明 | 允许玩家互相伤害：启用玩家间伤害；官方 PvP 配置需同时开启 bIsPvP 与 bEnableDefenseOtherGuildPlayer。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bEnableFriendlyFire` | 行为未完全验证 | 允许友军伤害：社区解释为友方单位间的伤害开关；具体受影响的单位和生效条件尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `bEnableInvaderEnemy` | 官方明确说明 | 启用据点袭击：允许袭击敌人出现。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bActiveUNKO` | 行为未完全验证 | 启用排泄物机制：社区按 UNKO 的日语含义解释为排泄物机制。可能属于未完整启用的机制，当前实际效果存在争议，建议保留原值。 | [社区参考](https://github.com/CubeCoders/AMPTemplates/blob/main/palworldconfig.json) |
| `bEnableAimAssistPad` | 官方明确说明 | 手柄瞄准辅助：True 启用手柄瞄准辅助；False 禁用。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bEnableAimAssistKeyboard` | 行为未完全验证 | 键盘鼠标瞄准辅助：社区解释为 True 开启键鼠瞄准辅助；当前版本的具体效果尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `DropItemMaxNum` | 行为未完全验证 | 地面掉落物数量上限：社区解释为世界中同时存在的地面掉落物数量上限；计数范围和其他清理规则尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `PhysicsActiveDropItemMaxNum` | 官方明确说明 | 启用物理模拟的掉落物数量上限：限制可参与物理模拟的掉落物数量。默认特殊值 -1 的含义及其与 DropItemMaxNum 的关系尚未核实。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `DropItemMaxNum_UNKO` | 行为未完全验证 | 排泄物掉落数量上限：社区解释为 UNKO 机制的掉落物上限，样本默认 100；与普通掉落物上限分开，实际作用及机制是否启用尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `BaseCampMaxNum` | 官方明确说明 | 全服据点上限：整个服务器允许存在的据点数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `BaseCampWorkerMaxNum` | 官方明确说明 | 每据点工作帕鲁：每个据点允许的工作帕鲁数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `DropItemAliveMaxHours` | 行为未完全验证 | 掉落物保留时间：社区按小时解释掉落物保留时长；1 通常理解为约一小时，其他清理规则可能使掉落物提前消失。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `bAutoResetGuildNoOnlinePlayers` | 官方明确说明 | 无人登录时自动清理公会基地：公会所有成员均未登录达到设定阈值后，自动删除公会建筑和据点帕鲁；阈值由 AutoResetGuildTimeNoOnlinePlayers 设置。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `AutoResetGuildTimeNoOnlinePlayers` | 官方明确说明 | 公会无人登录清理阈值：公会所有成员均未登录达到此时长后才触发清理；仅开启 bAutoResetGuildNoOnlinePlayers 时生效。官方未注明时间单位，单位尚未核实。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `GuildPlayerMaxNum` | 官方明确说明 | 公会人数上限：每个公会允许的玩家数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `BaseCampMaxNumInGuild` | 官方明确说明 | 每公会据点上限：提高数量会增加服务器负载。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PalEggDefaultHatchingTime` | 官方明确说明 | 巨大蛋孵化时间：巨大蛋的基准孵化时间；其他蛋也受影响。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `WorkSpeedRate` | 行为未完全验证 | 工作速度倍率：社区解释为工作速度的倍率，1 为标准、5 为五倍；具体影响的工作类型及当前版本效果尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `AutoSaveSpan` | 行为未完全验证 | 自动保存间隔：社区工具以秒表示存档间隔，样本默认 30 通常理解为每 30 秒保存；专用服务器当前版本的读取与计时行为尚未完全验证。 | [社区参考](https://github.com/CubeCoders/AMPTemplates/blob/main/palworldconfig.json) |
| `bIsMultiplay` | 行为未完全验证 | 启用合作多人模式：社区解释为合作联机设置，样本默认 False；在专用服务器中可能没有实际作用，不代表专用服务器关闭多人联机。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `bIsPvP` | 官方明确说明 | 启用 PvP：玩家对战开关；官方要求同时开启玩家间伤害与据点防御其他公会玩家。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bHardcore` | 官方明确说明 | 硬核模式：启用后死亡将无法重生。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bPalLost` | 官方明确说明 | 死亡永久失去帕鲁：启用死亡时永久失去帕鲁的规则。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bCharacterRecreateInHardcore` | 官方明确说明 | 硬核模式允许重建：允许硬核模式死亡后重新创建角色。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bCanPickupOtherGuildDeathPenaltyDrop` | 官方明确说明 | 允许拾取其他公会玩家的死亡掉落：True 允许拾取其他公会玩家死亡掉落的物品和帕鲁；实际掉落范围由 DeathPenalty 决定。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bEnableNonLoginPenalty` | 行为未完全验证 | 启用长期未登录惩罚：样本默认 True。社区解释为长期未登录惩罚开关，具体对象、触发条件及当前版本效果尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `bEnableFastTravel` | 官方明确说明 | 允许快速旅行：启用世界中的快速旅行。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bEnableFastTravelOnlyBaseCamp` | 官方明确说明 | 仅据点间快速旅行：将快速旅行限制为据点之间。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bIsStartLocationSelectByMap` | 官方明确说明 | 允许在地图选择出生地点：True 允许玩家在开始游戏时选择出生地点。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bExistPlayerAfterLogout` | 官方明确说明 | 离线保留角色：玩家退出后，角色在原地进入睡眠状态。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bEnableDefenseOtherGuildPlayer` | 官方明确说明 | 允许据点防御其他公会玩家：官方 PvP 配置的必要开关之一；三项 PvP 开关开启后，据点帕鲁会攻击闯入的敌对玩家。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bInvisibleOtherGuildBaseCampAreaFX` | 官方明确说明 | 隐藏其他公会据点范围效果：True 隐藏其他公会的据点范围效果；False 显示。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bBuildAreaLimit` | 官方明确说明 | 限制建筑区域：限制在快速旅行点等地点附近建造。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ItemWeightRate` | 官方明确说明 | 物品重量倍率：背包物品的重量倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `CoopPlayerMaxNum` | 行为未完全验证 | 合作模式人数上限：社区解释为合作联机的人数上限；独立专用服务器人数使用 ServerPlayerMaxNum，该参数在专用服务器中的效果尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `ServerPlayerMaxNum` | 官方明确说明 | 最大在线人数：同时加入服务器的玩家上限。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ServerName` | 官方明确说明 | 服务器名称：显示在服务器列表中的名称。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ServerDescription` | 官方明确说明 | 服务器简介：让玩家了解这个世界。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `AdminPassword` | 官方明确说明 | 管理员密码：获取服务器管理权限时使用的密码。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ServerPassword` | 官方明确说明 | 加入密码：玩家连接服务器时使用的密码；留空表示不设置。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowClientMod` | 官方明确说明 | 允许客户端 Mod：允许启用 Mod 的玩家加入。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PublicPort` | 官方明确说明 | 服务器列表公布端口：社区服务器列表对外公布的端口；修改此值不会改变服务器实际监听的端口。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PublicIP` | 官方明确说明 | 公开 IP：社区服务器对外公布的 IP，可留空。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `RCONEnabled` | 官方明确说明 | 启用 RCON：允许通过 RCON 管理服务器。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `RCONPort` | 官方明确说明 | RCON 端口：RCON 服务使用的端口。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `Region` | 行为未完全验证 | 服务器地区标识：社区解释为服务器列表的地区信息；填写地区标识不等于改变服务器的实际地理位置。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `bUseAuth` | 行为未完全验证 | 启用玩家身份认证：社区解释为玩家身份认证开关；认证实现及生效条件尚未验证，建议保留默认 True。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `BanListURL` | 行为未完全验证 | 封禁名单来源地址：社区解释为服务器读取封禁名单的来源；默认值使用官方地址，建议保留。下载、刷新与合并规则尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `RESTAPIEnabled` | 官方明确说明 | 启用 REST API：允许使用服务器 REST API。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `RESTAPIPort` | 官方明确说明 | REST API 端口：REST API 的监听端口。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bShowPlayerList` | 官方明确说明 | 显示玩家列表：在游戏 ESC 菜单中显示玩家列表。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ChatPostLimitPerMinute` | 官方明确说明 | 聊天频率上限：每分钟允许发送的最大消息数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `CrossplayPlatforms` | 官方明确说明 | 允许连接的平台：选择允许加入服务器的平台。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bIsUseBackupSaveData` | 官方明确说明 | 自动备份世界：开启世界备份，会增加磁盘读写。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `LogFormatType` | 官方明确说明 | 日志格式：服务器日志的输出格式。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bIsShowJoinLeftMessage` | 官方明确说明 | 显示进出消息：玩家加入或离开时显示游戏内消息。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `SupplyDropSpan` | 官方明确说明 | 陨石与补给间隔：陨石与补给事件的发生间隔。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `EnablePredatorBossPal` | 行为未完全验证 | 启用掠食者帕鲁：社区解释为地图中的掠食者帕鲁出现开关；当前版本的具体生成规则尚未验证。 | 用户补充（本次会话） |
| `MaxBuildingLimitNum` | 官方明确说明 | 建筑数量上限：官方文档定义为每位玩家的建筑数量上限，0 表示不限制；与 MaxBuildingLimitNumPerPlayer 的关系尚未核实。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `MaxBuildingLimitNumPerPlayer` | 行为未完全验证 | 每名玩家建筑数量上限：社区按每玩家建筑上限解释，0 通常理解为不限制；与 MaxBuildingLimitNum 的关系、优先级及生效范围尚未验证。 | 用户补充（本次会话） |
| `ServerReplicatePawnCullDistance` | 官方明确说明 | 帕鲁同步距离：向玩家同步帕鲁的距离，官方范围为 5000～15000 厘米。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowGlobalPalboxExport` | 官方明确说明 | 允许全局终端导出：允许将帕鲁存入全局帕鲁终端。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowGlobalPalboxImport` | 官方明确说明 | 允许全局终端导入：允许从全局帕鲁终端取出帕鲁。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `EquipmentDurabilityDamageRate` | 官方明确说明 | 装备耐久消耗：装备耐久度的消耗倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `ItemContainerForceMarkDirtyInterval` | 官方明确说明 | 容器物品强制同步间隔：容器界面打开时，强制重新同步容器内容的间隔，单位为秒。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `PlayerDataPalStorageUpdateCheckTickInterval` | 行为未完全验证 | 玩家帕鲁存储数据检查间隔：社区推定为玩家帕鲁存储数据的更新检查间隔；秒为推定单位，样本默认 1，内部机制尚未验证，建议保留原值。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `ItemCorruptionMultiplier` | 官方明确说明 | 食物腐坏速度：物品腐坏速度的倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `MonsterFarmActionSpeedRate` | 官方明确说明 | 牧场生产速度：帕鲁在牧场中生产物品的速度倍率。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `FishingDifficultyRate` | 官方明确说明 | 钓鱼难度：钓鱼难度系数。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `DenyTechnologyList` | 官方明确说明 | 禁用科技 ID 列表：填写游戏支持的科技 ID；例如 ("PALBOX","RepairBench")，留空表示不指定。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `GuildRejoinCooldownMinutes` | 官方明确说明 | 重新加入公会冷却时间：玩家离开公会后，再次加入公会前需等待的分钟数；0 分钟表示不等待。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `AutoTransferMasterCheckIntervalSeconds` | 行为未完全验证 | 公会会长自动转移检查间隔：社区推定为会长自动转移的检查间隔；按秒解释，样本默认 3600 即一小时。具体检查与继任规则尚未验证，建议保留原值。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `AutoTransferMasterThresholdDays` | 行为未完全验证 | 公会会长自动转移离线阈值：社区推定为会长离线后职位可转移的天数阈值，样本默认 14 天；离线判定及职位转移规则尚未验证。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `MaxGuildsPerFrame` | 行为未完全验证 | 每帧处理公会数量上限：社区推定为每帧处理公会任务的性能调度上限，样本默认 10；具体处理对象和机制未公开，建议保留原值。 | [社区参考](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md) |
| `BlockRespawnTime` | 官方明确说明 | 重生冷却：死亡后的基础重生等待时间。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `RespawnPenaltyDurationThreshold` | 官方明确说明 | 重生惩罚重置所需存活时间：连续存活达到此秒数后，重生等待恢复基础值；在阈值内再次死亡时配合 RespawnPenaltyTimeScale 递增等待时间。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `RespawnPenaltyTimeScale` | 官方明确说明 | 连续死亡重生冷却倍率：短时间内再次死亡时，重生冷却按此倍率增加；连续存活达到 RespawnPenaltyDurationThreshold 后恢复基础等待时间。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `bDisplayPvPItemNumOnWorldMap_BaseCamp` | 官方明确说明 | 地图显示据点 PvP 物品数量：PvP 中，在世界地图显示各据点持有的 PvP 专用物品数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bDisplayPvPItemNumOnWorldMap_Player` | 官方明确说明 | 地图显示玩家 PvP 物品数量及位置：PvP 中，在世界地图显示玩家位置及其持有的 PvP 专用物品数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `AdditionalDropItemWhenPlayerKillingInPvPMode` | 官方明确说明 | PvP 击杀额外掉落物品 ID：额外掉落开关开启后使用的游戏物品 ID；默认配置中的 PlayerDropItem 为冠军徽章。 | [官方 PvP](https://docs.palworldgame.com/settings-and-operation/pvp/) |
| `AdditionalDropItemNumWhenPlayerKillingInPvPMode` | 官方明确说明 | PvP 击杀额外掉落数量：额外掉落开关开启后，每次击杀玩家掉落指定物品的数量。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAdditionalDropItemWhenPlayerKillingInPvPMode` | 官方明确说明 | 启用 PvP 击杀额外掉落：True 在 PvP 中击杀玩家时，额外掉落指定物品；物品 ID 和数量由对应参数设置。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bEnableVoiceChat` | 官方明确说明 | 启用语音聊天：启用游戏内语音聊天。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `VoiceChatMaxVolumeDistance` | 官方明确说明 | 语音保持最大音量的距离：语音在此距离内不衰减音量；官方未注明距离单位。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `VoiceChatZeroVolumeDistance` | 官方明确说明 | 语音完全听不到的距离：语音音量衰减至零的距离；官方未注明距离单位。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowEnhanceStat_Health` | 官方明确说明 | 允许分配生命值属性点：True 允许玩家将属性点分配到生命值；False 禁止。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowEnhanceStat_Attack` | 官方明确说明 | 允许分配攻击属性点：True 允许玩家将属性点分配到攻击；False 禁止。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowEnhanceStat_Stamina` | 官方明确说明 | 允许分配体力属性点：True 允许玩家将属性点分配到体力；False 禁止。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowEnhanceStat_Weight` | 官方明确说明 | 允许分配负重属性点：True 允许玩家将属性点分配到负重；False 禁止。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bAllowEnhanceStat_WorkSpeed` | 官方明确说明 | 允许分配工作速度属性点：True 允许玩家将属性点分配到工作速度；False 禁止。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `bEnableBuildingPlayerUIdDisplay` | 官方明确说明 | 显示建筑创建者玩家 ID：True 在建筑上显示创建该建筑的玩家 ID。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |
| `BuildingNameDisplayCacheTTLSeconds` | 行为未完全验证 | 建筑名称及所有者缓存时间：社区按显示信息缓存时间解释，样本默认 60 秒；实际缓存内容、失效和刷新规则尚未验证，建议保留原值。 | 用户补充（本次会话） |
| `bAllowEnemyCampSpawnNearBaseCamp` | 官方明确说明 | 允许据点附近敌营：允许在据点附近生成敌方营地。 | [官方配置](https://docs.palworldgame.com/settings-and-operation/configuration/) |

[38 项建议核对记录](parameter-review.md)保留其核对依据，状态已按当前规则同步。
