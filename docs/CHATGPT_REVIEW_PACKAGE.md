# Character Studio —— 外部审查资料包（ChatGPT Review Package）

> **这份文档的用途**：让一个外部审查者（例如 ChatGPT）在不读全部源码的情况下，快速、准确地了解这个项目**现在是什么状态**，并据此提出问题与建议。
> 它是**索引与摘要**，不复制源码。所有事实都指向仓库里的具体文件；标注为「未验证」的部分**不要当作已确认的事实**。
> 生成日期：**2026-10-15** ｜ 生成方式：源码 + Git 历史 + 只读命令实测（未修改任何应用代码）

---

## 1. 项目概况与当前状态

| 项 | 值 |
| --- | --- |
| 项目名 | **Character Studio** |
| 定位 | 面向 OC（原创角色）创作的**本地优先（Local First）**角色工作台。纯前端，无账号、无服务器、不上传数据 |
| 线上 | <https://rintotan.github.io/character-studio/> |
| 仓库 | <https://github.com/RintoTan/character-studio> |
| 应用版本 | **2.27.0**（Sprint 37.1） |
| 版本来源 | `src/config/version.ts` 的 `APP_VERSION` / `APP_SPRINT` |
| 分支 / HEAD | `main` / **`f94f321`**（文档治理提交；其父提交 `bccec24` 是最后一次应用代码提交） |
| 工作区 | 干净 |
| 规模 | `src/` 共 **26161 行**；`styles.css` 7177、`Dashboard.tsx` 3623、`CharacterForm.tsx` 3008、`importExport.ts` 1881、`App.tsx` 1671 |
| 测试 | **31 个文件 / 360 个用例**，本轮 `vitest run` 全通过 |
| 数据存储 | 文字进 `localStorage`（21 个键），头像二进制进 `IndexedDB`（库 `character-studio-assets`） |

**一句话现状**：功能面完整（角色 CRUD + 编辑 + 预览 + 关系网 + 时间线 + 世界观 + 导入导出 + 备份恢复 + 开发者中心），当前处于**可用性与一致性收敛**阶段，重点是把界面一致性、验证覆盖与文档治理补齐。

---

## 2. 版本、分支与提交信息

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| 本次文档治理提交 | **`f94f321ed70fed35966c10db541e74e745f19ca9`**（`docs: rebuild the project's written record, and hand the UI to a designer`） |
| 本次提交的父提交 | `bccec24843e0ccdae0c97c8ab7d3d0484267e550`（2.27.0 / Sprint 37.1，最后一次应用代码提交） |
| 提交总数 | 113（含本次文档提交） |
| Git 标签 | 仅 `v1.0.0` `v1.1.0` `v1.2.0` `v2.0.0` `v2.0.1`，且**全部创建于 2026-10-14/15（回溯打标）**；`v2.1.0` 之后没有标签 |
| 线上部署提交 | `bccec24`（来源：线上 `build-info.json`；**本次只有文档变更，不触发部署，产物不变**） |

> **重要口径**：应用版本号（`version.ts` 的 `2.27.0`）与 `package.json` 的 `version`（`1.0.0`）**不同源**，与 Git 标签也不同源。三者互不代表。这是已记录的 KI-07，未修。

---

## 3. 模块与功能状态摘要

完整清单（含入口、用户可见行为、数据依赖、已知问题、验证情况、后续任务）见 **`docs/FEATURES.md`**。以下为摘要：

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 主页（Dashboard）与角色列表 | 已实现 | 卡片 / 表格双视图、搜索、筛选、4 种排序、收藏、草稿箱、置顶、批量操作、命令面板、导入导出 |
| 角色编辑工作台 | 已实现 | 六分节 + 模块导航 + 完成度 + 折叠记忆 + 跳到下一个未完成 + 随机生成 + 创作辅助 + 头像（Emoji / 上传 / 裁剪 / 素材库）+ 自动保存草稿 + `Cmd/Ctrl+S` |
| 角色预览页 | 已实现 | **双模式**：`browse`（编辑/收藏/导出/返回）与 `editing`（返回编辑/保存草稿/删除角色/保存角色） |
| 角色关系网 | 已实现 | 8 种关系、方向语义（互为类 `↔` / 师承 `→`）、径向布局、缩放平移、邻居高亮、重复检测、表格化、1x/2x/3x 导出 JPG/PNG/PDF |
| 世界观时间线 | 已实现 | 事件 CRUD、支持架空历法、按日期排序（不依赖纪年标签）、年份分组、关联角色 |
| 世界观管理 | 已实现 | 分层条目（最多渲染 6 层）、6 个分类、标签、关联角色、成环防护、删父级时子级脱离为顶层 |
| 开发者中心 | 已实现 | 9 个分节：项目 / 品牌 / 设计系统 / 内容 / Prompt / 应用配置 / 导出 / 工具 / 实验开关；是运行时主题的实际控制台 |
| 头像素材库 | 已实现 | IndexedDB、引用数提示、多选、批量删除、清理未使用、JSON 导入导出 |
| 导入 / 导出 / 备份 / 恢复 | 已实现 | JSON / ZIP / CSV 导入；JSON / ZIP / CSV / PDF / JPG / PNG 导出；自动快照与恢复；按 id 合并不覆盖 |
| 设置弹窗 | **部分实现** | 未加宽、未中文化、未折叠尚未发布的功能（KI-01） |
| AI 助手 | **未实现** | 界面有占位（标注 Coming Soon）；只存配置、不发起任何请求；API Key 输入框为 `disabled` |
| 阵营 / 地图 / 多版本角色 / 云同步 / 插件 / i18n | **未实现** | 路线图方向，无任何代码 |

---

## 4. 技术架构摘要

完整版见 **`docs/ARCHITECTURE.md`**。

| 方面 | 现状 |
| --- | --- |
| 技术栈 | TypeScript + React 18 + Vite 6；vitest 3 + happy-dom + fake-indexeddb；html2canvas + jsPDF（均动态 import） |
| 路由 | **无路由库**。`Page` 是一个 7 值联合类型，由 `App.tsx` 的 `useState` + History API 驱动；只有 `/character-studio/developer` 有真实 URL |
| 代码分割 | Dashboard 静态入首屏（落地页）；其余 6 条路由 `React.lazy` |
| 状态管理 | **无状态库**。组件本地 `useState` + 9 个自定义 hook + `App.tsx` 持有角色集合 |
| 模块边界 | 页面之间**互不引用**，`App.tsx` 是唯一调度者；每个 `localStorage` 键**只有一个所有者** |
| 持久化 | 21 个键（20 localStorage + 1 sessionStorage）+ IndexedDB（库 `character-studio-assets` v1） |
| 数据模型 | `Character`（核心 + 3 个兼容字段 `isFavorite` / `birthYear` / `tags`）、`Relationship`、`TimelineEvent`、`WorldEntry` |
| 导入导出 | `utils/importExport.ts`（1881 行）是核心。ZIP 备份走 `manifest.json` 绑定（**禁止按文件名猜测**）；CSV 是四种数据的全量表格，用「类型」列区分 |
| 部署 | push `main` → GitHub Actions：`pnpm install --frozen-lockfile` → `typecheck` → `test` → `build:pages` → 部署 Pages；构建把 commit / 时间戳注入前端以便反查 |
| 构建身份 | `scripts/build-identity.mjs`：环境变量优先，缺省从 git 推导，**工作树脏时提交号带 `-dirty`** |
| 线上一致性校验 | `scripts/verify-deploy.mjs`（比对入口包、样式表、逐文件字节数、commit 戳、深链接回退） |

### 4.1 最值得审查者注意的四条技术约束

1. **`body` 必须是 `overflow-x: clip` + `overflow-y: visible`。** 若改成 `overflow-y: auto`，body 会成为滚动容器，**全站 `position: sticky` 静默失效**（这是 2.2.0 修掉的一个长期 bug 的根因）。
2. **导出区域不能用 `oklch()` / `color()` / `lab()`。** html2canvas 的颜色解析器只认 rgb / rgba / hsl / hex，遇到 `color-mix()` 的 computed value（`color(srgb …)`）会让**整张截图失败**。现有代码用克隆期降级兜底（`toLegacyColorFunctions()` 在 `onclone` 里把 `color(srgb …)` 转成 `rgba()`），但设计语言本身没有为此降级。
3. **html2canvas 不能直接截 `<svg>`** —— 它抛的是一个**裸字符串** `Unable to find element in cloned iframe`（不是 Error）。关系网的截图目标因此是一层包裹 `<div>`。
4. **懒加载块会 404（部署换块）** —— Vite 给块加内容哈希，Pages 部署整体替换目录，已打开的标签页第一次懒加载就要一个已删除的块。已用 `utils/lazyImport.ts` 做成自愈（只在「块取不到」时刷新一次）。`verify:deploy` 查不出这一类问题。

---

## 5. UI 现状摘要

完整版见 **`docs/UI_AUDIT.md`**；给设计智能体的任务输入见 **`docs/UI_DESIGN_HANDOFF.md`**。

### 5.1 页面清单（7 个路由 + 全局壳层）

主页 `dashboard` · 编辑工作台 `form` · 预览页 `preview` · 关系网 `relationships` · 时间线 `timeline` · 世界观管理 `world` · 开发者中心 `developer`；壳层 = 顶栏 + 浮动栏 + 页脚 + Toast + 弹窗层。

### 5.2 设计系统（已有令牌体系）

- **颜色**：15 个语义色令牌 + 3 档派生中性填充（`--control-fill` 7% / hover 12% / active 17%，由 `color-mix` 计算）+ 18 组标签色（`.tag-tone-0…17`，深浅各一套）
- **主题**：`:root[data-theme]` 切换 + `color-scheme`；强调色 / 圆角 / 阴影 / 动效 / 字体缩放由开发者设置**在运行时写入 CSS 变量**
- **圆角**：输入 8px / 卡片 8px / 按钮 10px / 浮动按钮 999px
- **控件高度**：带文字 42px / 图标 36px / 紧凑 34px
- **内边距**：面板 24 / 卡片 16 / 侧栏 12
- **层序**：内联 5–40 ／ 浮层 120–160 ／ 弹窗 900·910 ／ Toast 1000（全部令牌化）
- **按钮语言**：主按钮实心、次要与描边为中性填充、**危险按钮是中性填充 + 危险色文字**（不用大红块）
- **图标**：42 个线性 SVG（24×24 网格，`strokeWidth 1.7`，`currentColor`）
- **断点**：1024 / 860 / 720（主力，约 160 条规则）/ 430 + 触控与 `prefers-reduced-motion` 规则

### 5.3 设计系统当前的缺口（均已确认）

| 缺口 | 证据 |
| --- | --- |
| 约 **140 处**硬编码颜色字面量 | 全部落在 `styles.css` 前 5079 行 |
| 12 个 `*-dialog` 的宽度与内边距不统一 | 读码确认 |
| 编辑页六个分节的节内排布与措辞不一致 | KI-02 |
| 标题字号阶梯与间距阶梯**无集中令牌** | 读码未能确认存在统一比例（标注为「待确认」，不是结论） |
| 设计令牌有两份并行定义（`styles.css` 与 `config/themeTokens.ts`） | `themeTokens.ts` 当前无运行时读取方 |

---

## 6. 已知问题与风险

完整台账见 **`docs/KNOWN_ISSUES.md`**。**当前没有 P0 与 P1 级问题。**

| 编号 | 问题 | 优先级 | 状态 |
| --- | --- | --- | --- |
| KI-01 | 设置弹窗未加宽 / 未中文化 / 未折叠未发布功能 | P2 | 待开始 |
| KI-02 | 编辑页六个分节设计语言未统一 | P2 | 待开始 |
| KI-03 | 浮动栏「贴近主栏」需求含义未确认 | P2 | **被阻塞（需用户输入）** |
| KI-05 | `useDialogKeyboard` 的键盘行为无有效验证证据 | P2 | 待开始 |
| KI-10 | Apple 日期控件 / Windows Emoji 未真机验收 | P2 | 需真机 |
| KI-09 | 深色主题缺目视检查（`UI-09`） | P2 | 待验证 |
| KI-04 | Developer Center 有 4 组永不渲染的分节分支 | P3 | 待开始 |
| KI-06 | `compactMobileEditor` 开关无任何 CSS 读取 | P3 | 待开始 |
| KI-07 | `package.json` 版本与应用版本不同源 | P3 | 待开始 |
| KI-08 | 约 140 处硬编码颜色字面量 | P3 | 待开始 |
| KI-11 | 关系网三档视口重排未实测 | P3 | 待验证 |

### 6.1 三条「已发现但本轮未修」的问题（因为修它们需要改源码）

1. **`DeveloperCenter.tsx` 有 4 组永不渲染的分节分支**：`ai`（L835/841）、`debug`（L1125）、`data`（L1151/1165）、`update`（L1178）。分节列表 `developerSections` 只声明了 9 个 id，渲染按该列表迭代，因此这四组条件永远为假 → 死代码，无用户可见影响。
2. **`compactMobileEditor` 是无效果的开关**：`applyDeveloperSettings()` 写 `root.dataset.compactMobileEditor`，而 `styles.css` 中 **0 处**规则读取 `data-compact-mobile-editor`。
3. **版本号三源**：`version.ts`（2.27.0）／`package.json`（1.0.0）／Git 标签（止于 `v2.0.1`）。

### 6.2 未验证项（**不要当作已完成**）

- 三档视口（1440 / 900 / 375）下的关系网重排。
- 深色主题的目视检查（编辑器与关系网）。
- 导出分辨率 3x 的实际字节数。
- 编辑页操作栏玻璃效果的**视觉效果**（只改了数值，未读数也未截图）。
- 编辑器的 Tab 顺序与焦点陷阱。
- `useDialogKeyboard` 的键盘行为（历史探针是**空转断言**，故不计入证据）。

---

## 7. 已完成与未完成事项

### 7.1 已完成（有实现 + 证据）

- 角色 CRUD、草稿箱、收藏夹、置顶、删除撤销。
- 搜索 / 筛选 / 4 种排序 / 卡片（>30 角色分组）与表格双视图 / 批量编辑与批量操作。
- 六模块编辑工作台（含折叠记忆、完成度、跳到下一个未完成、自动保存、创作辅助、头像裁剪与素材库）。
- 预览页双模式与 PDF / JPG / PNG / JSON 导出。
- 关系网 / 时间线 / 世界观管理三个领域。
- JSON / ZIP / CSV 导入导出、完整备份与恢复、自动快照、跨域引用清理。
- 主题（浅 / 深 / 跟随系统）、工作区导航、弹窗与菜单键盘层、Toast、浮动栏、深链接。
- 360 个测试用例（31 个文件）、CI（typecheck → test → build → deploy）、构建身份与线上一致性校验。
- 懒加载块 404 的自愈。

### 7.2 未完成

- 设置弹窗的加宽 / 中文化 / 分组（KI-01）。
- 编辑页六节的设计语言统一（KI-02）。
- 浮动栏「贴近主栏」（KI-03，被阻塞）。
- `useDialogKeyboard` 的有效验证（KI-05）。
- Dashboard 与 CharacterForm 的渲染体拆分（纯逻辑已抽完；渲染体未拆，需要先补交互探针）。
- CSS 硬编码颜色收敛与 74 组共用声明体合并。
- 约 140 处硬编码颜色、`themeTokens.ts` 的归属、`package.json` 版本同源。
- 全部长期方向：阵营 / 地图 / 多版本角色 / AI 助手 / 云同步 / 插件 / i18n。

---

## 8. 当前路线图

完整版（含优先级、前置条件、影响范围、验收标准、状态）见 **`docs/ROADMAP.md`**。

**近期**：R-01 设置弹窗（P2）· R-02 编辑页六节统一（P2）· R-03 补 `useDialogKeyboard` 测试（P2）· R-04 三档视口与主题走查（P3）· R-05 3x 导出验证（P3）· R-06「暂未应用」配置收敛（P3）· R-07 浮动栏（P2，**被阻塞**）。

**中期（维护性）**：R-08 / R-09 两个巨型渲染体拆分 · R-10 / R-11 CSS 收敛与合并 · R-12 `themeTokens.ts` 归属 · R-13 版本号同源 · R-14 死分支清理 · R-15 视觉细节 · R-16 灵感库去重。

**长期（新领域）**：阵营 / 地图 / 多版本角色 / AI 助手 / 云同步 / 插件与模板 / i18n / 性能优化 / 主题系统扩展。**全部只有方向，无排期、无代码。**

**已取消 / 已废弃**（不要重新提出）：独立角色标签系统、`openSearch` 设置、`hideLowPriority`、三个无人读取的设置字段、`calculateAgeFromYear`、关系网「触摸端不拖拽」、预览页两个入口都提供导出（已改为按入口分工）、编辑页浮动保存按钮、预览页浮动导出按钮、关系网工具栏的第三个回主页入口、独立「适配」按钮、Vercel 部署。

---

## 9. 关键文件索引

| 关注点 | 文件 |
| --- | --- |
| 应用外壳 / 路由 / 全局弹窗 / 浮动栏 | `src/App.tsx` |
| 主页 | `src/pages/Dashboard.tsx`（+ `src/pages/dashboard/layers.ts`、`src/hooks/useDashboardPrefs.ts`、`src/hooks/useDashboardLayers.ts`） |
| 编辑工作台 | `src/pages/CharacterForm.tsx`（+ `src/pages/editor/sections.ts`、`src/hooks/useCharacterSave.ts`、`useAvatarEditing.ts`、`useEditorSections.ts`、`useIdentityEditing.ts`） |
| 预览页 | `src/pages/CharacterPreview.tsx` |
| 关系网 / 时间线 / 世界观 | `src/pages/RelationshipGraph.tsx`、`Timeline.tsx`、`WorldManager.tsx` |
| 开发者中心与设置 | `src/pages/DeveloperCenter.tsx`、`src/config/developerSettings.ts` |
| 数据模型 | `src/types/character.ts`、`relationship.ts`、`timeline.ts`、`world.ts`、`app.ts` |
| 存储层 | `src/storage/`（12 个模块，含 `referenceIntegrity.ts`、`workspaceBackup.ts`、`backup.ts`） |
| 导入导出与 CSV | `src/utils/importExport.ts`、`src/utils/workspaceCsv.ts` |
| 头像素材库 | `src/utils/avatarAssets.ts`、`src/components/AvatarDisplay.tsx` |
| 纯逻辑 | `src/utils/cropGeometry.ts`、`bulkEdit.ts`、`age.ts`、`lazyImport.ts` |
| 样式与设计令牌 | `src/styles.css`（唯一样式表，7177 行） |
| 内容与词库 | `src/content/defaultContent.ts`、`src/data/avatarCategories.ts`、`src/data/external-inspiration-library.txt` |
| 测试 | `test/`（31 个文件） |
| 构建与部署 | `scripts/build-identity.mjs`、`scripts/build-info.mjs`、`scripts/verify-deploy.mjs`、`.github/workflows/deploy-pages.yml`、`vite.config.ts` |
| 项目文档 | 根目录只放 `README.md`、`CHANGELOG.md`、`Developer Handbook.md`（后者被应用内 7 处链接指向 `blob/main/Developer%20Handbook.md`，故不移动）；**其余全部文档在本目录下**，索引见 `docs/README.md` |

---

## 10. 测试与构建结果

本轮（2026-10-15）实际执行：

```bash
npm run typecheck   # tsc -b                  -> 退出码 0，无输出
npm test            # vitest run              -> Test Files 31 passed (31) / Tests 360 passed (360)
npm run build       # tsc -b && vite build    -> 退出码 0，325 modules transformed
```

线上核对：

```text
https://rintotan.github.io/character-studio/build-info.json
  app        character-studio
  version    2.27.0
  sprint     37.1
  commit     bccec24843e0ccdae0c97c8ab7d3d0484267e550
  commitShort bccec24
  entry      index-CJaOoWIX.js
  stylesheet index-C1wTYI6I.css
  files      19
```

**未执行**：`npm run verify:deploy`（它逐字节比对本地 `build:pages` 产物与线上；本次文档变更不影响产物。注意：`npm run build` 与 `npm run build:pages` 的 JS 哈希**不同**，因为 `import.meta.env.BASE_URL` 被内联进包 —— 要逐字节比对必须用 `build:pages`）。

**测试覆盖的缺口**：`useDialogKeyboard` 的键盘行为、Developer Center 的控件回调、页面的实际布局与视觉回归。

---

## 11. GitHub 同步结果

| 项 | 结果 |
| --- | --- |
| 远端 | `git@github.com:RintoTan/character-studio.git`（HTTPS 在本机不可用，走 SSH） |
| 分支 | `main` |
| 推送前远端 | `bccec24843e0ccdae0c97c8ab7d3d0484267e550` |
| 本次文档治理提交 | **`f94f321ed70fed35966c10db541e74e745f19ca9`**（`docs: rebuild the project's written record, and hand the UI to a designer`，12 个文件） |
| 该提交的推送 | 快进推送成功：`bccec24..f94f321  main -> main` |
| 推送后远端 | `f94f321ed70fed35966c10db541e74e745f19ca9`（= 当时本地 HEAD，已用 `git ls-remote` 核对） |
| 本文件所在提交 | 本文件是紧接着的第二个文档提交（`docs: add the external review entry point`）。它自身的 SHA 无法写在自己内部；请在 GitHub 的提交列表中查看 `f94f321` 之后的那个提交 |
| 应用部署 | **未触发**（本次无应用源码变更；线上产物仍是 `bccec24` 构建的那一份，逐字节未变） |
| 文档发布 | 仓库内的 Markdown 在 GitHub 上可见；项目**没有**独立的文档站点或文档发布流程 |

> **注意**：GitHub Pages 每次部署会整体替换站点目录，但它发布的是 `dist`（构建产物），**不含仓库里的 Markdown**。因此本次文档变更不会影响线上应用的可用性或内容。

---

## 12. 尚待用户决策的问题

| # | 决策 | 影响 |
| --- | --- | --- |
| 1 | **浮动栏「贴近主栏」的「主栏」指什么**（吸顶顶栏 / 编辑页操作栏 / 内容容器边缘）？ | 阻塞 R-07；猜错会引入新的遮挡 |
| 2 | **`compactMobileEditor`**：实现它的 CSS，还是标注「暂未应用」或删除？ | KI-06 |
| 3 | **英文 AI Prompt 中自由文本的策略**：音译 / 保留中文并标注 / 仅翻译预设值？ | 当前实现为「保留原文 + 一行语言说明」，影响 Prompt 质量预期 |
| 4 | 卡片视图的分组与折叠**是否要持久化**（当前刻意是会话级）？ | 未排期 |
| 5 | 裁剪弹窗残留的 `position: sticky; bottom: -18px` 是否清理？ | R-15 |
| 6 | 「首次 About 排版精简」「预设下拉与输入框同文案重复展示」是否要做？ | R-15 |
| 7 | `package.json` 版本号是否要与应用版本同源？ | KI-07（属配置改动） |
| 8 | `config/themeTokens.ts` 是预留还是死代码？ | R-12 |

---

## 13. 给外部审查者的建议切入点

1. **架构层面**：`App.tsx` 持有角色集合、页面互不引用、一键一所有者 —— 这套边界是否足以支撑「多版本角色」或「云同步」这类长期方向？
2. **数据可靠性**：备份 / 恢复的合并语义（按 id 合并、manifest 绑定、CSV 按名称建关系）在什么情况下会丢数据？重名角色、跨设备合并、部分导入是最值得推演的场景。
3. **UI 一致性**：在已有令牌体系下，最大的不一致来源是什么（硬编码颜色、弹窗尺寸、节级模式）？按什么顺序收敛风险最低？
4. **验证策略**：项目的历史教训集中在「验证动作本身产生了假信息」（空转断言、观测点无区分度、合成事件无默认行为）。有没有更系统的防护方式（例如视图层的几何指纹基线）？
5. **范围判断**：哪些「已知未完成」其实不该做（收益低于维护成本）？
