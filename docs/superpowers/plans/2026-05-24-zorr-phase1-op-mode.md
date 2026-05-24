# zorr Phase 1 — OP Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个补丁文件 + push → 10 分钟后 zorr 上线 OP 模式(升级快、血厚、伤害高、掉率高、怪多)。

**Architecture:** 新增 `Shared/OpMode.hh` 集中放 8 个 `inline constexpr` multiplier 常量。在 4 个 .cc 文件的 8 处 call site 应用这些常量(乘法或条件分支)。打包成单个 `patches/0004-op-mode.patch`,由 Dockerfile 构建时 `patch -p1` 应用,跟现有 3 个 cosmetic patch 同列。

**Tech Stack:** C++20 / Emscripten / WASM / 现有 GHA → GHCR → Dokploy 流水线(Phase 0 已建)

**Spec**: `docs/superpowers/specs/2026-05-24-zorr-game-progression-and-admin-design.md` (Phase 1 section)

**Pre-conditions**(本次开始时已为真):
- `upstream/gardn` 已 pin 到 commit `86fcec609cae059e950781c70dae62dee31de58d`
- `patches/0001..0003` 已存在并能干净 apply
- `Dockerfile` 已经包含通用 patch-apply 循环(`for p in /patches/*.patch; do patch -p1 < "$p"; done`)
- GHA 工作流 `build-and-push.yml` 监听 push to main → 推 GHCR
- `deploy/dokploy-deploy.sh` 幂等,重跑只是触发 redeploy

---

## File Structure(本计划完成后)

```
zorr/
├── patches/
│   ├── 0001-add-title-and-rebrand.patch         (existing)
│   ├── 0002-client-ws-url-from-location.patch   (existing)
│   ├── 0003-map-background-color.patch          (existing)
│   ├── 0004-op-mode.patch                       (NEW — this plan)
│   └── README.md                                (UPDATED — add row for 0004)
└── (everything else unchanged)
```

补丁 0004 内含 5 个文件改动:
- **新增**: `Shared/OpMode.hh`(全部 multiplier 常量)
- **改动**: `Shared/StaticData.cc`(include + 3 处函数体)
- **改动**: `Server/EntityFunctions/Damage.cc`(include + 1 处插入)
- **改动**: `Server/EntityFunctions/Death.cc`(include + 2 处)
- **改动**: `Shared/Map.cc`(include + 1 处)

---

## Task 1: 写 0004-op-mode 补丁,本地 dry-run 验证

**Files:**
- Create: `patches/0004-op-mode.patch`
- Modify: `patches/README.md`(加一行第 0004 行说明)

- [ ] **Step 1: 生成补丁(已用 git-diff 方法生成,见 patches/0004-op-mode.patch)**

**注意:本计划在 authoring 阶段已经用更稳的"git diff 生成法"产出 patch,而不是手工编辑 `@@` 行号(那样太容易错位)。**生成过程:

```bash
# 1. 在 upstream/gardn 工作树里直接 edit 5 个文件应用所有修改
# 2. git add -N Shared/OpMode.hh(让新文件出现在 diff 里)
# 3. git diff > ../../patches/0004-op-mode.patch
# 4. git checkout . && rm Shared/OpMode.hh(还原工作树,patch 是唯一真相)
```

如果未来要重新生成或修改 patch,重复上述流程。

完整 patch 内容(已落盘到 `patches/0004-op-mode.patch`):

```diff
diff --git a/Shared/OpMode.hh b/Shared/OpMode.hh
new file mode 100644
--- /dev/null
+++ b/Shared/OpMode.hh
@@ -0,0 +1,21 @@
+#pragma once
+
+// zorr OP-Mode tunables — Phase 1: compile-time constants.
+// Phase 2 will replace these with values loaded from /etc/zorr/op-config.json.
+
+namespace OpMode {
+    // Leveling
+    inline constexpr float LEVEL_DIV = 10.0f;        // XP-to-next-level divided by this
+    inline constexpr float XP_MULT = 5.0f;           // XP awarded per kill * this
+    inline constexpr bool  ALL_SLOTS_FROM_START = true;
+
+    // Survivability
+    inline constexpr float HP_MULT = 2.0f;           // Flower HP * this
+    inline constexpr float PETAL_DMG_MULT = 3.0f;    // Petal-to-mob damage * this
+    inline constexpr float MOB_DMG_MULT = 0.5f;      // Mob-to-flower damage * this
+
+    // Economy
+    inline constexpr float DROP_MULT = 5.0f;         // Drop chance * this
+    inline constexpr float DENSITY_MULT = 3.0f;      // Mob density * this
+}
--- a/Shared/StaticData.cc
+++ b/Shared/StaticData.cc
@@ -1,4 +1,5 @@
 #include <Shared/StaticData.hh>
+#include <Shared/OpMode.hh>
 
 #include <cmath>
 
@@ -1102,7 +1103,9 @@
 }
 
 uint32_t score_to_pass_level(uint32_t level) {
-    return (uint32_t)(pow(1.06, level - 1) * level) + 3;
+    uint32_t raw = (uint32_t)(pow(1.06, level - 1) * level) + 3;
+    uint32_t scaled = (uint32_t)(raw / OpMode::LEVEL_DIV);
+    return scaled < 1 ? 1 : scaled;
 }
 
 uint32_t score_to_level(uint32_t score) {
@@ -1120,6 +1123,7 @@
 }
 
 uint32_t loadout_slots_at_level(uint32_t level) {
+    if (OpMode::ALL_SLOTS_FROM_START) return MAX_SLOT_COUNT;
     if (level > MAX_LEVEL) level = MAX_LEVEL;
     uint32_t ret = 5 + level / LEVELS_PER_EXTRA_SLOT;
     if (ret > MAX_SLOT_COUNT) return MAX_SLOT_COUNT;
@@ -1128,5 +1132,5 @@
 
 float hp_at_level(uint32_t level) {
     if (level > MAX_LEVEL) level = MAX_LEVEL;
-    return BASE_HEALTH + level;
+    return (BASE_HEALTH + level) * OpMode::HP_MULT;
 }
--- a/Server/EntityFunctions/Damage.cc
+++ b/Server/EntityFunctions/Damage.cc
@@ -1,5 +1,6 @@
 #include <Server/EntityFunctions.hh>
 
+#include <Shared/OpMode.hh>
 #include <Server/Spawn.hh>
 #include <Shared/Entity.hh>
 #include <Shared/Simulation.hh>
@@ -22,6 +23,15 @@
     if (!sim->ent_alive(def_id)) return;
     Entity &defender = sim->get_ent(def_id);
     if (!defender.has_component(kHealth)) return;
+    // zorr OpMode: scale damage by attacker/defender type
+    if (sim->ent_exists(atk_id)) {
+        Entity const &attacker_peek = sim->get_ent(atk_id);
+        bool a_petal  = attacker_peek.has_component(kPetal);
+        bool a_mob    = attacker_peek.has_component(kMob);
+        bool d_flower = defender.has_component(kFlower);
+        bool d_mob    = defender.has_component(kMob);
+        if (a_petal && d_mob)        amt *= OpMode::PETAL_DMG_MULT;
+        else if (a_mob && d_flower)  amt *= OpMode::MOB_DMG_MULT;
+    }
     DEBUG_ONLY(assert(!defender.pending_delete);)
     DEBUG_ONLY(assert(defender.has_component(kHealth));)
     if (defender.immunity_ticks > 0) return;
--- a/Server/EntityFunctions/Death.cc
+++ b/Server/EntityFunctions/Death.cc
@@ -1,5 +1,6 @@
 #include <Server/EntityFunctions.hh>
 
+#include <Shared/OpMode.hh>
 #include <Server/PetalTracker.hh>
 #include <Server/Spawn.hh>
 
@@ -43,7 +44,7 @@
     if (!sim->ent_alive(killer_id)) return;
     Entity &killer = sim->get_ent(killer_id);
     if (killer.has_component(kFlower) || killer.has_component(kPetal))
-        killer.set_score(killer.get_score() + target.score_reward);
+        killer.set_score(killer.get_score() + (uint32_t)(target.score_reward * OpMode::XP_MULT));
 }
 
 void on_entity_dies(Simulation *sim, EntityID const ent_id) {
@@ -72,7 +73,7 @@
         {
             uint32_t total_drops = 0;
             for (uint32_t i = 0; i < mob_data.drops.size(); ++i) 
-                if (frand() < drop_chances[i]) success_drops.push_back(mob_data.drops[i]);
+                if (frand() < drop_chances[i] * OpMode::DROP_MULT) success_drops.push_back(mob_data.drops[i]);
                 else if (success_drops.size() == 0 && drop_chances[i] > best_drop_chance) {
                     best_drop_chance = drop_chances[i];
                     best_drop_id = mob_data.drops[i];
--- a/Shared/Map.cc
+++ b/Shared/Map.cc
@@ -1,4 +1,5 @@
 #include <Shared/Map.hh>
+#include <Shared/OpMode.hh>
 
 #ifdef SERVERSIDE
 #include <Server/Spawn.hh>
@@ -43,7 +44,7 @@
 void Map::spawn_random_mob(Simulation *sim, float x, float y) {
     uint32_t zone_id = Map::get_zone_from_pos(x, y);
     struct ZoneDefinition const &zone = MAP_DATA[zone_id];
-    if (zone.density * (zone.right - zone.left) * (zone.bottom - zone.top) / (500 * 500) < sim->zone_mob_counts[zone_id]) return;
+    if (zone.density * OpMode::DENSITY_MULT * (zone.right - zone.left) * (zone.bottom - zone.top) / (500 * 500) < sim->zone_mob_counts[zone_id]) return;
     float sum = 0;
     for (SpawnChance const &s : zone.spawns)
         sum += s.chance;
```

**关键确认点**(在写 patch 前 grep 验证):
- `Shared/StaticData.cc:1104` 应该是 `uint32_t score_to_pass_level(uint32_t level) {`
- `Shared/StaticData.cc:1119` 应该是 `uint32_t loadout_slots_at_level(uint32_t level) {`
- `Shared/StaticData.cc:1128` 应该是 `float hp_at_level(uint32_t level) {`
- `Server/EntityFunctions/Damage.cc:20` 应该是 `void inflict_damage(Simulation *sim, ...)`
- `Server/EntityFunctions/Death.cc:46` 应该是 `killer.set_score(killer.get_score() + target.score_reward);`
- `Server/EntityFunctions/Death.cc:75` 应该是 `if (frand() < drop_chances[i]) success_drops...`
- `Shared/Map.cc:46` 应该是 `if (zone.density * (zone.right - zone.left)...`

如果哪行对不上(上游 commit 漂移),`patch --dry-run` 会报 `Hunk #N succeeded at LINE (offset X lines)` 或 `FAILED`,前者无害,后者需要手调 `@@` 上下文。

- [ ] **Step 2: dry-run 验证 patch**

```bash
cd upstream/gardn
patch -p1 --dry-run < ../../patches/0004-op-mode.patch
cd ../..
```

Expected 输出:5 个文件的 `Hunk #N succeeded`(可能带 small offset),**没有任何 FAILED 或 rejected**。如果有 FAILED,根据报错的 line 调整 `@@ -X,Y +X,Y @@` 头里的行号或修正上下文 3 行,然后重跑 dry-run 直到全绿。

- [ ] **Step 3: 更新 patches/README.md**

在 `patches/README.md` 表格里加一行(放在 0003 那行下面):

```markdown
| 0004 | `op-mode.patch` | OP Mode:升级快/血厚/伤害高/掉率高/怪多。8 个 multiplier 集中在 `Shared/OpMode.hh`,Phase 2 会改成运行时配置 |
```

- [ ] **Step 4: commit**

```bash
git add patches/0004-op-mode.patch patches/README.md
git commit -m "feat: patch 0004 OP-mode (faster leveling, HP×2, dmg×3, drop×5, density×3)"
```

Expected: commit 成功,`git log --oneline | head -2` 顶部是这个 commit。

---

## Task 2: push 触发 GHA build,等出新镜像

**Files:** 无(纯 CI/CD 流程)

- [ ] **Step 1: push 到 main 触发 GHA**

```bash
git push origin main
```

Expected: `<old>..<new>  main -> main`,无 error。

- [ ] **Step 2: 找到刚触发的 run id**

```bash
sleep 5
gh run list --repo kanekanefy/zorr --limit 3
```

Expected: 顶部第一行是 status=`in_progress`,workflow=`Build and Push`,event=`push`,commit message 是 Task 1 commit 的 message。记下 run ID(数字)。

- [ ] **Step 3: 后台 watch GHA build,等 ~5-8 分钟**

```bash
gh run watch <RUN_ID> --repo kanekanefy/zorr --exit-status
```

(用 `run_in_background: true`,不阻塞。)

GHA 完成后会通知。Expected:exit code 0(绿勾)。如果失败:
- 看哪一步挂的:`gh run view --log --job=$(gh run view <RUN_ID> --json jobs -q .jobs[0].databaseId)`
- 最常见的失败:patch 应用失败 → 回 Task 1 Step 2 修 patch → 重跑
- 编译失败 → 看 cmake/make 输出,可能是 OpMode.hh include 路径错或 namespace 名字打错

- [ ] **Step 4: 验证新镜像在 GHCR**

```bash
TOKEN=$(curl -sS "https://ghcr.io/token?service=ghcr.io&scope=repository:kanekanefy/zorr:pull" | jq -r .token)
curl -sS -H "Authorization: Bearer $TOKEN" \
     -H "Accept: application/vnd.oci.image.index.v1+json" \
     "https://ghcr.io/v2/kanekanefy/zorr/manifests/latest" \
  | jq -r '"\(.mediaType)  manifests: \(.manifests | length)"'
```

Expected: 输出 `application/vnd.oci.image.index.v1+json  manifests: 2`(或 1,无所谓数量,关键 mediaType 正常)。

Bonus:对比 image digest 跟上次部署的 digest 不同(确认是新版):

```bash
curl -sS -I -H "Authorization: Bearer $TOKEN" \
     -H "Accept: application/vnd.oci.image.index.v1+json" \
     "https://ghcr.io/v2/kanekanefy/zorr/manifests/latest" \
  | grep -i docker-content-digest
```

记下这个 digest 备用。

---

## Task 3: 触发 Dokploy redeploy + 等容器换新

**Files:** 无

- [ ] **Step 1: 跑 deploy 脚本(幂等,只触发 redeploy)**

```bash
DOKPLOY_URL=https://dok.inglegames.com \
DOKPLOY_API_KEY=<your-key> \
./deploy/dokploy-deploy.sh
```

Expected: 输出 5 个 `[N/5]` 步骤都成功,末尾有 summary 含 `applicationId: g9-sgDp9fx5CCh2FkkPTB` 和 `url: https://zorr.inglegames.com`。注意 step `[1/5]` 应显示 `reusing project G0R-3yV2FDZSTW1atGErl`(不是 created),`[2/5]` 显示 `reusing application g9-sgDp9fx5CCh2FkkPTB`,`[4/5]` 显示 `reusing https://zorr-...sslip.io`。

- [ ] **Step 2: 用 Monitor 等容器拉新镜像并起来(~30-60 秒)**

```bash
ssh ubuntu@lax-02 \
  'until sudo docker inspect $(sudo docker ps -q --filter "name=zorr") 2>/dev/null | jq -e ".[0].State.Status == \"running\" and (now - (.[0].State.StartedAt | fromdate) < 60)" >/dev/null; do sleep 3; done; echo "READY"; sudo docker logs --tail 5 $(sudo docker ps -q --filter "name=zorr")'
```

Expected: 输出 `READY` 后跟 5 行 `tick took ...ms` 类似的日志 —— 表示新容器起来并在跑 game loop。

如果 30 秒后还看不到 `READY`:
- 看 Dokploy UI 的 deploy log:`https://dok.inglegames.com/projects/G0R-3yV2FDZSTW1atGErl`
- 看容器 startup log:`ssh ubuntu@lax-02 'sudo docker logs $(sudo docker ps -aq --filter "name=zorr") | tail -50'`

- [ ] **Step 3: 验证容器跑的就是新镜像**

```bash
ssh ubuntu@lax-02 'sudo docker inspect $(sudo docker ps -q --filter "name=zorr") | jq -r ".[0].Image"'
```

Expected: 输出 `sha256:...`,这个 sha 应该跟 Task 2 Step 4 记下的 digest 对应。

如果 sha 没变(还是旧镜像),Dokploy 可能没真去 pull。再跑一次 Task 3 Step 1 触发,或在 Dokploy UI 上点 Force Pull + Redeploy。

- [ ] **Step 4: HTTPS 烟雾测试**

```bash
curl -sS -o /tmp/zorr-new.html -w "HTTP %{http_code}, size %{size_download}\n" "https://zorr.inglegames.com/"
grep -E "title|zorr" /tmp/zorr-new.html | head -3
```

Expected: `HTTP 200, size <某值>`,且 HTML 包含 `<title>zorr</title>`。如果 200 但 HTML 是 nginx default page → 容器没起来,回到 Step 2。

---

## Task 4: 浏览器验证 6 条体感

**Files:** 无(纯人工 QA)

- [ ] **Step 1: 浏览器打开游戏**

```
打开 https://zorr.inglegames.com
输入随便一个 name → Spawn
```

- [ ] **Step 2: 验证"升级飞快"**

打杀几只 Easy 区(地图最左侧)的 ladybug 或 bee。

Expected: **30 秒内升 5+ 级**,屏幕左下角 level 数字快速跳。打杂兵之前(原版)要打几十只才升一级,现在 1-2 只就升。

如果升级感觉没变快 → `OpMode::LEVEL_DIV` 或 `XP_MULT` 没生效。检查:
- `gh run view --log` 看 Death.cc 是否编译有警告
- 容器日志看是否真的拉了新镜像

- [ ] **Step 3: 验证"槽位全开"**

进游戏第 1 秒,看上面的装备栏。

Expected: **8 个 active 槽 + 8 个备选槽全亮**(原版 1 级只有 5 个 active)。

- [ ] **Step 4: 验证"血厚"**

让一只杂兵打你 1-2 下。

Expected: HP 条只掉 10-20%(原版 1 级一只 ladybug 几下就秒)。

- [ ] **Step 5: 验证"打怪伤害高"**

朝一只 Easy 区的 mob 撞过去用 basic petal 打它。

Expected: **1-2 下秒杀**(原版要 5-10 下)。

- [ ] **Step 6: 验证"掉率高"**

杀 5 只 mob。

Expected: **至少 2-3 个 drop**(原版 Easy 区掉率 0.3,杀 10 只才出 3 个 drop)。

- [ ] **Step 7: 验证"怪多"**

环顾屏幕。

Expected: 屏幕里随时能看到 **5-10+ 个 mob**(原版能看到 2-4 个)。走到地图边缘 Easy 区中心看,**全图密密麻麻**。

- [ ] **Step 8: 验证"怪伤害低"**

故意被一只 Hard 区或 ??? 区的强 mob 撞几下。

Expected: HP 掉得明显比预期慢 —— 原本被秒的怪现在你能扛 3-5 下。

- [ ] **Step 9: 如果有任何一条不对**

写一份简短的"调整意见"给下一轮 iteration:
- 哪个 multiplier 太大 / 太小
- 建议调到多少
- 这个会进入 Phase 2 admin 面板的 slider 默认值讨论

---

## Rollback(如果整个上线翻车)

```bash
git revert HEAD --no-edit
git push origin main
# 等 GHA 重 build 上个镜像,Dokploy 自动 redeploy
./deploy/dokploy-deploy.sh   # 加速 redeploy
```

或者直接在 Dokploy UI 上 rollback 到上一个镜像 tag(`sha-<上一个 commit 短哈希>`),不需要重 build。

---

## 完成定义

- [ ] `patches/0004-op-mode.patch` 在 main 分支上
- [ ] GHA 绿勾,GHCR 上有新 digest 的 `:latest`
- [ ] Dokploy 上的 zorr container 跑的就是新 digest
- [ ] 浏览器进游戏,Task 4 的 6 条验收全部通过
- [ ] (可选)如果数值想调,记到 spec 的"Phase 2 默认值"草稿里
