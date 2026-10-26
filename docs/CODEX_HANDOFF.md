# Codex 交接：Character Studio

> 这份文件是接手入口，目标是让 Codex 在不读 Accio 历史会话的前提下理解项目、跑起来、改对地方。
> 版本 **2.60.1**｜提交 `f7a12f4`｜2026-10-26。历史主线见
> [`history/PROJECT_HISTORY.md`](history/PROJECT_HISTORY.md)，决策理由见
> [`history/DECISIONS.md`](history/DECISIONS.md)。

---

## 1. 项目概况

| 项 | 值 |
| --- | --- |
| 产品定位 | 中文长篇小说/OC 创作者的**本地优先**角色设定管理工具：角色库、关系网、时间线、世界观 |
| 仓库 | <https://github.com/RintoTan/character-studio> |
| 线上 | <https://rintotan.github.io/character-studio/>（GitHub Pages，子路径 `/character-studio/`） |
| 版本 | `2.60.1` —— `package.json` + `src/config/version.ts`，`pnpm verify:version` 校验 |
| 技术栈 | React 18 · TypeScript 5.7 · Vite 6 · Vitest 3（happy-dom）· Mantine 7 · pnpm 10 |
| 数据 | 全部本地：localStorage（主体）+ IndexedDB（头像等大对象）；无后端、无账号 |
| 部署 | GitHub Actions `deploy-pages.yml` → Pages；构建注入 `build-info.json` |

**没有的东西**（不要"顺手补"）：登录、云同步、多人协作、i18n、AI 生成接口、后端服务。

## 2. 本地运行

```bash
pnpm install                 # Node ≥ 20
pnpm dev                     # 开发服务器
pnpm typecheck               # tsc -b
pnpm test                    # 单元测试（约 95 文件）
pnpm build:pages             # 生产构建（带 /character-studio/ base 和 build-info）
pnpm verify:docs             # 文档链接/图片/版本一致性
pnpm verify:version          # package.json ↔ version.ts
pnpm verify:browser --list   # 浏览器检查清单（需要本机 Chrome）
pnpm verify:deploy           # 线上产物与本地构建逐字节比对
```

浏览器检查支持 `--only=<子串>`、`--shard=i/n`、`--range=a-b`；跑完分片后用
`node scripts/verify-browser-summary.mjs --dir=<目录> --shards=3` 汇总。**不要把 SKIP 当 PASS。**

## 3. 架构入口（代码在哪）

| 领域 | 入口 | 关键文件 |
| --- | --- | --- |
| 应用外壳 / 路由 | `src/App.tsx` | 工作区切换、主题、备份提示、全局快捷键 |
| 角色库 | `src/pages/Dashboard.tsx`、`src/pages/dashboard/` | `list-toolbar` 工具栏、筛选、批量操作 |
| 角色编辑 | `src/pages/CharacterForm.tsx`、`src/pages/editor/` | 分段表单、Mantine 迁移后的控件 |
| 角色预览 / 导出 | `src/pages/CharacterPreview.tsx` | PDF 导出、关联信息 |
| 关系网 | `src/pages/RelationshipGraph.tsx` | SVG 画布、外观面板、布局快照、拖拽与缩放 |
| 时间线 | `src/pages/Timeline.tsx`、`src/pages/timeline/` | 年份导航、事件卡片、长描述折叠 |
| 世界观 | `src/pages/WorldManager.tsx`、`src/pages/world/` | 条目列表、层级与角色筛选 |
| 开发者中心 | `src/pages/DeveloperCenter.tsx` | 只读诊断与开关，勿当业务入口 |
| 存储层 | `src/storage/*.ts` | 每个数据域一个模块，另有 `backup.ts`、`workspaceBackup.ts` |
| 类型 | `src/types/` | 实体与视图类型 |
| 组件 | `src/components/`、`src/ui/` | 共享组件与设计令牌（`src/ui/tokens.css`） |
| 样式 | `src/styles.css` | 单文件、分区注释；媒体查询断点 720 / 900 / 1024 |

数据流：页面 → `src/storage/*` → localStorage/IndexedDB；跨实体引用只存 ID，不存副本。
备份是四个数据域的快照 + 恢复点，格式见 [`DATA_FORMATS.md`](DATA_FORMATS.md)。

## 4. 按任务阅读

| 要改什么 | 依次读 |
| --- | --- |
| 角色编辑器 | 本文 §3 → [`ARCHITECTURE.md`](ARCHITECTURE.md) 编辑器节 → `CharacterForm.tsx` → `docs/DEVELOPER_GUIDE.md` UI 约定 |
| 关系网 | [`ARCHITECTURE.md`](ARCHITECTURE.md) 关系网节 → `RelationshipGraph.tsx` → `src/storage/relationshipLayout.ts`、`canvasStyle.ts` → 浏览器检查 `--only=自由画布`、`--only=外观` |
| 时间线 | `Timeline.tsx` → `src/storage/timelineStorage.ts` → 检查 `--only=时间线` |
| 世界观 | `WorldManager.tsx` → `worldStorage.ts` → 检查 `--only=世界观` |
| UI / 移动端 | `docs/DEVELOPER_GUIDE.md` UI 章 → `src/ui/tokens.css` → `src/styles.css` 对应断点 → 检查 `--only=移动端` |
| 数据 / 备份 | [`DATA_FORMATS.md`](DATA_FORMATS.md) → `src/storage/backup.ts`、`workspaceBackup.ts` → `test/backup*.test.ts` |
| 测试 / 部署 | [`TESTING.md`](TESTING.md)、[`DEPLOYMENT.md`](DEPLOYMENT.md) → `scripts/verify-*.mjs` |

## 5. 数据安全边界

- **稳定 ID**：角色/关系/事件/世界条目的 ID 只在创建时生成，永不因编辑而变；导入合并时
  需要建立旧 ID → 新 ID 的映射并在写入阶段统一应用，否则关系与时间线引用会断。
- **删除可恢复**：删除写入 `character-studio.delete-recovery` 快照，恢复路径有单测。
- **覆盖前先快照**：导入/完整恢复在覆盖四域之前先写备份，回滚读取的是同一份快照。
- **空集合不是证据**：任何「按当前数据算出要写回存储的值」的 effect，必须等数据真正加载完，
  否则会用空数组覆盖真实数据（历史事故见 [`history/DECISIONS.md`](history/DECISIONS.md)）。
- **不改字段语义**：字段重命名必须走迁移 + 双向兼容至少一个版本。

## 6. 当前问题（只有证据支撑的）

| 类别 | 问题 | 证据 |
| --- | --- | --- |
| 环境 | 长会话（约 40 项检查后）自由画布拖动/手势检查会 TIMEOUT 或读到拖动前坐标 | v2.60.1 三段验收：1 FAIL + 2 TIMEOUT；短会话隔离重跑 3/3 PASS |
| 未验证 | 真机安全区、软键盘、Safari/Firefox、原生 `<select>` 方向键 | 从未在真机验证 |
| 未运行 | 2 项 `SHOTS=` 门控截图检查 | 需显式开启 |
| 观感 | 外观面板在 375px 下仍约 2000px 长；320px 首屏约 1.4 张角色卡 | v2.60.1 实测 |

其余「已知问题」以 [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) 为准；该文件区分产品缺陷、测试环境
问题与未验证三类。

## 7. 未来候选方向（**未批准开发**）

- 跨实体稳定引用与双向关联（角色 ↔ 事件 ↔ 条目互见）
- `@` 引用与全局搜索
- 角色自定义字段
- 角色与世界观的**多图管理**（含历史编号 U-84 的时间线/世界观配图）
- 时间区间事件、角色人生轨迹、随事件变化的动态关系

远期研究方向、尚未立项：地图生成器、小说创作系统。
以上都不在本次交接的批准范围内，动手前需要用户明确立项。

## 8. 开发约定（摘要，完整版见根目录 `AGENTS.md`）

1. 先交付具体用户场景，再做抽象。
2. 小步迭代，不做无意义的大规模重构；一次只动一个工作面。
3. 默认只跑相关单测、`typecheck`、`build:pages` 和必要浏览器检查。
4. 完整浏览器套件只在明确要求或高风险发布时跑。
5. 不隐藏真实失败；SKIP/TIMEOUT 不是通过。
6. 数据格式变更必须做兼容 + 备份 + 恢复验证。
7. 不擅自引入云同步、多语言、新业务模块。
8. 重要变更记录 `Sprint / 工作项 / 版本 / 提交`，编号规则见
   [`history/PROJECT_HISTORY.md`](history/PROJECT_HISTORY.md) §1。

## 9. 第一小时建议路线

1. `pnpm install && pnpm test` —— 确认基线是绿的（约 95 个测试文件）。
2. 读 [`PROJECT_STATUS.md`](PROJECT_STATUS.md) 与 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
3. `pnpm dev`，走一遍四个工作区，重点看 Dashboard 的工具栏与时间线卡片。
4. `pnpm verify:version && pnpm verify:docs` —— 确认文档与版本没有被上一轮弄脏。
5. 要发布时再读 [`DEPLOYMENT.md`](DEPLOYMENT.md)；发布需要用户授权。
