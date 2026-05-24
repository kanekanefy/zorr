# Patches

应用在 `upstream/gardn/` 之上的补丁,由 Dockerfile 在 build 阶段
按文件名顺序 `patch -p1` 应用。

| # | 文件 | 作用 |
|---|------|------|
| 0001 | `add-title-and-rebrand.patch` | HTML 加 `<title>zorr</title>`,loading 文案改 "zorr" |
| 0002 | `client-ws-url-from-location.patch` | 客户端 WS URL 从 `window.location` 动态推导(不依赖编译时常量,镜像跨域名可移植) |
| 0003 | `map-background-color.patch` | 地图底色 `0xff987d72`(棕) → `0xff2c8a3e`(绿) |
| 0004 | `op-mode.patch` | **Super Fun Mode**:升级 /100、XP ×50、HP ×10、玩家伤害 ×20、怪伤害 ×0.1、掉率 ×20、密度 ×5、8 槽全开。目标:30 分钟通关完整游戏。8 个 multiplier 集中在新增的 `Shared/OpMode.hh`,Phase 2 admin 面板会改成运行时配置 |
| 0005 | `super-starter-loadout.patch` | **OP 起手套装**:初次 spawn(`camera.inventory[0] == kNone`)时,在 `Server/Spawn.cc::player_spawn()` 自动给玩家 8 槽塞:Heaviest / Stinger / Yggdrasil / Rose / Faster / Tricac / Triplet / Peas。死亡重生不影响(那时 inventory 已不空) |
| 0006 | `bot-system.patch` | **Bot 玩家系统(Phase 3)**:新 `Server/Bot.{hh,cc}` + `Server/BotManager.{hh,cc}`,启动时 spawn 15 个 bot(10 rookie level 1-10 / 3 competitor level 30-50 / 2 veteran level 70-99 with player-grade OP loadout)。每 tick 跑简单 FSM(wander/engage/flee/dead),用 spatial_hash 找最近 mob。GameInstance::{init,tick} 接入,CMakeLists 新增 .cc。 |
| 0007 | `add-starfish.patch` | **首只新怪 Starfish**(Phase 4 MVP):验证加怪 pipeline。`MobID::kStarfish` 加进枚举尾,`MOB_DATA` 加 Unusual 海星条目(HP 40-60, 伤害 15, drops Faster/Salt/Rose/Yucca, stationary),Easy zone spawns 加 weight 50000(略低于 Ladybug),`Client/Assets/Mob.cc::draw_static_mob` 加 5 角星 Canvas2D 渲染(粉色 0xffe86e82 + breath 动画 + 中心高光点)。**gardn 所有素材都是程序绘制,没有图片** — Wiki 上的 PNG 不能直接用,得手译几何路径。 |

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
