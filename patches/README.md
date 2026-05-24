# Patches

应用在 `upstream/gardn/` 之上的补丁,由 Dockerfile 在 build 阶段
按文件名顺序 `patch -p1` 应用。

| # | 文件 | 作用 |
|---|------|------|
| 0001 | `add-title-and-rebrand.patch` | HTML 加 `<title>zorr</title>`,loading 文案改 "zorr" |
| 0002 | `client-ws-url-from-location.patch` | 客户端 WS URL 从 `window.location` 动态推导(不依赖编译时常量,镜像跨域名可移植) |
| 0003 | `map-background-color.patch` | 地图底色 `0xff987d72`(棕) → `0xff2c8a3e`(绿) |
| 0004 | `op-mode.patch` | **Super Fun Mode v2(Phase 5A 调优)**:升级 /30、XP ×8、HP ×5、玩家伤害 ×20、怪伤害 ×0.6、掉率 ×8、密度 ×3、8 槽全开。目标:**60-90 分钟通关 + 战斗有紧张感**(从"秒怪秒升"调到"有挑战")。multiplier 集中在 `Shared/OpMode.hh`。**额外**:Death.cc 加 CPU-controlled flower(bot)死亡时的 tier-aware bonus drops 池(rookie/competitor/veteran 各 1-3 个,来自 Common→Mythic 三个稀有度池)。 |
| 0005 | `super-starter-loadout.patch` | **OP 起手套装**:初次 spawn(`camera.inventory[0] == kNone`)时,在 `Server/Spawn.cc::player_spawn()` 自动给玩家 8 槽塞:Heaviest / Stinger / Yggdrasil / Rose / Faster / Tricac / Triplet / Peas。死亡重生不影响(那时 inventory 已不空) |
| 0006 | `bot-system.patch` | **Bot 玩家系统(Phase 3 + 5B 强化 + 30 总数)**:新 `Server/Bot.{hh,cc}` + `Server/BotManager.{hh,cc}`,启动时 spawn **30 个** bot(20 rookie level 1-10 / 7 competitor level 30-50 / 3 veteran level 70-99)。每 tick 跑简单 FSM(wander/engage/flee/dead),用 spatial_hash 找最近 mob **或敌方 flower**(Phase 5B1:bots 现在会主动追打玩家;bots 之间因为同 NULL_ENTITY team 不互相攻击)。新 bot player 标记 `EntityFlags::kCPUControlled`(Phase 5B2:让 Death.cc 知道这是 bot,死了给 tier-pool bonus drops)。Rookie loadout 改成 Common+Unusual 混合(Phase 5B3:原全 Basic 导致死了什么都不掉,因为 Basic 永远不出 drop)。GameInstance::{init,tick} 接入,CMakeLists 新增 .cc。 |
| 0007 | `add-starfish.patch` | **首只新怪 Starfish**(Phase 4 MVP):验证加怪 pipeline。`MobID::kStarfish` 加进枚举尾,`MOB_DATA` 加 Unusual 海星条目(HP 40-60, 伤害 15, drops Faster/Salt/Rose/Yucca, stationary),Easy zone spawns 加 weight 50000(略低于 Ladybug),`Client/Assets/Mob.cc::draw_static_mob` 加 5 角星 Canvas2D 渲染(粉色 0xffe86e82 + breath 动画 + 中心高光点)。**gardn 所有素材都是程序绘制,没有图片** — Wiki 上的 PNG 不能直接用,得手译几何路径。 |
| 0008 | `mobs-jellyfish-mushroom-bubble.patch` | **Phase 6 三连击新怪**(参考 hornex sandbox 设计):**Jellyfish**(Rare, Hard zone, HP 80-140, dmg 25, 青色钟形+触手 bcurve_to 摆动, drop Faster/Stinger/Salt/Bubble/Light, weight 8000 = 罕见见到才稀奇);**Mushroom**(Common, Easy zone, HP 30-55, dmg 8 + 6dmg/4s poison_damage,**首次在 mob 侧用 poison attribute**, 红蘑菇白点造型, drop Rose/Leaf/Iris/Azalea, weight 30000);**BubbleMob**(Common, Easy zone, HP 1-8 玻璃大炮, dmg 1, weight 80000 = 新手刷 XP 用, 5 个 drop 槽塞 3 个 Bubble 给后续 craft 系统刷料)。所有新怪 stationary。`MobID` 枚举尾加 3 ID(注意 `kBubbleMob` 避免与 `PetalID::kBubble` 混淆),`MOB_DATA` 末尾追加 3 entry,`MAP_DATA` Easy + Hard 加 spawn weight,`Client/Assets/Mob.cc::draw_static_mob` 加 3 case(用 `partial_arc(x,y,r,start,end,anticlockwise)` 和 `bcurve_to` 真 API,**不是** Canvas2D 那个 `arc(...)`)。 |
| 0009 | `craft-inventory-lottery.patch` | **Phase 6 抽奖式 craft + 持久 inventory**(参考 hornex `02-inventory.png`/`03-craft.png` 设计,但适配 gardn '1 PetalID = 1 rarity' 架构):**新增 `Game::persistent_inventory[PetalID::kNumPetals]`**(终身拾起计数)+ **新增 `Game::try_craft(rarity)`**(消耗 5 个该 rarity 任意 petal,按 `[60,45,30,20,12,6,3]%` 成功率,成功 +1 随机次档 petal,失败销毁 1-4 个)。**持久化**走现成 `Client/Storage.cc` STORED macro,序列化为 `(id, uint32 count)` pairs。**+1 触发**在 `Client/Game.cc::update()` loadout-diff 处:新 petal 出现在 slot 即增计数。**UI**:`Client/Ui/TitleScreen/Inventory.cc` 按 rarity 行+petal 列网格(数量用 `format_score` 显示 5k/5m),`Client/Ui/TitleScreen/Craft.cc` 每 rarity 一行 + Craft 5 按钮 + 5 秒结果反馈文本。两个 panel 通过 `Ui::Panel::{kInventory,kCraft}` 加进 enum,`MainScreen.cc::make_panel_buttons` 加 "Inventory"(紫)+ "Craft"(绿)按钮。CMakeLists 加 2 个新 .cc。**纯客户端**,无服务端改动,不影响 loadout 系统。 |

## 应用方式

Dockerfile 里已经做了。手动应用:

```bash
cd upstream/gardn
for p in ../../patches/*.patch; do patch -p1 < "$p"; done
```

## 重新生成补丁

```bash
cd upstream/gardn
git diff > ../../patches/NNNN-description.patch
git checkout .   # 回退,补丁是唯一真相源
```
