# Character Studio —— 技术架构

> 文档最后核查日期：2026-10-19 ｜ 依据：2.37.1 源码逐文件核对 ｜ 2.30–2.37 的结构增补见第 10 节

---

## 1. 技术栈与入口

| 项 | 值 | 来源 |
| --- | --- | --- |
| 语言 | TypeScript | `package.json` `typescript: ^5.7.2` |
| UI 框架 | React 18 | `react: ^18.3.1`、`react-dom: ^18.3.1` |
| 构建 | Vite 6 | `vite: ^6.0.5`（本轮构建实际报告 `vite v6.4.3`） |
| 测试 | vitest 3 + happy-dom + fake-indexeddb | `vitest: ^3.2.7`、`happy-dom: ^21.0.1`、`fake-indexeddb: ^6.2.5` |
| 截图导出 | html2canvas | `html2canvas: ^1.4.1`（动态 import） |
| PDF | jsPDF | `jspdf: ^4.2.1`（动态 import） |
| 包管理 | pnpm（锁文件 `pnpm-lock.yaml`；CI 用 pnpm 10 + Node 22） | `.github/workflows/deploy-pages.yml` |
| 应用入口 | `index.html` → `src/main.tsx` → `src/App.tsx` | `src/main.tsx`（10 行） |

`src/main.tsx` 只做一件事：把 `App` 挂到 `#root`。**所有应用逻辑都在 `App.tsx`**（2048 行）。

---

## 2. 路由与页面结构

**没有路由库。** 路由是一个联合类型 + History API：

```ts
// src/types/app.ts
export type Page = "dashboard" | "form" | "preview" | "developer" | "relationships" | "timeline" | "world";
```

| 页面 | 值 | 入口 | 代码分割 |
| --- | --- | --- | --- |
| 主页 | `dashboard` | 落地页 | **静态打入首屏包**（它是落地页，走二次请求反而更慢） |
| 编辑工作台 | `form` | 主页「新建角色」/「编辑」 | `lazy()` + `importWithRecovery` |
| 预览页 | `preview` | 主页「预览」、保存后、各工作区点击角色 | `lazy()` |
| 开发者中心 | `developer` | **唯一有真实 URL 的路由**：`${BASE_URL}developer`（路径由 `import.meta.env.BASE_URL` 推导，不写死 `/developer`） | `lazy()` |
| 角色关系网 | `relationships` | 顶栏工作区菜单 | `lazy()` |
| 世界观时间线 | `timeline` | 顶栏工作区菜单 | `lazy()` |
| 世界观管理 | `world` | 顶栏工作区菜单 | `lazy()` |

### 2.1 深链接与回退

站点发布在 `/character-studio/` 子路径。静态托管下 `/character-studio/developer` 会 404，因此 `scripts/build-info.mjs` 在构建时把 `index.html` 复制为 `404.html`；应用启动时读 `window.location.pathname` 决定进入哪个页面。页面切换用 `history.pushState` 写 `{ characterStudioPage: page }`，`popstate` 读回。

### 2.2 懒加载与部署自愈

六条懒加载路由与两个导出库都经 `utils/lazyImport.ts`（83 行）的 `importWithRecovery()`：

- `isChunkLoadError()` **只在「块取不到」时成立**——块加载成功但内部抛错不算（否则真 bug 会被藏在刷新循环后面）。
- 取不到块时刷新一次，返回的 promise **永不 settle**（页面即将消失，resolve 会让 React 在刷新落地前多渲染一帧）。
- `sessionStorage` 做「只刷一次」的闸（键 `character-studio.chunk-reload`），**模块加载时清闸**，使下一次部署仍能自愈。

> 这一机制的成因：Vite 给每个块加内容哈希，GitHub Pages 部署整体替换目录，于是**已打开的标签页持旧入口，第一次懒加载就要一个已删除的块**。`verify:deploy` 查不出这一类问题。

---

## 3. 核心组件关系

```text
main.tsx
└── App（拥有：Page、characters、themeMode、developerSettings、全部全局弹窗、浮动栏）
    ├── topbar：品牌标识 + 工作区切换 + 主题控件
    ├── Suspense
    │   ├── Dashboard（静态）—— 19 个模态/浮层 + Hero + 列表面板
    │   ├── CharacterForm（lazy）—— 内部可选渲染 CharacterPreview（preview 模式）
    │   ├── CharacterPreview（lazy）—— 双模式：browse / editing
    │   ├── DeveloperCenter（lazy）
    │   ├── RelationshipGraph（lazy）
    │   ├── Timeline（lazy）
    │   └── WorldManager（lazy）
    ├── floating-actions（回到顶部 / 滑到底部 / 上下文动作）
    ├── footer（非主页）
    └── 全局弹窗：About（含首次 About）/ Settings / 头像素材库 / 清理 / 清空数据 / 重置开发者设置 / 素材删除确认×2
```

### 3.1 共享组件

| 组件 | 行数 | 职责 | 关键约束 |
| --- | --- | --- | --- |
| `components/AvatarDisplay.tsx` | 68 | 头像显示的唯一入口：优先 `avatarAssetId` 的图片，读失败回退 `avatarEmoji`，再回退默认 `🙂` | 新页面不要自己写一套图片显示逻辑（历史上出现过大屏不显示、小屏椭圆变形） |
| `components/Icon.tsx` | 290 | 42 个线性 SVG 图标，24×24 网格，`strokeWidth 1.7`，`currentColor` | 三个图标带光学重心补偿：`heart`、`sparkles`、`tool` |
| `components/CharacterPicker.tsx` | 127 | 时间线 / 世界观共用的角色多选器：>12 个角色时出现搜索、已选置顶、`已选 N / 共 M`、全选结果 / 清空 | 角色数 ≤12 时不显示这些控件 |
| `components/AiSettingsForm.tsx` | 113 | AI 设置表单（App 与 Dashboard 两处引用同一实现） | 只存配置，**不发起任何请求**；API Key 输入框 `disabled` |
| `components/BottomSheet.tsx` | 92 | 手机端底部抽屉：Portal 到 `body`、遮罩、Escape、滚动锁、安全区 | 必须挂在 `body` 上（放在顶栏内会以顶栏为定位基准）；外点判定靠 `data-sheet-root` |
| `components/WorkspaceHeader.tsx` | 137 | 工作区标题与操作区的统一结构 | 手机端纵向排布由样式层处理，不复制标题 |
| `components/CharacterRow.tsx` | 288 | 列表视图的单行角色 | 与卡片共享同一份数据与操作语义 |
| `components/CharacterRelatedInfo.tsx` | 214 | 预览页的跨模块关联（关系 / 事件 / 世界观） | 关联跳转通过页面回调，不直接读存储 |

图标名（42）：`arrowDown, arrowLeft, arrowUp, beaker, chart, check, checkSquare, chevronDown, chevronRight, clock, close, component, contrast, copy, download, eye, file, filter, gear, globe, grid, heart, home, image, link, list, monitor, moon, more, minus, package, pencil, pin, plus, refresh, search, sparkles, square, sun, tool, trash, upload`

### 3.2 状态域（hooks）

| Hook | 行数 | 持有 | 被谁用 | 测试 |
| --- | --- | --- | --- | --- |
| `useCharacterSave` | 194 | 保存状态、快照比对、`buildCharacter`、autosave、离开提示 | CharacterForm | `useCharacterSave.test.ts`（16 例） |
| `useAvatarEditing` | 433 | 头像域：12 个 state + 5 个 ref + 17 个动作（emoji、上传、URL、拖拽、裁剪、素材库、最近使用） | CharacterForm | `useAvatarEditing.test.ts`（17 例） |
| `useEditorSections` | 113 | 活跃分节、编辑/预览模式、折叠状态与持久化 | CharacterForm | `useEditorSections.test.ts`（13 例） |
| `useIdentityEditing` | 129 | 心理标签、性别、年龄 / 生日三种编辑态 | CharacterForm | `useIdentityEditing.test.ts`（13 例） |
| `useDashboardPrefs` | 51 | 仪表盘偏好 + 持久化 + 应用来自编辑器的重置请求 | Dashboard | `dashboardPrefs.test.ts`（14 例） |
| `useDashboardLayers` | 33 | 把 22 项图层声明接到状态上，给出 `dismiss()` 与 `blockingSignature` | Dashboard | `dashboardLayers.test.ts`（9 例） |
| `useDialogKeyboard` | 90 | Escape 关闭、Enter 确认、打开时焦点进入、关闭后焦点回到原处 | Dashboard + 关系网 / 时间线 / 世界观（6 个弹窗） | **无**（见 KI-05） |
| `useTransientMessage` | 44 | 单一计时器的短暂消息（1.8s） | Dashboard、编辑器、关系网、预览 | `useTransientMessage.test.ts`（5 例） |
| `useMediaQuery` | 23 | 媒体查询状态（折叠是渲染内容变化，纯 CSS 表达不了） | Dashboard、App | — |
| `useHorizontalScrollHint` | 54 | 横向滚动容器的边缘状态（是否还有被裁切的内容） | Dashboard 分组定位条 | 浏览器回归（320px 渐隐换边） |

### 3.3 纯规则模块（无 React 依赖，可单测）

| 模块 | 行数 | 职责 |
| --- | --- | --- |
| `pages/dashboard/layers.ts` | 60 | 图层声明规则：Escape 一律关闭所有已声明层；`blocksMenus` 逐项声明 |
| `pages/editor/sections.ts` | 97 | 六个分节的元数据与「已完成 / 部分完成 / 未完成」规则 |
| `utils/cropGeometry.ts` | 150 | 裁剪几何（三个坐标空间的换算与夹取） |
| `utils/bulkEdit.ts` | 179 | 批量补丁：每字段独立可选、空值不写、标签增删去重、未改动的按引用原样返回 |
| `utils/importExport.ts` | 1881 | 导入导出全景（见第 6 节） |
| `utils/workspaceCsv.ts` | 223 | CSV 全量表格（角色 + 关系 + 世界观 + 时间线）的读写与校验 |
| `utils/age.ts` | 40 | 出生日期 → 年龄（`today` 可注入，便于测试边界） |
| `utils/textFragments.ts` | 13 | 文本片段工具 |
| `utils/lazyImport.ts` | 83 | 懒加载块自愈 |

---

## 4. 数据模型与持久化

### 4.1 数据模型

**Character**（`types/character.ts`，45 行）

核心字段：`id`、`name`、`avatarEmoji`、`avatarAssetId`、`favorite`、`isDraft`、`draftOfId`、`age`、`birthDate`、`gender`、`species`、`occupation`、`worldview`、`personalityTags[]`、`appearanceDescription`、`abilityDescription`、`backstory`、`likes`、`dislikes`、`habits`、`importantItems`、`relationshipKeywords`、`visualStyle`、`characterKeywords`、`imagePrompt`、`createdAt`、`updatedAt`（必填）。

兼容字段（**不得删除读取兼容**）：`isFavorite`、`birthYear`、`tags`。

`CharacterDraft = Omit<Character, "id" | "updatedAt">` —— 编辑器持有的形态：除了存储层拥有的身份与时间戳之外的一切。

**Relationship**（`types/relationship.ts`，90 行）
`id`、`fromId`、`toId`、`kind`（8 种）、`note?`、`createdAt`、`updatedAt`。
8 种关系类型与 `symmetric` 标志：`family 亲属 ✓`、`mentor 师承 ✗`、`friend 友人 ✓`、`rival 对手 ✓`、`enemy 敌对 ✓`、`colleague 同僚 ✓`、`romance 情感 ✓`、`other 其他 ✓`。
`symmetric` **决定三件事**：是否画箭头、列表里读作 `↔` 还是 `→`、反向的同一对是否算重复。

**TimelineEvent**（`types/timeline.ts`，63 行）
`id`、`title`、`date`（补齐为完整 `YYYY-MM-DD` 以便排序是全序）、`era?`（显示用纪年，如「光历 318 年」）、`kind`（6 种：`origin 起源 / turning 转折 / bond 羁绊 / conflict 冲突 / loss 失去 / other 其他`）、`description?`、`location?`、`characterIds[]`、`createdAt`、`updatedAt`。
**排序永不依赖 `era`**，因此架空历法也能稳定排序。

**WorldEntry**（`types/world.ts`，71 行）
`id`、`name`、`category`（6 种：`location 地点 / faction 势力 / species 种族 / item 物品 / concept 概念 / other 其他`）、`parentId?`、`summary?`、`details?`、`tags[]`、`characterIds[]`、`createdAt`、`updatedAt`。
`wouldCreateWorldCycle()` 在**每一条写路径**上检查成环，而不是信任调用方。

### 4.2 存储键（22 个：localStorage 21 个 + sessionStorage 1 个）

统计口径：`grep -rn '"character-studio' src/` 去掉 `exportType` 之类的非键字符串后逐条核对。

| 键 | 所有者模块 | 内容 |
| --- | --- | --- |
| `character-studio.characters` | `storage/characterStorage.ts` | 角色数组 |
| `character-studio.relationships` | `storage/relationshipStorage.ts` | 关系数组 |
| `character-studio.timeline` | `storage/timelineStorage.ts` | 时间线事件数组 |
| `character-studio.world` | `storage/worldStorage.ts` | 世界观条目数组 |
| `character-studio.dashboard-prefs` | `storage/dashboardPrefs.ts` | 搜索词、三个筛选、收藏范围、排序、视图模式 |
| `character-studio.dashboard-flags` | `storage/dashboardPrefs.ts` | 置顶 id 列表、收藏 id 列表（`flags`） |
| `character-studio.graph-prefs` | `storage/graphPrefs.ts` | `{ avatarSize, nameSize, exportScale }` |
| `character-studio.relationship-layout` | `storage/relationshipLayout.ts` | 画布坐标与视觉分组（`schemaVersion: 1`） |
| `character-studio.editor-sections` | `storage/editorUiState.ts` | 六个分节的折叠状态 |
| `character-studio.theme` | `App.tsx` | `system` / `light` / `dark` |
| `character-studio.about-seen` | `App.tsx` | 是否已看首次 About |
| `character-studio.recent-avatars` | `storage/recentAvatars.ts` | 最近使用的 emoji（封顶 12） |
| `character-studio.backup` | `storage/backup.ts` | 自动快照（只含角色） |
| `character-studio.delete-recovery` | `storage/deleteRecovery.ts` | 删除恢复记录（被删角色 + 被清理的关系边 + 受影响条目的原有参与角色；单槽位） |
| `character-studio.chunk-reload` | `utils/lazyImport.ts` | 「只刷一次」的闸（`sessionStorage`） |
| `character-studio-developer-settings` | `config/developerSettings.ts` | 统一设置对象（见 4.4） |
| `character-studio.ai.provider` | `storage/aiSettings.ts` | AI 设置（7 个键） |
| `character-studio.ai.base-url` | 同上 | |
| `character-studio.ai.model` | 同上 | |
| `character-studio.ai.temperature` | 同上 | |
| `character-studio.ai.top-p` | 同上 | |
| `character-studio.ai.max-tokens` | 同上 | |
| `character-studio.ai.streaming` | 同上 | |

（后 7 个为 AI 设置的键集合；实际键总数为 **23**：上表前 16 个 + AI 的 7 个。）

**历史扁平键（仅作一次性迁移输入，不再写入）**：
`character-studio.settings.compact-mobile`、`.jpg-quality`、`.png-scale`、`.pdf-light`、`.export-footer`、`.export-prompt`、`.export-time`、`character-studio.prompt.external-library`、`.random-missing-fields`、`.complexity`、`.repeat-control`、`.custom-library`。
其中 `character-studio.settings.open-search` **已刻意退休、不做迁移**——搜索面板「进入页面永远关闭」是不变量，迁移它等于恢复一个没人读的设置。

### 4.3 IndexedDB

| 项 | 值 |
| --- | --- |
| 库名 | `character-studio-assets` |
| 版本 | `1` |
| 唯一使用点 | `utils/avatarAssets.ts`（374 行） |
| 角色与素材的绑定 | 角色只存 `avatarAssetId`；**图片二进制从不进 localStorage** |

素材记录字段：`id`、`type`、`name`、`mimeType`、`blob`、`size`、`width`、`height`、`createdAt`、`updatedAt`。

**删除语义**：引用数为 0 可直接删；>0 必须二次确认；删除后受影响角色回退 Emoji。

### 4.4 画布布局（`relationshipLayout`）

关系画布的位置与分组是**展示数据**，单独存放，不进入 `Character`，也不进入 `WorldEntry`：

- `positions` 以角色 ID 为键，改名不移动；删除角色时 `pruneLayout` 同时清理坐标与分组成员。
- 读取统一经过 `normalizeLayout`：逐条校验，坏一条只丢一条；整体损坏回退为空布局。
- 没有布局的工作区仍按 `nodePositions` 的环形显示；第一次拖动才把环形坐标 `materialize` 落盘，避免首拖导致其余节点跳动。
- `RelationshipGraph` 的 `viewBox` 只在可见角色集合变化时重算；拖动、整理、分组移动都不改变它，所以画布映射稳定。
- 自动整理是纯函数（`ringLayout` / `clusterLayout`），同输入同输出；预览只改渲染坐标，确认后才写存储，撤销保留上一份布局。
- 备份写入 `workspace.json` 的 `relationshipLayout`；导入在角色 ID 重映射之后调用 `mergeImportedLayout`。

### 4.5 开发者设置（单一真相源）

`config/developerSettings.ts`（411 行）。统一对象 `DeveloperSettings` 含 12 个分组：

`project`、`content`（11 个文案字段）、`appearance`（7）、`designTokens`（1）、`brandAssets`（3）、`editorDefaults`（6）、`dashboardDefaults`（6）、`exportDefaults`（6）、`promptCenter`（5）、`application`（7）、`featureFlags`（9）、`developerMode`（1）。

两条关键机制：

1. **`pickKnown()` 只保留默认值声明过的键。** 旧实现把存储对象整个展开，于是「类型里已经没有的键」会进得来、出得去、下一次保存又被写回存储，永远留在那儿。
2. **`applyDeveloperSettings()` 把设置写进 CSS 变量与 `data-*` 属性**，而不是让组件各自读设置对象：
   `--primary`、`--primary-hover`（由强调色推导）、`--on-primary`（按对比度自动取白或近黑）、`--control-radius`、`--developer-card-radius`、`--developer-button-radius`、`--developer-font-scale`、`--shadow`、`--shadow-strong`、`--duration-fast`、`--duration-medium`；`data-compact-ui`、`data-show-app-logo`、`data-show-header-logo`、`data-about-logo-size`、`data-compact-mobile-editor`。

> **`data-compact-mobile-editor` 目前没有任何 CSS 规则读取它**（本轮 grep `styles.css`：0 命中）。对应开关在界面上的效果因此不可见——见 KI-06。

---

## 5. 数据流与状态管理

### 5.1 写路径

| 数据 | 写入方 | 说明 |
| --- | --- | --- |
| 角色集合 | **只有 `App.tsx`** | 页面通过 `onSave` / `onDraftSave` / `onAutoSave` / `onImport` / `onDelete` / `onBulkDelete` / `onBulkDuplicate` / `onToggleFavorite` 请求 |
| 关系 / 时间线 / 世界观 | 各自的页面 | 页面自己 `load*` / `save*`；进入页面时 prune 一次悬空引用 |
| 仪表盘偏好 | **只有 `Dashboard`**（经 `useDashboardPrefs`） | `App.tsx` 只在**没有存储值时播种一次**，且不硬写 `viewMode` / `sortMode` |
| 跨域引用清理 | `storage/referenceIntegrity.ts` 的 `pruneCharacterReferences()` | 单删与批量删除**共用同一个 helper**（历史上批量删除漏了这一步） |
| 开发者设置 | `App.tsx` 的 `setDeveloperSettings` | 单向：设置变化 → 持久化 → 应用到 CSS 变量 |

### 5.2 保存语义（编辑器）

「写角色」有四条路径（保存角色、另存草稿、autosave、浏览器离开提示），共用**同一套「什么算已保存」规则**（`useCharacterSave` 内的 `lastSnapshotRef` + `markLoaded` / `markCleared`）：

- `markLoaded` 与 `markCleared` 是**两个**函数而不是一个带参数的函数——打开已有角色显示「已保存」，打开新建角色显示「未保存」，清空表单恒为「未保存」。
- `lastSnapshotRef` 是 **ref 而不是 state**：它不该触发渲染，而浏览器的离开提示必须在**不重新注册监听器**的前提下读到最新值。
- `buildCharacter()` 是唯一知道出栈需要哪两件事的地方：**暂存的头像必须先写进素材库**、**身份字段取自已存角色而不是草稿**。

### 5.3 草稿与正式角色

- 草稿：`isDraft: true` + `draftOfId` 指向来源角色；同一个来源角色只保留一份草稿。
- 转正式（`handlePromoteDraft`）：取 `draftOfId` 或原 id 作为正式 id，删掉草稿条目，`createdAt` 沿用原角色的。
- 收藏是 **quick access 状态，不是编辑动作**：切换收藏**不更新 `updatedAt`**，因此默认「最近编辑」排序下不会跳位。

---

## 6. 导入导出与备份恢复

`utils/importExport.ts`（1881 行）是数据生态核心。

| 格式 | 内容 | 含头像 | 可重新导入 |
| --- | --- | --- | --- |
| 单角色 JSON | 单个角色；如使用上传头像，携带头像数据 | 是（Base64） | 是 |
| 角色 JSON | 全部角色文字数据 | 否 | 是 |
| 完整备份 ZIP | 角色 + 素材 + 绑定关系 + 三个工作区域 | 是 | 是 |
| 头像素材 JSON | 独立备份素材库（可只导所选） | 是 | 是 |
| CSV | **类型**列区分 角色 / 关系 / 世界观 / 时间线 的全量表格 | 否 | 是（按列名匹配） |
| PDF / JPG / PNG | 展示与归档 | 显示当前头像 | 否 |

**完整备份 ZIP 结构**

```text
characters.json      # 角色
manifest.json        # 角色 ↔ 头像素材的绑定关系
backup-info.json     # 备份说明（schemaVersion / exportedAt / 计数 / exportType）
workspace.json       # 关系网 / 世界观 / 时间线
assets/avatar/*      # 头像图片
```

**绑定规则**：导入时**只依据 manifest**，禁止按文件名、素材名、旧 id 猜测。建立两张映射（原角色 id → 新 id、原素材 key → 新 assetId）。

**导入流程**：解析 → 预览（`prepareCharacterImport`）→ 确认 → 写入（`commitCharacterImport`）。取消不写任何数据。合并策略是**按 id 合并而不是覆盖**——备份是「当时有什么」，恢复它不该删掉备份之后新建的东西。

**校验**：指向不存在角色的关系被丢弃、自环被丢弃、未知类型被丢弃、重复 id 被丢弃、时间线与世界观里不存在的角色引用被过滤、父级不在同批则清空（避免把层级存成环）。

**两个已知的导出约束（有代码依据）**

1. **html2canvas 不能直接截 `<svg>`** —— 它把文档克隆进 iframe 后按元素查找，直接给一个 `<svg>` 会抛**字符串**（不是 Error）`Unable to find element in cloned iframe`。关系网的截图目标是包了一层的 `<div class="graph-canvas-frame">`。
2. **html2canvas 的颜色解析器只认 rgb / rgba / hsl / hex** —— 遇到 `color(srgb …)`（`color-mix()` 的 computed value）会抛错并**让整张截图失败**。因此克隆后统一降级：`toLegacyColorFunctions()` / `downgradeModernColors()` 在 `onclone` 里把 `color(srgb r g b / a)` 转成 `rgba(...)`（含复合值如 `box-shadow` 里的多个颜色、含宽色域可能出现的负值通道并做 clamp）。两条截图路径都接上。
   > 设计语言本身**不因此降级**：降级只发生在截图的克隆副本里。

**自动快照**：清空全部数据与导入文件都会替换整份列表，两者都先写 `character-studio.backup`，设置页在有快照时提供「恢复上次自动备份」入口（没有恢复入口的快照就是又一个「看似可用、实际无效」的控件）。

**删除恢复记录**（`storage/deleteRecovery.ts`，与自动快照是两个不同的东西）：删除角色会同时清掉它在关系网 / 时间线 / 世界观里的引用，所以删除前先写 `character-studio.delete-recovery`，撤销时**按 id 合并**回写（只补缺失项、不替换数据集，因此不覆盖删除之后的新数据）。三个删除入口共用它；记录写不进去就不执行删除，恢复时某一步没落地则保留记录并如实报告为部分恢复。快照覆盖的是「角色列表」，这份记录覆盖的是「这一次删除动了什么」。

---

## 7. 样式与设计系统架构

`src/styles.css`（**7177 行**）是唯一的样式表。

### 7.1 令牌（`:root`）

| 组 | 令牌 |
| --- | --- |
| 颜色 | `--bg:#f3f4f6`、`--surface:#ffffff`、`--surface-subtle:#f9fafb`、`--text:#111827`、`--text-soft:#374151`、`--muted:#5b6472`、`--border:#e5e7eb`、`--border-strong:#d1d5db`、`--primary:#111827`、`--primary-hover:#374151`、`--on-primary:#ffffff`、`--danger:#b91c1c`、`--danger-bg:#fef2f2`、`--danger-border:#fecaca`、`--avatar-tint:rgba(17,24,39,.06)` |
| 派生填充 | `--control-fill: color-mix(in srgb, var(--text) 7%, var(--surface))`、`--control-fill-hover`(12%)、`--control-fill-active`(17%) |
| 间距 | `--pad-surface:24px`、`--pad-card:16px`、`--pad-rail:12px`、`--btn-gap:8px` |
| 圆角 | `--control-radius:8px`、`--developer-card-radius:8px`、`--dialog-radius:10px`、`--developer-button-radius:10px` |
| 控件高度 | `--control-height:42px`、`--control-height-icon:36px`、`--control-height-compact:34px` |
| 阴影 / 焦点 | `--shadow`、`--shadow-strong`、`--focus-ring` |
| 动效 | `--ease-standard: cubic-bezier(.2,0,0,1)`、`--duration-fast:150ms`、`--duration-medium:190ms` |
| z-index | 内联层 `--z-inline-1..6`（2/3/5/7/8/12）、浮层 `--z-overlay-1..8`（20/24/30/35/40/**120**/130/160）、`--z-dropdown:80`、`--z-modal-overlay:900`、`--z-modal-content:910`、`--z-toast:1000` |

深色主题（`:root[data-theme="dark"]`）覆盖：`--bg:#0f1115`、`--surface:#171a21`、`--surface-subtle:#20242d`、`--text:#f4f4f5`、`--text-soft:#d4d4d8`、`--muted:#a1a1aa`、`--border:#2b303b`、`--border-strong:#3f4654`、`--primary:#f4f4f5`、`--primary-hover:#d4d4d8`、`--danger:#fca5a5`、`--danger-bg:#3f1d22`、`--danger-border:#7f1d1d`、`--avatar-tint:rgba(244,244,245,.08)`、`--shadow`、`--shadow-strong`。

**层序的设计意图**（样式表内的注释原文）：`5–40` 锚定在控件上的浮层与菜单；`120–160` 必须盖住页面但仍要在弹窗之下的浮层；`900/910` 弹窗遮罩与内容；`1000` Toast。

### 7.2 断点（11 个 `@media` 块）

| 查询 | 规则数 |
| --- | --- |
| `(hover:none) and (pointer:coarse)` | 1 |
| `max-width: 1024px` | 3 |
| `max-width: 860px` | 1 |
| `max-width: 720px` | 约 **160**（分散在 5 个块中：3332、3350、5299、7084、7168） |
| `max-width: 430px` | 15 |
| `prefers-reduced-motion: reduce` | 3（两个块） |

滚动行为的关键约束：`body` 必须是 `overflow-x: clip` + `overflow-y: visible`。若写成 `overflow-y: auto`，body 会自己变成滚动容器，于是**全站 `position: sticky` 静默失效**（历史上编辑页侧栏与操作栏因此全部不动）。

### 7.3 按钮语言

| 变体 | 高度 | 圆角 | 填充 | 文字 |
| --- | --- | --- | --- | --- |
| `.primary-button` | 42 | `--developer-button-radius` | `--primary` | `--on-primary`（按对比度自动推导） |
| `.secondary-button` | 42 | 同上 | `--control-fill` | `--text` |
| `.ghost-button` | 42 | 同上 | `--control-fill` | `--text-soft` |
| `.danger-button` | 42 | 同上 | `--control-fill` | `--danger`（破坏性由文字颜色承担） |
| `.hero-icon-button` / `.bare-icon-button` / `.mini-icon` | 36×36 | 同上 | `--control-fill` | `--text-soft` |
| `.floating-action` | 44×44 | 999px | 透明 | `--text-soft` |

`--control-height-compact:34px` 是第三档，只用于**装不下图标档的紧凑行**（手机导航 chip、移动编辑器操作行）——那里是布局约束而不是审美偏好。

### 7.4 设计系统的现状缺口

- 约 **140 处**硬编码颜色字面量（6 位 hex 与 `rgba()`），全部落在样式表前 5079 行；其后一律使用令牌。
- `src/config/themeTokens.ts`（20 行）导出一个 `defaultThemeTokens` 对象（颜色 / 圆角 / 动效），**与 CSS 里的 `:root` 是两份并行的定义**：CSS 是运行时实际生效的那份，`themeTokens.ts` 当前没有运行时读取方。这是一处**待确认**的重复来源，本轮未修改。

---

## 8. 测试与部署架构

### 8.1 测试

| 项 | 值 |
| --- | --- |
| 框架 | vitest 3 + happy-dom + fake-indexeddb |
| 规模 | **48 个文件 / 538 个用例**（2.37.1 `npm test` 实测） |
| 覆盖对象 | 存储层往返与容错、纯逻辑（裁剪几何 / 批量补丁 / 年龄 / CSV / 导入导出 / 导入计划 / 懒加载恢复 / 图层声明 / 关系语义与布局 / 编辑器分节 / 图偏好）、PDF 文本结构、删除恢复、版本一致性 |
| 未覆盖 | Developer Center 的控件回调、绝大多数渲染与真实布局（由 `verify:browser` 补足） |

设置里没有 `setupFiles` 之外的环境配置；测试**不需要浏览器**（happy-dom 提供 DOM，fake-indexeddb 提供 IndexedDB）。

### 8.2 部署

```text
push 到 main
  → pnpm install --frozen-lockfile      (pnpm 10 / Node 22)
  → pnpm typecheck                     (tsc -b)
  → pnpm test                          (vitest run)
  → pnpm build:pages                   (tsc -b && vite build --base=/character-studio/ && node scripts/build-info.mjs)
                                        env: VITE_BUILD_COMMIT=${{ github.sha }}
                                             VITE_BUILD_TIME=${{ github.event.head_commit.timestamp }}
  → actions/upload-pages-artifact (path: dist)
  → actions/deploy-pages
```

`scripts/build-info.mjs` 产出 `build-info.json`、`404.html`（`index.html` 的副本，用于深链接回退）与 `.nojekyll`。

**构建身份**：`scripts/build-identity.mjs` 环境变量优先，缺省时从 git 推导（`rev-parse HEAD` 与 `log -1 --format=%cI`），并且**工作树脏时把 commit 标成 `-dirty`**——一个不可能与部署一致的构建应当自己说出来。同样的推导在 `vite.config.ts` 里重复了一份（配置加载上下文不同），两处都写了注释说明原因。

`scripts/verify-deploy.mjs` 比对线上与本地：入口包、样式表、每个文件的字节数、commit 戳、深链接回退。

> **注意**：`npm run build`（base `/`）与 `npm run build:pages`（base `/character-studio/`）产出的 JS **哈希不同**，因为 `import.meta.env.BASE_URL` 被内联进包。要逐字节比对线上产物，必须用 `build:pages`。

---

## 9. 重要约束与高风险区域

### 9.1 不可动摇的约束

| 约束 | 原因 |
| --- | --- |
| 不引入服务器 / 登录 / 云存储 | 本地优先是产品定位；数据隐私与部署简单都是它带来的 |
| 图片不进 localStorage | 只存 `avatarAssetId`；Base64 会快速膨胀并触发存储上限 |
| 一个 localStorage 键只有一个所有者 | 「3 个写入方管同一个偏好」已造成过静默回滚事故 |
| 默认值是初始值，不是策略 | 开发者默认值覆盖作者偏好会让「切到列表视图」在往返后失效 |
| 导出区域不用 `oklch()` / `color()` / `lab()` | html2canvas 的颜色解析器只认 rgb / rgba / hsl / hex；虽然现在有克隆期降级兜底，但新增现代颜色函数仍应复核 |
| 删除是「断开」而不是「连带删除」 | 删角色会从事件与世界观条目里移除该角色的关联，**但事件与条目保留** |
| 收藏不更新 `updatedAt` | 否则默认排序下卡片会跳位 |

### 9.2 高风险区域（改动前应先建立证据）

| 区域 | 风险 |
| --- | --- |
| `Dashboard.tsx`（4273 行）/ `CharacterForm.tsx`（3037 行） | 两个巨型渲染体，承载拖拽、批量选择、弹窗与自动保存；未拆分的部分改动只能靠回归探针保护 |
| `utils/importExport.ts`（2184 行） | 备份结构、manifest 绑定、截图导出三条线交织；任何一处改动都可能让旧备份打不开 |
| `styles.css`（10759 行） | 层叠位置敏感：合并声明体会改变层叠顺序；`.relationship-table td` 这类「类+元素」选择器会盖过单类规则 |
| 吸顶体系 | 依赖 `body` 的 `overflow` 与 `--topbar-height` / `--editor-bar-height` 两个运行时测量的变量 |
| IndexedDB 素材与角色的引用完整性 | 悬空 `avatarAssetId`、被引用素材的删除都需要二次确认与回退 |

---

## 10. 2.30 – 2.37 的结构增补

这一段只记录**结构上新增或改变了行为边界**的部分；逐版本细节见 `CHANGELOG.md`。

### 10.1 角色档案 PDF（2.33 – 2.35）

- `utils/characterSheetPdf.ts` 负责排版：逐行测量、分页、中文标点避头尾；`characterSheetExport.ts` 负责加载字体、绘制头像、触发下载。
- 字体是 `src/assets/fonts/NotoSansSC-CS.ttf`（Noto Sans SC 的可变字体按 `wght=400` 实例化后，用 GB2312 + Latin + 假名 + 排印标点子集化），由 `utils/fontGlyphCoverage.ts` 提供 `hasGlyph`。
- 缺字形不静默丢字：渲染为 `□`，并在导出后提示具体字符。`INVISIBLE` 规则避免把变体选择符误报为缺失。
- PDF 是可选中文本（`Identity-H` / `CIDFontType`），不是整页截图；关系网导出的 PDF 才是画布截图。两者不要混用同一套描述。

### 10.2 关系网双模式（2.36 – 2.37）

- 图谱与管理共用一个页面的两套呈现；`boardMode` 是视图状态，写入 `character-studio.relationship-view`。
- 默认只画核心视图（`CORE_VIEW_LIMIT` 40，手机上 24；`CORE_VIEW_DEGREE` 2），文案明确写出「已画 / 有连接 / 总数」。
- 搜索会聚焦默认未画出的角色：`focusExtraIds` 把命中角色临时并入画布，而不是只提示「不在画布中」。
- 管理表格分页 20 条，编辑 / 删除走同一份存储，返回图谱即同步。

### 10.3 移动端导航与弹层（2.37.1）

- `App.tsx` 用 `useMediaQuery("(max-width: 720px)")` 决定工作区列表的呈现：桌面是 `.workspace-menu` 下拉，手机是 `BottomSheet`（`testId="workspace-sheet"`）。两者共用同一个 `workspaceEntries` 数组，避免一边有、一边没有。
- Dashboard 的「更多操作」同样是一份 `renderMoreMenuItems()`、两种呈现（`.export-menu` / `BottomSheet testId="more-sheet"`）。
- 抽屉 Portal 到 `body`，外点处理通过 `[data-sheet-root]` 放行；Escape 与焦点恢复由 `useDialogKeyboard` 负责。
- 手机端工具栏不再给「新建角色」设 132px 下限；≤360px 使用 8px 间距与 8px 内边距，保证四个控件同一行。
- 分组定位条保留横向滚动，`useHorizontalScrollHint` 依据滚动位置加 `has-overflow-start/end`，由 `mask-image` 渐隐；内容放得下时不出现。

### 10.4 恢复范围（2.36）

- 自动快照从「只有角色」扩展到角色 + 关系 + 时间线 + 世界观；头像二进制仍不在快照内。
- 删除恢复记录保存被删角色与被清理的引用，撤销按 ID 合并回去，重复撤销是幂等的。
