# zorr Phase 3 — Bot 玩家系统设计

**Date**: 2026-05-24
**Status**: Draft, pending user approval
**Depends on**:
- `2026-05-24-zorr-gardn-dokploy-deployment-design.md`(基础部署,完成)
- `2026-05-24-zorr-game-progression-and-admin-design.md` Phase 3 section(本 spec 是它的细化版)
- `patches/0004-op-mode.patch` + `patches/0005-super-starter-loadout.patch`(Super Fun Mode,完成)

---

## Context

zorr 现在跑在家庭服上,Super Fun Mode 让单人也能爽快。但 1-2 个人在地图上跑时,**世界本身感觉空荡** —— 没有"跟别人抢 mob"、"看 leaderboard 紧张"、"被陌生人撞到的意外"。

gardn 自带一个 `alloc_cpu_camera()` 函数在 `Server/Spawn.cc:197`,**定义了但从来没被调用** —— 显然作者起头做 bot 但没完成。我们激活它 + 加一层 AI 调度,就能拿到完整的 bot 系统。

### 核心体感目标

用户的话:**"在玩正版中间像氪了很多钱,玩的就是又紧张又爽的那种感觉,但事实上你已经可能是服务器排前五的牛人"**。

拆解:
1. **Leaderboard 上有 15-20 个名字**(像活跃服)
2. **你常驻 top 5**(玩了几分钟就上)
3. **不一定是 #1**(顶上有 2 个 veteran 镇着,要努力才能拼)
4. **会被打** —— 偶尔有 veteran 抢你的 mob、互相误伤
5. **bot 看起来像真人** —— 不打 `[BOT]` 标签,名字像随机玩家

## 全局架构

```
GameInstance::tick()
   ├── simulation.tick()       (existing — entities + collisions + AI for mobs)
   ├── bot_manager.tick()      (NEW — runs AI for each of 15 bots)
   └── _update_client(...)     (existing — broadcasts state to real players)
```

新加一个 `BotManager` 模块,完全 server-side,**客户端零改动**。Bot 走标准的 Camera + Flower 实体路径,在客户端看就是普通玩家。

## Bot 三档配置

| 档位 | 数量 | `respawn_level` | 起手 inventory | 名字风格 |
|---|---|---|---|---|
| **Rookie** | 10 | 1-10(随机) | `[Basic ×8]` | 萌新感小写名:`noob123`, `flwr_new`, `petalpls`, `rosie_xo`, `imaweed`, `floofyy`, `yo_im_new`, `bee_lover`, `petal99`, `flower42` |
| **Competitor** | 3 | 30-50(随机) | `[Stinger, Rose, Faster, Heavy, Basic ×4]` | 普通玩家名:`GardenFox`, `BumbleByte`, `stigmatize`, `PollenDrip`, `LadyBugLuv`, `SporeStorm` |
| **Veteran** | 2 | 70-99(随机) | 跟玩家起手套相同(`Heaviest, Stinger, Yggdrasil, Rose, Faster, Tricac, Triplet, Peas`) | 老阴比名:`xX_Heaviest_Xx`, `florr_pr0`, `L1GHTNlNG`, `tha_real_pro`, `Yggdr4sil_main` |

**为什么这样分**:
- 10 个 rookie 是"风景板" + 你的爽快击杀目标
- 3 个 competitor 是"刚好能赢"的小高潮
- 2 个 veteran 是真正威胁,leaderboard 顶上常驻,你要努力才能挑战

**Veteran 装备故意 = 玩家起手** → 你不是"唯一的 OP",有伴。

名字池总共 ~30 个,运行时附加 1-3 位数字防重复(`noob123` 真的随机抽到的话再加个数字)。

## Bot AI(单 bot 每 tick 的 FSM)

```
Bot 状态机:
  ┌──────────┐
  │ Dead     │ ── respawn_cooldown 倒计时 (3-5s) ──→ Alive (Wander)
  │          │
  ├──────────┤
  │ Wander   │ ── 视野内 (500u) 有 mob ──────────→ Engage
  │ (默认)   │     每 5s 选新随机点
  ├──────────┤
  │ Engage   │ ── HP < 30% ──→ Flee
  │          │ ── mob 死了 / 走远 ──→ Wander
  ├──────────┤
  │ Flee     │ ── HP > 60% ──→ Wander
  │          │     朝最近威胁反方向跑
  └──────────┘
  Engage state:
    朝 target mob 走 (set acceleration)
    设置 attack input flag
  Death:
    所有 bot 都会被 mob / 别的 bot / 玩家杀
    death → 3-5s 后用 `player_spawn` 重生 (沿用现有死亡→重生流程)
```

**故意有缺陷**(让 veteran 也不会成屠杀机器):
- 不会捡 drop(不会升级装备)
- 不会主动 PvP(只 engage 视野内 ENTITY 类型,如果你走进它视野它会 engage 你,但不会主动找你)
- 没记忆 —— 死了忘记之前打谁
- 不抱团

## 实体路径(Bot 怎么变成 gardn 里的"玩家")

借现有 API,**不动 gardn 的实体协议**:

```cpp
// in BotManager::spawn_one_bot(BotTier tier):
Entity &camera = alloc_cpu_camera(sim, NULL_ENTITY);  // existing function
configure_bot_camera(camera, tier);                    // OUR — set inventory based on tier
Entity &player = alloc_player(sim, NULL_ENTITY);       // existing function
player_spawn(sim, camera, player);                     // existing — links them + spawns
player.set_name(pick_random_name(tier));               // existing setter
return camera.id;                                       // we own the camera_id
```

每 tick 对每个 bot:
```cpp
// in Bot::tick(sim):
Entity &camera = sim->get_ent(camera_id);
if (!sim->ent_alive(camera.get_player())) {
    respawn_cooldown--;
    if (respawn_cooldown <= 0) {
        Entity &player = alloc_player(sim, camera.get_team());
        player_spawn(sim, camera, player);
        player.set_name(name);
        respawn_cooldown = 5 * TPS;
    }
    return;
}
Entity &player = sim->get_ent(camera.get_player());

// Find threat / target
EntityID nearest_mob = NULL_ENTITY; float nearest_dist = 99999;
sim->spatial_hash.query(player.get_x(), player.get_y(), 500, 500, [&](auto, Entity &e){
    if (!e.has_component(kMob)) return;
    float d = distance(player, e);
    if (d < nearest_dist) { nearest_mob = e.id; nearest_dist = d; }
});

// FSM
if (player.health < player.max_health * 0.3) {
    set_flee_movement(player);   // 反向逃跑
} else if (nearest_mob != NULL_ENTITY) {
    set_engage_movement(player, sim->get_ent(nearest_mob));
    player.input = ATTACK_BIT;   // 攻击 flag(精确 bit layout 在实现时定)
} else {
    set_wander_movement(player);
    player.input = 0;
}
```

Bot **不发送 kClientInput packet**(它没有 socket),而是**直接写 `player.acceleration` 和 `player.input`** —— 跟服务端处理真实玩家 input 后的结果完全一致(参考 `Server/Client.cc:76-100`)。Bot 跑的是同一个 simulation tick,所以受到一切现有逻辑(碰撞、伤害、Super Fun Mode 倍率、死亡触发器)的影响。

## Leaderboard 怎么自然形成"前 5"

gardn 已有 leaderboard 系统(`Simulation::arena_info` 持有 player score 排序)。

- **Veterans** 一上线 `respawn_level=70-99` → `level_to_score(70+) ≈ 几万 ~ 几十万` 起手 score
- **Competitors** `respawn_level=30-50` → `level_to_score(30+) ≈ 几百 ~ 几千` 起手
- **Rookies** `respawn_level=1-10` → 接近 0 起手
- **玩家** Super Fun Mode 加成,几分钟也能上几万

预期 leaderboard 长这样(随时间推移):

| 排名 | 谁 | 大概 score |
|---|---|---|
| 1-2 | Veterans(初始 score 高 + 持续打怪) | 100k+ |
| **3-5** | **玩家** | 几万到十万 |
| 6-10 | Competitors + 状态好的 rookies | 几千 |
| 11-15+ | 刚 respawn 的 rookies | 几十 |

**玩家恒定 top 5,但要挑战 #1 得专门去找 veteran 干**(高风险:他们装备和你一样;高回报:杀掉抢他的分)。

## 文件结构(本 Phase 新增/修改)

| 文件 | 行数估算 | 职责 |
|---|---|---|
| `Server/BotManager.hh` (新) | ~30 行 | class 接口:`init(sim)`、`tick(sim)`、私有 `vector<Bot> bots` |
| `Server/BotManager.cc` (新) | ~80 行 | 启动时 spawn 15 个 bot;tick 遍历 bots 调 `Bot::tick`;管理三档比例(10/3/2) |
| `Server/Bot.hh` (新) | ~20 行 | `struct Bot { EntityID camera_id; uint8_t tier; std::string name; int respawn_cooldown; ... }` |
| `Server/Bot.cc` (新) | ~120 行 | 单 bot AI tick + 名字池 + tier 配置(inventory & respawn_level) |
| `Server/Game.hh` (改) | +1 行 | 加 `BotManager bot_manager` 字段 |
| `Server/Game.cc` (改) | +2 行 | `init()` 末尾调 `bot_manager.init(&simulation)`;`tick()` 中 `simulation.tick()` 后调 `bot_manager.tick(&simulation)` |
| `Server/CMakeLists.txt` (改) | +3 行 | 把新 .cc 加入 server build |

**总:** ~250 行新 C++ + 三五行 CMake/Game.{hh,cc} 改动。打包成 `patches/0006-bot-system.patch`(一次性大 patch)。

## 性能预估

- 15 bots × 20 tps = 300 次/秒 AI tick
- 每次 = 1 次 `spatial_hash.query`(O(grid cells) ~ ms 内)+ if 链 + 2 个 setter
- 总 CPU 增量 < 1%(在你 lax-02 测过,游戏本身 tick 5ms,bot 加几十 μs 而已)

如果未来扩到 50 bots,也就 ~3% CPU。完全不是瓶颈。

## 跟现有系统的交互

| 系统 | 交互 |
|---|---|
| Super Fun Mode `OpMode::PETAL_DMG_MULT=20` | Bot 的 petal 打 mob 也 ×20(全局)— 公平 |
| `OpMode::MOB_DMG_MULT=0.1` | mob 打 bot 也 ×0.1 — bot 也不容易死 |
| Bot 互相打 / 打玩家(PvP) | 我们 `Damage.cc` 现有 patch 只对 `petal→mob` 和 `mob→flower` 做缩放,**petal→flower 是 base damage**(不放大)—天然平衡 PvP |
| Patch 0005 OP starter loadout | `if (camera.get_inventory(0) == PetalID::kNone)` 触发 — 而 bot 的 camera inventory 在 `alloc_cpu_camera` 已被初始化(非 kNone),**不触发** — bot 用自己档位的 inventory,玩家用 OP starter,互不干扰 |
| Bot 死亡 → 掉装备(`Death.cc` flower 死亡 drop 逻辑) | bot 死时也会掉它的 petal — Veteran 死了能掉 Heaviest 等好货 —— 是奖励玩家击杀 veteran 的强动机 |

## 范围外(明确不做)

- Bot **不会捡 drop** / **不会换装备**(以后可加:让 bot 在视野内有 drop 时绕过去 set_inventory)
- Bot **不会主动 PvP / 不会组队**(以后可加:engage state 扩展到任何 flower)
- Bot 名字池**本地固定**(以后可加:从在线 API 拿真实 florr 风格名字)
- Bot 数量 / 比例**编译时常量**(Phase 2 admin 面板才支持运行时调)
- 不打 `[BOT]` 标签(故意 — 用户要"看起来像真人")
- 不显示"今日新增 N bot"全局消息

## 验证(Acceptance)

进游戏后:
- [ ] Leaderboard 显示 16 个名字(15 bot + 你)
- [ ] 名字看起来像玩家(没"Bot_" 前缀)
- [ ] 走两步能看到 2-3 个其他"玩家"(rookie 在打怪)
- [ ] 挂机 30 秒不死(bot 偶尔撞你但 super mode HP 10× 扛得住)
- [ ] 持续看 leaderboard 你能升到 top 5(用 super mode 几分钟就上)
- [ ] 顶上 1-2 名是固定那俩 veteran 名字
- [ ] Bot 死了 ~5 秒后名字回到 leaderboard(说明 respawn 工作)
- [ ] 你击杀一个 veteran → 看到它掉了好几个高级 petal
- [ ] 浏览器 DevTools tick 时间不显著上升(< 1ms 增量)

## 实现风险点

| 风险 | 缓解 |
|---|---|
| `player.input` 的精确 bit layout 不确定 | 实现时 grep gardn 找"input.*bit"、"kAttack"等。如果找不到就先用全 0(只移动不攻击),后面调 |
| `alloc_cpu_camera` 是"死代码",可能有不完整初始化 | 实现时 diff 真实玩家 camera 的字段,对照补全(比如可能缺 `kName`组件) |
| Bot leaderboard 显示需要 `kName` 组件? | 检查 `Simulation::arena_info` 怎么从 entity 拉 name 写入排行榜 |
| bot 集中在一个 zone 怎么办 | `spawn_random_mob` 用 `Map::get_suitable_difficulty_zone(power)` 按 respawn_level 分配 zone — 已自然分散 |
| Performance: 15 bots × 每 tick spatial_hash 1 次 = OK,但如果未来到 50+ 可能要 cache 临近 mob list | 现在 15 个不担心,留 TODO |

## Future(不在本 Phase 内)

- 给 BotManager 加运行时配置(配合 Phase 2 admin 面板的 op-config.json)— `bot_count`、`bot_tier_distribution`、`bot_aggression`
- Bot LLM 化(让 GPT 控制 bot 的行为更像真人)— 不严肃
- Bot 之间组队 / 群体行为
- Bot 互发消息(假聊天)— 需要 gardn 加聊天系统,大坑
