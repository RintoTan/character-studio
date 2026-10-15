# Character Studio —— 项目文档索引

> 本目录是项目的**文档主目录**。本文件是入口：先在这里找到该读哪一份，再打开那一份。
> 每个主题**只有一份文档负责**，其他文档只引用、不复制。

---

## 1. 文档落位规则

| 位置 | 放什么 | 为什么 |
| --- | --- | --- |
| 仓库根目录 | `README.md`、`CHANGELOG.md`、`Developer Handbook.md` | 三者是 GitHub 约定文件与应用内硬引用：`Developer Handbook.md` 被页面里的 7 处链接指向 `blob/main/Developer%20Handbook.md`，改名或移动会打断线上入口 |
| `docs/` | 其余全部项目文档（本目录） | 单一文档主目录，便于整目录交接与外部审查 |
| `src/` | 源码 | 数据与功能的**唯一真相源** |

---

## 2. 文档清单

| 文档 | 单一职责 | 什么时候读它 |
| --- | --- | --- |
| [../README.md](../README.md) | 项目定位、当前版本、核心功能、技术栈、运行方式 | 第一次接触这个项目 |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | **当前状态总览**：版本与提交、已完成 / 部分完成 / 未完成、验证等级、已知问题摘要、下一步重点 | 想知道「现在到哪一步了、哪些验证过、哪些没有」 |
| [../CHANGELOG.md](../CHANGELOG.md) | 每个版本的变更，**含验证边界**（哪些实测、哪些未验证） | 查某个版本改了什么、当时验到了什么程度 |
| [../Developer Handbook.md](../Developer%20Handbook.md) | 长期手册：项目简史、架构、数据结构、UI 与开发规范、经验教训 | 动手改代码之前 |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | 定位、用户流程、模块边界、核心功能与总体架构 | 需要一张「这个应用由什么组成」的全图 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 技术栈、路由、组件关系、数据模型、**存储键**、数据流、持久化、导入导出、测试与部署、高风险区域 | 要改数据模型、存储、导入导出或部署 |
| [FEATURES.md](FEATURES.md) | 每个真实功能的清单：状态 / 实现证据 / 用户可见行为 / 数据依赖 / 已知问题 / 验证情况 | 要查某个功能到底实现了没有、在哪实现 |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | 已确认问题（复现条件 / 证据 / 影响 / 优先级 / 建议方向）+ 已修复的坑 + 待验证的设计假设 | 要修缺陷，或想确认某个观感是否已被证实 |
| [ROADMAP.md](ROADMAP.md) | 近期 / 中期 / 长期任务，含优先级、前置条件、验收标准、状态，以及「已取消 / 已废弃 / 已被替代」 | 要知道下一步做什么 |
| [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) | 可确认的开发阶段、重要决策、关键修复、回退与**口径更正记录** | 想查某个决定或回退的来由 |
| [UI_AUDIT.md](UI_AUDIT.md) | UI 现状审计：页面与布局清单、设计令牌、组件模式、交互行为（含验证等级）、已确认的 UI 问题 | 要做 UI 改动或设计评审 |
| [UI_DESIGN_HANDOFF.md](UI_DESIGN_HANDOFF.md) | **交给其他设计智能体的独立任务输入**：必须保留的行为、不可突破的限制、交付要求、改版优先级 | 要把 UI 工作外包给设计智能体 / 设计师 |
| [DEBUG_STRESS_TEST_PLAN.md](DEBUG_STRESS_TEST_PLAN.md) | **可执行的 Debug / 压力测试规范**：294 条用例（含 34 条历史缺陷回归）、11 条端到端旅程、测试环境与安全规则、执行与停止条件、结果与缺陷模板、覆盖率矩阵、自动化转化路径 | 要执行系统测试，或把测试交给测试智能体 |
| [CHATGPT_REVIEW_PACKAGE.md](CHATGPT_REVIEW_PACKAGE.md) | **交给外部审查者的资料入口**：概况、状态、架构与 UI 摘要、关键文件索引、待决策问题 | 要让外部审查者（如 ChatGPT）快速了解项目 |

---

## 3. 按目的找文档

| 我要做的事 | 依次读 |
| --- | --- |
| 接手这个项目 | `../README.md` → `PROJECT_STATUS.md` → `PROJECT_OVERVIEW.md` → `../Developer Handbook.md` |
| 改一处代码 | `../Developer Handbook.md` → `ARCHITECTURE.md` → 该功能在 `FEATURES.md` 里的条目 |
| 修一个缺陷 | `KNOWN_ISSUES.md` → `CHANGELOG.md` 里同模块的历史修复（可能已踩过） |
| 做 UI 改版 | `UI_AUDIT.md` → `UI_DESIGN_HANDOFF.md` |
| 执行测试 | `DEBUG_STRESS_TEST_PLAN.md`（先读它的第 1、2、16 节与附录 E 执行前检查清单） |
| 交给外部审查 | `CHATGPT_REVIEW_PACKAGE.md`（它自带关键文件索引与待决策问题） |
| 发布新版本 | `ROADMAP.md` 第 6 节「每次后续开发结束后需要更新的文档」 |

---

## 4. 口径原则

- **数据与功能状态以源码为准。** 文档与实现冲突时，以代码为当前实现证据。
- 冲突不会悄悄抹掉：历史口径更正逐条记录在 [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md) 第 8 节。
- **不得把推测写成事实。** 验证等级沿用四档：已测试 ／ 仅静态检查 ／ 未验证 ／ 需真机；无法确认的写入 `KNOWN_ISSUES.md` 的「待验证的设计假设」，不混进已确认清单。
- 文档里不写生产密钥、域名凭据或用户数据。

---

## 5. 维护规则

改动代码后需要同步哪些文档，见 [`ROADMAP.md`](ROADMAP.md) 第 6 节。三条最容易忘的：

1. 任何源码改动 → `../CHANGELOG.md`（必须含**验证边界**：哪些实测、哪些只是代码层确认）。
2. 修复缺陷 → 把它从 `KNOWN_ISSUES.md` 第 1 节移入第 2 节「已修复但值得记住的坑」，并写清机制，而不是只改状态。
3. 发布 → 核对线上 `build-info.json` 的 `commit` 与本地 `HEAD` 一致，并更新 `../README.md` 的版本行与本目录的状态文档。

> 本索引建立于 2026-10-15，作为文档落位规整的一部分；此前 `PROJECT_STATUS.md` 与 `DEBUG_STRESS_TEST_PLAN.md` 位于仓库根目录。
