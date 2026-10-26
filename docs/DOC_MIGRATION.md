# 文档迁移与职责表

> 2026-10-26 交接整理。记录**原路径 → 新路径**、处理理由、信息保留情况、引用修复情况。
> 原则：合并只减重复，不减知识；旧文件先归档，验证内容可追溯后才允许物理删除（阶段 B）。

## 1. 迁移表

| 原路径 | 新路径 | 理由 | 信息保留 | 引用修复 |
| --- | --- | --- | --- | --- |
| `Developer Handbook.md`（根，1860 行） | `docs/archive/DEVELOPER_HANDBOOK_2026-10-25.md`（**归档**）+ 新建 `docs/DEVELOPER_GUIDE.md` | 根目录只留三份入口文件；手册内容与 `ARCHITECTURE`/`DATA_FORMATS` 大量重复 | 原文完整保留在 archive；新手册承接「环境/结构/约定/改法」，细节指向原文件 | `README.md`、`docs/README.md`、`docs/PROJECT_STATUS.md`、`scripts/verify-docs.mjs` 已改 |
| （无） | `AGENTS.md`（根，新建） | Codex 需要一份高优先级短规则，不能塞整本手册 | 新写，命令与约束均来自现有脚本与文档 | 新增 |
| （无） | `docs/CODEX_HANDOFF.md`（新建） | 交接入口：跑起来、改哪里、边界在哪 | 新写 | 新增 |
| （无） | `docs/history/PROJECT_HISTORY.md`（新建） | 历史主线与编号规范集中一处 | 汇总 `DEVELOPMENT_LOG`、`CHANGELOG`、标签与提交 | 新增 |
| （无） | `docs/history/DECISIONS.md`（新建） | 决策与后果单独成册，避免散落在变更日志 | 提炼自各轮报告与代码注释 | 新增 |
| （无） | `docs/HANDOFF_CLEANUP_PLAN.md`（新建） | 清理计划与执行分离 | 新写 | 新增 |
| `docs/DEVELOPMENT_LOG.md` | 位置不变 | 仍是 Sprint 38.2 之前的唯一过程记录 | 原样保留（顶部概览表已过期，标注在历史文末） | 无需改 |

## 2. 现行职责（一份事实只有一个家）

| 文档 | 唯一负责 | 不负责 |
| --- | --- | --- |
| `README.md` | 对外介绍、能力、快速开始、文档入口 | 字段、实现、逐版本历史 |
| `AGENTS.md` | 代理硬约束、命令、验证节奏 | 教程 |
| `docs/CODEX_HANDOFF.md` | 接手路线、代码地图、任务导航、数据安全边界 | 重复实现细节 |
| `docs/DEVELOPER_GUIDE.md` | 环境、目录、状态流、UI 约定、常见改法、兼容边界 | 历史流水账 |
| `docs/ARCHITECTURE.md` | 系统结构、模块职责、数据流 | 逐版本变更 |
| `docs/DATA_FORMATS.md` | 实体字段、存储键、备份结构、导入规则 | 界面行为 |
| `docs/PROJECT_STATUS.md` | 当前版本、完成度、验证基线、未解决问题 | 完整变更史 |
| `docs/ROADMAP.md` | 候选、远期、已取消 | 已完成历史（指向 history） |
| `docs/TESTING.md` | 测试结构、命令、覆盖范围、限制 | 具体某轮结果 |
| `docs/DEPLOYMENT.md` | Pages 构建、发布、校验、回滚 | 开发流程 |
| `docs/FEATURES.md` | 逐功能状态与用户可见行为 | 实现细节 |
| `docs/KNOWN_ISSUES.md` | 未解决问题（区分产品/环境/未验证） | 已修历史 |
| `docs/ACCEPTANCE.md` | 验收分层与截图索引 | 测试命令 |
| `docs/MOBILE_UI_GUIDELINES.md` | 移动端规则 | 桌面布局 |
| `docs/history/*` | 历史主线与决策原因 | 当前事实 |
| `CHANGELOG.md` | 版本变更与验证边界 | 当前状态 |
| `docs/archive/*` | 历史快照（审计、外部审查、旧手册） | 当前行为 |

## 3. 已知重复（保留，但已标明谁是权威）

- `docs/DEVELOPMENT_LOG.md` 与 `docs/history/PROJECT_HISTORY.md`：前者是**过程原文**，后者是
  **索引**。索引不复制原文细节。
- `docs/FEATURES.md` 与 `README.md` 功能列表：README 只列能力名，细节在 FEATURES。
- `docs/ACCEPTANCE.md` 与 `docs/screenshots/`：前者是索引，后者是文件。
- `docs/archive/DEVELOPER_HANDBOOK_2026-10-25.md` 与 `docs/DEVELOPER_GUIDE.md`：归档件只读，
  不再更新；新事实写进 GUIDE。

## 4. 尚未处理（留给用户决定）

| 项 | 说明 |
| --- | --- |
| 归档手册是否压缩成专题 | 1860 行里有大量一次性排查记录，可拆成 `history/` 专题，但需要逐段判断，本轮不做 |
| `docs/sprint-53.3-acceptance/` | 未入 Git，是否作为正式证据提交未定 |
| `docs/DEBUG_STRESS_TEST_PLAN.md`（4514 行） | 与 `TESTING.md` 有重叠，但内容不可再生，暂不合并 |
