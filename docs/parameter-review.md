# 38 项参数建议核对

核对日期：2026-10-17。下表按本次用户提供的顺序列出，建议名称是待审查的原提议，不代表已确认。

当前状态：本表 23 项具有官方用途依据，另 15 项按用户后续要求采用社区解释并标“行为未完全验证”。项目完整配置为 99 项官方说明、23 项社区解释，未知新字段仍计入未识别。下表保留此前对证据不足之处的核对说明，不代表目前拒绝展示中文名称。

“样本原值”取自项目用户提供的固定默认配置，不代表所有游戏版本的默认值，也不证明该字段当前会生效。社区字段现在提供中文控件，并标注说明来源和行为未完全验证；原始值和顺序继续保留。

主要依据：

- [官方配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/)：用途、单位和条件；此次页面显示 1.0.4。
- [官方 PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/)：跨公会拾取、据点防御、据点范围、手柄辅助瞄准和重生机制。
- [官方 REST 字段定义](https://docs.palworldgame.com/api/rest-api/settings)：部分参数只有名称与类型，不能证明用途。

补充核对到的原项目资料：

- [容器项目维护者的参数说明](https://github.com/jammsen/docker-palworld-dedicated-server/blob/develop/docs/ENV_VARS.md)：会长转移、玩家帕鲁存储检查与每帧公会处理等说明明确标注为未正式记录的推测，因此不能拿来证明这些游戏机制。
- [AMP 自己的配置模板](https://github.com/CubeCoders/AMPTemplates/blob/main/palworldconfig.json)：把 AutoSaveSpan 显示为秒，但这是管理工具的配置实现，不能代替当前版本游戏服务器实际读取与计时验证。
- [PalMap 自己的存档读取说明](https://github.com/voidpossum/PalMap/blob/main/docs/TECHNICAL.md)：描述读取 WorldOption.sav 中 autoSaveSpan 作为周期提示；尚不能据此保证专用服务器 INI 中同名字段的读取与覆盖规则。

| 参数 | 用户建议名称 | 核对结论 | 说明 | 样本原值 |
| --- | --- | --- | --- | --- |
| `Difficulty` | 游戏难度预设 | 采用社区解释；行为未完全验证 | 官方 API 仅列字符串类型，尚未核实 None 的预设语义、覆盖规则及专用服务器行为。 | `None` |
| `bActiveUNKO` | 启用帕鲁排泄机制 | 采用社区解释；行为未完全验证 | 官方 API 仅列布尔类型；不能由 UNKO 的字面含义确认当前游戏存在可启用的排泄机制，True 是否实际生效尚未核实。 | `False` |
| `bEnableAimAssistPad` | 手柄瞄准辅助 | 用途已确认；说明已校正 | True 启用手柄瞄准辅助；False 禁用。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `True` |
| `bEnableAimAssistKeyboard` | 键鼠瞄准辅助 | 采用社区解释；行为未完全验证 | 官方 API 仅列布尔类型，当前版本键鼠辅助的实际效果及生效条件尚未核实，不能从手柄参数类推。 | `False` |
| `DropItemMaxNum_UNKO` | 排泄物掉落数量上限 | 采用社区解释；行为未完全验证 | 样本原值 100 可以确认；UNKO 指向的对象、数量范围以及功能是否生效尚未核实。 | `100` |
| `AutoSaveSpan` | 自动存档间隔（秒） | 采用社区解释；行为未完全验证 | 第三方管理模板把它作为秒显示，存档读取工具也将同名世界设置解释为存档周期；但尚缺少当前专用服务器读取此 INI 字段及计时行为的充分依据，不将 30 必然每 30 秒存档升级为已核实结论。 | `30.000000` |
| `bIsMultiplay` | 多人合作模式 | 采用社区解释；行为未完全验证 | 官方 API 仅列布尔类型。默认配置 False 与专用服务器的多人功能不能直接划等号；专用服务器是否读取、如何生效尚未核实。 | `False` |
| `bCanPickupOtherGuildDeathPenaltyDrop` | 允许拾取其他公会玩家的死亡掉落物 | 用途已确认；说明已校正 | True 允许拾取其他公会玩家死亡掉落的物品和帕鲁；实际掉落范围由 DeathPenalty 决定。 名称需涵盖帕鲁；官方 DeathPenalty=All 示例包含帕鲁和物品。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `False` |
| `bEnableNonLoginPenalty` | 启用离线惩罚 | 采用社区解释；行为未完全验证 | 官方 API 仅列布尔类型，离线惩罚的对象、触发条件及与公会清理的区别缺乏充分用途依据。 | `True` |
| `bIsStartLocationSelectByMap` | 允许在地图选择出生地点 | 用途已确认；说明已校正 | True 允许玩家在开始游戏时选择出生地点。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `False` |
| `bEnableDefenseOtherGuildPlayer` | 允许据点防御其他公会玩家 | 用途已确认；说明已校正 | 官方 PvP 配置的必要开关之一；三项 PvP 开关开启后，据点帕鲁会攻击闯入的敌对玩家。 需与 bIsPvP、bEnablePlayerToPlayerDamage 同时开启，不能由单项开启推断完整 PvP 已启用。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `False` |
| `bInvisibleOtherGuildBaseCampAreaFX` | 隐藏其他公会据点范围效果 | 用途已确认；说明已校正 | True 隐藏其他公会的据点范围效果；False 显示。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `False` |
| `CoopPlayerMaxNum` | 合作模式人数上限 | 采用社区解释；行为未完全验证 | 官方 API 仅列数字类型，合作模式与专用服务器之间的读取规则、上限范围尚未核实，不能替代 ServerPlayerMaxNum。 | `4` |
| `bUseAuth` | 启用玩家身份验证 | 采用社区解释；行为未完全验证 | 官方 API 仅列布尔类型；认证对象、实现、生效条件均未获得充分用途依据。 | `True` |
| `BanListURL` | 官方封禁名单地址 | 采用社区解释；行为未完全验证 | 样本值使用官方域名可以确认；不能据默认 URL 认定此字段只适用于官方名单，下载、合并及刷新规则尚未核实。 | `"https://b.palworldgame.com/api/banlist.txt"` |
| `ItemContainerForceMarkDirtyInterval` | 容器物品强制同步间隔（秒） | 用途已确认；说明已校正 | 容器界面打开时，强制重新同步容器内容的间隔，单位为秒。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `1.000000` |
| `PlayerDataPalStorageUpdateCheckTickInterval` | 玩家帕鲁存储更新检查间隔 | 采用社区解释；行为未完全验证 | 参数表作者将其解释标为推测；检查对象、具体机制和时间单位仍待核实。 | `1.000000` |
| `DenyTechnologyList` | 禁用科技 ID 列表 | 用途已确认；说明已校正 | 填写游戏支持的科技 ID；例如 ("PALBOX","RepairBench")，留空表示不指定。 必须使用游戏支持的科技 ID；科技 ID 与物品 ID 不是同一概念。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `` |
| `GuildRejoinCooldownMinutes` | 重新加入公会冷却时间（分钟） | 用途已确认；说明已校正 | 玩家离开公会后，再次加入公会前需等待的分钟数；0 分钟表示不等待。 分钟单位已确认；0 分钟按等待时长理解为不等待，未新增未注明的特殊值规则。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `0` |
| `AutoTransferMasterCheckIntervalSeconds` | 自动转移会长检查间隔（秒） | 采用社区解释；行为未完全验证 | 样本原值 3600.000000 可确认；现有参数表作者将自动转移会长的说明明确标为推测，不能仅凭 Seconds 后缀确认执行机制。 | `3600.000000` |
| `AutoTransferMasterThresholdDays` | 自动转移会长离线阈值（天） | 采用社区解释；行为未完全验证 | 样本原值 14 可确认；离线判定、继任人选择及转移条件缺乏充分用途依据，Days 后缀不足以确认机制。 | `14` |
| `MaxGuildsPerFrame` | 每帧处理公会数量 | 采用社区解释；行为未完全验证 | 样本原值 10 可确认；处理的是哪种公会任务、计数范围及其与会长转移的关系均待核实，参数表作者也将解释标为推测。 | `10` |
| `RespawnPenaltyDurationThreshold` | 连续死亡惩罚判定时间（秒） | 用途已确认；说明已校正 | 连续存活达到此秒数后，重生等待恢复基础值；在阈值内再次死亡时配合 RespawnPenaltyTimeScale 递增等待时间。 建议改为“重生惩罚重置所需存活时间”。官方示例为 1800 秒不死亡后恢复基础等待时间，不能只描述为连续死亡统计窗口。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `0.000000` |
| `RespawnPenaltyTimeScale` | 连续死亡重生冷却倍率 | 用途已确认；说明已校正 | 短时间内再次死亡时，重生冷却按此倍率增加；连续存活达到 RespawnPenaltyDurationThreshold 后恢复基础等待时间。 要与基础等待 BlockRespawnTime 及重置阈值共同理解。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `2.000000` |
| `bDisplayPvPItemNumOnWorldMap_BaseCamp` | 地图显示据点 PvP 物品数量 | 用途已确认；说明已校正 | PvP 中，在世界地图显示各据点持有的 PvP 专用物品数量。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `False` |
| `bDisplayPvPItemNumOnWorldMap_Player` | 地图显示玩家 PvP 物品数量及位置 | 用途已确认；说明已校正 | PvP 中，在世界地图显示玩家位置及其持有的 PvP 专用物品数量。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `False` |
| `AdditionalDropItemWhenPlayerKillingInPvPMode` | PvP 击杀额外掉落物品 ID | 用途已确认；说明已校正 | 额外掉落开关开启后使用的游戏物品 ID；默认配置中的 PlayerDropItem 为冠军徽章。 [依据：PvP 文档](https://docs.palworldgame.com/settings-and-operation/pvp/) | `"PlayerDropItem"` |
| `AdditionalDropItemNumWhenPlayerKillingInPvPMode` | PvP 击杀额外掉落数量 | 用途已确认；说明已校正 | 额外掉落开关开启后，每次击杀玩家掉落指定物品的数量。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `1` |
| `bAdditionalDropItemWhenPlayerKillingInPvPMode` | 启用 PvP 击杀额外掉落 | 用途已确认；说明已校正 | True 在 PvP 中击杀玩家时，额外掉落指定物品；物品 ID 和数量由对应参数设置。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `False` |
| `VoiceChatMaxVolumeDistance` | 语音保持最大音量的距离 | 用途已确认；说明已校正 | 语音在此距离内不衰减音量；官方未注明距离单位。 样本原值 3000，距离单位尚未核实，不标米或厘米。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `3000.000000` |
| `VoiceChatZeroVolumeDistance` | 语音完全听不到的距离 | 用途已确认；说明已校正 | 语音音量衰减至零的距离；官方未注明距离单位。 样本原值 15000，距离单位尚未核实，不标米或厘米。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `15000.000000` |
| `bAllowEnhanceStat_Health` | 允许分配生命属性点 | 用途已确认；说明已校正 | True 允许玩家将属性点分配到生命值；False 禁止。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `True` |
| `bAllowEnhanceStat_Attack` | 允许分配攻击属性点 | 用途已确认；说明已校正 | True 允许玩家将属性点分配到攻击；False 禁止。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `True` |
| `bAllowEnhanceStat_Stamina` | 允许分配体力属性点 | 用途已确认；说明已校正 | True 允许玩家将属性点分配到体力；False 禁止。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `True` |
| `bAllowEnhanceStat_Weight` | 允许分配负重属性点 | 用途已确认；说明已校正 | True 允许玩家将属性点分配到负重；False 禁止。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `True` |
| `bAllowEnhanceStat_WorkSpeed` | 允许分配工作速度属性点 | 用途已确认；说明已校正 | True 允许玩家将属性点分配到工作速度；False 禁止。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `True` |
| `bEnableBuildingPlayerUIdDisplay` | 显示建筑创建者玩家 ID | 用途已确认；说明已校正 | True 在建筑上显示创建该建筑的玩家 ID。 [依据：配置文档](https://docs.palworldgame.com/settings-and-operation/configuration/) | `False` |
| `BuildingNameDisplayCacheTTLSeconds` | 建筑名称显示缓存时间（秒） | 采用社区解释；行为未完全验证 | 样本原值 60 可确认；TTLSeconds 后缀本身不足以确认缓存内容、失效与刷新规则，该项按用户补充展示并提示行为未完全验证。 | `60` |

页面单位由控件旁的单位标注呈现，不必在中文名称里重复括号。官方参数与社区参数都提供控件，社区解释始终显示未完全验证提示；不自动改写配置原值。
