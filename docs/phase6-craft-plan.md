# Phase 6: Craft + Inventory 实施 Plan

> **背景**：参考 hornex sandbox（见 `docs/hornex-reference/`）建立"背包 + 锻造"系统。
> **关键约束**：gardn 现有 `PetalID` 是"1 id = 1 稀有度"绑定，没有 hornex 那种 79×9 矩阵。
> **决策已定**（与用户最后一轮 AskUserQuestion 同步）：
> 1. 扩 gardn 加同 petal 多稀有度变体（拒绝抽奖式简化）
> 2. Inventory +1 触发：**拾起就 +1**（详实历史）
> 3. Craft 成功率：温和阶梯 `[60, 45, 30, 20, 12, 6, 3]%`
> 4. Craft 失败：销毁 1-4 个（随机）
> 5. 存储：客户端 localStorage（emscripten 桥）

---

## 已完成（本 session）

- ✅ Patch 0008: 3 个新 mob (Jellyfish/Mushroom/BubbleMob)

## 未完成（下次 session 起点）

按依赖顺序：

### Patch 0009: Per-rarity petal 变体（基础设施）

**目标**：让 PETAL_DATA 支持 `Rose Common`、`Rose Unusual`、`Rose Rare` 这种同 petal 多档。

**改动文件**：
- `Shared/StaticDefinitions.hh` — `PetalID` 枚举追加 ~30 个新 ID
- `Shared/StaticData.cc` — `PETAL_DATA` 追加 ~30 条目，每条沿用原 petal stats 乘以稀有度倍率
- 新建 `Shared/PetalUpgrade.hh` — `(basePetalId, currentRarity) → nextRarityPetalId` 查找表
- `Shared/StaticData.cc` MOB_DATA — 修改主要怪 drops 以包含高稀有度版本

**选 5 个起步 petal 加 4 档**（每个 +4 = 20 新 ID）：
| Base | Common | Unusual | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Basic | (existing) | BasicUnusual | BasicRare | BasicEpic | BasicLegendary |
| Rose | (existing as Unusual) | – | RoseRare | RoseEpic | RoseLegendary |
| Stinger | (existing as Unusual) | – | StingerRare | StingerEpic | StingerLegendary |
| Faster | (existing as Rare) | – | – | FasterEpic | FasterLegendary |
| Leaf | (existing as Unusual) | – | LeafRare | LeafEpic | LeafLegendary |

**稀有度倍率**（用于 PetalData 字段的 base × multiplier）：
```cpp
constexpr float RARITY_HP_MULT[7]     = {1.0, 1.4, 2.0, 3.0, 4.5, 7.0, 12.0};
constexpr float RARITY_DMG_MULT[7]    = {1.0, 1.3, 1.8, 2.5, 3.8, 6.0, 10.0};
constexpr float RARITY_RELOAD_DIV[7]  = {1.0, 1.1, 1.25, 1.5, 1.8, 2.2, 3.0};
```

例：`Rose Rare` = base Rose stats but `health=14, damage=14, heal=18 (vs base 10)`.

**估时**：4-6 小时（大量手工建表 + 渲染共享 + 测试）

---

### Patch 0010: Inventory 持久化（客户端）

**目标**：用 localStorage 记录每个 (petalId, rarity) 的累计拾取数。

**改动文件**：
- `Client/Game.hh` — 加 `extern std::array<uint32_t, PetalID::kNumPetals> persistent_inventory;`
- `Client/Game.cc` — 每 tick 比较 `cached_loadout` 当前 vs 上一帧，新出现的 petal_id +1 进 persistent_inventory；调 EM_JS 写 localStorage
- 启动时从 localStorage 读取

**关键代码骨架**（EM_JS 桥）：
```cpp
EM_JS(void, save_inventory, (uint32_t* data, uint32_t len), {
    const arr = new Uint32Array(HEAP32.buffer, data, len);
    localStorage.setItem('zorr_inv', JSON.stringify(Array.from(arr)));
});

EM_JS(void, load_inventory, (uint32_t* data, uint32_t len), {
    const stored = localStorage.getItem('zorr_inv');
    if (!stored) return;
    const arr = JSON.parse(stored);
    const view = new Uint32Array(HEAP32.buffer, data, len);
    for (let i = 0; i < Math.min(arr.length, len); i++) view[i] = arr[i];
});
```

**估时**：2-3 小时

---

### Patch 0011: Inventory dialog UI

**目标**：玩家按 `I` 或点 HUD 图标打开背包，看 grid。

**改动文件**：
- 新建 `Client/Ui/Inventory.{hh,cc}` — 复用 `Container` + `ScrollContainer` 模式
- `Client/Game.cc` — 注册 'I' 快捷键
- HUD：右上角加 inventory icon button

**UI 元素**（参考 hornex `02-inventory.png`）：
- 网格 9 列 × N 行（每行一个 base petal，行内按稀有度排）
- 每格显示 petal sprite + 数量（`x50` / `x5k` / `x5m` 缩写）
- 0 数量的格灰掉
- 顶部 Wipe 按钮（debug 用）

**估时**：4-5 小时

---

### Patch 0012: Craft dialog + 逻辑

**目标**：玩家点 "Craft" 按钮打开锻造界面。

**逻辑**：
```cpp
// Pseudo:
constexpr float SUCCESS_RATE[7] = {0.60, 0.45, 0.30, 0.20, 0.12, 0.06, 0.03};

bool try_craft(PetalID::T base_id, uint8_t rarity) {
    if (persistent_inventory[base_id_at_rarity(base_id, rarity)] < 5) return false;
    persistent_inventory[base_id_at_rarity(base_id, rarity)] -= 5;
    if (randf() < SUCCESS_RATE[rarity]) {
        persistent_inventory[base_id_at_rarity(base_id, rarity + 1)] += 1;
        return true;
    } else {
        uint8_t destroyed = 1 + rand() % 4;  // 1-4
        // Note: we already subtracted 5; "destroyed" means 5-destroyed get refunded
        persistent_inventory[base_id_at_rarity(base_id, rarity)] += (5 - destroyed);
        return false;
    }
}
```

**UI 元素**（参考 hornex `03-craft.png`）：
- 上半屏：5 槽五边形围中心结果槽 + Craft 按钮 + "?% success rate" 文本
- 下半屏：9 列网格选择 base petal × rarity，点击放进 5 槽
- "Combine 5 of the same petal" 提示
- 失败动画 + log
- 成功 result canvas scale(0)→1.2→1 弹动

**估时**：6-8 小时

---

## 总时间估计

| Patch | 内容 | 估时 |
|---|---|---|
| 0009 | Per-rarity petal 变体 | 4-6h |
| 0010 | Inventory 持久化 | 2-3h |
| 0011 | Inventory dialog UI | 4-5h |
| 0012 | Craft dialog + 逻辑 | 6-8h |
| **总** | | **16-22h** |

= **2-3 个全职 dev 工作日**。这是为什么本 session 装不下。

---

## 法律/版权回顾

- ✅ 抄设计模式 / 数值公式 / UI 范式：合规
- ✅ 用 hornex `petal-atlas.png` 作**视觉风格参考**：合规  
- ⚠️ **不要 commit `petal-atlas.png` 进 zorr 仓库的运行时**（设计参考 OK，运行时美术应自绘）
- ⚠️ 命名建议本土化（"Rose Legendary" → 重起中文名）

---

## 下次 session 启动 prompt

> "继续 phase 6 craft。从 `docs/phase6-craft-plan.md` Patch 0009 开始：
> 1. 加 5 个 base petal × 4 档变体到 PETAL_DATA
> 2. 用倍率表生成 stats
> 3. 加 `PetalUpgrade::next_rarity_id()` 查找
> 4. 修改 ~3 个常见 mob 的 drops 包含高档变体
> 生成 patch 0009 跑 dry-run 验证。"
