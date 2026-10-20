# Character Studio —— 数据格式与存储

> 用途：改数据模型、导入导出、备份兼容或存储迁移前读这一份。
> 事实来源：`src/types/`、`src/storage/`、`src/utils/importExport.ts`、`src/utils/importPlan.ts`。
> 最近核对：2026-10-19（2.37.1）。

---

## 1. 四个数据域

角色、关系、时间线、世界观是四个独立集合。关系与世界观不内嵌在角色里，避免同一事实存两份后各自漂移。

### 1.1 Character（`src/types/character.ts`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，导入冲突时的判断依据 |
| `name` | string | 角色名 |
| `avatarEmoji` | string? | Emoji 头像 |
| `avatarAssetId` | string? | 指向 IndexedDB 头像素材的 ID（不是文件路径） |
| `favorite` / `isFavorite` | boolean? | 收藏（历史字段并存，读取时兼容） |
| `isDraft` / `draftOfId` | boolean? / string? | 草稿标记与来源角色 |
| `age` / `birthDate` / `birthYear` | string? | 年龄与生日，三者可只填其一 |
| `gender` / `species` / `occupation` / `worldview` | string? | 基础档案 |
| `tags` | `{ id, name, color? }[]` | 显示标签 |
| `personalityTags` | string[] | 性格标签，可自定义 |
| `appearanceDescription` / `abilityDescription` / `backstory` | string? | 长文本 |
| `likes` / `dislikes` / `habits` / `importantItems` | string? | 个人偏好 |
| `relationshipKeywords` | string? | 关系自由文本（结构化关系另存于关系集合） |
| `visualStyle` / `characterKeywords` / `imagePrompt` | string? | 视觉风格、中文关键词、英文 Prompt |
| `createdAt` / `updatedAt` | string? / string | ISO 时间；`updatedAt` 由存储层写入 |

**头像引用**：角色只保存 `avatarAssetId`。图片本体在 IndexedDB 的素材库里，可被多个角色复用；删除素材前会提示受影响的角色。上传原图上限 10MB，保存前会压缩。

### 1.2 Relationship（`src/types/relationship.ts`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `fromId` / `toId` | string | 关系描述的两端 |
| `kind` | 8 种枚举 | `family` / `mentor` / `friend` / `rival` / `enemy` / `colleague` / `romance` / `other` |
| `note` | string? | 备注 |
| `createdAt` / `updatedAt` | string | ISO 时间 |

方向语义由 `kind.symmetric` 决定：

- **互为类**（亲属、友人、对手、敌对、同僚、情感、其他）：不画箭头，列表读作 `↔`；`A→B` 与 `B→A` 视为同一条，重复保存会被拒绝并说明原因。
- **有方向**（师承）：画箭头，读作 `A → B`；反向是另一条事实（互相师承），不视为重复。

### 1.3 TimelineEvent（`src/types/timeline.ts`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `title` | string | 事件标题 |
| `date` | string | 排序用日期，读取时补齐为 `YYYY-MM-DD` |
| `era` | string? | 显示用纪年（架空历法），不参与排序 |
| `kind` | 6 种枚举 | `origin` / `turning` / `bond` / `conflict` / `loss` / `other` |
| `description` / `location` | string? | 描述与地点 |
| `characterIds` | string[] | 关联角色；角色删除时移除对应 ID |
| `createdAt` / `updatedAt` | string | ISO 时间 |

日期接受 `2026`、`2026-05`、`2026-05-01`，分别补成 `2026-01-01`、`2026-05-01`、原值；非法日期在保存前被拒绝。**排序永远只依据 `date`**，即使显示的是「光历 318 年」。

### 1.4 WorldEntry（`src/types/world.ts`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `name` | string | 条目名 |
| `category` | 6 种枚举 | `location` / `faction` / `species` / `item` / `concept` / `other` |
| `parentId` | string? | 上级条目；写入前检查是否会形成环 |
| `summary` / `details` | string? | 简介与详细设定 |
| `tags` | string[] | 标签 |
| `characterIds` | string[] | 关联角色；角色删除时移除对应 ID |
| `createdAt` / `updatedAt` | string | ISO 时间 |

删除父级时，子条目的 `parentId` 被清空（**脱离为顶层**），不会级联删除。层级只由 `parentId` 表达，没有单独的树结构存储。

---

## 2. 本地存储键

| 键 | 内容 |
| --- | --- |
| `character-studio.characters` | 角色数组 |
| `character-studio.relationships` | 关系数组 |
| `character-studio.timeline` | 时间线数组 |
| `character-studio.world` | 世界观条目数组 |
| `character-studio.backup` | 最近一次破坏性操作前的快照（单槽位） |
| `character-studio.delete-recovery` | 单次删除的恢复记录（角色 + 被清理的引用） |
| `character-studio.dashboard-prefs` | 视图、排序、筛选、置顶等偏好 |
| `character-studio.dashboard-flags` | 一次性提示的已读标记 |
| `character-studio.editor-sections` | 编辑器分节折叠状态 |
| `character-studio.graph-prefs` | 关系网显示设置与导出倍率 |
| `character-studio.relationship-layout` | 关系画布的节点坐标与视觉分组（`schemaVersion: 1`） |
| `character-studio.recent-avatars` | 最近使用的头像 |
| `character-studio.theme` | `system` / `light` / `dark` |
| `character-studio.about-seen` | About 面板已读 |
| `character-studio.ai.*` | AI 设置（仅本地保存，不发起请求） |
| `character-studio.settings.*` | 开发者设置的历史键，读取时兼容 |

IndexedDB 保存头像素材与角色头像的 Blob；不进 `localStorage`。

> 改键名或改字段必须提供迁移。读取层对缺失字段有默认值，但**不允许**用「读不到就当空」处理整个集合——那会把旧数据静默清空。

---

## 3. 导出格式

| 导出 | 结构 |
| --- | --- |
| 单角色 JSON | 一个 Character；上传头像会内嵌为 data URL |
| 角色库 JSON | `{ characters: Character[] }`，不含头像文件 |
| 完整备份 ZIP | 见下 |
| 头像素材 JSON | 素材数组，含图片数据 |
| CSV | 角色的文字列；不含头像，不适合作为唯一备份 |

完整备份 ZIP：

```text
characters.json      { characters: Character[] }
workspace.json       { workspaceVersion, relationships, timeline, world, relationshipLayout }
manifest.json        { schemaVersion, bindings: [{ sourceCharacterId, sourceAssetKey, assetFile, hash, mimeType, size }] }
backup-info.json     { schemaVersion, exportedAt, appVersion, characterCount, avatarAssetCount, assetTotalSize, exportType, notes, workspaceVersion }
assets/avatar/*      avatar-1.webp, avatar-2.png, ...
```

- `workspace.json` 的 `relationshipLayout` 是画布布局；旧包没有这个字段时按「没有布局」处理，不清空本地画布。
- 头像绑定**只依据 `manifest.json`**，不按文件名或旧 ID 猜测。
- `backup-info.json` 的 `appVersion` 目前固定为 `0.1.0`，是历史字段，不代表导出时的应用版本；应用版本以 `src/config/version.ts` 为准。

---

### 3.1 画布布局（`character-studio.relationship-layout`）

```json
{
  "schemaVersion": 1,
  "positions": { "<characterId>": { "x": 0, "y": 0 } },
  "groups": [{ "id": "group-…", "name": "北境线", "characterIds": ["<characterId>", "…"] }]
}
```

- **只是展示数据**：坐标与分组不写入 `Character`，也不写入世界观字段；删除布局不会改变任何角色或关系。
- 键是角色 ID，不是姓名；改名不影响坐标，删除角色时坐标与分组会被裁剪。
- 读取经过归一化：单个坏坐标只丢该条，不会整套回退；无法解析时按空布局处理。
- 没有保存过布局的工作区仍按环形布局显示，首次拖动时才把当前环形坐标落盘，因此第一次编辑不会让其他节点跳动。
- 新增角色（导入、`显示全部`）在已有画布下方按行列补位，不覆盖已摆放的节点。

---

## 4. 导入规则

### 4.1 模式

| 模式 | 行为 |
| --- | --- |
| 合并（merge） | 保留现有角色；按 ID 判断冲突；只新增包内多出的部分 |
| 替换（replace） | 导入包成为完整角色库；现有角色被替换 |

### 4.2 冲突策略（合并时）

| 策略 | 行为 |
| --- | --- |
| 保留现有（keep） | 跳过包内同 ID 记录 |
| 用导入替换（replace） | 用包内记录覆盖现有记录 |
| 作为副本导入（copy） | 给包内记录分配新 ID，作为新角色加入 |

### 4.3 ID 重映射

当保留双方时，包内记录会获得新 ID；关系、时间线与世界观里的 `characterIds` 同步改写，避免引用指向旧 ID。映射在**计划阶段**计算，写入阶段统一应用。

### 4.4 布局的合并与恢复

| 模式 | 布局处理 |
| --- | --- |
| 完全恢复 | 采用备份中的布局；期间发生的 ID 重映射同样应用，缺失角色引用被丢弃 |
| 合并导入 | 保留本地已有坐标，只补充本地从未摆放过的角色；同名分组另起 ID，成员不重复归属 |
| 选择性导入 | 只处理本次真正导入的角色 |

没有布局的旧包不会改动本地画布，只给新导入的角色补位。

### 4.5 预检与缺失引用

导入前生成计划并展示：将新增多少、冲突多少、哪些引用找不到对应角色。缺失引用不会被伪造一个角色；导入后这些引用保持缺失，由用户自行决定补人或忽略。

### 4.6 旧备份兼容

- 没有 `workspace.json` 的旧 ZIP：只导入角色与头像，**不覆盖**现有关系 / 时间线 / 世界观。
- 没有 `manifest.json` 的旧包：按包内文件名与旧 ID 规则回退；失败时明确报告，而不是静默丢头像。
- 快照记录（`character-studio.backup`）在 2.36.0 之前只含角色；读取时允许缺少三个工作区字段。

---

## 5. 恢复点与撤销

| 机制 | 范围 | 保留 |
| --- | --- | --- |
| 自动快照 `character-studio.backup` | 角色 + 关系 + 时间线 + 世界观；**不含头像二进制** | 单槽位，下一次破坏性操作前覆盖 |
| 删除恢复 `character-studio.delete-recovery` | 被删角色 + 被清理的关系 / 引用 | 单次删除，撤销窗口 10 秒 |
| 导入前快照 | 同自动快照 | 导入失败或需要回退时使用 |

写入前会先读回校验；快照写失败时，破坏性操作被阻断，而不是继续执行。

---

## 6. 兼容原则

1. 新增字段必须有默认值，旧数据读取后仍能正常显示。
2. 删除或重命名字段必须提供迁移，并在 `CHANGELOG.md` 写明。
3. 导入器不认识的新字段应保留而不是丢弃（除非明确是废弃字段）。
4. 任何会覆盖用户数据的路径，必须先写快照并可读回。
5. 修改以上任一规则时，同步更新本文件与 `test/workspaceBackup.test.ts`、`test/importPlan.test.ts`、`test/importExport.test.ts`。

---

## relationship-layout（schemaVersion 2，Sprint 50）

```json
// style.node.form: "avatar" | "compact" | "card"（缺省按 avatar；局部覆盖写在 nodeStyles[id].form）
{
  "schemaVersion": 2,
  "positions": { "<characterId>": { "x": 0, "y": 0 } },
  "groups": [{ "id": "grp-1", "name": "北境线", "characterIds": ["a", "b"] }],
  "style": {
    "preset": "classic | archive | portrait | faction | minimal | custom",
    "node": { "size": 1, "shape": "circle", "showAvatars": true, "showNames": true,
               "nameScale": 1, "nameInside": false, "borderColor": "", "background": "" },
    "edge": { "color": "", "byKind": false, "width": 1.4, "dash": "solid",
               "curve": "curved", "arrowSize": 1, "showLabel": true,
               "labelSize": 10, "labelBackground": false },
    "canvas": { "background": "", "grid": "dots", "gridSize": 48, "gridOpacity": 0.5, "snap": false }
  },
  "nodeStyles": { "<characterId>": { "borderColor": "#c2410c", "background": "#fff7ed" } },
  "edgeStyles": { "<relationshipId>": { "color": "#0f766e", "width": 3, "dash": "dashed" } },
  "bookmarks": [{ "id": "bm-1", "name": "北境线特写", "view": { "k": 1.6, "x": -120, "y": 40 } }]
}
```

- `style` / `nodeStyles` / `edgeStyles` / `bookmarks` 在 Sprint 49 的 v1 包中不存在，加载时按经典风格与空覆盖补齐，不报错。
- 旧字段 `style.node.nameSize`（绝对像素）在加载时换算为 `nameScale = nameSize / 13`，范围 0.8–1.8。
- 局部覆盖以稳定 id 为键：角色 id、关系 id。合并导入时节点覆盖按角色 id 映射重写；关系线覆盖只保留导入后仍存在的关系 id，找不到直接丢弃，不会挂到别的关系上。
- 书签只存视角三元组；合并导入保留本地书签，不用别的工作区的坐标覆盖它。
