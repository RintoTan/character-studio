# AGENTS.md —— 接手本仓库的第一份规则

> 适用对象：任何自动化开发代理（当前为 Codex）。只写「必须遵守」和「去哪儿查」，
> 不复制说明书。深入内容见 [`docs/CODEX_HANDOFF.md`](docs/CODEX_HANDOFF.md)。
> 最后核对：2026-10-26（v2.60.1 / `f7a12f4`）。

---

## 1. 这是什么

纯前端、本地优先的角色设定管理工具。数据全部存在浏览器里（localStorage + IndexedDB），
没有后端、没有账号、没有云同步。四个工作区：角色库（Dashboard）、关系网、时间线、世界观。

- 线上：<https://rintotan.github.io/character-studio/>（GitHub Pages，子路径 `/character-studio/`）
- 仓库：<https://github.com/RintoTan/character-studio>
- 版本源头：`package.json` 与 `src/config/version.ts` 必须一致；`npm run verify:version` 校验

## 2. 命令（只用这些，别自创）

| 目的 | 命令 |
| --- | --- |
| 开发服务器 | `pnpm dev` |
| 类型检查 | `pnpm typecheck`（`tsc -b`） |
| 单元测试（全量，通常几秒） | `pnpm test` |
| 单个测试文件 | `pnpm vitest run test/xxx.test.ts` |
| 生产构建（Pages 版，含 build-info） | `pnpm build:pages` |
| 版本一致性 | `pnpm verify:version` |
| 文档一致性 | `pnpm verify:docs` |
| 浏览器验收（可 `--only=` / `--shard=i/n` / `--list`） | `pnpm verify:browser` |
| 线上与本地构建比对 | `pnpm verify:deploy` |

包管理器是 **pnpm**（`pnpm-lock.yaml`）。不要提交 `node_modules`、`dist`、`tmp`。

## 3. 硬性约束

1. **不引入云同步、后端、账号体系、多语言（i18n）、AI 接口。** 这是产品决策，不是待办。
2. **数据格式优先稳定。** 改存储键、字段或备份结构，必须同时提供迁移、备份与恢复验证；
   不允许静默丢弃用户数据。字段与键的现状见 [`docs/DATA_FORMATS.md`](docs/DATA_FORMATS.md)。
3. **实体 ID 不可重排或复用于其他实体。** 关系、时间线、世界观都靠 ID 交叉引用。
4. **不为「看起来干净」删测试断言。** 检查失败要么是真缺陷，要么是探针缺陷，先判性质再改。
5. **不擅自升版本号。** 版本只在发布准备阶段提升，且必须同步 CHANGELOG。
6. **不改 `docs/audit/`**（历史审计原件）与 `docs/history/`（历史主线）中的既有记录；
   新增历史记录用追加方式。
7. **发布动作（push main / 部署）需要用户显式授权。** 构建与本地验证不需要。

## 4. 验证节奏

- 日常改动：相关单测 + `pnpm typecheck` + `pnpm build:pages`，必要时跑对应 `--only=` 的浏览器检查。
- **不要默认跑完整浏览器套件**（88 项、约 20 分钟、需要真实 Chrome）。完整套件只在明确要求
  或高风险发布前跑，且必须用**同一个构建**、分 `--shard=1/3`…`3/3` 再跑汇总脚本。
- 浏览器检查的 SKIP 与 TIMEOUT **不算通过**；失败不许靠放宽阈值或延长时间变绿。
- 长会话后自由画布一类拖动检查可能因 CDP 输入积压而 TIMEOUT/误判，判定方式：短会话单独
  重跑同一检查；只有无法复现为通过时才算环境问题。

## 5. 改代码前先读

| 任务 | 先读 |
| --- | --- |
| 任何改动 | 本文件 → [`docs/CODEX_HANDOFF.md`](docs/CODEX_HANDOFF.md) |
| 数据 / 备份 / 导入 | [`docs/DATA_FORMATS.md`](docs/DATA_FORMATS.md) → `src/storage/` |
| 页面结构 / 组件 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| UI 风格 / 移动端 | [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) 的 UI 章节 + `src/styles.css` |
| 测试与发布 | [`docs/TESTING.md`](docs/TESTING.md)、[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| 某决定的来由 | [`docs/history/DECISIONS.md`](docs/history/DECISIONS.md) |

## 6. 提交约定

`Sprint / 工作项` 写进 commit 标题，正文说明**为什么**改，以及验证做到哪一步（跑了什么、
哪项没跑）。文档与代码分开提交。提交前 `git status` 确认没有把 `tmp/`、`dist/`、
个人数据或审计原件带进去。

## 7. 交付标准

能用的具体场景优先于架构洁癖；小步迭代优先于大重构；没验证的事写成「未验证」而不是「已完成」。
