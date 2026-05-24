# AGENTS.md — 给下一个接手者(人或 AI)

> 这个文件是"如果你是新来的 AI agent 或开发者,请先读这个"。README.md 是给**外部访客**看的;AGENTS.md 是给**修改这个项目的人**看的。两者不重叠。
>
> 平台兼容:Claude Code 会自动读 `CLAUDE.md`,Codex 会读 `AGENTS.md`,OpenCode/OpenClaw 同。本文件兼任两种角色——`CLAUDE.md` 是 symlink 或副本。

## TL;DR(30 秒看完)

1. **项目结构**:gardn (florr.io 克隆) submodule + `patches/*.patch` 是我们所有的改动。修改流程见下方"Patch workflow"。
2. **部署**:`git push origin main` 就够了。GHA 跑 ~1-3 分钟后 Dokploy 自动滚到新镜像。
3. **代码踩坑**:gardn 的 Renderer 用 `bcurve_to / partial_arc`(不是 Canvas2D 同名 API);Style designator 必须按声明顺序;`MobID::kBubble*` 注意和 `PetalID::kBubble` 命名冲突。
4. **不要 commit** `docs/hornex-reference/`(本地参考研究,含别人的 wasm)和 `deploy/.secrets`(API key)。
5. **沟通**:用户在这个项目里偏好中文回复(global CLAUDE.md 说 English,project memory 覆盖为中文)。

---

## Patch workflow(最重要的一节)

所有改动 → patch 文件。**绝不直接 commit `upstream/gardn/` 改动**——submodule 必须 pristine。

### 加一个新 patch(完整流程)

```bash
# 1. 进 submodule,验证 clean
cd upstream/gardn
git status --short    # 必须空

# 2. 按 patches/ 文件名顺序 apply 已有 patches,得到当前 working state
for p in ../../patches/0001*.patch ../../patches/0002*.patch \
         ../../patches/0003*.patch ../../patches/0004*.patch \
         ../../patches/0005*.patch ../../patches/0006*.patch \
         ../../patches/0007*.patch ../../patches/0008*.patch \
         ../../patches/0009*.patch ../../patches/0010*.patch; do
  patch -p1 --silent < "$p" >/dev/null 2>&1
done

# 3. 在 working tree 里做你的修改(Edit/Write 各种文件)
vim Shared/StaticData.cc  # 或随便什么

# 4. ★ 关键步骤:生成"只包含你这次改动"的 diff —— stash + reset + reapply + pop 法
git add -A
git stash push -m "wip"
git reset --hard HEAD
git clean -fdx
# 重新 apply 已有 patches 作为 baseline
for p in ../../patches/0001*.patch .. (同上); do patch -p1 --silent < "$p"; done
git add -A
git commit -m "tmp: baseline" --no-verify
# Pop stash 在 baseline 之上
git stash pop
# (如果 stash 和 baseline 在同一行冲突,git checkout --theirs <冲突文件>)
git add -A
# 现在 git diff --cached 就是"只有这次改动"
git diff --cached --no-color > /tmp/patch.patch

# 5. 保存为新 patch
cp /tmp/patch.patch ../../patches/NNNN-short-name.patch

# 6. 验证:revert + 单独 apply 应该干净
git reset --hard HEAD~1
git clean -fdx
for p in ../../patches/0001*.patch .. ../../patches/000(N-1)*.patch; do patch -p1 --silent < "$p"; done
patch -p1 --dry-run < ../../patches/NNNN-*.patch    # 必须无 reject

# 7. 还原 submodule 到 pristine,再 commit 顶层 repo
git reset --hard HEAD
git clean -fdx
cd ../..
git add patches/NNNN-*.patch patches/README.md   # 更新 patches/README.md 加新词条!
git commit -m "feat: ..."
git push    # 触发自动 deploy
```

如果中间打断,跑 `cd upstream/gardn && git reset --hard HEAD && git clean -fdx` 还原。

### 不要这样做

- ❌ 直接 `git diff > new.patch` —— 会包含**所有先前 patch 的内容**,变成超大重复
- ❌ commit submodule 里的改动 —— `upstream/gardn` 必须保持 pristine
- ❌ 在没 apply 之前的 patches 就开始改 —— 你的 context line 会和 0001-0008 之后的状态不匹配,patch 7→8 重叠时会 reject

---

## gardn 代码踩坑速查

这些是我(上一个 agent)从编译报错里学来的,新人写代码时容易踩。

### Renderer API ≠ Canvas2D

gardn 的 `Client/Render/Renderer.hh` 用了和 Canvas2D **同义但不同名**的方法:

| Canvas2D | gardn Renderer |
|---|---|
| `bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)` | `bcurve_to(cp1x, cp1y, cp2x, cp2y, x, y)` |
| `quadraticCurveTo(cx, cy, x, y)` | `qcurve_to(cx, cy, x, y)` |
| `arc(x, y, r, start, end, ccw)` | `partial_arc(x, y, r, start, end, ccw)` |
| `arc(x, y, r)` (full circle) | `arc(x, y, r)` |
| `save() / restore()` | **不存在** — 用 translate/scale 后手动还原,或依赖 Element 间隔离 |

### Style designator 必须按声明顺序

`struct Style` 字段声明顺序是:`fill, stroke_hsv, line_width, round_radius, animate, should_render, h_justify, v_justify, layer, no_animation, no_polling`。ISO C++ 要求 designated init 必须按这个顺序写,否则报错。**特别注意 `.should_render` 在 `.h_justify` 之前**——很反直觉。

```cpp
// ❌ 编译错误
new HContainer({}, 0, 6, { .h_justify = Style::Left, .should_render = ... });
// ✅
new HContainer({}, 0, 6, { .should_render = ..., .h_justify = Style::Left });
```

### Button callback 不能 capture

`Button(w, h, child, void(Element*,uint8_t), bool(void)=nullptr, Style={})` 的两个回调参数是**函数指针**,不是 `std::function`。带 capture 的 lambda 转换失败。

如果回调要带状态,用全局 map 间接索引(参考 `Client/Ui/TitleScreen/Craft.cc` 里 `g_craft_rarity_map`)。

### Anonymous namespace 里的 `extern` 是陷阱

```cpp
// 文件顶部:在全局(文件)scope 定义
void register_craft_button(Element *, uint8_t);

namespace {
  // ❌ 内部 linkage,链接失败
  void some_fn() {
    extern void register_craft_button(Element *, uint8_t);  // 变成 anon-ns 内 decl
    register_craft_button(btn, 0);
  }
  // ✅ 直接调,unqualified lookup 会找到全局
  void some_fn() {
    register_craft_button(btn, 0);
  }
}
```

### MobID / PetalID 同名陷阱

`MobID` 和 `PetalID` 是不同 namespace,理论上 `MobID::kBubble` 和 `PetalID::kBubble` 可以共存。但**人眼会混淆**。约定:mob 加 `Mob` 后缀(`kBubbleMob`)如果和已有 petal 同名。已发生:patch 0008。

### 数据结构字段速查

- `MobData` (`Shared/StaticDefinitions.hh:245`):name, description, rarity, health(RangeValue), damage, radius(RangeValue), xp, drops(StaticArray<PetalID, 6>), attributes(MobAttributes)
- `MobAttributes`:aggro_radius=500, segments=1, stationary, poison_damage(PoisonDamage)
- `PoisonDamage`:damage, time
- `MAX_DROPS_PER_MOB = 6`
- Rarities:`kCommon, kUnusual, kRare, kEpic, kLegendary, kMythic, kUnique`(7 档)
- Zone weight `0` = 不在该区域 spawn。**新 mob 必须在至少 1 个 zone 出现**,否则 `MOB_SPAWN_RATES[id] = 0` 在 `MOB_DROP_CHANCES` 计算时除零

---

## "加一个 X" 食谱

### 加一个新 mob

```
1. Shared/StaticDefinitions.hh   → MobID 枚举尾 + 新 ID
2. Shared/StaticData.cc          → MOB_DATA 末尾追加 entry
3. Shared/StaticData.hh          → 至少 1 个 zone 的 spawns 加 weight
4. Client/Assets/Mob.cc          → draw_static_mob 加 case
                                   (用 partial_arc/bcurve_to 真 API)
```
参考 patch 0007 (Starfish)、patch 0008 (Jellyfish/Mushroom/BubbleMob)。

### 加一个新 dialog panel

```
1. Client/Ui/Extern.hh           → Panel:: enum 加新 ID + extern Element *
2. Client/Ui/Extern.cc           → 定义 Element *xxx = nullptr
3. Client/Ui/TitleScreen/TitleScreen.hh → 声明 Element *make_xxx_panel()
4. Client/Ui/TitleScreen/Xxx.cc  → 实现(参考 Inventory.cc / Craft.cc)
5. Client/Ui/TitleScreen/MainScreen.cc::make_panel_buttons → 加 Button
6. Client/Game.cc::init()         → title_ui_window.add_child(make_xxx_panel())
7. Client/CMakeLists.txt         → 加 Ui/TitleScreen/Xxx.cc
```
参考 patch 0009。

### 持久化客户端状态

走现成的 `Client/Storage.cc` STORED macro。加一行到 `#define STORED \\` 表,再加 retrieve/set 块。不要直接写 localStorage——已有的 `StorageProtocol::store/retrieve` 做 b16 编码 + XOR(对抗 user 手动改 storage)。

---

## 部署

`git push origin main` 自动触发:
1. GHA workflow `.github/workflows/build-and-push.yml`
2. emscripten build (~1-3 min,有 cache)
3. push to `ghcr.io/kanekanefy/zorr:latest`
4. 最后一步 curl POST `$DOKPLOY_WEBHOOK_URL` 触发 Dokploy redeploy

webhook URL 在 repo secret `DOKPLOY_WEBHOOK_URL`,格式 `https://dok.inglegames.com/api/deploy/<application-refreshToken>`。token 在 Dokploy UI → Application → Settings → Auto Deploy。

### 跳过 deploy(2026-05-24 加)

**默认跳过**:`paths-ignore` 在 workflow trigger 层就过滤了 `**.md`、`docs/**`、`LICENSE-NOTICE.md`、`.gitignore`、`UPSTREAM_PIN.txt`——纯文档 push 不会跑 build,不会触发 redeploy。

**显式跳过**(代码改了但不想 deploy):commit message 加 `[skip ci]`。

**强制 deploy**(没代码改但想重新滚一次):Actions UI → "Run workflow",或 `gh workflow run build-and-push.yml --ref main`。

详情:[`deploy/README.md`](deploy/README.md)。

---

## 反向工程参考(本地 only)

`docs/hornex-reference/`(**gitignored,不入仓库**)是上一轮研究 sandbox.hornex.pro 的产物,包含:
- 那个游戏的 wasm + sprite atlas(别人的代码 + 美术)
- 设计文档(7 篇 design-notes,含 craft/inventory/mob AI/rarity 经济等)
- runtime 内存 dump 提取的 changelog + 192 个真字段名

合规说明:这些是**学习/灵感参考**,不能 redistribute。已经 gitignored。如果你需要查询,本地路径 `docs/hornex-reference/README.md` 是入口。Phase 6 (patches 0008+0009) 的设计来自这里。

---

## 已知小尾巴

- **GHA Node 20 deprecation**:2026-06-02 前 bump `actions/checkout@v4` 等到最新版,否则 workflow 会被强制升 Node 24。不紧急但留个 TODO。
- **GameInstance + bot AI 性能**:Phase 5 加到 30 bots 时没做 profile。如果未来加到 50+ 可能要看 spatial_hash 命中率。
- **客户端 inventory 不去重**:patch 0009 v1 的 +1 触发是 "loadout slot 出现新 petal 即+1",所以反复装备/卸下同一个会重复加。可接受但下一版可加 dedupe(比如 5 秒内同 id 同 slot 不重计)。
- **craft 失败用 `frand() * 4` 计算 destroyed**——理论上 4.0 时会变 4,我用 `if > 4 then 4` 兜底,实际几率几乎为 0。如果有 RNG 洁癖可改用 `1 + int(frand() * 4)`。

---

## 历史 phase 速览

| Phase | 内容 | Patches |
|---|---|---|
| Phase 1 | 部署 Dokploy + 镜像流水线 | (基础设施,无 patch) |
| Phase 2 | Super Fun Mode + 起手装 | 0004, 0005 |
| Phase 3 | Bot 系统(15→后续扩 30) | 0006 |
| Phase 4 | 新怪 pipeline 验证:Starfish | 0007 |
| Phase 5A/B | 数值调优 + Bot AI 增强 + tier drops | 0004/0006 update |
| **Phase 6** | **3 新怪 + craft + inventory + auto-deploy webhook** | **0008, 0009** + CI |

下一步可能:Phase 7 = wave/boss mode? 多人语音? PvP zones? 看 `docs/phase6-craft-plan.md` 末尾"还没做完"那段。
