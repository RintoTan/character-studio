# Character Studio

> **发布状态：v2.27.0**（Sprint 37.1）—— 关系网控件从五控件四样式收敛为三个（滚轮不再把页面一起带走、百分比本身即适配按钮）、画布栏统一控件语言并新增导出分辨率 1x/2x/3x、关系列表对齐与吸顶、筛选浮层两列、工作区菜单层级、列表吸顶头改为不透明、编辑页操作栏玻璃效果。
> 上一版：v2.26.0（Sprint 36.1）—— 主页四层信息架构（全局导航 → Hero 概览 → 角色列表工具栏 → 角色内容区）。
> 上一版：v2.25.0（Sprint 35.1）—— 预览页按入口分工（浏览＝编辑/收藏/导出/返回；编辑＝返回编辑/保存草稿/删除角色/保存角色）；修好被 `color-mix()` 打断的截图导出。
> 上一版：v2.24.0（Sprint 34.1）—— 工具栏并入 HERO 并吸顶折叠；三个工作区入口提为独立大按钮；列表状态列；弹窗键盘控制；新增「滑到底部」。
> 上一版：v2.23.0（Sprint 33.1）—— 搜索栏「进入页面永远关闭」收敛为不变量；关系网可用性（名称防裁切、画布填满、标签避让、互指边扇形分开、表格化、JPG/PNG/PDF 导出）。
> 上一版：v2.22.0（Sprint 32.1）—— 修复部署换块导致懒加载 404（导出不可用）并让其自愈；修复列表列错位、恢复卡片创建/编辑时间。
> 变更见 [CHANGELOG.md](CHANGELOG.md)；线上地址 <https://rintotan.github.io/character-studio/>。
> 构建会注入提交号，线上站点可在 About 面板反查自己由哪次提交构建。
>
> **项目文档索引**见本文件末尾的「项目文档」一节。当前状态与验证等级见 [PROJECT_STATUS.md](PROJECT_STATUS.md)。


**Character Studio** 是一个面向 OC（Original Character，原创角色）创作的本地优先角色工作台。

它用于创建、编辑、管理、预览、备份和导出角色设定，适合小说、插画、跑团、乙游企划、世界观创作和 AI 绘图 Prompt 整理。

当前版本采用纯前端架构，不需要登录、不接入服务器、不上传角色数据。角色资料保存在浏览器本地，头像素材保存在 IndexedDB 中。

---

## 核心特性

### Dashboard 角色管理

- 角色卡片视图与列表视图
- 搜索角色名、职业、世界观、性格标签
- 按最近编辑、创建时间、名称排序
- 按世界观、性别、视觉风格筛选
- 收藏夹视图
- 草稿箱视图
- 置顶角色
- 批量选择、复制、删除、收藏、导出
- 删除撤销
- Empty State 与搜索无结果状态
- Light / Dark / Follow System 主题

### Character Editor 角色创作工作台

- 六个分节：基础信息 → 外貌设定 → 性格设定 → 个人偏好 → 能力设定 → 背景故事 → AI Prompt
- 左侧模块导航 + 完成度进度 + 「跳到下一个未完成」（到末尾绕回）
- 折叠记忆（按作者的工作习惯持久化）
- Emoji 头像与上传头像
- 头像裁剪、压缩、本地保存
- 从头像素材库选择头像
- 性格标签（含自定义；独立的「角色标签」系统已在 6.4 删除）
- 随机生成角色
- 本地规则生成中文人物关键词
- 本地规则生成英文 AI 绘图 Prompt
- 自动保存草稿、临时保存
- 编辑 / 预览切换
- 创作辅助：示例、随机灵感、写作提示
- `Ctrl / Cmd + S` 保存

### Character Preview 展示页

同一个页面有两种用法，**由打开它的入口决定**：

| 入口 | 工具栏 |
| --- | --- |
| 从主页「预览」进入，或保存后的落点 | `编辑` · `收藏` · `导出` · `返回` |
| 从编辑工作台切到预览进入 | `返回编辑` · `保存草稿` · `删除角色` · `保存角色` |

共同能力：

- 头像、基础资料、性格标签、视觉风格、外貌、能力、背景故事、个人偏好、中文关键词、英文 Prompt
- 点击头像查看大图
- 浏览模式下可导出 JSON / PDF / JPG / PNG
- 导出为图片 / PDF 时，页面上的操作按钮会被排除出画面

**复制完整设定与复制 Prompt 的按钮已移除**：那两个字段在编辑器里本来就有复制，导出也统一在主页按范围与格式选择（一屏一职）。

### 世界观工作区（关系网 / 时间线 / 世界观管理）

从顶栏的**工作区切换**进入。三者各自是独立的数据集合，都可以与角色一起备份与恢复。

**角色关系网** —— 以图为载体建立与查看角色之间的连接。

- 8 种关系类型：亲属 / 师承 / 友人 / 对手 / 敌对 / 同僚 / 情感 / 其他
- **方向有语义**：互为类（亲属、友人、情感等）不画箭头、列表读作 `↔`；师承画箭头、读作 `→`，字段名变为「师承方 / 学习方」
- 重复关系在保存前被拒绝并说明原因（而不是静默无反应）
- 径向布局：一个角色居中、两个水平并排、三个以上成环，环半径随人数增长
- 缩放（滚轮 / 按钮 / 双指）、拖拽平移、悬停高亮邻居、点击节点进入该角色
- 默认只画参与关系的角色，可一键切到全部
- 头像与名称尺寸（小中大）；导出分辨率 **1x / 2x / 3x**
- 导出 JPG / PNG / PDF；同一份数据同时提供图形与表格两种读法

**世界观时间线** —— 按时间组织世界与角色的关键事件。

- 事件含标题、日期、可选**纪年显示**（支持架空历法，如「光历 318 年」）、类型（起源/转折/羁绊/冲突/失去/其他）、地点、描述、关联角色
- 日期接受 `2026` / `2026-05` / `2026-05-01`，读取时补齐；**排序永不依赖纪年标签**
- 按年份分组、按日期升序，与录入顺序无关

**世界观管理** —— 地点 / 势力 / 种族 / 物品 / 概念的分层条目。

- 支持层级（国家下辖城市），最多渲染 6 层；每层可折叠
- 每类可打标签、可关联角色
- 删除父级时**子级脱离为顶层**，不会一起消失

### 头像素材库

头像素材库用于管理当前浏览器中的本地头像资源。

- 浏览头像素材
- 查看素材数量与占用空间
- 查看素材是否被角色引用
- 导入头像素材 JSON
- 导出头像素材 JSON
- 多选、全选、批量删除
- 清理未使用素材
- 删除被引用素材时自动提示影响角色

图片素材不会存入 localStorage，而是存入 IndexedDB。角色数据只保存头像引用 ID。

### 导入 / 导出

Character Studio 支持多种导入导出方式：

| 类型 | 用途 | 是否包含头像图片 | 是否可重新导入 |
| --- | --- | --- | --- |
| 单角色 JSON | 分享单个角色 | 如有上传头像，会包含头像数据 | 是 |
| 角色 JSON | 轻量备份所有角色文字资料 | 否 | 是 |
| 完整备份 ZIP | 跨设备迁移角色和头像 | 是 | 是 |
| 头像素材 JSON | 独立备份头像素材库 | 是 | 是 |
| CSV | 纯文字表格，可在 Excel / Numbers 里编辑后导回 | 否 | 是 |
| PDF | 展示和归档 | 显示当前头像 | 否 |
| JPG / PNG | 图片分享 | 显示当前头像 | 否 |

完整备份 ZIP 包含：

```text
characters.json
manifest.json
backup-info.json
assets/avatar/*
```

导入角色时会先显示导入预览，确认后才写入本地数据。

---

## Local First

Character Studio 当前是 Local First 应用。

- 角色文字数据保存在 `localStorage`
- 上传头像和头像素材保存在 `IndexedDB`
- 不需要账号
- 不依赖服务器
- 不上传角色资料
- 可通过 JSON / ZIP 完成备份和迁移；CSV 仅承载表格中的文字列，不含头像

请注意：清除浏览器缓存或站点数据可能导致本地数据丢失。建议定期导出角色 JSON 或完整备份 ZIP。

---

## 技术栈

| 技术 | 用途 |
| --- | --- |
| React | 前端 UI |
| TypeScript | 类型约束 |
| Vite | 开发与构建 |
| html2canvas | 展示页与关系网截图导出（动态 import） |
| jsPDF | PDF 导出（动态 import） |
| vitest + happy-dom + fake-indexeddb | 单元测试（31 个文件 / 360 个用例，不需要浏览器） |
| localStorage | 角色文字数据与偏好 |
| IndexedDB | 头像素材 Blob 存储 |

---

## 项目结构

```text
src/
├── App.tsx                    # 应用外壳、页面调度、全局弹窗、浮动栏
├── main.tsx
├── styles.css                 # 唯一样式表（约 7177 行，含全部设计令牌）
├── components/                # AvatarDisplay / Icon(42 个图标) / CharacterPicker / AiSettingsForm
├── hooks/                     # 状态域：保存、头像、分节、身份字段、图层、偏好、消息、媒体查询、弹窗键盘
├── config/
│   ├── developerSettings.ts    # 统一设置对象（单一真相源）+ 应用到 CSS 变量
│   ├── themeTokens.ts
│   └── version.ts              # 版本号 + 构建时注入的 commit / 时间戳
├── content/defaultContent.ts
├── data/                      # avatarCategories、external-inspiration-library.txt（懒加载词库）
├── lib/developerStorage.ts
├── pages/
│   ├── Dashboard.tsx           # 主页（静态入首屏）
│   ├── CharacterForm.tsx       # 编辑工作台（懒加载）
│   ├── CharacterPreview.tsx    # 预览页，双模式 browse / editing（懒加载）
│   ├── DeveloperCenter.tsx     # 开发者中心（懒加载，唯一有真实 URL 的路由）
│   ├── RelationshipGraph.tsx   # 角色关系网（懒加载）
│   ├── Timeline.tsx            # 世界观时间线（懒加载）
│   ├── WorldManager.tsx        # 世界观管理（懒加载）
│   ├── dashboard/layers.ts     # 仪表盘弹窗/浮层的一份声明
│   └── editor/sections.ts      # 六个分节的元数据与完成度规则
├── storage/                   # 每个数据集一个模块：键名、类型、归一化、读写
├── types/                     # character / relationship / timeline / world / app
└── utils/                     # 纯逻辑：裁剪几何、批量编辑、年龄、CSV、导入导出、颜色降级、懒加载恢复

test/                          # 31 个文件 / 360 个用例（vitest + happy-dom + fake-indexeddb）

scripts/
├── build-identity.mjs         # 构建身份（环境变量优先，缺省从 git 推导，脏树标 -dirty）
├── build-info.mjs             # 产出 build-info.json / 404.html / .nojekyll
└── verify-deploy.mjs          # 校验线上产物与本地构建一致
```

### 页面与数据流

`App.tsx` 是唯一的调度者：页面之间**互不引用**。角色集合由 `App.tsx` 独占所有权，页面通过 `onSave` / `onImport` / `onDelete` 等回调请求写入；关系网 / 时间线 / 世界观各自拥有自己的存储模块。

完整的模块边界、数据模型、持久化与导入导出架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 首屏与按需加载

`Dashboard` 静态打入首屏包（它是落地页，走二次请求反而更慢）；`CharacterForm`、
`CharacterPreview`、`DeveloperCenter`、`RelationshipGraph`、`Timeline`、`WorldManager`
六条路由通过 `React.lazy` 拆分，只在真正打开时下载。
词库文件 `external-inspiration-library.txt`（37 KB）因此也移出了首屏。

懒加载的块带内容哈希，而 GitHub Pages 部署会整体替换目录 —— **已打开的标签页持旧入口，第一次懒加载就要一个已删除的块**。这类失败由 `utils/lazyImport.ts` 自愈（只在「块取不到」时刷新一次）。

| 产物 | 优化前 | 优化后 |
| --- | --- | --- |
| 首屏 JS | 417.3 KB（gzip 131.8 KB） | 265.5 KB（gzip 78.5 KB） |
| 首屏 CSS | 81.9 KB（gzip 14.7 KB） | 82.5 KB（gzip 14.9 KB） |
| 按需加载 | html2canvas、jsPDF | 另加编辑器 67.1 KB、开发者中心 37.4 KB、展示页 10.8 KB、词库 37.3 KB |

更完整的架构、历史和维护说明请阅读：

```text
Developer Handbook.md
```

---

## 安装与运行

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

本地预览生产构建：

```bash
npm run preview
```

其他脚本：

```bash
npm run test             # 单元测试（vitest）
npm run typecheck        # 仅类型检查
npm run build:pages      # 构建 GitHub Pages 版本（带子路径与构建信息）
npm run verify:deploy    # 比对线上产物与本地构建
```

---

## 部署

线上地址：<https://rintotan.github.io/character-studio/>（唯一正式地址）

> 历史：项目曾部署在 `character-studio-nine.vercel.app`。该 Vercel 项目已于 2026-10-14 删除，
> 域名返回 `DEPLOYMENT_NOT_FOUND`，Git 集成同步解除，Pages 现在是唯一的发布目标。
> 注意应用数据按 origin 隔离，旧域名下的 `localStorage` / `IndexedDB` 不会迁移过来。

发布流程由 [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) 驱动：
推送到 `main` 触发 `pnpm install --frozen-lockfile` → `typecheck` → `build:pages`
→ `upload-pages-artifact` → `deploy-pages`。本地不再需要手工发布。

几个容易踩的点：

- **子路径**：站点发布在 `/character-studio/` 而不是域名根目录，所有资源 URL 都依赖
  `vite build --base=/character-studio/`。开发与 `vite preview` 仍跑在根路径。
- **深链接**：`/character-studio/developer` 在静态托管上会 404，因此构建时把 `index.html`
  复制为 `404.html`；应用启动时读取 URL 决定进入哪个页面。页面路由 URL 由
  `import.meta.env.BASE_URL` 推导，不写死 `/developer`。
- **版本漂移**：只靠手写的 `version.ts` 标签无法证明线上跑的是哪个提交。构建会把
  commit 与时间戳注入前端（About 面板可见），同时产出 `build-info.json`；
  `npm run verify:deploy` 会校验线上入口包、样式表、文件字节数和 commit 是否与本地构建一致，
  不一致就以非零码退出。

---

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `N` | 新建角色 |
| `/` | 打开**搜索框**（注意不是筛选面板） |
| `Esc` | 关闭弹窗、菜单、搜索框（在破坏性确认框上等于「取消」） |
| `Enter` | 打开第一个搜索结果 |
| `Ctrl / Cmd + K` | 打开 Command Palette |
| `Ctrl / Cmd + S` | 在编辑工作台中保存角色 |
| `Tab` | 切换输入焦点 |

输入框、文本域和选择控件聚焦时，快捷键不会干扰正常输入。

---

## 主题与响应式

Character Studio 支持：

- Light
- Dark
- Follow System

Dashboard、Editor、Preview、Settings、About、头像素材库、Dialog、Toast、Tooltip 均适配深色模式。

移动端会自动收敛部分按钮和信息，优先保证角色卡片、菜单、导出弹窗和编辑区域可用。

---

## 当前状态

当前版本已经具备完整的本地角色创作与管理闭环：

- 角色 CRUD
- 草稿箱、收藏夹、置顶
- 搜索、筛选、排序（4 种）
- 批量选择、批量编辑、批量收藏 / 复制 / 导出 / 删除
- 卡片视图（>30 角色时按世界观分组）与列表视图（可逐行选择）
- 六模块编辑工作台：折叠记忆、完成度、跳到下一个未完成、自动保存草稿、随机生成、创作辅助
- Emoji / Image Avatar，含裁剪与本地素材库
- 本地头像素材库（IndexedDB，含引用提示与批量管理）
- 角色关系网、世界观时间线、世界观管理三个独立工作区
- JSON / CSV / ZIP 导入；JSON / ZIP / CSV / PDF / JPG / PNG 导出
- Preview 展示页（浏览 / 编辑入口双模式）
- Light / Dark / Follow System
- 基础 Design System 控件（令牌化的颜色、圆角、控件高度与层序）
- Developer Center（版本/品牌/设计系统/文案/Prompt/应用配置/导出/工具/实验开关）
- 31 个测试文件 / 360 个用例；CI 在构建前执行类型检查与测试

### 可访问性

已在真实渲染层（而非只看样式表）核对过 Dashboard、Editor、Developer Center 的
浅色与深色两套主题，以及 375px 窄视口：

- 正文与辅助文字对比度均达到 WCAG AA
- 可缩放：viewport 不再声明 `user-scalable=no` / `maximum-scale=1`，允许双指放大
- 开关控件带 `role="switch"` 与 `aria-checked`，状态可被读屏识别
- 无无名可聚焦控件、无缺 `alt` 图片、375px 无横向滚动

主按钮文字颜色不再硬编码：强调色可在 Developer Center 修改，`--on-primary`
会按对比度自动在白色与近黑之间取值。

---

## Roadmap

已交付（原先列在这里的三项，随 1.1.0 / 1.2.0 / 2.0.0 上线）：

- ~~Character Relationship：角色关系网~~（v1.1.0）
- ~~Timeline：角色和世界事件时间线~~（v1.2.0）
- ~~World Manager：世界观管理~~（v2.0.0）

未来可能扩展：

- Faction / Organization：阵营与组织
- Map / Location：地图与地点
- Multi-version Character：多版本角色
- AI Assistant：AI 创作辅助
- Cloud Sync：云同步
- Plugin System：插件与模板系统

**以上只是方向，没有排期，也没有任何代码实现。** 带优先级、前置条件、验收标准与当前状态的完整路线图见 [docs/ROADMAP.md](docs/ROADMAP.md)。

### 已知限制与未完成

**产品层面的限制（当前版本刻意不做）**

- **没有账号、没有服务器、没有云同步。** 数据只存在于当前浏览器：换设备、换浏览器或换域名都看不到原来的数据。站点地址变更会导致数据「看不见」（浏览器的存储按 origin 隔离）。
- **没有 AI 助手。** 所有随机生成、关键词与 Prompt 都是**本地词库与规则**的产物，不发起任何网络请求。
- **Preview 导出的 PDF / JPG / PNG 不能再导入回来**（它们是展示稿，不是数据格式）；能重新导入的是 JSON / ZIP / CSV。
- **CSV 不携带角色 id**，重建时会生成新 id；关系通过角色**名称**建立，因此重名会解析到第一个匹配项。
- **没有 i18n**：界面全中文，英文只出现在 AI Prompt 的生成结果里。

**内部质量项（按当前优先级）**

- **把 Dashboard 与 CharacterForm 的 JSX 拆成容器 / 展示组件。** 两个页面各约 3600 / 3000 行，
  纯逻辑（筛选排序、完成度规则、区块元数据、保存流程、头像域）已经抽出并可单测，剩下的巨型渲染函数尚未拆。
  这不是「顺手改改」的一批：卡片与编辑器区块承载拖拽、批量选择、弹窗与自动保存，
  需要先补齐针对这些交互的探针再做，否则是用回归风险换行数。
- **设置弹窗**未加宽 / 未中文化 / 未折叠尚未发布的功能（P2）。
- **编辑页六个分节**的设计语言未统一（P2，仅操作栏的玻璃效果已做）。
- **`useDialogKeyboard` 的键盘行为**没有有效验证证据，目前只有类型检查保证（P2）。
- **约 140 处硬编码颜色字面量**、74 组共用声明体的 CSS 未合并（P3，需逐条判断层叠位置）。
- **三档视口下的关系网重排、深色主题目视检查、导出分辨率 3x 的实际字节数**均未验证。
- **Apple 设备的日期控件与 Windows 的 Emoji 显示**需要真机验收。

当前阶段仍以本地优先、数据安全、导入导出稳定和 UI 一致性为主。
完整的任务清单、优先级、前置条件与验收标准见 [docs/ROADMAP.md](docs/ROADMAP.md)；
已确认问题与证据见 [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)。

---

## 项目文档

| 文档 | 职责 |
| --- | --- |
| [README.md](README.md) | 本文件：项目定位、版本、功能、技术栈、运行方式、文档索引 |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | **当前状态总览**：版本与提交、已完成 / 部分完成 / 未完成、验证等级、已知问题摘要、下一步重点 |
| [CHANGELOG.md](CHANGELOG.md) | 每个发布版本的变更与**验证边界**（哪些实测、哪些未验证） |
| [Developer Handbook.md](Developer%20Handbook.md) | 面向开发者与 AI 协作者的长期手册：历史、架构、数据结构、UI 与开发规范、路线图 |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | 项目定位、用户流程、模块边界、核心功能与总体架构 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 技术栈、路由、组件关系、数据模型、数据流、持久化、导入导出、测试与部署、高风险区域 |
| [docs/FEATURES.md](docs/FEATURES.md) | 全部实际功能的清单（状态 / 入口 / 数据依赖 / 验证情况 / 遗留问题） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 近期 / 中期 / 长期计划，含优先级、前置条件、验收标准与状态 |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | 已确认问题（复现条件 / 影响 / 优先级 / 证据 / 建议方向）+ 待验证的设计假设 |
| [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) | 可确认的开发阶段、重要决策、关键修复、回退与口径更正 |
| [docs/UI_AUDIT.md](docs/UI_AUDIT.md) | UI 现状审计：页面结构、设计令牌、组件模式、交互行为、响应式与主题、已确认的 UI 问题 |
| [docs/UI_DESIGN_HANDOFF.md](docs/UI_DESIGN_HANDOFF.md) | **交给其他设计智能体的独立任务输入**（定位、页面清单、设计系统、必须保留的行为、限制、交付要求） |
| [docs/CHATGPT_REVIEW_PACKAGE.md](docs/CHATGPT_REVIEW_PACKAGE.md) | **交给 ChatGPT 独立审查的项目资料入口**（概况、状态、架构与 UI 摘要、关键文件索引、待决策问题） |

> 数据与功能状态以**源码**为准；文档与实现冲突时，以代码为当前实现证据（冲突记录见 `docs/DEVELOPMENT_LOG.md` 第 8 节）。

---

## Credits

Designed & developed by **RINTO**.

Built with:

- React
- TypeScript
- Vite
- html2canvas
- jsPDF

---

## License

当前仓库未声明开源许可证。使用、分发或二次开发前请先确认授权方式。
