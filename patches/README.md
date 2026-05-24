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
| 0006 | `bot-system.patch` | **Bot 玩家系统(Phase 3 + 5B 强化)**:新 `Server/Bot.{hh,cc}` + `Server/BotManager.{hh,cc}`,启动时 spawn 15 个 bot(10 rookie level 1-10 / 3 competitor level 30-50 / 2 veteran level 70-99)。每 tick 跑简单 FSM(wander/engage/flee/dead),用 spatial_hash 找最近 mob **或敌方 flower**(Phase 5B1:bots 现在会主动追打玩家;bots 之间因为同 NULL_ENTITY team 不互相攻击)。新 bot player 标记 `EntityFlags::kCPUControlled`(Phase 5B2:让 Death.cc 知道这是 bot,死了给 tier-pool bonus drops)。Rookie loadout 改成 Common+Unusual 混合(Phase 5B3:原全 Basic 导致死了什么都不掉,因为 Basic 永远不出 drop)。GameInstance::{init,tick} 接入,CMakeLists 新增 .cc。 |

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
