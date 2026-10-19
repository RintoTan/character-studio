# Character Studio —— UI 审计

> 文档最后核查日期：2026-10-15 ｜ 基线提交 `bccec24`（2.27.0）
> **本文只分析 UI，不改 UI。** 所有条目都标注了证据来源与验证等级；未验证的一律显式标注。

---

## 0. 方法与限制

| 项 | 内容 |
| --- | --- |
| 手段 | 逐文件读源码（含行号）+ `styles.css` 令牌与规则统计 + 本仓库 `CHANGELOG.md` 中记录的历史真实浏览器实测（CDP 探针） |
| 本次**没有**做的 | 没有启动浏览器做新的视觉走查；没有在 1440 / 900 / 375 三档重新截图；没有做深色主题的目视检查 |
| 因此本文的性质 | **以源码为证据的静态审计** + 历史实测记录的汇总。凡标注「未验证」的，都需要一次新的渲染层检查才能作为结论 |
| 历史实测的来源 | `CHANGELOG.md` 各版本的「实测」段落（使用零依赖 CDP 驱动 `tools/cdp.mjs` 与 `tools/pages-server.mjs`）。这些读数是当时构建的真实数值，不是估计值 |

### 验证等级（本文全篇使用）

| 等级 | 含义 |
| --- | --- |
| **A 已由测试确认** | `test/` 下有对应用例且本轮 `vitest run` 通过 |
| **B 已在实际页面验证** | `CHANGELOG.md` 记录的浏览器实测（含真实输入、`elementsFromPoint`、逐元素几何） |
| **C 已从源码确认** | 读码可确定的行为与结构，未被渲染层验证 |
| **D 仅推测** | 从代码推断但未验证 |
| **E 无法确认** | 需要真机、用户输入或设计判断 |

---

## 1. 页面与布局清单

### 1.1 主页（Dashboard）｜路由 `dashboard`｜入口：应用落地页

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `.app-shell` > `.topbar` + `section.page-grid` ＞〔Toast / 16 组弹窗浮层〕+ `.panel.intro-panel`（Hero）+ `.panel`（列表面板）+ `.dashboard-footer`；右下 `.floating-actions` |
| 区块层级 | ① Hero：eyebrow `OC Workspace` + 列表标题 + 三个统计入口（全部 / 收藏 / 草稿）② 列表头：`角色列表` + 数量 + 右侧 `.list-header-actions`（搜索 → 筛选 → 视图切换 → 新建角色 → 更多）③ 内容区：`.skeleton-grid` / `.empty-state` / `.card-list`（卡片，>30 角色时按世界观分组且组头吸顶）/ `character-table-wrap` > `character-table`（表格） |
| 主要操作入口 | 工具栏 5 个 + 批量条（8 个）+ 更多菜单（3 组 8 项）+ 命令面板（7 项）+ 卡片/表格行菜单 + 页脚 3 个 |
| 数据展示 | 卡片：头像、名字、状态徽章（正式/草稿 + 置顶 + 收藏）、标签（默认最多 5 个，上限 8）、`创建 … · 编辑 …`；表格：7–8 列（状态列由与表头同一个布尔量决定） |
| 关键交互 | 搜索展开/收起（关键词保留）、筛选浮层、视图切换、批量模式、删除撤销 Toast、`N` / `/` / `Esc` / `Enter` / `Cmd·Ctrl+K` |
| 桌面 / 平板 / 移动 | `>1024` 卡片 4 列；`≤860` 工具栏换行（不隐藏入口）；`≤720` 标题与工具栏各占一行、展开的搜索框独占一行、新建按钮拉满居中、五个筛选下拉收进「筛选选项」、更多菜单贴视口固定 |
| 浅色 / 深色 | 全部使用令牌；历史实测过浅/深两套的三档对比度与横向溢出（B） |
| 已知视觉问题 | 设置弹窗（KI-01）、首次 About 排版（未核实）；历史台账记过「375px 下列表标题被截断 2px」，当时确认**与图标档改动无关**且未处理 |
| 未验证 | 置顶排序的实际视觉效果；工具栏吸顶时的滚动行为（2.26.0 之后未复测）；深色主题目视检查 |

### 1.2 角色编辑工作台（CharacterForm）｜路由 `form`｜入口：新建 / 编辑

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `section.workspace-shell` >〔Toast + 6 组弹窗〕+ `.panel.workspace-hero` + `.workspace-toolbar.editor-action-bar`（吸顶）+ `.workspace-nav`（进度 + 下一个未完成）+ `form.workspace-layout`（左侧 `workspace-nav`、右侧 `workspace-content` 六节）+ `.form-actions.workspace-footer` |
| 区块层级 | 六节顺序：基础信息 → 外貌设定 → 性格设定 → 个人偏好（flag 可隐）→ 能力设定 → 背景故事 → AI Prompt（flag 可隐） |
| 主要操作入口 | 操作栏：保存状态徽章 + `随机生成角色`｜`返回`·`预览`·`更多`·`保存角色`；各节内的头像动作（`选择 Emoji` / `更换头像`）、`随机灵感` / `清空` / `重新生成` / `复制`；页脚 `清空`·`删除`·`取消`·`临时保存`·`保存角色` |
| 数据展示 | 表单字段 + 头像舞台（`crop-dialog`：360×360 舞台 / 286×286 裁框）+ 完成度进度条 |
| 关键交互 | 保存（Cmd/Ctrl+S）、autosave、折叠记忆、跳到下一个未完成（到末尾绕回）、随机生成、裁剪（拖动 / 滚轮 / 滑杆 / 最小最大）、离开提示 |
| 桌面 / 平板 / 移动 | `≤720` 操作栏只留「更多 / 保存角色」；`≤430` 有 15 条规则（含移动编辑器操作行） |
| 浅色 / 深色 | 令牌驱动；**未做深色目视检查（E）** |
| 已知视觉问题 | **六个分节设计语言未统一（KI-02）**；`compactMobileEditor` 开关无任何 CSS 生效（KI-06）；裁剪弹窗残留 `position: sticky; bottom: -18px`（未决定） |
| 未验证 | 表单字段数（历史上探针选择器不匹配，**不计入结论**）；吸顶行为在滚动新工具栏时的表现；Tab 顺序与焦点陷阱；操作栏玻璃效果的**视觉效果**（只改了值，未读数也未截图） |

### 1.3 角色预览页（CharacterPreview）｜路由 `preview`｜入口：主页 / 保存后 / 各工作区点击角色

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `section.preview-page` >〔Toast / 导出弹窗 / 头像大图弹窗〕+ `div[data-pdf-export-root]` > `.preview-hero`（`.preview-identity` + `.preview-avatar-button`）+ `.preview-actions[data-pdf-hidden]` + `.preview-layout`（`.basic-card` + 8 张 `.wide-card` + 时间卡 + `.preview-export-footer`） |
| 区块层级 | Hero（eyebrow `Character Preview`、h1 角色名、副行 `职业 / 世界观`、头像）→ 基础资料卡 → 性格标签 / 视觉风格 / 外貌 / 能力 / 背景 / 个人偏好 / 中文关键词 / 英文 Prompt |
| 主要操作入口 | 双模式（`browse`：编辑 / 收藏 / 导出 / 返回；`editing`：返回编辑 / 保存草稿 / 删除角色 / 保存角色） |
| 数据展示 | 只读展示；空字段有兜底文案（`未填写` / `未命名角色`） |
| 关键交互 | 导出弹窗（4 种格式）、收藏切换、头像大图、Escape 关闭 |
| 桌面 / 平板 / 移动 | 桌面两列布局（历史实测两列节奏与编辑页字段网格一致）；窄屏单列（按钮显示图标 + `.desktop-label` / `.mobile-icon` 双标签） |
| 浅色 / 深色 | 令牌驱动 |
| 已知视觉问题 | 历史反馈「界面平淡、信息分散、无层次」——**属性为设计评估，不是缺陷（E）** |
| 未验证 | 头像大图弹窗；窄屏下双标签切换是否真的只渲染一个（历史上关系网有过 `display:none` 被覆盖的同类问题） |

### 1.4 角色关系网（RelationshipGraph）｜路由 `relationships`｜入口：顶栏工作区菜单

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `section.workspace-card.relationship-page` > `.workspace-card-head`（eyebrow `RELATIONSHIPS` + h2 `角色关系网` + 副行 `N 个角色 · M 条关系`）+ `.workspace-toolbar` +〔两种 `.empty-state`〕+ `.graph-canvas-frame` > `svg.relationship-canvas` + `.graph-canvas-bar` + `.relationship-table-head` + `.relationship-table-wrap` > `table.relationship-table` + `.graph-message` +〔新建关系 / 删除关系弹窗〕 |
| 区块层级 | 工具栏（3 个控件）→ 画布 → 画布栏（两组：节点外观 + 导出）→ 关系列表 |
| 主要操作入口 | `缩小画布` · 百分比（即适配）· `放大画布` · 切换可见集 · `新建关系`；画布栏 `头像` 小中大 / `名称` 小中大 / `分辨率` 1x·2x·3x / `JPG`·`PNG`·`PDF` |
| 数据展示 | 径向图（一个居中、两个水平、三个以上成环，半径随人数增长）；关系表格 5 列（备注是唯一允许换行的列） |
| 关键交互 | 滚轮缩放（原生 `{passive:false}`）、拖拽平移、双指缩放、悬停高亮邻居、点击节点进入角色、删除确认 |
| 桌面 / 平板 / 移动 | `≤720` 工具栏换行；画布高度 `clamp(320px, 58vh, 680px)` 量级；历史实测 375px 下工具栏 142px 高（三行）、画布 357×164 |
| 浅色 / 深色 | 画布背景取当前主题 `body` 背景色（JPEG 无 alpha，透明会变黑） |
| 已知视觉问题 | 历史反馈「混乱的控件 / 灾难的列表 / 没有视觉对齐」——**2.27.0 已按 8 项处理**（工具栏 5→3 控件、画布栏统一控件语言、表格对齐、吸顶表头等），并有实测记录（B） |
| 未验证 | **三档视口下的重排（KI-11）**；深色主题目视检查；3x 导出实际字节数 |

### 1.5 世界观时间线（Timeline）｜路由 `timeline`｜入口：顶栏工作区菜单

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `section.workspace-card.timeline-page` > `.workspace-card-head`（eyebrow `TIMELINE` + h2 `世界观时间线` + 副行 `N 个事件 · M 个年份`）+ `.workspace-toolbar`（`返回 Dashboard` · `新建事件`）+〔`.empty-state`〕+ `ol.timeline-rail` > `li.timeline-year-group`（`h3.timeline-year`）> `ol.timeline-events` > `li.timeline-item` > `article.timeline-card` |
| 区块层级 | 卡片头（类型 chip + `<time>` + 操作）→ 标题 → 地点 → 描述 → 关联角色 chip |
| 主要操作入口 | `返回 Dashboard`、`新建事件`、每条 `编辑` / `删除`（aria-label 含事件标题）、关联角色 chip |
| 数据展示 | 按年份分组、按日期升序；纪年标签用于显示，排序不依赖它 |
| 关键交互 | 新建 / 编辑 / 删除（二次确认）弹窗；Escape / Enter（键盘证据未取得，E） |
| 桌面 / 平板 / 移动 | 弹窗用 `max-height: min(88vh→dvh, 720px)`；历史实测 375×800 下弹窗 355×776、选择器列表 180px / 114 行 |
| 浅色 / 深色 | 令牌驱动 |
| 未验证 | 深色主题目视检查；弹窗键盘行为 |

### 1.6 世界观管理（WorldManager）｜路由 `world`｜入口：顶栏工作区菜单

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `section.workspace-card.world-page` > `.workspace-card-head`（eyebrow `WORLD` + h2 `世界观管理` + 副行 `N 个条目 · M 个分类`）+ `.workspace-toolbar`（`返回 Dashboard` · `新建条目`）+〔`.empty-state`〕+ `.world-groups` > `section.world-group` > `h3` + `ul.world-roots` > `li.world-node` > `article.world-entry`（缩进 = 深度 × 16px） |
| 区块层级 | 条目头（折叠按钮 + 名称 + 操作）→ 简述 → 标签 → 关联角色 chip → 子级列表（最多 6 层） |
| 主要操作入口 | `返回 Dashboard`、`新建条目`、每条折叠 / `编辑` / `删除`（aria-label 含条目名）、关联角色 chip |
| 数据展示 | 按分类分组；层级以左缩进 + 折叠表达 |
| 关键交互 | 新建 / 编辑 / 删除（二次确认；删除父级时子级脱离为顶层）；折叠；Escape / Enter（键盘证据未取得，E） |
| 桌面 / 平板 / 移动 | `max-width:720px` 内的规则；未做专项实测（E） |
| 浅色 / 深色 | 令牌驱动 |
| 未验证 | 窄屏下 6 层缩进的可读性；深色主题目视检查 |

### 1.7 开发者中心（DeveloperCenter）｜路由 `developer`（唯一有真实 URL 的路由）

| 维度 | 内容 |
| --- | --- |
| 整体结构 | `.developer-page` > `.panel.developer-hero`（版本徽章行 + 链接）+ `.developer-layout` > `aside.developer-nav`（9 个锚点）+ `.developer-content` > `.developer-card` × 9 |
| 区块层级 | 每个分节是一张 `.developer-card`；字段用 `.developer-setting-field`（说明栏 200px 保底 + 控件栏） |
| 主要操作入口 | 开关 / 下拉 / 数字 / 颜色 / 滑杆 / 按钮；每个分节底部有「恢复默认」 |
| 数据展示 | 版本徽章、统计网格、只读 JSON 预览、状态徽章（已应用 / 暂未应用 / 只读） |
| 关键交互 | 所有写入经 `onSettingsChange`；无弹窗、无 `useState`（纯呈现） |
| 桌面 / 平板 / 移动 | `@media (max-width:1024px)` 3 条 + `≤720` 规则 |
| 浅色 / 深色 | 令牌驱动 |
| 已知视觉问题 | 4 组永不渲染的分节分支（KI-04）；7 个文案字段与若干导出选项标注「暂未应用」（KI-09）；信息密度偏高 |
| 未验证 | 深色主题目视检查；`auto-fit` 窄列下说明文字的换行（历史上曾被压成每行一个字，2.1.0 已修） |

### 1.8 公共壳层

| 区域 | 结构 | 已知问题 | 验证 |
| --- | --- | --- | --- |
| 顶栏 `.topbar` | 品牌标识（回到初始界面）+ 工作区切换 + 主题组合控件 | 层级曾与列表吸顶头同为 80 导致菜单被盖 → 提到 120（`--z-overlay-6`） | B（三点 `elementsFromPoint` 命中菜单内） |
| 浮动栏 `.floating-actions` | 胶囊容器：回到顶部 / 滑到底部 / 上下文动作 | 「贴近主栏」需求未确认（KI-03）；历史上曾把窄屏触摸目标做成 40px（低于常用下限），已改回 44px | B |
| 页脚 | `About Character Studio` · `头像素材库` · `Settings` · 版权 | 短页面页脚浮空（2.4.1 已修：空白 279 → 48px） | B |
| Toast | `.toast` + `success` / `warning` / `error` / `loading` | 历史上多条消息会继承上一条的剩余寿命（2.17.0 改为单计时器） | A |
| 弹窗层 | `.modal-backdrop`（900）/ `.export-backdrop` / `.confirm-dialog` | Escape 曾三份手写清单不一致（2.15.0/2.16.0 → 一份 22 项声明） | B |

---

## 2. 设计系统盘点

### 2.1 颜色与主题令牌（C，来源 `styles.css` 逐条核对）

| 语义 | 浅色 | 深色覆盖 |
| --- | --- | --- |
| `--bg` | `#f3f4f6` | `#0f1115` |
| `--surface` | `#ffffff` | `#171a21` |
| `--surface-subtle` | `#f9fafb` | `#20242d` |
| `--text` | `#111827` | `#f4f4f5` |
| `--text-soft` | `#374151` | `#d4d4d8` |
| `--muted` | `#5b6472` | `#a1a1aa` |
| `--border` | `#e5e7eb` | `#2b303b` |
| `--border-strong` | `#d1d5db` | `#3f4654` |
| `--primary` | `#111827`（运行时被 `appearance.accentColor` 覆盖，默认 `#635ab2`） | `#f4f4f5` |
| `--primary-hover` | `#374151`（运行时由强调色推导） | `#d4d4d8` |
| `--on-primary` | `#ffffff`（运行时按对比度自动取白或 `#111827`） | — |
| `--danger` | `#b91c1c` | `#fca5a5` |
| `--danger-bg` | `#fef2f2` | `#3f1d22` |
| `--danger-border` | `#fecaca` | `#7f1d1d` |
| `--avatar-tint` | `rgba(17,24,39,.06)` | `rgba(244,244,245,.08)` |
| 派生填充 | `--control-fill: color-mix(in srgb, var(--text) 7%, var(--surface))`、`-hover` 12%、`-active` 17% | 同（由深色 `--text` / `--surface` 计算） |
| 阴影 | `--shadow: 0 10px 28px rgba(15,23,42,.06)`；`--shadow-strong: 0 16px 34px rgba(15,23,42,.1)` | `rgba(0,0,0,.25)` / `rgba(0,0,0,.34)` |
| 焦点环 | `--focus-ring: 0 0 0 3px rgba(107,114,128,.16)` | — |

**机制**：主题由 `:root[data-theme]` 切换，同时设置 `color-scheme`（原生下拉与滚动条跟随）。强调色、阴影强度、动效时长、圆角、字体缩放由 `applyDeveloperSettings()` 在运行时写入 `:root` 的内联 CSS 变量。

**标签色**：`.tag-tone-0…17` 共 18 组 `--tag-bg` / `--tag-border` / `--tag-text`，深浅各一套，并在 `.pdf-safe` 下重复一份（导出不能依赖 `color-mix()`）。

### 2.2 字体与排版（C）

| 项 | 值 |
| --- | --- |
| 根字体栈 | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", var(--emoji-font)` |
| Emoji 字体栈 | `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`（挂在根字体末尾，全站继承） |
| 基准字号 | `body { font-size: calc(16px * var(--developer-font-scale)) }`（缩放范围 0.92–1.12） |
| 按钮 | `13.5px` / `font-weight: 650` / `line-height: 1` |
| 等宽（JSON 预览） | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` |
| 行高 | 根 `1.5` |
| **未确认** | 标题层级（h1–h4）没有集中的字号阶梯令牌；各级字号散落在各区块规则中，**无法确认存在统一的排版比例** |

### 2.3 间距、圆角、边框、阴影（C）

| 类别 | 值 |
| --- | --- |
| 间距令牌 | `--pad-surface:24px`、`--pad-card:16px`、`--pad-rail:12px`、`--btn-gap:8px`；紧凑模式（`data-compact-ui="true"`）把若干卡片内边距压到 12px |
| 圆角 | `--control-radius:8px`（输入 / 下拉）、`--developer-card-radius:8px`（卡片 / 面板 / 弹窗）、`--dialog-radius:10px`、`--developer-button-radius:10px`（按钮）、`.floating-action: 999px` |
| 边框 | 1px `--border` 为主；图标按钮与主按钮用 `2px solid transparent`（保持尺寸稳定）；`--border-strong` 用于强调与 hover |
| 阴影 | 只两档（`--shadow` / `--shadow-strong`），强度由开发者设置改写 |
| **未确认** | 间距并非完全令牌化：`styles.css` 中仍有大量字面量（`gap: 6px/10px/12px`、`padding: 6px 10px` 等）。**无法确认存在完整的间距阶梯**，只能说存在三个语义化内边距令牌 |

### 2.4 控件（C）

| 控件 | 规格 | 状态 |
| --- | --- | --- |
| 主按钮 `.primary-button` | 42px / 圆角 `--developer-button-radius` / 填充 `--primary` / 文字 `--on-primary` | hover 用 `--primary-hover`（由强调色推导，避免 hover 无反馈） |
| 次要 `.secondary-button` | 42px / `--control-fill` / `--text` | hover / active 加深 |
| 描边感 `.ghost-button` | 42px / `--control-fill` / `--text-soft` | hover 底色加深、文字变 `--text`；`.active` 加 `--primary` 边 |
| 危险 `.danger-button` | 42px / `--control-fill` / 文字 `--danger` | 破坏性靠文字颜色承担，不用大红块 |
| 图标按钮三兄弟 | `36×36`，`2px` 透明边 | `.active` / `.primary-icon` 变体 |
| 紧凑档 | `--control-height-compact: 34px` | 只用于手机导航 chip 与移动编辑器操作行 |
| 浮动按钮 | 44×44 / 圆角 999px | 触控下限 44px |
| 输入框 / 下拉 | 圆角 `--control-radius`，高度随 `--control-height` | 焦点用 `--focus-ring` |
| 复选框 / 开关 | `.settings-check`；开关带 `role="switch"` + `aria-checked` | — |
| 分段控件 | `.segmented-row` / `.graph-zoom` / `.graph-segment` | 画布栏 12 个分段按钮实测高度全为 **26px**、宽度 34–45 |
| 徽章 | `.status-badge`（正式 / 草稿 / 置顶 / 收藏） | 历史上曾因 emoji 字体栈接管 ASCII 数字而显示成「2 · 5 · 0」（2.7.0 已修） |

### 2.5 弹窗、菜单、提示（C + B）

| 组件 | 规格 | 已知差异 |
| --- | --- | --- |
| `.modal-backdrop` | `rgba(17,24,39,.32)`，z-index 900 | 点击背景关闭（命令面板在 2.22.0 补上） |
| `.confirm-dialog` | 圆角 `--dialog-radius`、内边距 `--pad-surface` | 依赖提示：多个「更宽的弹窗」需要复合选择器（`.confirm-dialog.bulk-edit-dialog`），单类会被基础类覆盖（2.11.0 的实际教训） |
| 各类 dialog | `export-dialog` / `settings-dialog` / `about-dialog` / `asset-library-dialog` / `crop-dialog` / `avatar-preview-dialog` / `timeline-dialog` / `world-dialog` / `helper-dialog` / `mobile-bulk-dialog` / `bulk-edit-dialog` / `developer-mini-dialog` | **宽度与内边距不统一**（历史台账 P1-8 记录圆角 8/10/18px、内边距 16/18/22/24px） |
| 菜单 | `.workspace-menu` / `.theme-menu` / `.card-menu` / `.table-card-menu` / `.editor-more-menu` | 统一：圆角、阴影、hover、Escape 关闭、点击外部关闭 |
| Toast | 四个语义类，单计时器 1.8s | — |
| Tooltip | `data-tooltip` 属性驱动 | 延迟 / 字号 / 圆角**未做统一核对**（E） |

### 2.6 图标（C）

42 个线性 SVG（24×24 网格，`strokeWidth 1.7`，`currentColor`）。三个图标带光学重心补偿（`heart`、`sparkles`、`tool`）；其余 37 个实测偏差在 0.5 单位内（UI 尺寸下不足半像素），刻意不调。

### 2.7 响应式断点（C）

`(hover:none) and (pointer:coarse)`（触控 overscroll）· `1024px`（3 条）· `860px`（1 条）· `720px`（约 160 条，分散在 5 个块）· `430px`（15 条）· `prefers-reduced-motion: reduce`（3 条，两个块）。

**关键约束**：`body` 必须 `overflow-x: clip` + `overflow-y: visible`。写成 `overflow-y: auto` 会让 body 成为滚动容器，全站 `position: sticky` 静默失效（2.2.0 的根因）。

### 2.8 主题切换机制（C）

1. `App.tsx` 读 `character-studio.theme`（`system` / `light` / `dark`），`system` 时监听 `prefers-color-scheme`。
2. 写入 `document.documentElement.dataset.theme`。
3. `styles.css` 用 `:root[data-theme="dark"]` 覆盖令牌，并设置 `color-scheme`。
4. 强调色 / 圆角 / 阴影 / 动效由 `applyDeveloperSettings()` 写入 `:root` 内联变量。

### 2.9 一致性与差异（结论）

**一致的部分**：按钮盒模型与四种变体、图标尺寸与网格、卡片 / 面板圆角、三档控件高度、z-index 令牌体系、弹窗的关闭行为（Escape + 点击背景）、主题令牌的覆盖方式。

**不一致的部分（有证据）**：

| # | 差异 | 证据 |
| --- | --- | --- |
| 1 | 弹窗宽度与内边距不统一 | 历史台账 P1-8；本轮读码确认存在 12 个 `*-dialog` 类，各自声明宽度 |
| 2 | 编辑页六个分节的节内排布不一致 | KI-02 |
| 3 | 颜色字面量约 140 处（集中在样式表前 5079 行） | KI-08 |
| 4 | 间距字面量仍大量存在，筹码不全 | 2.3 节「未确认」 |
| 5 | 标题字号阶梯无集中令牌 | 2.2 节「未确认」 |
| 6 | Tooltip 的延迟 / 字号 / 圆角未核对 | 2.5 节「未确认」 |
| 7 | 设计令牌有两份并行定义（`styles.css` 与 `config/themeTokens.ts`） | KI-07 同源问题；`themeTokens.ts` 无运行时读取方 |

---

## 3. 交互行为盘点

每条都标注验证等级（A/B/C/D/E）。**A–C 可直接作为结论；D–E 需要一次新的验证。**

### 3.1 导航与页面跳转

| 行为 | 细节 | 等级 |
| --- | --- | --- |
| 品牌标识 → 主页 | `goDashboard({ resetFilters: true })`：清搜索 + 三个筛选 + 收藏范围；**保留视图模式**（视图模式不在「初始状态」范围内） | B |
| 工作区切换 | 顶栏菜单 4 个入口，按 feature flag 门控（没发布的模块不出现死入口）；当前项有选中态 | B |
| 编辑 → 保存 | **保存已有角色会落到该角色的预览页**，不是主页。这一点曾被一次探针误读成「回到了 Dashboard」，此后成为显式记录的事实 | B |
| 二级页 → 角色 | 关系网节点、时间线角色 chip、世界观角色 chip 都进入该角色预览页 | C |
| 浏览器后退 | `history.pushState` + `popstate`；只有 `/developer` 有真实 URL | B（deploy 校验覆盖深链接回退） |
| 浮动栏 | 回到顶部（`scrollY > 280` 且页面更高一屏）、滑到底部（下方还剩 > 280）；8 角色时页面本就到底，**不出现** | B |

### 3.2 搜索、筛选、排序

| 行为 | 细节 | 等级 |
| --- | --- | --- |
| 进入页面搜索面板状态 | **恒为关闭**（不变量）。历史上三个写入者（设置、复选框、roster-size effect）已收敛 | B（同一份 40 角色数据前后对照：线上 `open` / 高度 127px ↔ 本次 `高度 0`） |
| 展开搜索 | 在工具栏内展开、自动聚焦；展开不引起页面跳动（表头位置不变） | B |
| 收起搜索 | `Escape` 或再点图标；**关键词保留**，图标以 active 标记「列表正在被过滤」 | B |
| `/` 与跨页搜索信号 | 打开**搜索框**（不是筛选面板）。2.26.0 重构后必须一起改，否则会悄悄打开错的面板 | B |
| 筛选 | 复用原有筛选面板（范围 / 排序 / 世界观 / 性别 / 视觉风格）与原有字段、状态、清空逻辑，从「撑开页面的一栏」改为浮层 | B |
| 清空筛选 | 清搜索 + 三个筛选 + 收藏范围，**并把排序重置为「最近更新」** | A |
| 编辑器删除后的重置 | 清搜索 + 三个筛选 + 收藏范围，**但不动排序** | A（两条规则共用 `clearedFilters()`，差异由 `resetSort` 参数表达，**刻意不统一**） |
| 排序 | 四种模式；**收藏不参与排序因子**，收藏也不写 `updatedAt`，因此「仅收藏」不会重排 | A + C |
| 关键词匹配范围 | 角色名、职业、世界观、性格标签 | C |
| 快捷键 | `N` 新建、`/` 搜索、`Esc` 关闭层、`Enter` 打开首个搜索结果、`Cmd/Ctrl+K` 命令面板 | 部分 B |

### 3.3 表单编辑、保存与取消

| 行为 | 细节 | 等级 |
| --- | --- | --- |
| 保存校验 | 名字为空被拒且**不写任何东西**（只提示一次） | A + B |
| 名字 trim | 保存时 `"  改名后  "` → 存储为 `改名后` | A + B |
| 身份字段 | `id` / `createdAt` 不变，`updatedAt` 更新；未触碰的字段原样保留 | A + B |
| 草稿通道 | 「临时保存」写草稿（`isDraft` + `draftOfId`），同一个来源角色只保留一份 | A |
| 自动保存 | 对草稿生效；有改动时写一次并置为「已保存」；无改动不重复写；可在开发者设置中关闭 | A |
| 离开提示 | 无改动不弹，有改动才弹 | A |
| 保存状态徽章 | 打开已有角色显示「已保存」；打开新建角色显示「未保存」；清空表单恒为「未保存」 | A |
| 清空内容 | 只清表单字段，**不改存储** | A |
| 删除角色 | 走确认弹窗；确认后删除并请求主页清除筛选 | A + B |
| 折叠记忆 | 作者的折叠写入 `character-studio.editor-sections`；开发者设置的「展开/折叠全部」是**每次打开的默认值**，**刻意不写存储** | A + B |
| 跳到下一个未完成 | 跳到下一个未完成节并展开；到末尾**绕回**；全部完成时提示且不移动 | A + B |
| 年龄 / 生日互斥 | 输入年龄清空生日；输入生日派生年龄并清空另两个字段 | A + B |
| 标签输入 | trim 后入库并清空输入框；空白输入被拒且保留原文；已有标签不重复添加但输入框照样清空 | A |
| 裁剪 | 打开时 zoom 1、offset (0,0)；滑杆下限由 `minZoom` 夹取；拖 9000px 夹到 **(37,37)**（解析解） | A + B |

### 3.4 收藏、删除、导入、导出

| 行为 | 细节 | 等级 |
| --- | --- | --- |
| 收藏 | 只表示 quick access；**不更新 `updatedAt`**；收藏夹视图只显示正式角色 | A + C |
| 删除撤销 | 删除后 Toast 提供撤销 | B |
| 批量删除 | 删除并**清理三个域的引用**（历史上这条路径漏了这一步） | A + B |
| 单角色删除 | 一直会清理引用（与批量删除共用同一个 helper） | A + B |
| 导入 | 解析 → 预览 → 确认 → 写入；**取消不写任何数据**；先写自动快照 | A + B |
| 导入校验 | 悬空引用 / 自环 / 未知类型 / 重复 id 被丢弃；世界观父级不在同批则清空 | A + B |
| 合并策略 | 按 id **合并而不是覆盖** | A |
| 导出（JSON / CSV） | 往返：导出的 CSV 可以直接导入回来 | A + B |
| 导出（PDF / JPG / PNG） | 预览页与关系网两条截图路径都接了克隆期颜色降级 | A + B |
| 清空全部数据 | 先写快照，再 `localStorage.clear()`，**并把快照写回**（否则快照会被自己删掉） | A |

### 3.5 弹窗、菜单与层

| 行为 | 细节 | 等级 |
| --- | --- | --- |
| Escape | **关闭所有已声明的层**（包括破坏性确认框 —— 在确认框上 Escape 等于「取消」，是不碰数据的方向） | B |
| 点击外部关闭 | 下拉、卡片菜单、命令面板、各弹窗（点背景）；**菜单与弹窗互斥**（有 blocking 层打开时背景菜单自己关） | B |
| 同时只打开一个菜单 | 由 `blocksMenus` + `blockingSignature` 保证；**一个弹窗换成另一个时签名必须变化**（布尔值会漏掉这种情形，已有单测钉住） | A |
| 层序 | 内联 5–40 / 浮层 120–160 / 弹窗遮罩 900 / 内容 910 / Toast 1000。顶栏提到 120 是因为它与列表吸顶头（80）曾经持平、而头部在文档中更靠后 | B |
| 键盘（Enter 确认 / 焦点进入与恢复） | `useDialogKeyboard` 已接入 6 个弹窗 + Dashboard | **E（无有效证据，见 KI-05）** |
| 小屏菜单防裁切 | 375px 下「更多」菜单改为贴视口固定（右下角 + `max-height: min(72vh, 420px)`） | B |

### 3.6 滚动、吸顶与定位

| 行为 | 细节 | 等级 |
| --- | --- | --- |
| 顶栏吸顶 | `position: sticky; top: 0`，半透明 + `blur(12px)` | B |
| 吸顶偏移 | 由 `ResizeObserver` 测量顶栏与编辑页操作栏的真实高度写入 `--topbar-height` / `--editor-bar-height`，偏移写成 `calc()` 表达式 | B（1280 → 停 54 / 46；375 → 停 103 / 95） |
| 列表工具栏吸顶 | 跟随滚动（沿用原来「控制跟着滚动」的行为，只是换了位置） | B |
| 列表吸顶头**不透明** | 曾经的 92% 表面色 + 模糊让下方滚过的行透出来，被误读成「列表错位」；改为不透明 + 底部一条分割线 | B |
| 关系网滚轮 | 原生 `{passive:false}` 监听：画布上滚动只缩放（`scrollY` 300 → 300、缩放 100% → 115%） | B |
| 编辑页吸顶链 | 操作栏停在顶栏下方；侧栏 `position: sticky` 生效（依赖 `body` 的 overflow 约束） | B |
| 浮动栏不遮挡 | 历史实测：关系列表底 705.75 < 漂浮按钮顶 730 | B |

### 3.7 空状态、错误状态、加载状态

| 状态 | 细节 | 等级 |
| --- | --- | --- |
| 加载中 | `.skeleton-grid` / `.page-fallback`（懒加载路由的 `Suspense` 回退，含 spinner 与「加载中…」） | C |
| 空状态（无角色） | `.empty-state` | B |
| 搜索无结果 | 独立文案（与「无角色」区分） | B |
| 关系网空状态 | **两种**：角色不足两个（`至少需要两个角色`）、还没有关系（`还没有关系`，含引导句） | C |
| 时间线 / 世界观空状态 | `还没有事件` / `还没有世界观条目` | C |
| 导入失败 | Toast 提示；**不静默失败** | B |
| 导出失败 | 显示 html2canvas 的原话（含裸字符串），而不是笼统的「导出失败」 | B |
| 懒加载失败 | 块取不到时刷新一次自愈；真错误原样抛出（不刷新，避免把 bug 藏在刷新循环后） | A |
| 素材库空 | `暂无本地头像素材。` | C |
| 素材引用提示 | `正在被 N 个角色使用` / `未使用 / 无主素材` | C |
| 保存失败 | 徽章显示「保存失败」 | A |

### 3.8 重复操作、隐藏入口与行为不一致

| # | 观察 | 证据 | 等级 |
| --- | --- | --- | --- |
| 1 | 预览页的**双模式**是有意的（谁打开的，决定它提供什么），不是重复入口 | 2.25.0 的设计决定 + 实测 | B |
| 2 | 编辑器**没有**面向作者的「展开全部 / 折叠全部」控件 —— 它们只在开发者设置里。曾差点把设计报成缺陷 | 读码确认 | C |
| 3 | 导出入口只保留两处职责清晰的位置（主页按范围与格式 / 关系网画布）；预览页浮动导出、编辑器浮动保存按钮已移除 | 2.2.0 / 2.23.0 | B |
| 4 | 「清空筛选」与「编辑器删除后重置」在排序上的差异是**有意的**，不是漂移 | `dashboardPrefs.ts` 的 `resetSort` 参数 + 单测 | A |
| 5 | 开发者设置里的「展开/折叠全部」作为默认值**刻意不持久化**；若统一反而会覆盖作者习惯 | `useEditorSections` 的两个具名函数 + 单测 | A |
| 6 | `compactMobileEditor` 开关写了 `data-compact-mobile-editor` 但**没有 CSS 读取** → 界面上是个无效果的开关 | 本轮 grep：`styles.css` 0 命中 | C（KI-06） |
| 7 | Developer Center 有 4 组永不渲染的分节分支 | `developerSections` 只有 9 个 id | C（KI-04） |

---

## 4. UI 问题分类与优先级

按任务要求的十类归类。**没有证据的只能列为待验证的设计假设**，不得标为已确认缺陷。

### 4.1 已确认问题

| 编号 | 问题 | 类型 | 优先级 | 证据 | 影响 |
| --- | --- | --- | --- | --- | --- |
| UI-01 | 设置弹窗偏窄、中英混排、未发布功能与在用功能并列 | 信息密度／设计系统缺失 | **P2** | `App.tsx` L1406–1470；`settings-grid` 仅 4 张卡，标题为 `Appearance` / `About Data`；AI 区块为 Coming Soon 占位 | 作者在设置里看到英文标题与尚不可用的配置，产生「这功能是不是坏了」的疑问 |
| UI-02 | 编辑页六个分节的节内排布与措辞风格不一致 | 间距与排版不一致／设计系统缺失 | **P2** | `CharacterForm.tsx` 六节渲染体；`styles.css` 中 `.workspace-card` / `.field-*` 存在非令牌字面量 | 六节之间移动时像换了界面，削弱「这是一个工作台」的感觉 |
| UI-03 | 浮动栏「贴近主栏」 | 页面布局不合理（需求未明） | **P2** | `App.tsx` L1065–1160；「主栏」在代码中没有对应概念 | 需求无法安全实施，可能引入遮挡 |
| UI-04 | `compactMobileEditor` 是无效果的开关 | 交互行为不一致（承诺与实现不符） | **P3** | `applyDeveloperSettings` L407–410 写 dataset；`styles.css` 0 命中 | 与项目原则冲突；读代码的人会以为它在生效 |
| UI-05 | Developer Center 4 组永不渲染的分节分支 | 设计系统缺失（死代码） | **P3** | `developerSections` 9 个 id vs 渲染分支含 `ai`/`debug`/`data`/`update` | 无用户可见影响；误导后续读者 |
| UI-06 | 关系网三档视口重排未实测 | 响应式布局问题（**待验证**） | **P3** | `CHANGELOG` 2.27.0 自述未验证 | 900 / 375 下的工具栏换行与画布高度缺记录 |
| UI-07 | 约 140 处硬编码颜色字面量 | 设计系统缺失 | **P3** | 本轮统计（样式表前 5079 行） | 主题一致性靠人工维持，深色易漏改 |
| UI-08 | 12 个 `*-dialog` 的宽度与内边距不统一 | 间距与排版不一致 | **P3** | 历史台账 P1-8 + 本轮读码确认 | 弹窗之间观感不一致 |
| UI-09 | 深色主题缺目视检查 | 视觉层级（**未验证**） | **P2** | 多版 CHANGELOG 自述未验证；本轮也未做 | 深色下的层级与对比度只有令牌保证，没有渲染层证据 |
| UI-10 | 操作栏玻璃效果只有数值改动，无视觉确认 | 视觉层级（**未验证**） | **P3** | 2.27.0 自述「只改了值，未读数也未截图」 | 无法确认玻璃是否真的看得出来 |
| UI-11 | 空状态与反馈整体完整，但 Tooltip 的延迟 / 字号 / 圆角未核对 | 设计系统缺失（**待确认**） | **P3** | 本轮读码未能确认统一规范 | 可能出现逐处不同的提示样式 |

### 4.2 按类型的分布

| 类型 | 已确认项 | 说明 |
| --- | --- | --- |
| 视觉层级不清晰 | UI-09、UI-10 | 都是**未验证**项，不能作为缺陷记账 |
| 页面布局不合理 | UI-03 | 需求未明 |
| 间距与排版不一致 | UI-02、UI-08 | 可改，风险低 |
| 操作入口混乱或重复 | **无** | 历史上最集中的一批（预览页导出/复制、三个工作区入口、第三个回主页入口、独立适配按钮）已在 2.2.0–2.27.0 处理 |
| 信息密度过高或过低 | UI-01 | 设置弹窗与开发者中心 |
| 空状态与反馈不明确 | **无已确认项** | 五种空状态 + 四种 Toast + 导出/导入失败提示均在位且有实测 |
| 交互行为不一致 | UI-04 | 其余历史差异已收敛并写入测试 |
| 响应式布局问题 | UI-06 | 待实测 |
| 可访问性与键盘操作问题 | **键盘项无有效证据（KI-05）** | 对比度 / `role="switch"` / 无无名控件 / 无缺 `alt` 曾在 1.0.0 于渲染层核验；键盘行为只有类型检查 |
| 设计系统缺失或组件不一致 | UI-05、UI-07、UI-11 | 令牌体系已建立，缺口在硬编码与局部差异 |

### 4.3 待验证的设计假设（不得当作缺陷）

| # | 假设 | 需要什么 |
| --- | --- | --- |
| H-01 | 预览页「界面平淡、信息分散、无层次」 | 设计评估（见 `docs/UI_DESIGN_HANDOFF.md`） |
| H-02 | 「收藏后卡片跳到前排」「排序与收藏的位移」 | 用户复现路径（代码层已确认排序无收藏因子） |
| H-03 | 「浮窗盖住弹窗」 | 具体页面与操作路径（代码层未发现越级） |
| H-04 | 「编辑器 Hero 保存按钮居中」 | 视觉回归用例或标注截图 |
| H-05 | 375px 下列表标题被截断 2px | 已确认与图标档改动无关；是否要修需产品决定 |
| H-06 | 裁剪弹窗残留 `position: sticky; bottom: -18px` | 是否清理 |
| H-07 | 首次 About 排版需要精简 | 是否要做 |
| H-08 | 预设下拉与输入框同文案重复展示 | 是否要做 |
| H-09 | `themeTokens.ts` 是预留还是死代码 | 需确认 |
| H-10 | 标题字号阶梯 / 间距阶梯是否应该存在 | 设计判断（当前只能说「未确认」） |
