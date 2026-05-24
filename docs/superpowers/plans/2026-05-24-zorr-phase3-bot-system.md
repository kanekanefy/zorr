# zorr Phase 3 — Bot 系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服务器启动时 spawn 15 个 AI 控制的 bot(10 rookie + 3 competitor + 2 veteran),leaderboard 显示 16 个名字,玩家常驻 top 5,被 veteran 镇压偶尔紧张。

**Architecture:** 新 `Server/Bot.{hh,cc}`(单 bot 数据 + AI FSM)+ 新 `Server/BotManager.{hh,cc}`(15 个 bot 生命周期 + 调度)。`GameInstance::init()` 启 BotManager,`GameInstance::tick()` 在 `simulation.tick()` 后调 `bot_manager.tick()`。所有 bot 实体走 gardn 的 alloc_player + player_spawn 路径,客户端零改动,leaderboard / drop / 渲染全自动。

**Tech Stack:** C++20 / WASM-Node server / 现有 GHA → GHCR → Dokploy 流水线

**Spec**: `docs/superpowers/specs/2026-05-24-zorr-phase3-bot-system-design.md`

**Pre-conditions**(本次开始时已为真):
- `upstream/gardn` pin 在 commit `86fcec609cae059e950781c70dae62dee31de58d`
- `patches/0001..0005` 已存在并能 apply
- Super Fun Mode 在线
- `git-diff 生成法` 已有先例(patches/0004、0005 都是这样产出)

---

## File Structure(本计划完成后,gardn 工作树内)

```
upstream/gardn/Server/
├── Bot.hh                 (NEW, ~25 行) — struct Bot + enum BotTier
├── Bot.cc                 (NEW, ~150 行) — AI tick + tier configs + name pool
├── BotManager.hh          (NEW, ~15 行) — class 接口
├── BotManager.cc          (NEW, ~60 行) — spawn N bots + tick loop
├── Game.hh                (MODIFY) — add `BotManager bot_manager` 字段
├── Game.cc                (MODIFY) — init/tick 中调 bot_manager
└── CMakeLists.txt         (MODIFY) — Bot.cc + BotManager.cc 加入 SOURCES
```

所有改动统一打包成 `patches/0006-bot-system.patch`。

---

## Task 1: 在 upstream/gardn 工作树写新文件(Bot + BotManager)

**Files (created in working tree, NOT yet committed):**
- Create: `upstream/gardn/Server/Bot.hh`
- Create: `upstream/gardn/Server/Bot.cc`
- Create: `upstream/gardn/Server/BotManager.hh`
- Create: `upstream/gardn/Server/BotManager.cc`

⚠️ 这一步只在 working tree 写,**不要 commit submodule 改动**(patch 是唯一交付物)。

- [ ] **Step 1: 确认 working tree 干净**

```bash
cd /Users/kane/Desktop/project/zorr/upstream/gardn
git status --short
```

Expected: 空输出(没有未跟踪文件)。如果有遗留改动,先 `git checkout .` + 清理 untracked 文件。

- [ ] **Step 2: 写 `Server/Bot.hh`**

```cpp
#pragma once

#include <Shared/Entity.hh>

#include <cstdint>
#include <string>

class Simulation;

enum class BotTier : uint8_t { Rookie, Competitor, Veteran };

struct Bot {
    EntityID camera_id;            // owned camera entity ID (never invalidated for bot's lifetime)
    BotTier tier;
    std::string name;
    int respawn_cooldown;          // ticks until respawn after death (<= 0 means ready / not waiting)
    int wander_change_cooldown;    // ticks until pick new wander target
    float wander_target_x;
    float wander_target_y;

    void tick(Simulation *sim);
};
```

- [ ] **Step 3: 写 `Server/Bot.cc`**

```cpp
#include <Server/Bot.hh>

#include <Server/PetalTracker.hh>
#include <Server/Spawn.hh>

#include <Shared/Entity.hh>
#include <Shared/Map.hh>
#include <Shared/Simulation.hh>
#include <Shared/StaticData.hh>

#include <Helpers/Math.hh>
#include <Helpers/Vector.hh>

#include <cmath>

namespace BotConfig {
    constexpr int   RESPAWN_COOLDOWN_TICKS = 5 * 20;   // 5s @ TPS=20
    constexpr int   WANDER_CHANGE_TICKS    = 5 * 20;   // pick new wander target every 5s
    constexpr float VISION_RADIUS          = 500.0f;
    constexpr float FLEE_HEALTH_RATIO      = 0.30f;
    constexpr float WANDER_RANGE           = 1500.0f;  // half-width of wander target offset
    constexpr float WANDER_STOP_DIST       = 50.0f;    // close enough to wander target → stop
}

namespace BotNames {
    static char const *const ROOKIE_NAMES[] = {
        "noob123", "flwr_new", "petalpls", "rosie_xo", "imaweed",
        "floofyy", "yo_im_new", "bee_lover", "petal99", "flower42",
    };
    static char const *const COMPETITOR_NAMES[] = {
        "GardenFox", "BumbleByte", "stigmatize",
        "PollenDrip", "LadyBugLuv", "SporeStorm",
    };
    static char const *const VETERAN_NAMES[] = {
        "xX_Heaviest_Xx", "florr_pr0", "L1GHTNlNG",
        "tha_real_pro", "Yggdr4sil_main",
    };

    std::string pick(BotTier tier, uint32_t index) {
        switch (tier) {
            case BotTier::Rookie:     return ROOKIE_NAMES[index % 10];
            case BotTier::Competitor: return COMPETITOR_NAMES[index % 6];
            case BotTier::Veteran:    return VETERAN_NAMES[index % 5];
        }
        return "bot";
    }
}

namespace BotTiers {
    static PetalID::T const ROOKIE_INVENTORY[8] = {
        PetalID::kBasic, PetalID::kBasic, PetalID::kBasic, PetalID::kBasic,
        PetalID::kBasic, PetalID::kBasic, PetalID::kBasic, PetalID::kBasic,
    };
    static PetalID::T const COMPETITOR_INVENTORY[8] = {
        PetalID::kStinger, PetalID::kRose, PetalID::kFaster, PetalID::kHeavy,
        PetalID::kBasic,   PetalID::kBasic, PetalID::kBasic, PetalID::kBasic,
    };
    static PetalID::T const VETERAN_INVENTORY[8] = {
        PetalID::kHeaviest, PetalID::kStinger,  PetalID::kYggdrasil, PetalID::kRose,
        PetalID::kFaster,   PetalID::kTricac,   PetalID::kTriplet,   PetalID::kPeas,
    };

    PetalID::T const *get_inventory(BotTier tier) {
        switch (tier) {
            case BotTier::Rookie:     return ROOKIE_INVENTORY;
            case BotTier::Competitor: return COMPETITOR_INVENTORY;
            case BotTier::Veteran:    return VETERAN_INVENTORY;
        }
        return ROOKIE_INVENTORY;
    }

    uint32_t get_random_level(BotTier tier) {
        switch (tier) {
            case BotTier::Rookie:     return 1  + (uint32_t)(frand() * 10);  // 1..10
            case BotTier::Competitor: return 30 + (uint32_t)(frand() * 20);  // 30..49
            case BotTier::Veteran:    return 70 + (uint32_t)(frand() * 30);  // 70..99
        }
        return 1;
    }
}

static float distance_between(Entity const &a, Entity const &b) {
    float dx = a.get_x() - b.get_x();
    float dy = a.get_y() - b.get_y();
    return std::sqrt(dx * dx + dy * dy);
}

void Bot::tick(Simulation *sim) {
    if (!sim->ent_exists(camera_id)) return;
    Entity &camera = sim->get_ent(camera_id);

    // Death / respawn flow
    if (!sim->ent_alive(camera.get_player())) {
        if (respawn_cooldown > 0) {
            respawn_cooldown--;
            return;
        }
        Entity &player = alloc_player(sim, camera.get_team());
        player_spawn(sim, camera, player);
        player.set_name(name);
        respawn_cooldown = BotConfig::RESPAWN_COOLDOWN_TICKS;
        return;
    }

    Entity &player = sim->get_ent(camera.get_player());

    // Find nearest mob within vision radius
    EntityID nearest_mob = NULL_ENTITY;
    float nearest_dist = 1e9f;
    sim->spatial_hash.query(
        player.get_x(), player.get_y(),
        BotConfig::VISION_RADIUS, BotConfig::VISION_RADIUS,
        [&](Simulation *, Entity &ent) {
            if (!ent.has_component(kMob)) return;
            if (!sim->ent_alive(ent.id)) return;
            float d = distance_between(player, ent);
            if (d < nearest_dist) {
                nearest_dist = d;
                nearest_mob = ent.id;
            }
        }
    );

    bool low_health = (player.health < player.max_health * BotConfig::FLEE_HEALTH_RATIO);

    Vector accel;
    uint8_t input_flags = 0;

    if (low_health && nearest_mob != NULL_ENTITY) {
        // Flee: move away from nearest mob
        Entity &mob = sim->get_ent(nearest_mob);
        accel = Vector(player.get_x() - mob.get_x(), player.get_y() - mob.get_y());
        if (accel.magnitude() > 0) accel.set_magnitude(PLAYER_ACCELERATION);
    } else if (nearest_mob != NULL_ENTITY) {
        // Engage: move toward mob, attack
        Entity &mob = sim->get_ent(nearest_mob);
        accel = Vector(mob.get_x() - player.get_x(), mob.get_y() - player.get_y());
        if (accel.magnitude() > 0) accel.set_magnitude(PLAYER_ACCELERATION);
        BitMath::set(input_flags, InputFlags::kAttacking);
    } else {
        // Wander
        if (wander_change_cooldown <= 0) {
            wander_target_x = player.get_x() + (frand() - 0.5f) * BotConfig::WANDER_RANGE;
            wander_target_y = player.get_y() + (frand() - 0.5f) * BotConfig::WANDER_RANGE;
            wander_change_cooldown = BotConfig::WANDER_CHANGE_TICKS;
        } else {
            wander_change_cooldown--;
        }
        accel = Vector(wander_target_x - player.get_x(), wander_target_y - player.get_y());
        float m = accel.magnitude();
        if (m > BotConfig::WANDER_STOP_DIST) accel.set_magnitude(PLAYER_ACCELERATION);
        else accel.set(0, 0);
    }

    player.acceleration = accel;
    player.input = input_flags;
}
```

注:`frand()`、`BitMath::set`、`Vector`、`InputFlags::kAttacking`、`PLAYER_ACCELERATION` 都是 gardn 现有 API,已确认存在(参考 Helpers/Math.hh、Shared/StaticDefinitions.hh、Shared/StaticData.cc、Server/Process/Flower.cc:186)。

- [ ] **Step 4: 写 `Server/BotManager.hh`**

```cpp
#pragma once

#include <Server/Bot.hh>

#include <vector>

class Simulation;

class BotManager {
    std::vector<Bot> bots;
public:
    void init(Simulation *sim);
    void tick(Simulation *sim);
};
```

- [ ] **Step 5: 写 `Server/BotManager.cc`**

```cpp
#include <Server/BotManager.hh>

#include <Server/PetalTracker.hh>
#include <Server/Spawn.hh>

#include <Shared/Entity.hh>
#include <Shared/Simulation.hh>
#include <Shared/StaticData.hh>
#include <Shared/StaticDefinitions.hh>

namespace BotTiers {
    PetalID::T const *get_inventory(BotTier tier);
    uint32_t get_random_level(BotTier tier);
}
namespace BotNames {
    std::string pick(BotTier tier, uint32_t index);
}

namespace {
    constexpr int N_ROOKIES     = 10;
    constexpr int N_COMPETITORS = 3;
    constexpr int N_VETERANS    = 2;

    // Inline the parts of alloc_cpu_camera we need, with our tier-specific config.
    // We avoid calling alloc_cpu_camera directly because it sets respawn_level/inventory
    // we'd just override, and side-effects (PetalTracker) we'd need to undo.
    Entity &alloc_bot_camera(Simulation *sim, BotTier tier) {
        Entity &cam = sim->alloc_ent();
        cam.add_component(kCamera);
        cam.add_component(kRelations);
        cam.set_fov(BASE_FOV);
        cam.set_team(NULL_ENTITY);
        cam.set_color(ColorID::kGray);
        cam.set_respawn_level(BotTiers::get_random_level(tier));

        PetalID::T const *inv = BotTiers::get_inventory(tier);
        for (uint32_t i = 0; i < 8 && i < MAX_SLOT_COUNT; ++i) {
            cam.set_inventory(i, inv[i]);
            PetalTracker::add_petal(sim, inv[i]);
        }
        return cam;
    }

    Bot make_bot(Simulation *sim, BotTier tier, uint32_t name_index) {
        Entity &camera = alloc_bot_camera(sim, tier);
        Entity &player = alloc_player(sim, camera.get_team());
        player_spawn(sim, camera, player);

        Bot bot;
        bot.camera_id              = camera.id;
        bot.tier                   = tier;
        bot.name                   = BotNames::pick(tier, name_index);
        bot.respawn_cooldown       = 0;  // alive; cooldown counts down only when dead
        bot.wander_change_cooldown = 0;
        bot.wander_target_x        = player.get_x();
        bot.wander_target_y        = player.get_y();
        player.set_name(bot.name);
        return bot;
    }
}

void BotManager::init(Simulation *sim) {
    bots.clear();
    bots.reserve(N_ROOKIES + N_COMPETITORS + N_VETERANS);
    for (int i = 0; i < N_ROOKIES;     ++i) bots.push_back(make_bot(sim, BotTier::Rookie,     i));
    for (int i = 0; i < N_COMPETITORS; ++i) bots.push_back(make_bot(sim, BotTier::Competitor, i));
    for (int i = 0; i < N_VETERANS;    ++i) bots.push_back(make_bot(sim, BotTier::Veteran,    i));
}

void BotManager::tick(Simulation *sim) {
    for (Bot &bot : bots) {
        bot.tick(sim);
    }
}
```

- [ ] **Step 6: 验证 working tree 现状**

```bash
cd /Users/kane/Desktop/project/zorr/upstream/gardn
ls -la Server/Bot* Server/BotManager*
```

Expected: 4 个文件都存在。

```bash
git status --short
```

Expected: 4 个 `??` (untracked) 行,对应 4 个新文件。

---

## Task 2: 接入 Game + CMakeLists

**Files:**
- Modify: `upstream/gardn/Server/Game.hh`
- Modify: `upstream/gardn/Server/Game.cc`
- Modify: `upstream/gardn/Server/CMakeLists.txt`

- [ ] **Step 1: 改 `Server/Game.hh` — 加 BotManager 成员**

用 Edit 工具,在现有 class GameInstance 里加字段 + include:

`old_string`:
```cpp
#pragma once

#include <Server/TeamManager.hh>

#include <Shared/Simulation.hh>

#include <set>

class Client;

class GameInstance {
    std::set<Client *> clients;
    TeamManager team_manager;
public:
    Simulation simulation;
    GameInstance();
    void init();
    void tick();
    void add_client(Client *);
    void remove_client(Client *);
};
```

`new_string`:
```cpp
#pragma once

#include <Server/BotManager.hh>
#include <Server/TeamManager.hh>

#include <Shared/Simulation.hh>

#include <set>

class Client;

class GameInstance {
    std::set<Client *> clients;
    TeamManager team_manager;
    BotManager bot_manager;
public:
    Simulation simulation;
    GameInstance();
    void init();
    void tick();
    void add_client(Client *);
    void remove_client(Client *);
};
```

- [ ] **Step 2: 改 `Server/Game.cc` — init/tick 中调 BotManager**

`old_string` (init 函数):
```cpp
void GameInstance::init() {
    for (uint32_t i = 0; i < ENTITY_CAP / 2; ++i)
        Map::spawn_random_mob(&simulation, frand() * ARENA_WIDTH, frand() * ARENA_HEIGHT);
    #ifdef GAMEMODE_TDM
    team_manager.add_team(ColorID::kBlue);
    team_manager.add_team(ColorID::kRed);
    #endif
}
```

`new_string`:
```cpp
void GameInstance::init() {
    for (uint32_t i = 0; i < ENTITY_CAP / 2; ++i)
        Map::spawn_random_mob(&simulation, frand() * ARENA_WIDTH, frand() * ARENA_HEIGHT);
    #ifdef GAMEMODE_TDM
    team_manager.add_team(ColorID::kBlue);
    team_manager.add_team(ColorID::kRed);
    #endif
    bot_manager.init(&simulation);
}
```

`old_string` (tick 函数):
```cpp
void GameInstance::tick() {
    simulation.tick();
    for (Client *client : clients)
        _update_client(&simulation, client);
    simulation.post_tick();
}
```

`new_string`:
```cpp
void GameInstance::tick() {
    simulation.tick();
    bot_manager.tick(&simulation);
    for (Client *client : clients)
        _update_client(&simulation, client);
    simulation.post_tick();
}
```

- [ ] **Step 3: 改 `Server/CMakeLists.txt` — 加 Bot.cc + BotManager.cc 到 SOURCES**

`old_string`:
```cmake
    Client.cc
    Game.cc
    Main.cc
    PetalTracker.cc
    Server.cc
    Simulation.cc
    Spawn.cc
    TeamManager.cc
```

`new_string`:
```cmake
    Bot.cc
    BotManager.cc
    Client.cc
    Game.cc
    Main.cc
    PetalTracker.cc
    Server.cc
    Simulation.cc
    Spawn.cc
    TeamManager.cc
```

- [ ] **Step 4: 验证修改**

```bash
cd /Users/kane/Desktop/project/zorr/upstream/gardn
git status --short
```

Expected:
```
 M Server/CMakeLists.txt
 M Server/Game.cc
 M Server/Game.hh
?? Server/Bot.cc
?? Server/Bot.hh
?? Server/BotManager.cc
?? Server/BotManager.hh
```

```bash
grep -n "bot_manager" Server/Game.cc Server/Game.hh
```

Expected: 3 行 hit(Game.hh 字段、init 调用、tick 调用)。

---

## Task 3: 生成 patch 0006 + dry-run 验证

**Files:**
- Create: `patches/0006-bot-system.patch`
- Modify: `patches/README.md`

- [ ] **Step 1: 让 untracked 文件出现在 diff 里(intent-to-add)**

```bash
cd /Users/kane/Desktop/project/zorr/upstream/gardn
git add -N Server/Bot.hh Server/Bot.cc Server/BotManager.hh Server/BotManager.cc
git status --short
```

Expected: 之前 `??` 的 4 行现在变成 ` A`(intent to add, will appear in diff)。

- [ ] **Step 2: 生成 patch**

```bash
git diff Server/Bot.hh Server/Bot.cc Server/BotManager.hh Server/BotManager.cc \
        Server/Game.hh Server/Game.cc Server/CMakeLists.txt \
        > /Users/kane/Desktop/project/zorr/patches/0006-bot-system.patch
wc -l /Users/kane/Desktop/project/zorr/patches/0006-bot-system.patch
```

Expected: 大约 ~290 行(250 行新代码 + 40 行 diff 头/上下文)。

- [ ] **Step 3: 还原 working tree**

```bash
git reset HEAD Server/Bot.hh Server/Bot.cc Server/BotManager.hh Server/BotManager.cc
git checkout Server/Game.hh Server/Game.cc Server/CMakeLists.txt
rm Server/Bot.hh Server/Bot.cc Server/BotManager.hh Server/BotManager.cc
git status --short
```

Expected: 空输出(working tree 干净)。

- [ ] **Step 4: dry-run 验证全部 6 个 patch**

```bash
cd /Users/kane/Desktop/project/zorr/upstream/gardn
for p in /Users/kane/Desktop/project/zorr/patches/*.patch; do
  echo "--- $(basename $p) ---"
  patch -p1 --dry-run < "$p" 2>&1 | head -10
done
```

Expected: 6 个 patch 全部 "patching file X" 行,**任何地方都不能出现 FAILED 或 Hunk #N failed**。

如果 0006 失败:最常见原因是 Game.hh / Game.cc 上下文里有空白字符差异。打开 patch 文件人工检查 `@@` 段。

- [ ] **Step 5: 更新 patches/README.md**

用 Edit 工具,在 0005 的表格行后面加一行:

`old_string`:
```markdown
| 0005 | `super-starter-loadout.patch` | **OP 起手套装**:初次 spawn(`camera.inventory[0] == kNone`)时,在 `Server/Spawn.cc::player_spawn()` 自动给玩家 8 槽塞:Heaviest / Stinger / Yggdrasil / Rose / Faster / Tricac / Triplet / Peas。死亡重生不影响(那时 inventory 已不空) |
```

`new_string`:
```markdown
| 0005 | `super-starter-loadout.patch` | **OP 起手套装**:初次 spawn(`camera.inventory[0] == kNone`)时,在 `Server/Spawn.cc::player_spawn()` 自动给玩家 8 槽塞:Heaviest / Stinger / Yggdrasil / Rose / Faster / Tricac / Triplet / Peas。死亡重生不影响(那时 inventory 已不空) |
| 0006 | `bot-system.patch` | **Bot 玩家系统(Phase 3)**:新 `Server/Bot.{hh,cc}` + `Server/BotManager.{hh,cc}`,启动时 spawn 15 个 bot(10 rookie + 3 competitor + 2 veteran),每 tick 跑简单 FSM(wander/engage/flee/dead)。GameInstance::init/tick 接入,CMakeLists 加新文件 |
```

---

## Task 4: 提交 + push + 等 GHA build

- [ ] **Step 1: commit**

```bash
cd /Users/kane/Desktop/project/zorr
git add patches/0006-bot-system.patch patches/README.md
git status --short
git commit -m "feat: patch 0006 — Phase 3 bot system (15 bots, 3 tiers, AI FSM)

Activates the dormant alloc_cpu_camera() infrastructure with a new
BotManager + Bot module wired into GameInstance.

15 bots spawned at server init:
  - 10 rookies (level 1-10, all Basic petals)
  - 3 competitors (level 30-50, mid loadout)
  - 2 veterans (level 70-99, OP loadout matching player starter set)

Bot AI per tick: nearest-mob lookup via spatial_hash, FSM with
wander/engage/flee/dead states. Sets player.acceleration + player.input
directly (no fake kClientInput packet needed).

Leaderboard naturally shows 16 names; player typically lands top 5
with veterans holding 1-2 positions due to their high initial score
from respawn_level=70-99.

Spec: docs/superpowers/specs/2026-05-24-zorr-phase3-bot-system-design.md"
```

- [ ] **Step 2: push**

```bash
git push origin main
```

Expected: `<old>..<new>  main -> main`。

- [ ] **Step 3: 找到 GHA run id**

```bash
sleep 5
gh run list --repo kanekanefy/zorr --limit 3
```

Expected: 顶上 in_progress,记下 run ID。

- [ ] **Step 4: 后台 watch GHA build(~5-7 分钟)**

```bash
gh run watch <RUN_ID> --repo kanekanefy/zorr --exit-status
```

(用 run_in_background:true,不阻塞。等通知。)

Expected: exit 0。

**如果失败** —— 最可能的原因 + 修法:

| 症状 | 排查 |
|---|---|
| 编译错误 `'X' was not declared` | 缺 include。看错误指向的文件,补 include。常见:`#include <Helpers/Math.hh>` 缺 frand,`#include <Shared/StaticDefinitions.hh>` 缺 InputFlags |
| linker 错误 `undefined reference to BotManager::init` | CMakeLists 没加 BotManager.cc。检查 patch 应用是否成功 |
| `'PetalTracker::add_petal' undeclared` | 缺 `#include <Server/PetalTracker.hh>` |
| `'Vector' undeclared` | 缺 `#include <Helpers/Vector.hh>` |

修法:回 Task 1 修对应文件,重 Task 3 生成 patch,push 新版。

---

## Task 5: 触发 Dokploy 部署 + SSH 验证 container 起来

- [ ] **Step 1: 跑 deploy 脚本**

```bash
DOKPLOY_URL=https://dok.inglegames.com \
DOKPLOY_API_KEY=<your-key> \
/Users/kane/Desktop/project/zorr/deploy/dokploy-deploy.sh
```

Expected: 5 个 step 全 reusing,末尾 summary 含 `applicationId: g9-sgDp9fx5CCh2FkkPTB`。

- [ ] **Step 2: 等容器换新 + 健康**

```bash
ssh ubuntu@lax-02 \
  'until sudo docker inspect $(sudo docker ps -q --filter "name=zorr") 2>/dev/null | jq -e ".[0].State.StartedAt | fromdate > (now - 60)" >/dev/null; do sleep 3; done; echo "NEW CONTAINER READY"; sudo docker logs --tail 10 $(sudo docker ps -q --filter "name=zorr") 2>&1 | tail -10'
```

Expected: 看到 `NEW CONTAINER READY`,然后是新容器的启动日志。**关键看是否有 "Diagnostics:" 输出**(说明 Main.cc 跑了 → 编译成功)和 "Server running" / "tick took" 行(说明初始化没崩)。

- [ ] **Step 3: HTTPS 烟雾测试**

```bash
curl -sS -o /tmp/zorr-bot.html -w "HTTP %{http_code}\n" "https://zorr.inglegames.com/"
grep -E "title" /tmp/zorr-bot.html | head
```

Expected: HTTP 200,HTML 含 `<title>zorr</title>`。

---

## Task 6: 浏览器验证 — bot 是否真的在场上 + leaderboard

**Files:** 无(人工 QA)

- [ ] **Step 1: 打开游戏**

```
浏览器开 https://zorr.inglegames.com → 输入名字 → Spawn
```

- [ ] **Step 2: 验证 "leaderboard 有 16 个名字"**

游戏右上角的 leaderboard。

Expected: 至少 10-16 个名字。**你的名字 + 15 个 bot 名字**(随机抽到的 rookie/competitor/veteran 名字)。

如果只看到你一个名字 → bot 没起来。看容器日志:`ssh ubuntu@lax-02 'sudo docker logs --tail 50 $(sudo docker ps -q --filter "name=zorr") | grep -i "crash\|abort\|panic\|bot"'`

- [ ] **Step 3: 验证 "bot 在地图上活动"**

走两步,环顾屏幕。

Expected: 看到至少 1-2 个"其他玩家"花在打怪、移动、互相误伤。它们的名字应该跟 leaderboard 上的 bot 名字一致。

- [ ] **Step 4: 验证 "你能升到 top 5"**

挂着打 mob 几分钟。

Expected: 你的名字逐渐在 leaderboard 上升。最终常驻 3-5 名,顶上有 1-2 个固定的 veteran 名字(`xX_Heaviest_Xx` 等)。

- [ ] **Step 5: 验证 "veteran 死了掉东西"**

找一个 veteran(它会因为高 respawn_level 看起来"大且强")故意撞它/打它。它有 OP 装备但你也有,你应该能慢慢磨死它。

Expected: veteran 死后掉好几个高级 petal(Heaviest、Yggdrasil 等)— 这是奖励玩家击杀 veteran 的强动机。

- [ ] **Step 6: 验证 "bot 死了会 respawn"**

观察一个 rookie(它经常被 mob 秒)。等它死。

Expected: 5 秒左右,它的名字从 leaderboard 消失(死亡时),然后重新出现(respawn)。

- [ ] **Step 7: 性能 sanity check**

```bash
ssh ubuntu@lax-02 'sudo docker logs --tail 20 $(sudo docker ps -q --filter "name=zorr") 2>&1 | grep "tick took"'
```

Expected: tick time 仍在 5-10ms 范围。如果飙到 30ms+ → bot 影响性能,可能要减数量。

---

## Rollback(如果整个 Phase 3 翻车)

```bash
git revert HEAD --no-edit
git push origin main
# 等 GHA + Dokploy auto deploy(~7 分钟回到上一版)
/Users/kane/Desktop/project/zorr/deploy/dokploy-deploy.sh
```

或者直接在 Dokploy UI 上 rollback 到 `sha-341096e`(Super Fun Mode 的最后一个 commit)。

---

## 完成定义

- [ ] `patches/0006-bot-system.patch` 在 main 分支上,dry-run 干净
- [ ] GHA 绿勾,GHCR 上有新 digest
- [ ] Dokploy zorr container 跑新 image,无 crash
- [ ] 浏览器进游戏,leaderboard 显示 ≥ 10 个名字
- [ ] 你能在地图上看到其他"玩家"活动
- [ ] 几分钟后你在 leaderboard top 5
- [ ] 顶上有 2 个 veteran(如 xX_Heaviest_Xx)
- [ ] tick time 在 5-10ms,未受 bot 影响

## 后续(明确不在本计划内)

| 想法 | 留到 |
|---|---|
| Bot 数量 / tier 比例运行时可调 | Phase 2 admin 面板上线后 |
| Bot 捡 drop / 换装备 | Phase 3.1(本 Phase 完成后做) |
| Bot 主动 PvP / 组队 | Phase 3.2 |
| Bot LLM 驱动(让 GPT 控制行为更像真人) | 不严肃,暂不规划 |
