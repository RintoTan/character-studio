# Character Studio —— 已知问题台账

> 文档最后核查日期：2026-10-15 ｜ 基线提交 `bccec24`
> **收录规则**：只收录**有证据**的问题（源码位置 / 命令输出 / 实测记录）。无法确认的一律列入文末「待验证的设计假设」，不混进已确认清单。

---

## 0. 优先级定义

| 级别 | 含义 |
| --- | --- |
| **P0** | 导致数据丢失、严重误操作或核心流程阻断 |
| **P1** | 明显影响主要工作流或造成重要交互回归 |
| **P2** | 造成持续的操作摩擦或视觉理解障碍 |
| **P3** | 低影响的视觉细节与一致性问题 |

**当前状态：没有 P0 与 P1 级的已知问题。** 历史 P0/P1 项（数据可靠性、设置静默回滚、截图导出整体失败、懒加载 404、窄屏编辑器裁切）均已在 2.12.0 – 2.27.0 修复，处理过程与证据见 `CHANGELOG.md` 与 `docs/DEVELOPMENT_LOG.md`。

---

## 1. 已确认问题

### KI-01　设置弹窗未加宽 / 未中文化 / 未折叠未发布项　**P2**

| 字段 | 内容 |
| --- | --- |
| 复现条件 | 打开页面 → 页脚 `Settings`（或主页「更多操作」→ 设置） |
| 影响范围 | 全站设置入口；所有用户 |
| 证据 | `src/App.tsx` L1406–1470：`.settings-dialog` > `.settings-grid`，仅含 `Appearance`、`AiSettingsForm`、`About Data`、`头像素材库` 四张卡；标题为英文 `Appearance` / `About Data`；`AiSettingsForm` 中的 AI 区块是**功能不存在**的占位（界面标注 Coming Soon）；`@media (max-width:720px)` 内对 `.settings-dialog` 的宽度约束见 `styles.css` |
| 现象 | 弹窗偏窄、中英混排、把未发布功能与在用功能并列展示 |
| 建议方向 | 加宽到与 `asset-library-dialog` 同档；标题与字段中文化；未发布功能折叠进「未发布」分组；沿用现有 `--pad-surface` / `--dialog-radius` 令牌统一设计语言 |
| 约束 | 只动呈现层；**不得**改动设置键名、迁移逻辑或 `developerSettings` 结构 |

### KI-02　编辑页六个分节设计语言未统一　**P2**

| 字段 | 内容 |
| --- | --- |
| 复现条件 | 打开任一角色的编辑器 |
| 证据 | `src/pages/CharacterForm.tsx` 的六个分节渲染在 `workspace-content`（L2987–2999）；节头、字段网格、辅助按钮（`随机灵感` / `清空` / `重新生成` / `复制`）在不同节里的排布与措辞风格不一致；`styles.css` 中 `.workspace-card` / `.field-cell` / `.workspace-card-head` 等规则的间距与对齐存在多处字面量（非令牌） |
| 现象 | 作者在六节之间移动时感觉「不是同一套界面」 |
| 建议方向 | 定义一组节级模式（节头 / 字段行 / 节内辅助动作条）并让六节共用；先做 A/B 几何指纹对照再合并 |
| 注意 | 操作栏的玻璃效果**已做**（`.editor-action-bar`：70% 表面色 + `blur(16px) saturate(1.5)`），本节级统一**未做** |

### KI-03　浮动栏「贴近主栏」需求含义未确认　**P2（阻塞）**

| 字段 | 内容 |
| --- | --- |
| 来源 | 用户反馈原文：「悬浮栏：贴近主栏」 |
| 证据 | `src/App.tsx` L1065–1160：`.floating-actions` 是固定定位容器；「主栏」在代码里没有对应概念——可指**吸顶顶栏**（`.topbar`，`--topbar-height`）或**编辑页操作栏**（`.editor-action-bar`，`--editor-bar-height`） |
| 为什么不能直接实施 | 移动一个固定图层可能遮挡正文，且两种解释对应完全不同的位置与动画，猜错等于制造新的遮挡问题 |
| 需要的输入 | 用户确认「主栏」指哪一个（吸顶顶栏 / 编辑页操作栏 / 内容容器边缘），或给一张标注截图 |
| 状态 | **被阻塞**，未动代码 |

### KI-04　Developer Center 有 4 组不可达的分节渲染分支　**P3**

| 字段 | 内容 |
| --- | --- |
| 证据 | `src/pages/DeveloperCenter.tsx` 的 `developerSections` 只声明 9 个 id：`project`、`brand`、`design`、`content`、`prompt`、`application`、`export`、`tools`、`experimental`（L18–95）。而渲染分支里存在 `section.id === "ai"`（L835/841）、`"debug"`（L1125）、`"data"`（L1151/1165）、`"update"`（L1178）四组 |
| 结论 | 分节列表按 `developerSections.map(...)` 迭代，因此这四组条件**永远为假**，其内容从不渲染 |
| 影响 | 无用户可见故障；属死代码，会让下一个读者以为「回退方案就在这里」 |
| 建议方向 | 删除这四组分支，或把它们接入分节列表并想清楚要不要发布。另注：AI 设置卡在**设置弹窗**内可用（`AiSettingsForm`），此处的 `ai` 分支是另一份未接入的实现 |
| 风险 | 删除前先确认没有任何 `id` 字符串会从别处传入 |

### KI-05　`useDialogKeyboard` 的键盘行为无有效验证证据　**P2**

| 字段 | 内容 |
| --- | --- |
| 证据 | `src/hooks/useDialogKeyboard.ts`（90 行）已在关系网 / 时间线 / 世界观与 Dashboard 上接入；`test/` 目录下**没有**对应的测试文件（31 个测试文件清单中无 `useDialogKeyboard`） |
| 历史记录 | `CHANGELOG.md` 2.24.0 §④ 明确写着：「这一项的键盘行为**没有拿到有效证据**。探针里对话框未打开（选择器不匹配），于是 `escapeClosed` 与 `enterSaved` 两个读数**都会为真** —— 典型的空转断言。它目前只有类型检查保证」 |
| 影响 | 全站键盘可达性只靠类型检查兜底；改这个 hook 时没有回归保护 |
| 建议方向 | 单测：Escape 调用 `onClose`、Enter 调用 `onConfirm`、焦点在 `textarea` 或按钮上时 Enter 不被拦截、打开时焦点进入、关闭后焦点回到触发元素 |
| 注意 | 写测试前先确认观测点有区分度（历史教训：空转断言比失败更危险） |

### KI-06　`compactMobileEditor` 开关没有任何 CSS 读取　**P3**

| 字段 | 内容 |
| --- | --- |
| 证据 | `applyDeveloperSettings()`（`config/developerSettings.ts` L407–410）写 `root.dataset.compactMobileEditor`；本轮 `grep -n 'compact-mobile-editor\|compactMobileEditor' src/styles.css` → **0 命中** |
| 结论 | 「紧凑移动端编辑器」这个开关当前**不产生任何视觉或行为差异** |
| 影响 | 与项目原则「设置不能承诺它做不到的事」冲突；开发者中心把它列为已应用（`appliedFeatureFlags` 包含它） |
| 建议方向 | 二选一：① 真的实现它的 CSS（移动端编辑器紧凑变体）；② 按 2.13.0 的先例把它标注「暂未应用」或删除 |
| 注意 | 它同时存在于 `featureFlags.compactMobileEditor` 与 `editorDefaults.compactMobileEditor`，两处语义不同（flag = 功能是否发布；default = 默认值），处理时不要只改一处 |

### KI-07　`package.json` 版本号与应用版本号不同源　**P3**

| 字段 | 内容 |
| --- | --- |
| 证据 | `package.json` `"version": "1.0.0"`；`src/config/version.ts` `APP_VERSION = "2.27.0"`；线上 `build-info.json` 的 `version` 为 `2.27.0` |
| 结论 | 应用内所有版本显示读的是 `version.ts`；`package.json` 的版本号只作为包标识，不参与界面 |
| 影响 | 读代码的人可能被误导；不影响功能 |
| 建议方向 | 让 `build-info.mjs` 从 `package.json` 读版本，或反向让 CI 在发布时同步两者。**本轮未修改**（属源码/配置改动，超出文档治理范围） |

### KI-08　`styles.css` 仍有约 140 处硬编码颜色字面量　**P3**

| 字段 | 内容 |
| --- | --- |
| 证据 | 本轮统计：6 位 hex 与 `rgba()` 字面量约 **140 处**，全部落在样式表前 5079 行；其后一律使用令牌。典型位置：`--avatar-tint`、`--shadow`、`--focus-ring`（`:root` 内，属于令牌定义本身）、`.brand-mark-primary` `#222937`、`.status-badge.pinned` `#b45309`、`.tag-tone-0…17` 的 18 组、`.modal-backdrop` `rgba(17,24,39,.32)`、`.toast` 的 6 个语义色、`.pdf-safe` 覆盖块（L4526–4593） |
| 影响 | 主题一致性靠人工维持；深色模式下容易出现漏改 |
| 建议方向 | 按「令牌定义（可保留）／语义色（应收敛为令牌）／PDF safe 覆盖（刻意硬编码，见架构文档约束）」三类区分后再收敛 |
| 注意 | 合并声明体会改变层叠位置，需逐条判断；`--tag-tone-*` 与 `.pdf-safe` 的重复块是**有意的**（导出不能依赖 `color-mix()`） |

### KI-09　Developer Center 中若干净字段标注「暂未应用」　**P3**

| 字段 | 内容 |
| --- | --- |
| 证据 | `DeveloperCenter.tsx` 的 `unwiredContentKeys = { settingsSummary, toastCopy }`；`ComingSoonNote` 组件；导出分节中 JSON Metadata / CSV 字段配置 / ZIP Manifest 策略 / Logo 导出开关 / Version 导出开关为 disabled；品牌分节的「上传替换」为 Coming Soon；Prompt 分节的「文件导入」为 Coming Soon |
| 结论 | 这些项**已被诚实标注**（这是 2.13.0 的成果），但仍在界面上占据位置 |
| 影响 | 开发者中心信息密度偏高；属可接受状态，不是缺陷 |
| 建议方向 | 若要精简，把「暂未应用」项折叠进一个可展开的「未接线」分组，而不是删除标注 |

### KI-10　Apple 日期控件与 Windows Emoji 未在真机验收　**P2（需真机）**

| 字段 | 内容 |
| --- | --- |
| 证据 | `CHANGELOG.md` 1.0.0 「已知问题」：「Apple 设备的日期/年龄控件：代码已做 WebKit 专项处理（`::-webkit-date-and-time-value` 等），但**尚未在真机验收**」；「Windows Emoji：emoji 字体栈已覆盖头像、表情选择器、标签与徽章，最终效果需在 Windows 上确认」 |
| 影响 | 这两类设备上的日期控件外观与 emoji 渲染可能与预期不同 |
| 需要的条件 | Apple 设备 / Windows 设备上的实机检查 |
| 注意 | emoji 字体栈已在 2.5.0 挂到根字体上，全站继承；但字体可用性依平台而定 |

### KI-11　三档视口下的关系网重排未实测　**P3**

| 字段 | 内容 |
| --- | --- |
| 证据 | `CHANGELOG.md` 2.27.0「未验证：三档视口下的关系网重排、深色主题下的目视检查、分辨率 3x 的实际导出字节数」 |
| 影响 | 关系网在 900px / 375px 下的工具栏换行与画布高度缺少实测记录 |
| 建议方向 | 用 `tools/cdp.mjs` 的 `--emulate` 在 1440 / 900 / 375 三档各采一次几何 |

---

## 2. 已修复但值得记住的坑（防止再犯）

这些**不是**当前问题，但它们对应的机制仍然存在，改动相邻代码时应先读：

| # | 坑 | 机制 / 教训 |
| --- | --- | --- |
| 1 | 一个开关被三个地方写 | `isSearchPanelOpen` 曾有设置、复选框、roster-size effect 三个写入者 → 「进入页面关闭」不能作为可依赖的状态。**一个布尔量如果有多个写入者，它就不是约束** |
| 2 | React 的 `onWheel` 是 passive | 在 React 处理器里 `preventDefault()` 会被忽略；只有原生 `{passive:false}` 监听能拒绝滚动 |
| 3 | html2canvas 不能直接截 `<svg>` | 抛的是**裸字符串** `Unable to find element in cloned iframe`，不是 Error |
| 4 | html2canvas 只认 rgb/rgba/hsl/hex | `color-mix()` 的 computed value 是 `color(srgb …)`，遇到它**整张截图失败** |
| 5 | 合成事件不执行默认行为 | 合成 `WheelEvent` 不能用来测「页面会不会滚动」；必须用真实 `Input.dispatchMouseEvent` |
| 6 | 空转断言比失败更危险 | `!querySelector(...)` 与 `>=` 比较在行为没发生时也会通过；空 DOM 让所有关于它的断言为真 |
| 7 | 选择器权重 | `.relationship-table td`（类+元素）会盖过裸 `.relationship-col-actions` |
| 8 | `space-between` 配三个子元素 | 中间那个会被挤压；收进一个 wrapper 变成两个子元素才对齐 |
| 9 | `git commit -m` 里的反引号 | 被 zsh 当命令替换吞掉 → 用 `-F file` |
| 10 | 脏工作树改变构建产物 | 提交号会带 `-dirty` → 内容哈希变化 → `verify:deploy` 误报。必须**先提交、再重建、再校验** |
| 11 | 吸顶依赖 `body` 的 overflow | `overflow-y: auto` 会让 body 成为滚动容器，全站 `position: sticky` 静默失效 |
| 12 | 先验证观测点，再验证行为 | 拿已知的开/关两种状态各测一次观测点，确认它有区分度 |
| 13 | 改完 → 下一轮再验 | 同一条回复里的工具调用会并行执行，编辑与读取同批会读到旧内容 |
| 14 | 图标按钮没有文字 | 用文本查找必然找不到 → 用 `aria-label`，并加「空结果即报错」的前置断言 |

---

## 3. 待验证的设计假设

**以下均未经核实，不得当作缺陷处理。** 它们来自历史反馈或界面观感，需要先取得证据。

| # | 假设 | 来源 | 需要什么证据 |
| --- | --- | --- | --- |
| H-01 | 「收藏后卡片跳到前排」 | 历史反馈 | 代码层已确认排序**无收藏因子**、收藏**不写 `updatedAt`**，因此「仅收藏」不会重排。需用户给复现路径（当时排序模式？是否刚编辑过该角色？） |
| H-02 | 「浮窗盖住弹窗」 | 历史反馈 | 代码层未发现越级（下拉层最高 80 < 遮罩 900）。需具体页面与操作路径 |
| H-03 | 「预览页界面平淡、信息分散、无层次」 | 历史反馈 | 属设计评估，不是缺陷。应交给 UI 设计交接文档处理（见 `docs/UI_DESIGN_HANDOFF.md`） |
| H-04 | 「排序与收藏的实际位移现象」 | 历史反馈 | 同 H-01，需复现路径 |
| H-05 | 「编辑器 Hero 保存按钮居中」 | 历史反馈 | 需视觉回归用例或标注截图 |
| H-06 | 裁剪弹窗残留 `position: sticky; bottom: -18px` 是否应清理 | 历史台账 P2-20 | 需产品决定；代码位置 `styles.css` 的 `.crop-dialog` 区块 |
| H-07 | `src/config/themeTokens.ts` 与 `styles.css` 的 `:root` 是两份并行定义 | 本轮读码 | `themeTokens.ts` 当前**没有运行时读取方**；需确认它是预留还是应删除 |
| H-08 | 卡片视图的分组与折叠是会话级、不持久化 | 代码可确认 | 这是**设计选择**（CHANGELOG 2.10.0 明示）。若要持久化，需产品决定 |

---

## 4. 明确不在本台账范围内的事

- **功能缺失**（阵营 / 地图 / 多版本角色 / AI 助手 / 云同步 / 插件系统）：这些是 Roadmap 项，不是缺陷。见 `docs/ROADMAP.md`。
- **编辑器与主页的巨型渲染体未拆分**：这是维护性工作项，不是缺陷。见 `PROJECT_STATUS.md` 第 3 节。
- **`package.json` 版本号与 `README` 的措辞**：属文档口径，见 KI-07。
