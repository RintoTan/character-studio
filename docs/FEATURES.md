# Character Studio —— 功能清单与状态

> 文档最后核查日期：2026-10-15 ｜ 状态依据：当前源码 + Git 历史 + 本轮 `tsc -b` / `vitest run` / `vite build` 实测
> **状态定义**：`已实现`＝代码存在且入口可达；`部分实现`＝主体可用但有明确缺口；`未实现`＝不存在；`待验证`＝有代码但缺有效证据。
> 验证栏三级：`已测试`（有单测覆盖）／`仅静态检查`（只有类型检查或读码）／`未验证`（无任何证据）。

---

## 1. 主页（Dashboard）

代码：`src/pages/Dashboard.tsx`（3623 行）｜ 路由值 `dashboard` ｜ 唯一**静态**打入首屏包的页面

### 1.1 页面结构（渲染顺序）

| # | 区块 | 可见标题 | 容器类 |
| --- | --- | --- | --- |
| 1 | Toast | 消息文本 + `撤销` | `toast` |
| 2–17 | 16 组弹窗 / 浮层 | 见 1.5 | `modal-backdrop` / `export-backdrop` + 各类 dialog |
| 18 | Hero | eyebrow `OC Workspace` + 列表标题 + 三个统计入口 | `panel intro-panel` |
| 19 | 角色列表面板 | `角色列表` / `搜索 / 筛选结果` / `收藏角色` / `草稿角色` | `panel` > `section-title list-section-title` |
| 20 | 页脚 | `About Character Studio` · `头像素材库` · `Settings` · 版权 | `dashboard-footer` |

### 1.2 列表工具栏（`list-toolbar`，L→R）

| 控件 | 标签 / aria | 行为 |
| --- | --- | --- |
| 搜索输入框（展开时） | `aria-label="搜索角色"`，placeholder「搜索角色名、职业、世界观、性格标签」 | 输入即过滤；`Escape` 或再点图标收起；**关键词保留** |
| 搜索图标 | `aria-label="搜索"` | 展开输入框并自动聚焦 |
| 筛选图标 | `aria-label="筛选"` | 打开筛选浮层（锚定在标题行，`right:0`、`width:min(560px,100%)`） |
| 视图切换 | `aria-label` = 「切换列表视图」/「切换卡片视图」 | cards ⇄ list |
| 新建角色 | `新建角色`（文字主按钮） | `onCreate()` |
| 更多操作 | `aria-label="更多操作"` | 三组菜单，见 1.4 |

**筛选浮层字段**：清空筛选（`aria-label="清空筛选"`）、范围（全部角色 / 仅收藏 / 草稿箱）、排序（最近编辑 / 最近创建 / 名称 A-Z / 名称 Z-A）、世界观、性别、视觉风格。桌面为一行，浮层内为两列网格；≤720px 时五个下拉收进「筛选选项」按钮（有筛选生效时显示「筛选 · N 项生效」）。

### 1.3 批量操作

| 控件 | 桌面标签 | 手机标签 |
| --- | --- | --- |
| 进入批量 | `批量选择` | `批量选择` |
| 全选 / 取消 | `全选` / `取消全选` | 同 |
| 批量编辑 | `批量编辑` | `编辑` |
| 收藏 | `加入收藏` / `移出收藏` | `收藏` / `移出` |
| 导出 | `导出` | `导出` |
| 复制 | `批量复制` | `更多` 菜单内 |
| 删除 | `批量删除` | `删除` / `更多` 菜单内 |
| 退出 | `取消选择` | `取消` |

### 1.4 更多操作菜单（三组）

| 分组 | 项 |
| --- | --- |
| 角色管理 | `草稿箱` / `退出草稿箱`、`收藏夹` / `退出收藏夹`（带数量） |
| 显示与布局 | `按世界观分组`（`aria-pressed` + 「已开启/已关闭」胶囊；只在卡片视图且角色数 > 30 时出现） |
| 数据管理 | `导入角色 JSON/ZIP/CSV`、`导出角色 JSON/ZIP/CSV` |

> 工作区入口（关系网 / 时间线 / 世界观管理）已从这里移除，移到顶栏的工作区菜单。

### 1.5 弹窗与确认（16 组）

| 弹窗 | 标题 | 按钮 |
| --- | --- | --- |
| 删除角色 | 删除角色 | `取消` / `确认删除` |
| 批量编辑 | 批量编辑 N 个角色 | `取消` / `应用到 N 个角色`（字段：世界观、视觉风格、收藏状态、添加标签、移除标签，各自需勾选） |
| 批量删除 | 批量删除 | `取消` / `确认删除` |
| 单角色导出 | 导出角色 | `关闭` / `JSON` / `PDF` / `JPG` / `PNG` |
| 按范围导出 | 导出选中角色 / 导出角色 | `关闭` / `取消` / `开始导出`（单选格式） |
| 手机批量更多 | 更多操作 | `关闭` / `批量复制` / `批量删除` |
| 命令面板 | 快速操作 | 新建角色(N) / 搜索角色(/) / 打开草稿箱 / 打开收藏夹 / 导入角色 JSON/ZIP/CSV / 导出角色 JSON/ZIP / 切换主题 |
| About | About Character Studio | `关闭` |
| 设置 | 设置 | `关闭` + Appearance（Follow System/Light/Dark）、Default View、简洁模式、JPG 导出质量、PDF Light Mode、导出角色 JSON/ZIP、导入角色 JSON/ZIP/CSV、恢复上次自动备份、清空本地数据、打开头像素材库 |
| 导入预览 | 确认导入 | `取消` / `查看详细信息 ▼` / `确认导入` |
| 头像素材库 | 头像素材库 | `关闭` / `导入头像素材` / `导出头像素材` / `清理未使用素材` / `全选` / `导出所选` / `删除未使用` / `删除所选` / 每项 `删除` |
| 恢复自动备份 | 恢复上次自动备份 | `取消` / `确认恢复` |
| 清空本地数据 | 清空本地数据 | `取消` / `确认清空` |
| 清理头像素材 | 清理头像素材 | `取消` / `确认清理` |
| 删除在用素材 | 删除正在使用的头像素材 | `取消` / `确认删除` |
| 批量删除素材 | 批量删除头像素材 | `取消` / `确认删除` |

### 1.6 功能状态

| 功能 | 状态 | 实现证据 | 用户可见行为 | 数据依赖 | 已知问题 | 验证 | 后续任务 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 角色卡片视图 | 已实现 | `Dashboard.tsx` 卡片分支 | 网格卡片，显示头像 / 名字 / 标签 / 时间 / 状态徽章 | `characters` | — | 已测试（`characterStorage`）+ 历史实测 | — |
| 角色列表视图（表格） | 已实现 | `character-table` | 表格 7–8 列，逐行选择 | `characters` + `showUpdatedTime` | — | 历史实测（表头/数据行同为 8 格、操作列右缘一致） | — |
| 搜索 | 已实现 | `prefs.searchTerm` + `getVisibleCharacters` | 关键词过滤角色名 / 职业 / 世界观 / 性格标签 | `dashboard-prefs` | — | 已测试 + 历史实测（40 → 11） | — |
| 筛选（范围 / 世界观 / 性别 / 视觉风格） | 已实现 | `dashboard-controls` + 浮层 | 浮层内选择，列表即时更新 | `dashboard-prefs` | — | 历史实测（两列 5 字段各 261px） | — |
| 排序（4 种） | 已实现 | `prefs.sortMode` | 最近编辑 / 最近创建 / 名称 A-Z / Z-A | `dashboard-prefs` | 收藏不参与排序因子（收藏不重排，是设计） | 已测试 | — |
| 收藏 | 已实现 | `handleToggleFavorite` | 切换收藏；收藏夹视图只显示正式角色 | `characters.favorite` | — | 已测试 | — |
| 置顶 | 已实现 | `flags.pinnedIds` 语义 | 置顶卡片排在前 | `dashboard-flags` | 未在 CHANGELOG 中单独实测 | 仅静态检查 | 补一次置顶顺序的实测 |
| 草稿箱 | 已实现 | `favoriteMode === "drafts"` | 只显示草稿；草稿可转正式 | `characters.isDraft` / `draftOfId` | — | 已测试 | — |
| 按世界观分组（卡片视图） | 已实现 | `groupedCards` + `cardRows` | >30 个角色时按世界观分组、表头吸顶、可折叠、按组大小排序 | 无（会话级状态） | 分组与折叠**不持久化**（刷新回到默认分组） | 历史实测（114 角色 → 9 组） | 是否要持久化分组，需产品决定 |
| 批量选择 / 全选 | 已实现 | `selectedIds` | 卡片与表格都能逐项选择 | 无 | — | 历史实测 | — |
| 批量编辑 | 已实现 | `utils/bulkEdit.ts` | 5 个字段各自勾选后批量写入 | `characters` | — | 已测试（11 例）+ 历史实测（3 改 / 111 未动） | — |
| 批量收藏 / 复制 / 删除 | 已实现 | 各 handler | 批量操作，删除走确认 | `characters` | — | 已测试（引用清理）+ 历史实测 | — |
| 删除撤销 | 已实现 | `undoCharacter` + Toast | 删除后 Toast 提供 `撤销` | `characters` | — | 历史实测 | — |
| 命令面板 | 已实现 | `command-palette` | Cmd/Ctrl+K 打开，7 个动作 | 无 | — | 历史实测（外部点击关闭） | — |
| 快捷键 | 已实现 | `Dashboard.tsx` L458 | `N` 新建、`/` 搜索、`Esc` 关闭、`Enter` 打开首个搜索结果 | 无 | — | 仅静态检查 | 补一次键盘实测 |
| 导入 | 已实现 | `prepareCharacterImport` / `commitCharacterImport` | 解析 → 预览 → 确认 → 写入；先写自动快照 | `characters` + 三个工作区域 | — | 已测试 + 历史实测（JSON 与 CSV 端到端） | — |
| 导出（JSON / ZIP / CSV / PDF / JPG / PNG） | 已实现 | `utils/importExport.ts` | 单角色 / 选中 / 全部三种范围，格式由弹窗选择 | `characters` + 工作区域 + IndexedDB 头像 | 截图导出的两个库限制已在代码中兜底 | 已测试 + 历史实测 | — |
| 头像素材库（弹窗） | 已实现 | `avatarAssets.ts` | 浏览、统计、多选、导入导出 JSON、清理未使用 | IndexedDB | — | 已测试（`avatarAssets`） | — |
| 设置弹窗 | 部分实现 | `settings-dialog` | 主题、默认视图、导出质量、数据管理入口 | `character-studio-developer-settings` | 未加宽、未中文化、未折叠「暂未应用」项（KI-01） | 未验证（视觉） | 见 ROADMAP |
| About / 首次 About | 已实现 | `App.tsx` + `Dashboard.tsx` | 版本 / Sprint / Build、快捷键、Roadmap、导入导出说明 | `character-studio.about-seen` | 首次 About 排版精简未做（历史台账 P1-12） | 未验证（视觉） | 见 ROADMAP |
| 主题切换 | 已实现 | `App.tsx` 主题 effect | 浅色 / 深色 / 跟随系统 | `character-studio.theme` | 深色主题**目视检查未做**（历史遗留） | 仅静态检查 | 补深色视觉走查 |
| 骨架屏 / 空状态 / 无结果状态 | 已实现 | `skeleton-grid` / `empty-state` | 加载中、无角色、搜索无结果三种状态 | 无 | — | 历史实测 | — |

---

## 2. 角色编辑工作台（CharacterForm）

代码：`src/pages/CharacterForm.tsx`（3008 行）｜ 路由值 `form` ｜ 懒加载

### 2.1 页面结构

| # | 区块 | 可见标题 / 类名 |
| --- | --- | --- |
| 1 | Toast | `toast` |
| 2–7 | 6 组弹窗 | 清空内容 / 表单动作 / 创作辅助 / 替换确认 / 裁剪头像 / 选择本地头像素材 |
| 8 | Hero | eyebrow `Character Workspace` / `New Character`；h1「编辑角色工作台」/「新建角色工作台」 |
| 9 | 操作栏 | `workspace-toolbar editor-action-bar` |
| 10 | 模块导航 | `已完成 N / total` + 「跳到下一个未完成 · n」 |
| 11 | 表单 | `workspace-layout`，六个分节 |
| 12 | 页脚操作 | `form-actions workspace-footer` |

**六个分节（顺序）**：基础信息 → 外貌设定 → 性格设定 → 个人偏好（可被 flag 隐藏）→ 能力设定 → 背景故事 → AI Prompt（可被 flag 隐藏）。

### 2.2 操作栏

左侧：保存状态徽章（`正在保存` / `保存失败` / `已保存` / `未保存`）+ `随机生成角色`（生成中显示 `生成中...`）。
右侧：`返回` · `预览` · `更多`（菜单：随机生成角色 / 临时保存 / 预览 / 返回 / 清空内容 / 删除角色）· `保存角色`。

### 2.3 功能状态

| 功能 | 状态 | 实现证据 | 用户可见行为 | 数据依赖 | 已知问题 | 验证 | 后续任务 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 新建 / 编辑角色 | 已实现 | `CharacterForm` + `App.handleSave` | 新建时 h1 为「新建角色工作台」 | `characters` | — | 已测试 | — |
| 六节编辑 + 导航 | 已实现 | `pages/editor/sections.ts` + `useEditorSections` | 左侧导航高亮、完成度进度、点节滚动 | `editor-sections` | **节级设计语言未统一**（KI-02） | 已测试（13 例）+ 历史实测 | 见 ROADMAP |
| 折叠记忆 | 已实现 | `storage/editorUiState.ts` | 折叠/展开被记住；刷新或重进保持 | `editor-sections` | 「展开全部/折叠全部」只在开发者设置里，是**每次打开的默认值**，刻意不写存储 | 已测试 + 历史实测 | — |
| 跳到下一个未完成 | 已实现 | `useEditorSections` | 跳到下一个未完成节并展开；到末尾绕回 | 同上 | — | 已测试 + 历史实测 | — |
| 保存角色 | 已实现 | `useCharacterSave` | 校验名字；成功保存并离开编辑器（落在该角色的预览页） | `characters` | — | 已测试（16 例）+ 历史实测 | — |
| 临时保存（草稿） | 已实现 | `saveDraftCharacter` | 产生/更新该角色的草稿 | `characters.isDraft` | — | 已测试 + 历史实测 | — |
| 自动保存草稿 | 已实现 | `useCharacterSave` autosave | 有改动时写一次并置为「已保存」；可在设置中关闭 | `characters` | — | 已测试 | — |
| 未保存离开提示 | 已实现 | `beforeunload` | 有改动才提示 | 无 | — | 已测试 | — |
| Cmd / Ctrl + S | 已实现 | L1448 | 触发保存 | — | — | 未验证（键盘实测） | 补实测 |
| 清空内容 | 已实现 | `resetEditableForm` + 确认弹窗 | 清空表单字段（不改存储） | 无 | — | 已测试 | — |
| 删除角色 | 已实现 | `confirmFormAction` | 确认后删除，并请求主页清除筛选 | `characters` + 三个工作区域 | — | 已测试 + 历史实测 | — |
| 随机生成角色 | 已实现 | `handleRandomCharacter` | 用本地词库填字段，按钮进入 450ms 生成态 | `data/avatarCategories.ts` + 词库 txt | — | 仅静态检查 | 补实测 |
| 中文关键词生成 | 已实现 | `handleGenerateKeywords` | 本地规则拼装，写入可编辑字段 | `external-inspiration-library.txt`（37 KB，懒加载） | 灵感抽选跨字段重复未处理（历史台账 P1-10） | 仅静态检查 | 可优化去重 |
| 英文 Prompt 生成 | 已实现 | `handleGenerateImagePrompt` | 预设值有英文映射；自由文本保留中文并在输出加一行语言说明 | 同上 | 自由文本翻译策略未定（需用户决策） | 历史实测（note 行存在） | 待用户定策略 |
| 创作辅助（随机灵感 / 追加 / 替换） | 已实现 | `helper-dialog` | 每个字段给建议，可复制 / 追加 / 替换 | 词库 txt | — | 仅静态检查 | 补实测 |
| Emoji 头像 | 已实现 | `useAvatarEditing` | 分类选择 + 最近使用（封顶 12） | `recent-avatars` | — | 已测试（17 例）+ 历史实测 | — |
| 上传 / URL / 拖拽头像 | 已实现 | 同上 | 三种输入统一在一个面板内 | IndexedDB | 粘贴监听只在面板打开时生效 | 已测试 + 历史实测 | — |
| 头像裁剪 | 已实现 | `utils/cropGeometry.ts` | 1:1 固定框、拖动、缩放、滑杆、最小/最大 | 无 | 裁剪弹窗残留 `position: sticky; bottom: -18px`（历史台账 P2-20，未决定是否清理） | 已测试（19 例）+ 历史实测 | 待产品决定 |
| 从素材库选头像 | 已实现 | `asset-library-dialog` | 选择本地素材；移除图片回退 Emoji | IndexedDB | — | 已测试 | — |
| 个人偏好分节（喜欢 / 不喜欢 / 习惯 / 重要物品） | 已实现 | `featureFlags.personalPreferences` | 可被 flag 隐藏，隐藏时导航同步消失 | 无 | — | 已测试（分节规则） | — |
| 编辑内预览 | 已实现 | `editorMode === "preview"` | 编辑器内直接渲染预览组件 | 无 | — | 历史实测 | — |
| 窄屏适配 | 部分实现 | `@media (max-width:720px)` | 操作栏只留「更多 / 保存角色」 | — | 历史上曾被静默裁切 44px（已修）；`compactMobileEditor` 开关**无 CSS 读取**（KI-06） | 历史实测 | 见 KI-06 |

---

## 3. 角色预览页（CharacterPreview）

代码：`src/pages/CharacterPreview.tsx`（555 行）｜ 路由值 `preview` ｜ 懒加载

### 3.1 双模式

| 模式 | 由谁打开 | 工具栏（L→R） |
| --- | --- | --- |
| `mode="browse"` | 主页「预览」；保存后的落点；各工作区点击角色 | `编辑` / `收藏`·`移出收藏` / `导出` / `返回` |
| `mode="editing"` | 编辑工作台内切到预览 | `返回编辑` / `保存草稿` / `删除角色` / `保存角色` |

### 3.2 页面结构

`.preview-page` → Hero（`.preview-hero` > `.preview-identity`：eyebrow `Character Preview`、h1 角色名、副行 `职业 / 世界观`、`.preview-avatar-button`）→ 导出弹窗 / 头像大图弹窗 → `div[data-pdf-export-root]` → `.preview-layout`：基础资料卡（`.basic-card`）+ 性格标签 / 视觉风格 / 外貌 / 能力 / 背景 / 个人偏好 / 中文关键词 / 英文 Prompt（`.wide-card`）+ 时间卡 + `.preview-export-footer`。

### 3.3 功能状态

| 功能 | 状态 | 实现证据 | 数据依赖 | 已知问题 | 验证 |
| --- | --- | --- | --- | --- | --- |
| 展示角色全部设定 | 已实现 | `.preview-layout` 10+ 卡片 | `characters` | 页面「界面平淡、信息分散、无层次」（历史反馈，未核实为缺陷） | 未验证（视觉设计评估） |
| 双模式工具栏 | 已实现 | `mode` prop | 无 | — | 历史实测（两个入口的标签集合各为 4 项、`返回` 类按钮各 1 个） |
| 导出（JSON / PDF / JPG / PNG） | 已实现（仅 browse 模式） | `.export-dialog` | IndexedDB 头像 | 历史上因 `color-mix()` 导致整张截图失败，已修（克隆期颜色降级） | 已测试（6 例颜色降级）+ 历史实测（PNG 356454 字节） |
| 收藏切换 | 已实现（仅 browse） | `onToggleFavorite` | `characters.favorite` | — | 已测试 |
| 头像大图 | 已实现 | `.avatar-preview-dialog` | IndexedDB | — | 未验证 |
| 复制完整设定 / 中文关键词 / 英文 Prompt | **已移除**（2.23.0），编辑模式下不再提供 | — | — | 卡片内的两个复制按钮按反馈移除 | 历史实测（复制按钮 0 个） |
| 导出 PDF 时隐藏操作按钮 | 已实现 | `data-pdf-hidden="true"`（L281） | — | — | 仅静态检查 |

---

## 4. 角色关系网（RelationshipGraph）

代码：`src/pages/RelationshipGraph.tsx`（1095 行）｜ 路由值 `relationships` ｜ 懒加载 ｜ 受 `featureFlags.experimentalRelationshipGraph` 门控

### 4.1 结构

Hero（eyebrow `RELATIONSHIPS`、h2 `角色关系网`、副行 `N 个角色 · M 条关系`）→ 工具栏（`缩小画布` / 缩放百分比即 `适配画布` 按钮 / `放大画布` / `显示全部角色`·`只显示有关联的` + 计数 / `新建关系`）→ 空状态（两种：角色不足两个、还没有关系）→ 画布（`.graph-canvas-frame` > `svg.relationship-canvas`）→ 画布栏（`头像` 小中大 · `名称` 小中大 · `分辨率` 1x/2x/3x · `JPG`/`PNG`/`PDF`）→ 关系列表（表头 + `<table class="relationship-table">`：关系 / 角色 / 另一方 / 备注 / 操作）→ 消息行 → 两个弹窗（新建关系、删除关系）。

### 4.2 功能状态

| 功能 | 状态 | 实现证据 | 用户可见行为 | 数据依赖 | 已知问题 | 验证 | 后续任务 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 新建关系 | 已实现 | `openDraft` / `submitDraft` | 选角色 A/B（师承时字段名变「师承方 / 学习方」）、8 种类型、可选备注 | `relationships` | 互为类的反向重复被拒绝（原有语义） | 已测试（13 例存储 + 9 例语义）+ 历史实测 | — |
| 删除关系 | 已实现 | `confirmDelete` | 二次确认后删除 | `relationships` | — | 已测试 + 历史实测 | — |
| 径向布局 | 已实现 | `nodePositions()` | 一个角色居中、两个水平并排、三个以上成环；环半径随人数增长 | 无 | — | 已测试（22 例布局）+ 历史实测 | — |
| 画布自适应 | 已实现 | `canvasBox()` | 画布只包住实际绘制范围，并为最宽名称预留半边宽度 | 无 | — | 已测试 | — |
| 名称不裁切 / 不压线 | 已实现 | `measureNameWidth()` / `widestNameHalfWidth()` / `labelHalfWidth` | 名称居中时不被画布边缘切掉；标签沿法线偏移 13 单位并描边 | 无 | — | 已测试 + 历史实测（越界 0） | — |
| 标签缩放阈值 | 已实现 | `labelZoomThreshold(count)` | 适配视图下隐藏名称，放大到阈值后出现；阈值随人数变化 | 无 | — | 已测试 | — |
| 滚轮缩放不带走页面 | 已实现 | 原生 `{passive:false}` wheel 监听 | 画布上滚动只缩放，页面不滚动 | 无 | React 的 `onWheel` 是 passive，`preventDefault()` 会被忽略——必须用原生监听 | 历史实测（真实 CDP 输入：scrollY 300→300、缩放 100%→115%） | — |
| 拖拽平移 / 双指缩放 | 已实现 | `panRef` / `pointersRef` / `pinchRef` | 单指拖、双指缩放 | 无 | — | 已测试（布局）+ 历史实测（合成触摸） | — |
| 悬停高亮邻居 | 已实现 | `neighbours` | 压暗无关节点、高亮相连边 | 无 | — | 历史实测（压暗 108 / 高亮 1 + 3 边） | — |
| 点击节点进入角色 | 已实现 | `onOpenCharacter` | 拖动过则不触发 | `characters` | — | 仅静态检查 | 补实测 |
| 互指边扇形分开 | 已实现 | `edgeBends()` / `edgeGeometry()` | 同一对节点的多条边弯曲分开、标签分居两侧、弯曲方向按这一对自身的顺序镜像 | 无 | — | 已测试 + 历史实测（`distinctPaths: 2`） | — |
| 方向语义（`symmetric`） | 已实现 | `isSymmetricKind()` | 互为类不画箭头、列表读作 `↔`；师承画箭头、读作 `→` | `types/relationship.ts` | — | 已测试（9 例） | — |
| 重复关系拒绝 | 已实现 | `findDuplicateRelationship()` | 保存前拒绝并说明原因（而不是静默无反应） | 同 | — | 已测试 + 历史实测 | — |
| 只显示有关联的角色 | 已实现 | `showAll` | 默认只画参与关系的角色；可切到全部 | 无 | — | 历史实测（112 节点 viewBox 扩张） | — |
| 头像 / 名称尺寸 | 已实现 | `graphMetrics()` | 小中大各三档，写入偏好 | `graph-prefs` | — | 已测试（8 例）+ 历史实测（半径 30 → 42） | — |
| 导出分辨率 1x/2x/3x | 已实现 | `EXPORT_SCALES` | 作为截图倍率 | `graph-prefs` | **3x 的实际导出字节数未测**（历史遗留） | 已测试（偏好校验）+ 未验证（导出结果） | 补一次 3x 导出的实测 |
| 导出 JPG / PNG / PDF | 已实现 | `exportSurfaceImage` / `exportSurfacePdf` | 导出前复位适配并强制显示全部名称；背景取当前主题 `body` 背景 | IndexedDB 头像 | html2canvas 不能直接截 `<svg>`（已用包裹 div 规避） | 历史实测（PNG 155100 字节 / PDF `%PDF-`） | — |
| 关系列表表格 | 已实现 | `relationship-table` | 表头吸顶、操作列右对齐、备注列可换行 | `relationships` | 选择器权重坑：`.relationship-table td` 会盖过单类规则 | 历史实测（6 个操作格右缘统一） | — |
| 三档视口重排 | 待验证 | `@media (max-width:720px)` | 手机工具栏三行排布 | 无 | **未在 900 / 375 实测过关系网重排** | 未验证 | 补三档实测 |

---

## 5. 世界观时间线（Timeline）

代码：`src/pages/Timeline.tsx`（319 行）｜ 路由值 `timeline` ｜ 懒加载 ｜ 受 `featureFlags.experimentalTimeline` 门控

| 功能 | 状态 | 实现证据 | 用户可见行为 | 数据依赖 | 验证 |
| --- | --- | --- | --- | --- | --- |
| 新建 / 编辑事件 | 已实现 | `submitDraft` | 标题、日期、可选纪年、类型、地点、描述、涉及角色 | `timeline` | 已测试（`timelineStorage` 21 例） |
| 按日期自动排序 + 年份分组 | 已实现 | `grouped`（`date` 升序；`era` 只用于显示） | 与录入顺序无关 | 同 | 已测试 |
| 删除事件 | 已实现 | `confirmDelete` | 二次确认 | 同 | 已测试 |
| 关联角色跳转 | 已实现 | `onOpenCharacter` | 点角色 chip 进入预览 | `characters` | 仅静态检查 |
| 日期精度 | 已实现 | `padDate()` | 接受 `2026` / `2026-05` / `2026-05-01`，读取时补齐 | 同 | 已测试 |
| 角色删除后引用清理 | 已实现 | `pruneTimelineCharacters()` | 事件保留，只移除失效关联 | 同 | 已测试（`referenceIntegrity`） |
| 弹窗键盘 | 待验证 | `useDialogKeyboard` | Escape 关闭、Enter 保存 | 无 | 未验证（KI-05） |
| 窄屏适配 | 部分实现 | `@media (max-width:720px)`；`.timeline-dialog` 用 `dvh` | 手机可用 | — | 历史实测（375×800：弹窗 355×776） |

---

## 6. 世界观管理（WorldManager）

代码：`src/pages/WorldManager.tsx`（381 行）｜ 路由值 `world` ｜ 懒加载 ｜ 受 `featureFlags.worldManager` 门控

| 功能 | 状态 | 实现证据 | 用户可见行为 | 数据依赖 | 验证 |
| --- | --- | --- | --- | --- | --- |
| 新建 / 编辑条目 | 已实现 | `submitDraft` | 名称、分类（6 种）、可选上级、简述、详情、标签、关联角色 | `world` | 已测试（21 例） |
| 层级（父子） | 已实现 | `parentId` + `worldChildren()` | 按分类分组，渲染最多 6 层 | 同 | 已测试 |
| 成环防护 | 已实现 | `wouldCreateWorldCycle()` | 上级选项排除自身与会成环的项 | 同 | 已测试 |
| 折叠 / 展开 | 已实现 | `collapsed` | 逐条折叠 | 无（会话级） | 仅静态检查 |
| 删除条目 | 已实现 | `confirmDelete` | 子级**脱离为顶层**而不是一起消失 | `world` | 已测试 + 历史实测 |
| 关联角色跳转 | 已实现 | `onOpenCharacter` | 点角色 chip 进入预览 | `characters` | 仅静态检查 |
| 角色删除后引用清理 | 已实现 | `pruneWorldCharacters()` | 条目保留，只移除失效关联 | 同 | 已测试 |
| 弹窗键盘 | 待验证 | `useDialogKeyboard` | Escape / Enter | 无 | 未验证（KI-05） |

---

## 7. 开发者中心（DeveloperCenter）

代码：`src/pages/DeveloperCenter.tsx`（1199 行）｜ 路由值 `developer`（**唯一有真实 URL 的路由**）｜ 懒加载

结构：`.developer-page` → `.panel.developer-hero`（徽章：Version / Sprint / Build / Theme / 数据版本 Local v1 / Prompt Library 文件名 / GitHub / Developer Handbook 链接）→ `.developer-layout` → `aside.developer-nav`（锚点到 9 个分节）→ `.developer-content`。

### 7.1 九个分节与实际写入的设置键

| 分节 id | 标题 | 控件与写入的键（摘要） |
| --- | --- | --- |
| `project` | Project / 项目 | Version / Sprint / Build / Release Label / Release Year（**全部只读**）→ `project.*`；按钮「恢复默认项目信息」「重置全部 Developer 设置」 |
| `brand` | 品牌资源 | App Logo / Header Logo（开关）→ `brandAssets.showAppLogo` / `showHeaderLogo`；About Logo Size（小中大）→ `brandAssets.aboutLogoSize`；复制 / 导出 SVG |
| `design` | 设计系统 | Accent Color → `appearance.accentColor`；Card Radius → `appearance.cardRadius`；Button Radius → `appearance.buttonRadius`；Input Radius → `designTokens.inputRadius`；Shadow Strength / Motion Level / Font Scale / Compact UI → `appearance.*` |
| `content` | 内容中心 | 11 个文案字段 → `content.*`（其中 Settings 说明、Toast 说明标注 comingSoon） |
| `prompt` | Prompt 中心 | 外挂词库 / 随机缺失字段 / 复杂度 / 重复控制 / 自定义词库 → `promptCenter.*` |
| `application` | 应用配置 | 页面标题 / Footer 文案 / 首次 About / 三个版本徽章 → `application.*`；六个编辑器默认值 → `editorDefaults.*`；六个主页默认值 → `dashboardDefaults.*` |
| `export` | Export / 导出规则 | JPG 质量 / PNG 截图倍率 / PDF Light Mode / 三个包含开关 → `exportDefaults.*` |
| `tools` | Developer Tools | 打开头像素材库、导出配置、导出角色 JSON、导出完整备份、复制 Debug Info、重置 |
| `experimental` | Experimental / 实验功能 | 9 个 feature flag 开关 → `featureFlags.*` |

### 7.2 状态与问题

| 项 | 结论 |
| --- | --- |
| 状态 | 已实现 |
| 数据依赖 | `character-studio-developer-settings`（单一真相源） |
| 已知问题 1 | **4 组不可达分节渲染分支**：`ai`（L835/841）、`debug`（L1125）、`data`（L1151/1165）、`update`（L1178）的 id 都不在 `developerSections` 列表（只有 9 个 id）里，因此**永不渲染**（KI-04） |
| 已知问题 2 | 7 个文案字段与若干导出选项标注「暂未应用」（KI-09） |
| 已知问题 3 | `compactMobileEditor` 开关写入 `data-compact-mobile-editor`，而 `styles.css` 无任何规则读取它（KI-06） |
| 验证 | 仅静态检查（组件本身无 `useState` / `useRef`，纯呈现） |

---

## 8. 头像素材库

代码：`utils/avatarAssets.ts`（374 行）+ `App.tsx` / `Dashboard.tsx` 两处弹窗

| 功能 | 状态 | 用户可见行为 | 数据依赖 | 验证 |
| --- | --- | --- | --- | --- |
| 浏览素材 | 已实现 | 缩略图 + 类型 + 体积 + 引用数（「正在被 N 个角色使用」/「未使用 / 无主素材」） | IndexedDB | 已测试 |
| 统计 | 已实现 | 素材总数 / 已绑定 / 未绑定 / 引用角色数 / 总占用 | IndexedDB + `characters` | 已测试 |
| 导入 / 导出 JSON | 已实现 | 全量或所选 | IndexedDB | 已测试 |
| 多选 / 全选 / 批量删除 | 已实现 | 有引用时二次确认，删除后角色回退 Emoji | IndexedDB + `characters` | 已测试 |
| 清理未使用 | 已实现 | 只删未被引用的素材 | IndexedDB | 已测试 |
| 顺序 | 已实现 | 按上传时间倒序（不再是 UUID 键序） | — | 历史实测 |

---

## 9. 导入 / 导出 / 备份 / 恢复

代码：`utils/importExport.ts`（1881 行）、`storage/workspaceBackup.ts`（295 行）、`utils/workspaceCsv.ts`（223 行）、`storage/backup.ts`（73 行）
详细格式与结构见 `docs/ARCHITECTURE.md` 第 6 节。

| 功能 | 状态 | 已知问题 / 限制 | 验证 |
| --- | --- | --- | --- |
| 单角色 JSON（含头像 Base64） | 已实现 | — | 已测试 + 历史实测 |
| 全部角色 JSON（不含头像） | 已实现 | — | 已测试 |
| 完整备份 JSON / ZIP | 已实现 | ZIP 走 manifest 绑定，禁止按文件名猜测 | 已测试（9 例）+ 历史实测 |
| CSV 全量表格（角色 + 关系 + 世界观 + 时间线） | 已实现 | 关系通过**角色名**建立 → 重名解析到第一个匹配；CSV 不携带角色 id（重建时生成新 id） | 已测试（5 例）+ 历史实测（117 行导出） |
| 无 `类型` 列的手写 CSV | 已实现 | 仍按「每一行都是角色」处理（旧行为，为了不破坏已有手写表格） | 已测试 |
| 头像素材 JSON | 已实现 | 可全量或只导所选 | 已测试 |
| PDF / JPG / PNG 展示导出 | 已实现 | 不可重新导入；截图库的两个限制已有兜底 | 已测试（颜色降级 6 例）+ 历史实测 |
| 导入预览与校验 | 已实现 | 取消不写任何数据 | 已测试 + 历史实测 |
| 自动快照与恢复 | 已实现 | 清空数据与导入前都写快照；清空时会连带删掉快照，因此快照在清空后写回 | 已测试（6 例） |
| 跨域引用清理 | 已实现 | 单删与批量删除共用 `pruneCharacterReferences()` | 已测试（3 例）+ 历史实测 |

---

## 10. Prompt 生成与复制

| 功能 | 状态 | 实现证据 | 用户可见行为 | 已知问题 | 验证 |
| --- | --- | --- | --- | --- | --- |
| 中文人物关键词 | 已实现 | `promptCenter` 设置 + `handleGenerateKeywords` | 本地规则生成，落到可编辑字段 | 抽选可能跨字段重复（历史台账 P1-10） | 仅静态检查 |
| 英文 AI Prompt | 已实现 | `handleGenerateImagePrompt` | 预设值有英文映射；自由文本保留中文 + 一行语言说明 | 自由文本翻译策略待定（需用户决策） | 历史实测 |
| 复制到剪贴板 | 已实现 | `navigator.clipboard.writeText` | 关键词与 Prompt 各有「复制」 | — | 仅静态检查 |
| 外挂词库 | 已实现 | `data/external-inspiration-library.txt`（37 KB，懒加载） | 可在开发者中心开关 / 替换 / 导出 | 文件导入为「Coming Soon」 | 仅静态检查 |

---

## 11. 公共交互与壳层

| 功能 | 状态 | 实现证据 | 已知问题 | 验证 |
| --- | --- | --- | --- | --- |
| 顶栏（吸顶 + 模糊） | 已实现 | `.topbar`，z-index `--z-overlay-6`(120) | 层级曾与列表吸顶头同为 80 导致菜单被盖，已提高 | 历史实测（三点命中菜单内） |
| 工作区切换菜单 | 已实现 | `workspace-menu` | 4 个入口按 feature flag 门控 | 历史实测 |
| 主题控件 | 已实现 | `theme-combo` + `theme-menu` | — | 历史实测 |
| 品牌标识回到初始界面 | 已实现 | `goDashboard({ resetFilters: true })` | 只清筛选，**不清视图模式**（设计） | 历史实测 + 已测试 |
| 全局弹窗（About / Settings / 素材库 / 清空 / 重置） | 已实现 | `App.tsx` | Escape 与点击背景关闭 | 历史实测 |
| 浮动栏 | 已实现 | `.floating-actions` | 条件出现：回到顶部（scrollY > 280 且页面更高一屏）、滑到底部（下方还剩 > 280） | 历史实测 |
| 「贴近主栏」 | **未实现** | — | 需求含义未确认（KI-03） | — |
| Toast | 已实现 | `.toast` + 四个语义类 | 单计时器 1.8s | 已测试（5 例） |
| 深链接 `/developer` | 已实现 | `404.html` + `BASE_URL` 推导 | — | 历史实测（deploy 校验项） |
| 懒加载块自愈 | 已实现 | `utils/lazyImport.ts` | 只在块取不到时刷新一次 | 已测试（`lazyImport`） |
| 快捷键总览 | 已实现 | `N` / `/` / `Esc` / `Enter` / `Cmd·Ctrl+K` / `Cmd·Ctrl+S` | About 面板内也列了这份表 | 部分未验证 |

---

## 12. 测试 / 构建 / 部署

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 单元测试 | 已实现 | **31 个文件 / 360 个用例**，本轮 `npm test` 全通过 |
| 类型检查 | 已实现 | `npm run typecheck`（`tsc -b`）退出码 0 |
| 生产构建 | 已实现 | `npm run build` 退出码 0，325 modules，2.29s |
| Pages 构建 + 构建信息 | 已实现 | `npm run build:pages` → `build-info.json` / `404.html` / `.nojekyll` |
| CI 部署 | 已实现 | `.github/workflows/deploy-pages.yml`：typecheck → test → build:pages → deploy |
| 线上一致性校验 | 已实现 | `npm run verify:deploy`；本轮线上 `build-info.json` 的 commit 与本地 HEAD 一致（`bccec24`） |
| 构建身份注入 | 已实现 | `scripts/build-identity.mjs`；工作树脏时提交号带 `-dirty` |
