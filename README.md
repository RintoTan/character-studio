# Character Studio

> **发布状态：v2.6.0**（Sprint 16.1）—— 填充式按钮语言、角色选择器（搜索/已选置顶）、关系网缩放平移与自适应半径。
> 已知未修：主页视图模式在进出编辑页后仍会被重置（见 CHANGELOG 2.6.0）。
> 变更见 [CHANGELOG.md](CHANGELOG.md)；线上地址 <https://rintotan.github.io/character-studio/>。
> 构建会注入提交号，线上站点可在 About 面板反查自己由哪次提交构建。


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

- 基础信息、外貌设定、性格设定、能力设定、背景故事、AI Prompt 分区编辑
- Emoji 头像与上传头像
- 头像裁剪、压缩、本地保存
- 从头像素材库选择头像
- 性格标签与自定义标签
- 随机生成角色
- 本地规则生成中文人物关键词
- 本地规则生成英文 AI 绘图 Prompt
- 自动保存草稿
- 临时保存
- 编辑 / 预览切换
- 创作辅助：示例、随机灵感、写作提示

### Character Preview 展示页

- 简洁角色设定展示页
- 头像、基础资料、性格标签、视觉风格、外貌、能力、背景故事、关键词、Prompt
- 复制完整角色设定
- 复制中文关键词
- 复制英文 Prompt
- 收藏切换
- 点击上传头像查看大图
- 导出 JSON / PDF / JPG / PNG

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
| html2canvas | 展示页截图导出 |
| jsPDF | PDF 导出 |
| localStorage | 角色文字数据与偏好 |
| IndexedDB | 头像素材 Blob 存储 |

---

## 项目结构

```text
src/
├── App.tsx                    # 应用外壳、路由状态、页面调度
├── main.tsx
├── styles.css
├── components/
│   └── AvatarDisplay.tsx
├── pages/
│   ├── Dashboard.tsx
│   ├── CharacterForm.tsx
│   ├── CharacterPreview.tsx
│   └── DeveloperCenter.tsx     # 开发者中心（按需加载）
├── config/
│   ├── developerSettings.ts
│   ├── themeTokens.ts
│   └── version.ts              # 版本号 + 构建时注入的 commit
├── storage/
│   └── characterStorage.ts
├── types/
│   ├── app.ts                  # 页面 / 主题类型
│   └── character.ts
└── utils/
    ├── avatarAssets.ts
    └── importExport.ts

scripts/
├── build-info.mjs              # 产出 build-info.json / 404.html / .nojekyll
└── verify-deploy.mjs           # 校验线上产物与本地构建一致
```

### 首屏与按需加载

`Dashboard` 静态打入首屏包（它是落地页，走二次请求反而更慢）；`CharacterForm`、
`CharacterPreview` 和 `DeveloperCenter` 通过 `React.lazy` 拆分，只在真正打开时下载。
词库文件 `external-inspiration-library.txt`（37 KB）因此也移出了首屏。

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
| `/` | 打开搜索 |
| `Esc` | 关闭弹窗、菜单、搜索面板 |
| `Enter` | 打开第一个搜索结果 |
| `Ctrl / Cmd + K` | 打开 Command Palette |
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
- 草稿箱
- 收藏夹
- 搜索、筛选、排序
- Emoji / Image Avatar
- 本地头像素材库
- JSON / CSV 导入；JSON / ZIP / CSV / PDF / JPG / PNG 导出
- Preview 展示页
- Light / Dark Theme
- 基础 Design System 控件
- Developer Center（版本/品牌/设计系统/文案/Prompt/应用配置/导出/工具）

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

### 已知未完成（内部质量项，按当前优先级）

- **把 Dashboard 与 CharacterForm 的 JSX 拆成容器 / 展示组件。** 两个页面各约 3300 / 3600 行，
  纯逻辑（筛选排序、完成度规则、区块元数据）已经抽出并可单测，剩下的巨型渲染函数尚未拆。
  这不是「顺手改改」的一批：卡片与编辑器区块承载拖拽、批量选择、弹窗与自动保存，
  需要先补齐针对这些交互的探针再做，否则是用回归风险换行数。
- **卡片菜单的交互复审**（本批只加了危险项分隔线，键 Esc 与外部点击关闭在更早批次已完成）。
- **74 组共用声明体的 CSS 合并**（见 CHANGELOG 2.5.0 的实测口径，需逐条判断层叠位置）。

当前阶段仍以本地优先、数据安全、导入导出稳定和 UI 一致性为主。

---

## 开发文档

如果你是新的开发者或 AI 协作者，请先阅读：

```text
Developer Handbook.md
```

这份文档包含：

- 项目发展历史
- 架构说明
- 数据结构说明
- Avatar 与 Asset Library 设计
- 导入导出系统设计
- UI 规范
- 响应式规范
- 开发规范
- AI 协作规范
- Roadmap 与维护说明

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
