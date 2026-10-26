# Character Studio —— 项目文档索引

> 本目录是项目的文档主目录。每个主题只有一份文档负责，其他文档只引用、不复制。
> 最近整理：2026-10-26（2.60.1，Codex 交接）。

---

## 1. 文档职责

| 位置 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| [`../README.md`](../README.md) | 对外介绍、界面预览、快速开始、数据安全摘要、许可证 | 详细字段、内部实现、逐版本历史 |
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | 当前版本、完成度、验证情况、下一步 | 完整变更史 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 每个版本的变更与验证边界 | 当前状态、教程 |
| `docs/` | 详细技术说明、数据格式、测试、部署、路线图 | 重复 README 的产品介绍 |
| [`archive/`](archive/README.md) | 历史快照（审计、交接、外部审查资料） | 当前行为说明 |

---

## 2. 现行文档

| 文档 | 单一职责 | 什么时候读 |
| --- | --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | 代理硬约束、命令、验证节奏、提交约定 | 任何自动化代理接手 | 
| [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md) | 接手入口：跑起来、代码地图、任务导航、数据安全边界 | 第一次接手、决定改哪里 |
| [`../README.md`](../README.md) | 产品定位、功能总览、快速开始、许可证 | 第一次接触项目、对外介绍 |
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | 版本、模块完成度、验证基线、已知问题摘要 | 想知道「现在到哪一步」 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 路由、组件、状态域、存储键、数据流、部署结构 | 要改代码或理解全局 |
| [`DATA_FORMATS.md`](DATA_FORMATS.md) | 四个数据域的字段、存储键、ZIP 结构、导入规则、恢复点 | 改数据模型、导入导出、备份兼容 |
| [`FEATURES.md`](FEATURES.md) | 逐功能清单：状态、用户可见行为、数据依赖 | 确认某功能是否实现、在哪实现 |
| [`TESTING.md`](TESTING.md) | 三层验证、用例范围、真机边界、提交前清单、仓库维护约定 | 改完代码要验证 |
| [`ACCEPTANCE.md`](ACCEPTANCE.md) | 验收分层、各轮截图索引与属性（当前/历史）、回归入口 | 查证据是否还算数 |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Pages 子路径、CI、构建身份、发布与回滚、线上校验 | 发布或排查部署 |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | 当前未解决 / 待验证的问题 | 修缺陷或确认观感是否已证实 |
| [`ROADMAP.md`](ROADMAP.md) | 近期与长期计划、已取消与已替代的项 | 决定下一步做什么 |
| [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md) | Sprint 38.2 之前的过程原文、关键修复与口径更正 | 查某次排查的原始经过 |
| [`history/PROJECT_HISTORY.md`](history/PROJECT_HISTORY.md) | 历史主线、编号规范（Version/Sprint/Phase）、缺口清单 | 确认「哪个版本发生了什么」 |
| [`history/DECISIONS.md`](history/DECISIONS.md) | 重大决策的原因、取舍与后果 | 想推翻某个设计前 |
| [`DOC_MIGRATION.md`](DOC_MIGRATION.md) | 旧→新路径映射与文档职责 | 找不到某份旧文档 |
| [`HANDOFF_CLEANUP_PLAN.md`](HANDOFF_CLEANUP_PLAN.md) | 文件保留与**未来**清理计划（未执行） | 想清理本地文件前 |
| [`DEBUG_STRESS_TEST_PLAN.md`](DEBUG_STRESS_TEST_PLAN.md) | 可执行的系统测试规范与用例矩阵 | 执行完整系统测试 |
| [`DEVELOPER_GUIDE.md`](DEVELOPER_GUIDE.md) | 长期开发手册：环境、结构、约定、常见改法 | 深入理解设计取舍 |

---

## 3. 按目的找文档

| 我要做的事 | 依次读 |
| --- | --- |
| 接手项目 | `CODEX_HANDOFF.md` → `../README.md` → `PROJECT_STATUS.md` → `ARCHITECTURE.md` |
| 改一处代码 | `ARCHITECTURE.md` → 对应功能的 `FEATURES.md` 条目 → 相关源码 |
| 改数据结构或备份 | `DATA_FORMATS.md` → `ARCHITECTURE.md` 第 6 节 → 相应用例 |
| 修一个缺陷 | `KNOWN_ISSUES.md` → `CHANGELOG.md` 中同模块的历史修复 |
| 做 UI 改版 | `FEATURES.md` → 现行样式源码；历史审计见 `archive/UI_AUDIT.md` |
| 执行测试 | `TESTING.md` → 需要完整用例时再读 `DEBUG_STRESS_TEST_PLAN.md` |
| 发布版本 | `DEPLOYMENT.md` 第 4 节 |
| 查历史判断 | `archive/` 下的快照，注意其版本基线 |

---

## 4. 口径原则

- **数据与功能状态以源码为准。** 文档与实现冲突时，以代码为当前实现证据。
- 不把推测写成事实。验证等级：已测试 / 仅静态检查 / 未验证 / 需真机。
- 文档里不写生产密钥、域名凭据或真实用户数据。
- 截图使用虚构测试数据，存放于 [`screenshots/`](screenshots/)。

---

## 5. 维护规则

1. 任何源码改动 → `../CHANGELOG.md`，写明验证边界（哪些实测、哪些只是代码层确认）。
2. 修复缺陷 → 更新 `KNOWN_ISSUES.md`，写清机制而不只是改状态。
3. 数据模型 / 存储 / 导入导出变化 → 同步 `DATA_FORMATS.md` 与相关用例。
4. 发布 → 更新 `../README.md` 的版本行、`PROJECT_STATUS.md`，并核对线上 `build-info.json`。
5. 新增文档前先确认没有同类文档；有重复时合并，而不是再写一份。
