# zorr — 游戏体感重塑 + Admin 面板 + Bot 玩家(三阶段)

**Date**: 2026-05-24
**Status**: Draft, pending user approval
**Depends on**: `2026-05-24-zorr-gardn-dokploy-deployment-design.md`(基础部署已完成)

---

## Context

zorr 私服基础部署已经跑通(https://zorr.inglegames.com),但 gardn 默认是为"匿名玩家在公开 .io 服务器苦熬"调过的:升级慢、掉率低、需要人多才热闹。我们的使用场景完全不同——

- **场景**:管理员(用户)+ 家里 2-3 人玩,可能朋友偶尔上
- **目标**:
  - 升级飞快、装备容易拿、玩感"爽"——别人氪几百拿的我免费给
  - 单人/小群体也能玩得动(不靠人气)
  - 长期想要 admin 面板能可视化调参,不要每改一次都 git 操作
  - 长期想要 bot 玩家让世界看着热闹

本 spec 把"管理面板"的需求拆成三阶段独立交付,每阶段独立可用、独立有价值。

## 全局架构(三阶段终局态)

```
                       ┌────────────────────────────────┐
                       │   admin.zorr.inglegames.com    │
                       │   (Next.js + auth, Dokploy app) │
                       └────────────────┬───────────────┘
                                        │ 读/写
                                        ▼
                       ┌────────────────────────────────┐
                       │  zorr repo on GitHub           │
                       │  op-config.json + patches/     │
                       └────────────────┬───────────────┘
                                        │ git push
                                        ▼
                       ┌────────────────────────────────┐
                       │  GHA build → GHCR              │
                       └────────────────┬───────────────┘
                                        │ webhook
                                        ▼
   玩家 → zorr.inglegames.com → Dokploy → gardn container
                                              │
                                              ├─ mount: /etc/zorr/op-config.json
                                              └─ runtime: read multipliers + spawn N bots
```

Phase 1 把 OP 体感烤进镜像;Phase 2 把它做成可调;Phase 3 让世界有人(bot)。

---

## Phase 1 — "OP Mode" 补丁(本周内,~3-4 小时)

### 目的
**立刻让游戏好玩**。无 UI,只是一组补丁,跟现有 3 个 cosmetic 补丁(标题/WS/底色)并列。

### 单点设计:`Shared/OpMode.hh`

新增一个 header,集中放所有"难度调节"常量,默认值即 OP 模式:

```cpp
#pragma once

// zorr OP-mode tunables.
// Phase 1: compile-time constants.
// Phase 2: will be replaced by runtime-loaded JSON config.

namespace OpMode {
    // Leveling
    inline constexpr float LEVEL_DIV = 10.0f;     // 升级所需 XP / 10
    inline constexpr float XP_MULT = 5.0f;        // 每杀给 XP × 5
    inline constexpr bool ALL_SLOTS_FROM_START = true;

    // Survivability
    inline constexpr float HP_MULT = 2.0f;        // 玩家 HP × 2
    inline constexpr float PETAL_DMG_MULT = 3.0f; // 玩家打怪 × 3
    inline constexpr float MOB_DMG_MULT = 0.5f;   // 怪打玩家 × 0.5

    // Economy
    inline constexpr float DROP_MULT = 5.0f;      // 掉率 × 5
    inline constexpr float DENSITY_MULT = 3.0f;   // 怪密度 × 3
}
```

### 修改点(基于 recon 确认的位置)

| 改的常量/函数 | 位置 | 改动 |
|---|---|---|
| `score_to_pass_level()` | `Shared/StaticData.cc:1104` | 返回值 `/ OpMode::LEVEL_DIV`,最小 1 |
| `loadout_slots_at_level()` | `Shared/StaticData.cc:1119` | 头部加 `if (OpMode::ALL_SLOTS_FROM_START) return MAX_SLOT_COUNT;` |
| `hp_at_level()` | `Shared/StaticData.cc:1128` | `return (BASE_HEALTH + level) * OpMode::HP_MULT;` |
| `mob.score_reward = ... .xp` 多处 | `Server/EntityFunctions/Damage.cc:48` 等 4 处 | 乘 `OpMode::XP_MULT` |
| `drop_chances[i]` 比较 | `Server/EntityFunctions/Death.cc:75` | `if (frand() < drop_chances[i] * OpMode::DROP_MULT)` |
| `spawn_random_mob` 密度判定 | `Shared/Map.cc:spawn_random_mob` | `zone.density * OpMode::DENSITY_MULT * ...` |
| 全部伤害(玩家↔怪) | `Server/EntityFunctions/Damage.cc:20` `inflict_damage()` 顶部 | 加 10 行:基于 attacker / defender 组件类型,`amt` 乘对应 mult。petal→mob 用 `PETAL_DMG_MULT`,mob→flower 用 `MOB_DMG_MULT`,其他默认 |

### 交付物

- `patches/0004-op-mode.patch` — 一个大补丁(添加 OpMode.hh + 改 8 处 call site)
- Dockerfile 不变(补丁顺序自动按文件名)
- 推 main → GHA build → Dokploy 自动 pull → ~10 分钟玩到 OP 模式

### 验收

| 验收项 | 怎么测 |
|---|---|
| 升级飞快 | 进游戏打几只杂兵,1 分钟内升 10+ 级 |
| 槽位全开 | 开局就有 8 个 petal 槽 |
| 玩家血厚 | 杂兵很难秒杀玩家 |
| 怪好打 | 1-2 朵基础花瓣秒一个 Easy 区 mob |
| 掉率高 | 杀 10 只 mob 应该出 2-3 个 drop |
| 世界热闹 | Easy 区随时能看到 30+ mob |

### 局限

- 数值是硬编码,要调得改 `Shared/OpMode.hh` → push → 等 10 分钟重新 build
- 没 UI,要懂 git
- 没 bot

---

## Phase 2 — Admin 面板(~3 天,独立 repo `zorr-admin`)

### 目的
把 Phase 1 的 OP_* multiplier 做成 web UI 可调,**不需要懂 git**。

### 架构

**两个东西要做**:

#### Part A:gardn 改造成"从 JSON 读 config"

新增补丁 `patches/0005-runtime-op-config.patch`:
- `Shared/OpMode.hh` 里的 `constexpr` 改成 `extern` 变量
- 新建 `Shared/OpMode.cc`:程序启动时读 `/etc/zorr/op-config.json`,如果不存在或字段缺失,用 Phase 1 的默认值
- 用 [nlohmann/json](https://github.com/nlohmann/json) 单 header 库做 JSON 解析(已是事实标准、CMake 友好)
- `Server/Main.cc` 在 `Server::init()` 前调用 `OpMode::load_from_disk("/etc/zorr/op-config.json")`

Dockerfile 不变(JSON 文件在 runtime mount,不在 image 里)。

#### Part B:Next.js admin 面板(新 repo `kanekanefy/zorr-admin`)

UI:
- 单页 dashboard
- 上面列出所有 OP_* 常量,每个一个 slider + 数字输入,显示默认值和当前值
- "Apply" 按钮 → 后端
- 下面一个区域显示:当前应用版本、上次 deploy 时间、deploy 历史最近 10 条

后端(Next.js API routes):
- `GET /api/config` — 从 GitHub 拉当前 `op-config.json`(via `gh api` 或直接 HTTPS raw)
- `POST /api/config` — 接受新值,本地生成 JSON,用 GitHub API 创建一个 commit(via PAT)推到 main
- `POST /api/deploy` — 调 Dokploy API 触发 redeploy(用我们 Phase 1 已经写好的 deploy 脚本逻辑)
- `GET /api/status` — 调 Dokploy API 拿 application 状态

鉴权:
- 单一密码,存在 `ADMIN_PASSWORD` env var
- iron-session 或类似:登录后 set httpOnly cookie

部署:
- 新 Dockerfile(Next.js `output: 'standalone'` 模式,~150MB 镜像)
- 新 Dokploy app `zorr-admin`,域名 `admin.zorr.inglegames.com`,Cloudflare 代理 + LE cert
- env vars 注入 Dokploy 面板:`GITHUB_TOKEN`(PAT,scope: repo)、`DOKPLOY_API_KEY`、`DOKPLOY_URL`、`ADMIN_PASSWORD`

### "Apply" 完整流程

1. Admin 拖 slider → 点 Apply
2. 面板 POST `/api/config` → 验证字段范围 → 调 GitHub API 提交 `op-config.json` 改动
3. 面板 POST `/api/deploy` → 等 GHA build(可选 poll)→ 调 Dokploy `application.deploy`
4. **总耗时 ~8-10 分钟**(主要花在 GHA 编译)
5. **优化**:如果只改 `op-config.json` 而 Dockerfile/source 没变,可以**跳过 GHA**,直接调 Dokploy 让它把新 JSON 作为环境注入,然后只重启容器(30 秒)。需要 Dokploy 支持"在不重 build 的情况下 update mount 内容"——细节待 Phase 2 实施时定。

### 安全考虑

- Admin URL 走 Cloudflare 代理,加 Cloudflare Access(可选,免费版有限制)
- 密码至少 16 字符随机
- 修改操作都 log 到 GitHub commit message(自带审计)
- 不在 admin 面板暴露任何敏感数据(不显示其他 env vars,不显示 Dokploy 内部 ID)

### 局限

- 还是不能"实时"改:得 push + rebuild(8-10 分钟)
- 单密码鉴权,没有多人权限模型(够用)

---

## Phase 3 — Bot 玩家(~2 周,独立大改 zorr)

### 目的
让单人或 2-3 人开服时,世界看起来像有几十个玩家在玩,**不依赖真人**。

### 架构

#### 服务端:Bot 实体

bot 复用现有 `Flower` 实体类型(避免给客户端增加新实体类型,客户端零改动)。

新增 `Server/Bot.hh/cc`:
- `Bot::spawn(Simulation*, int level)` — 创建一个 Flower 实体,标记 `bot = true`
- `Bot::tick(Bot&, Simulation*)` — 每 tick 给 bot 输出"假玩家输入"(移动方向、petal 旋转、攻击)
- 简单 FSM:
  - `Wandering`:随机游走,目标点每 5s 换
  - `Engaging`:发现 100 单位内的 mob → 朝 mob 移动 + 攻击(petal_rotation_speed up)
  - `Fleeing`:HP < 30% → 朝最近的 Easy zone 跑
  - `Dead`:5s 后在 spawn 区 respawn,装备随机洗
- Bot 装备表:按级别给递增稀有度的 petal(用 Phase 1 / 2 的 OP_XP_MULT 让 bot 也升级快)

#### Bot 控制器

`Server/BotManager.cc`:
- 维护期望 bot 数量(env var `BOT_COUNT` 或 op-config.json `bot_count`)
- 每 tick 检查:活的 bot < 目标数 → 补一个
- bot 名字:从一个名字池随机抽(`Bot_Glimmer`、`Bot_Petal`、`Bot_Ant`...)

#### 配置项加入 op-config.json

```json
{
  "bot_count": 20,
  "bot_min_level": 5,
  "bot_max_level": 80,
  "bot_combat_aggression": 0.5
}
```

Admin 面板(Phase 2)新增一个区域:bot 数量、bot 强度滑块。

#### 客户端:零改动

bot 用现有 Flower 实体协议,客户端把它当真玩家显示。Leaderboard 里 bot 自然出现。

### 风险

| 风险 | 缓解 |
|---|---|
| Bot AI 太傻反而搞笑 | FSM 简单,但合理。如果太弱可手调 aggression |
| Bot 消耗 CPU | 测下 20 个 bot 的 tick 耗时。可能要降到 10 个 |
| Bot 占满 leaderboard | 给 bot 名字加 `[B]` 前缀或 leaderboard 排序时给真人加权 |
| AGPL:bot 代码也是 zorr 仓库的 patch,公开 | 没问题,正好符合 AGPL |

### 局限

- AI 简单,不会"配合"真人玩家
- 不会模拟人类社交(没聊天)— gardn 本身就没聊天
- bot 死了会被踢出 leaderboard,直到 respawn(可接受)

---

## 范围外(三阶段都不做)

- 玩家账号 / 持久化(gardn 没有)
- 聊天系统
- 自定义 mob 类型(那是另一个大项目)
- 多服务器集群、跨服匹配
- Phase 3 的 bot 改造成 LLM 驱动("更智能"的 bot)— 太花哨
- 反作弊(私服不需要)

## 决策与开放问题

| 项 | 决定 |
|---|---|
| Phase 1 默认 multiplier 值 | 已给(LEVEL_DIV=10, XP=5, HP=2, PETAL_DMG=3, MOB_DMG=0.5, DROP=5, DENSITY=3, all slots=true)。**这些数你可能想第一次玩完后调,Phase 2 完成后变成 1 分钟的事** |
| Phase 2 是否做"无需 rebuild 的快速 reload" | 倾向做。30 秒 reload vs 10 分钟 rebuild,差 20x 体验提升 |
| Phase 3 bot 数量上限 | 默认 20。如果服务器 CPU 撑不住降到 10。Phase 3 实施时压测 |
| Phase 3 是否分零碎几个 spec | **是**。Phase 3 太大,届时单独立 spec(可能要拆"Bot AI 基础"、"Bot 装备体系"、"Bot 集成 Phase 2 面板"三个子 spec) |
| 三阶段建议顺序 | 1 → 2 → 3。**但本次只立 Phase 1 实施计划**,Phase 2/3 写出 spec 不写实施计划 |

## 验证(全程)

- Phase 1: 浏览器进游戏,挑 30 秒走完上面 6 条验收
- Phase 2: 在 admin 面板拖 slider 改 `OP_XP_MULT` 从 5 → 20,Apply,10 分钟后游戏里同样杀一只 mob,XP 变 4 倍
- Phase 3: 不上线真人,看 leaderboard 有 20 个 bot 名;开个真人号进去观察 bot 行为
