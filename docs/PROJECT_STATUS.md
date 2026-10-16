# Character Studio —— 项目状态总览

> 文档最后核查日期：**2026-10-15** ｜ 核查方式：源码 + Git 历史 + 本地只读检查（`tsc -b`、`vitest run`、`vite build`）+ 线上 `build-info.json`
> 本文只记录**有证据**的结论。凡未验证的，一律显式标注。
> **位置变更**：本文件原在仓库根目录，2026-10-15 随文档落位规整移入 `docs/`（根目录只保留 `README.md` / `CHANGELOG.md` / `Developer Handbook.md`）。文档索引见 [`README.md`](README.md)。

---

## 1. 当前状态

| 项目 | 值 |
| --- | --- |
| 应用版本 | **2.27.1**（来源：`src/config/version.ts` 的 `APP_VERSION`，与 `package.json` 一致，`npm run verify:version` 通过）—— **发布候选，等待授权**：线上仍是 2.27.0，本版本未打标签、未推送、未部署 |
| Sprint | **38.2**（`APP_SPRINT`）—— 该版本收进 Sprint 38 / 38.1 / 38.2 三轮工作，最后一个完成的阶段是 38.2（取值规则见 `CHANGELOG.md` 的 2.27.1 条目） |
| Build / Release Year | `2026` / `2026` |
| 分支 | `main` |
| 审计基线提交 | `bccec24843e0ccdae0c97c8ab7d3d0484267e550`（短号 `bccec24`）—— 本文与 `docs/ARCHITECTURE.md` 等文档中的代码行号均以此为基准 |
| 文档提交 | `f94f321`（重建文档体系）→ `3445979`（外部审查入口）→ `36b1cd6`（更正用例数）→ 本轮「文档落位规整与版本口径统一」（提交号见 `CHANGELOG.md` 对应条目） |
| 工作区状态 | **干净**（`git status --porcelain` 无输出） |
| 远端 | `origin` → `https://github.com/RintoTan/character-studio.git` |
| 线上地址 | <https://rintotan.github.io/character-studio/> |
| 线上部署提交 | 每次推送 `main` 由 CI 重新构建。核对方式：线上 `build-info.json` 的 `commit` 应等于 `main` 最新提交（`npm run verify:deploy` 自动比对，不一致则以非零码退出） |

**版本号口径已统一（原 KI-07，2026-10-15 修复）**：`package.json` 的 `version` 已由 `1.0.0` 改为 **`2.27.0`**，与 `src/config/version.ts` 的 `APP_VERSION` 一致。
应用内所有版本显示仍然只读 `version.ts`；`package.json` 的版本号是包元数据，不参与界面与构建产物（`scripts/build-info.mjs` 从 `version.ts` 取值）。
两处尚未合并为单一来源 —— 见 `docs/ROADMAP.md` 的 R-13。

### 运行方式（from `package.json` scripts）

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖（锁文件为 `pnpm-lock.yaml`，CI 用 `pnpm install --frozen-lockfile`） |
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | `tsc -b && vite build` |
| `npm run build:pages` | `tsc -b && vite build --base=/character-studio/ && node scripts/build-info.mjs` |
| `npm run preview` | 预览生产构建 |
| `npm run typecheck` | 仅类型检查（`tsc -b`） |
| `npm test` | `vitest run` |
| `npm run verify:deploy` | 比对线上产物与本地构建（`scripts/verify-deploy.mjs`） |

---

## 2. 已完成模块

以下模块**有实现证据**（组件 + 路由 + 存储/逻辑模块），且大部分有测试覆盖。验证等级见第 5 节。

| 模块 | 实现证据 | 状态 |
| --- | --- | --- |
| 主页（Dashboard）与角色列表 | `src/pages/Dashboard.tsx`（3623 行） | 已实现 |
| 角色编辑工作台 | `src/pages/CharacterForm.tsx`（3008 行）+ 6 个 hook 域 | 已实现 |
| 角色预览展示页 | `src/pages/CharacterPreview.tsx`（555 行），双模式 `browse` / `editing` | 已实现 |
| 收藏 / 草稿箱 | `Dashboard.tsx`（`favoriteMode` 偏好）、`App.tsx` 的 `handlePromoteDraft` / `handleDraftSave` | 已实现 |
| 搜索 / 筛选 / 排序 | `storage/dashboardPrefs.ts` + `Dashboard.tsx` 的 `getVisibleCharacters` | 已实现 |
| 批量选择 / 批量编辑 / 批量删除 / 批量复制 | `utils/bulkEdit.ts`、`Dashboard.tsx` 批量条 | 已实现 |
| 角色关系网 | `src/pages/RelationshipGraph.tsx`（1095 行）+ `storage/relationshipStorage.ts` + `types/relationship.ts` | 已实现 |
| 世界观时间线 | `src/pages/Timeline.tsx`（319 行）+ `storage/timelineStorage.ts` | 已实现 |
| 世界观管理（分层条目） | `src/pages/WorldManager.tsx`（381 行）+ `storage/worldStorage.ts` | 已实现 |
| 开发者中心 | `src/pages/DeveloperCenter.tsx`（1199 行）+ `config/developerSettings.ts` | 已实现 |
| 头像（Emoji + 图片上传 / 裁剪 / 压缩） | `hooks/useAvatarEditing.ts`（433 行）、`utils/cropGeometry.ts`、`components/AvatarDisplay.tsx` | 已实现 |
| 头像素材库（IndexedDB） | `utils/avatarAssets.ts`（374 行） | 已实现 |
| 导入 / 导出 / 备份 / 恢复 | `utils/importExport.ts`（1881 行）、`storage/workspaceBackup.ts`、`storage/backup.ts` | 已实现 |
| 主题（浅色 / 深色 / 跟随系统） | `App.tsx` 主题 effect + `styles.css` 令牌 | 已实现 |
| 弹窗键盘控制 | `hooks/useDialogKeyboard.ts`（90 行） | 已实现 |
| 懒加载块自愈 | `utils/lazyImport.ts`（83 行） | 已实现 |
| 构建身份与部署校验 | `scripts/build-identity.mjs`、`build-info.mjs`、`verify-deploy.mjs`、`.github/workflows/deploy-pages.yml` | 已实现 |
| 单元测试 | `test/` **31 个文件 / 360 个用例** | 已实现 |

---

## 3. 部分完成的模块

| 项 | 已完成的部分 | 尚未完成的部分 |
| --- | --- | --- |
| Dashboard / CharacterForm 拆分 | 纯逻辑与状态已按域抽出：`useDashboardPrefs`、`useDashboardLayers`、`useCharacterSave`、`useAvatarEditing`、`useEditorSections`、`useIdentityEditing`、`pages/dashboard/layers.ts`、`pages/editor/sections.ts` | 两个巨型渲染体（各约 3300 / 3000 行）**尚未**拆成容器 / 展示组件 |
| CSS 收敛 | z-index 已全部令牌化（`--z-inline-*` / `--z-overlay-*`）；间距收敛为 `--pad-surface` / `--pad-card` / `--pad-rail` | 仍有约 **140 处** 硬编码颜色字面量；约 74 组共用声明体未合并（合并会改变层叠位置，需逐条判断） |
| 弹窗键盘控制 | 关系网 / 时间线 / 时间线的 6 个弹窗已接入 `useDialogKeyboard`；Dashboard 有一份 22 项图层声明 | 该 hook 的**键盘行为没有有效验证证据**（见 `docs/KNOWN_ISSUES.md` KI-05） |
| 设置弹窗 | 功能可用 | 未加宽、未中文化、未折叠「暂未应用」项、设计语言未统一（见 ROADMAP） |
| 编辑页六个分节 | 行为与数据完整 | 节级**设计语言统一**未做（仅操作栏玻璃效果已做） |

---

## 4. 未完成 / 未实现

| 项 | 依据 |
| --- | --- |
| 阵营 / 组织、地图 / 地点（作为独立模块） | README 与 Developer Handbook 的 Roadmap 中列为未来项，代码中不存在对应页面 |
| 多版本角色 | 同上 |
| AI 创作辅助 | `featureFlags.aiSettings` 存在，`AiSettingsForm` 存在，但**只存配置、不发起任何请求**；`components/AiSettingsForm.tsx` 中 API Key 输入框为 `disabled`。界面标注「🚧 Coming Soon」 |
| 云同步 | 不存在任何服务端依赖（本地优先架构，`localStorage` + `IndexedDB`） |
| 插件 / 模板系统 | 不存在 |
| i18n | 全中文界面，无 i18n 框架 |

---

## 5. 验证等级与最近一次验证结果

### 5.1 最近一次执行（2026-10-16，Sprint 38.2 后）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`（`tsc -b`） | **通过**，退出码 0，无输出 |
| `npm test`（`vitest run`） | **通过**：`Test Files 38 passed (38)`、`Tests 417 passed (417)`，0 失败 0 跳过（Sprint 38.2 后的实测值；Sprint 38.1 后为 36 / 401，Sprint 38 后为 35 / 385，Sprint 38 开始前为 31 / 360） |
| `npm run build`（`tsc -b && vite build`） | 见 `docs/DEVELOPMENT_LOG.md` 的「本轮验证」一节 |
| 线上 `build-info.json` | `commit: bccec24…`、`version: 2.27.0`、`entry: index-CJaOoWIX.js`、`stylesheet: index-C1wTYI6I.css`、列出 **19 个文件**（描述的是**线上站点**，即上一轮部署；本轮未推送，因此本地 HEAD 与它不同） |

### 5.2 各模块的验证等级

| 等级 | 含义 | 覆盖的模块 |
| --- | --- | --- |
| **已测试** | 有单测覆盖，且本轮 `vitest run` 通过 | 存储层（角色 / 关系 / 时间线 / 世界观 / 备份 / 引用清理 / 恢复快照 / 仪表盘偏好 / 图偏好 / 编辑器 UI 状态 / 最近头像）、纯逻辑（批量编辑 / 裁剪几何 / 年龄 / 文本片段 / CSV / 导入导出 / 图层声明 / 关系语义与布局 / 分节规则） |
| **仅静态检查** | 只有类型检查保证，无单测、无真实交互证据 | `useDialogKeyboard` 的键盘行为（Escape / Enter / 焦点）、`lazyImport` 之外的部署路径、Developer Center 的多数控件回调 |
| **未验证** | 既无单测也无实测记录 | 三档视口下的关系网重排、深色主题目视检查、导出分辨率 3x 的实际字节数、编辑页六节设计语言、设置弹窗的加宽/中文化方案 |

历史实测证据（真实浏览器、CDP 探针）记录在 `CHANGELOG.md` 与 `docs/DEVELOPMENT_LOG.md`，本文不重复。

---

## 6. 已知问题

完整清单见 **`docs/KNOWN_ISSUES.md`**。摘要（按优先级）：

- **KI-12（P0，数据安全）** App 设置里的「清空本地数据」直接 `localStorage.clear()` + 清空 IndexedDB 头像素材，**不写快照**；而主页同名入口会先写快照并在清空后写回。两条同名入口的安全等级不同，App 那条路径不可恢复。**仅记录，未修复。**
- **KI-01**（P2）设置弹窗未加宽 / 未中文化 / 未折叠未发布项。
- **KI-02**（P2）编辑页六个分节设计语言未统一。
- **KI-03**（P2，阻塞）浮动栏「贴近主栏」需求含义未确认，无法安全实施。
- **KI-05**（P2）`useDialogKeyboard` 的键盘行为无有效验证证据。
- **KI-14**（P2）CSV 的关系行按角色名解析，重名时映射被导入角色覆盖 → 关系可能连到错误角色（静默）。
- **KI-10**（P2，需真机）Apple 设备日期控件、Windows Emoji 显示未在真机验收。
- **KI-04**（P3）Developer Center 有 4 组不可达分节渲染分支（`ai` / `debug` / `data` / `update`）。
- **KI-06**（P3）`compactMobileEditor` 开关写入 `data-compact-mobile-editor`，而样式表**无任何规则读取它**。
- **KI-08**（P3）`styles.css` 仍有约 140 处硬编码颜色字面量。
- **KI-09**（P3）Developer Center 中 7 个文案字段与若干导出选项标注「暂未应用」。
- **KI-11**（P3）三档视口下的关系网重排未实测。
- **KI-13**（P3）完整备份 ZIP 的 `backup-info.json` 里 `appVersion` 硬编码 `0.1.0`。

**已修复（2026-10-15）**：**KI-07** —— `package.json` 的 `version` 已由 `1.0.0` 统一为 `2.27.0`，与应用版本号一致。

---

## 7. 当前阻塞因素与依赖

| 类型 | 内容 |
| --- | --- |
| 需用户决策 | 浮动栏「贴近主栏」的「主栏」指吸顶顶栏还是编辑页操作栏（KI-03） |
| 需用户决策 | 英文 AI Prompt 中自由文本的处理策略（音译 / 保留中文并标注 / 仅翻译预设值）——当前实现为「保留原文 + 一行语言说明」 |
| 需真机 | Apple 设备的日期控件渲染、Windows 的 Emoji 字体回退 |
| 无技术阻塞 | 构建、测试、类型检查、部署流程当前全部可用且一致 |

---

## 8. 下一阶段的重点

1. **UI 设计交接**：`docs/UI_DESIGN_HANDOFF.md` 已可作为独立任务输入交给设计智能体。
2. **设置弹窗与编辑页设计语言**（KI-01 / KI-02）——两者都属于「不改数据与业务逻辑」的纯呈现层工作，风险低、收益直观。
3. **把「暂未应用」的配置项收敛**（KI-06 / KI-09）——围绕「设置不能承诺它做不到的事」这条既有原则。
4. **补 `useDialogKeyboard` 的有效验证**（KI-05）——它是全站键盘可达性的唯一入口，当前只有类型检查。
5. 长期：`docs/ROADMAP.md` 的中期 / 长期项。

---

## 9. Sprint 38（2026-10-15）—— 基线核验、数据安全与导航缺陷

本次不新增功能、不改 UI，只做核验、修复与补测。**已提交但未推送、未部署**（Sprint 规则明确禁止自动推送）。

| 项 | 结果 |
| --- | --- |
| 基线 | 起始 commit `5b1e625`；工作区干净；`APP_VERSION` 2.27.0 / `APP_SPRINT` 37.1；线上部署 commit = 本地 HEAD |
| KI-12 | **部分修复**。两条「清空本地数据」入口收敛为唯一实现 `src/storage/localDataReset.ts`；App 路径现在也保住角色级恢复副本。**未关闭**：快照仍只含角色；「写失败是否阻止删除」与代码内既有决策冲突；浏览器级异常路径未验证 |
| KI-14 | **已确认，未修复（被阻塞）**。5 条测试复现了机制（同名导入角色夺取名字、同文件同名最后一个胜出、世界观无法区分、指向不存在的角色被静默丢弃）。三种方案都会改变用户看到的结果，属数据语义决策，等待所有者确认 |
| KI-15 | **已复现、已修复、待验证**。`popstate` 曾只认 3 个页面，关系网 / 时间线 / 世界观无法被后退恢复。已改为按 7 项清单校验 |
| KI-16 | **新记录（P3）**：清空时会连带删掉**已有**的恢复快照。仅源码确认，无测试 |
| KI-05 | **部分验证**：`useDialogKeyboard` 补了 10 条单测并通过变异检验；真实浏览器与真机仍未测 |
| 测试总量 | 31 文件 / 360 用例 → **35 文件 / 385 用例**，全部通过；3 组变异检验确认新测试不是空转断言 |
| 生产构建 | `tsc -b && vite build` 退出码 0，无警告无错误 |
| 浏览器验证 | 本地以 Pages 子路径构建 + 真实 Chrome，跑了 6 个 History 场景（见 `docs/DEVELOPMENT_LOG.md` 第 11 节） |
| 未执行 | 未推送、未部署、未改版本号、未执行 `docs/DEBUG_STRESS_TEST_PLAN.md` 的用例 |

---

## 10. Sprint 38.1（2026-10-15）—— 数据安全决策落实与发布前验收

落实所有者给出的六项决策（DEC-38-01…06）。仍不新增功能、不改 UI。**提交在本地，未推送、未部署、未改版本号。**

| 决策 | 状态 | 证据 |
| --- | --- | --- |
| DEC-38-01 快照写失败即阻断清空 | **已落实** | 新增 `attemptSnapshot()`（`empty`/`created`/`failed`）；两条清空入口失败时不做任何删除并提示用户。单测 17 例（含注入 `setItem` 抛错）+ 变异检验（移除阻断 → 4 条失败）+ 真实浏览器（角色仍为 2 个、显示「自动备份失败」） |
| DEC-38-02 恢复能力分阶段 | **短期已落实** | 两条确认文案改为准确区分「备份里只有角色文字资料」与「不在备份内」的内容；扩大快照范围登记为 R-27（长期、需批准） |
| DEC-38-03 CSV 身份歧义 | **已落实** | `nameToId` 只收唯一名字；被跳过的引用在导入预览计数（「角色重名 X 条、角色不存在 Y 条」）；未改 CSV 结构、未新增 ID 列。契约测试 8 例 + 变异检验（6 条失败） |
| DEC-38-04 暂不发布 | **遵守** | `APP_VERSION` 2.27.0 / `APP_SPRINT` 37.1 未动；无标签、无推送、无部署 |
| DEC-38-05 保留两个清空入口 | **遵守** | 页面信息架构未改；两条入口共用 `src/storage/localDataReset.ts`，规则、范围、失败策略、确认机制一致，且都有测试覆盖 |
| DEC-38-06 版本系统暂不重构 | **已落实** | 新增 `npm run verify:version`（零依赖，不一致退出码 1）与 `test/versionConsistency.test.ts`；未改版本号、未引入框架 |

| 问题 | 状态 |
| --- | --- |
| KI-12 | **已实现 / 待验收**（P0 部分关闭；剩余为范围与验收事项） |
| KI-14 | **已实现 / 待验收** |
| KI-15 | **待验收**（修复 + 单测 + 变异检验 + 真实浏览器；守卫已进仓库但未接入 CI） |
| KI-16 | **已实现 / 待验收** |
| KI-17 | 当时 **待实施** → Sprint 38.2 **已实现 / 待验收** |
| KI-05 | **部分验证**（10 条单测；真实浏览器与真机未测） |

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，退出码 0 |
| `npm test` | **36 文件 / 401 用例**通过，0 失败 0 跳过 |
| `npm run build` / `build:pages` | 通过，无警告无错误 |
| `npm run verify:version` | 一致 → 0；故意改成 `1.0.0` → **1** |
| `npm run verify:browser` | **6/6 通过**（真实 Chrome + Pages 子路径构建） |
| 变异检验 | 3 组，全部被捕获（4 / 1 / 6 条失败） |

**未做**：未执行 `docs/DEBUG_STRESS_TEST_PLAN.md` 的用例；真实配额耗尽、IndexedDB 写入失败、导入中途失败、刷新中断**未验证**；未推送、未部署、未改版本号、未开始 UI 改版。**发布建议见 Sprint 38.1 执行报告**：`v2.27.1` 待所有者授权。

---

## 11. Sprint 38.2（2026-10-16）—— KI-17 删除操作的数据恢复（本地提交，未推送）

只处理 KI-17 / R-32：删除不再是「只有角色文字回来」。新增 `src/storage/deleteRecovery.ts`，三个删除入口（主页单删、主页批删、编辑器删除）在删除前统一写一份**删除恢复记录**（新键 `character-studio.delete-recovery`，所有者已批准新增存储键），记录受影响角色、被清理的关系边、以及时间线 / 世界观条目原有的参与角色。恢复按 id 合并回写，绝不按名字匹配，也不替换任何数据集，因此删除之后新建或修改的数据不会被覆盖。

| 项 | 结果 |
| --- | --- |
| 保护失败时的行为 | 恢复记录写不进去 → **不执行删除**，提示「删除已取消：浏览器存储空间不足 / 浏览器拒绝了本地写入」。没有「忽略失败继续删除」的入口 |
| 三类入口的一致性 | 单删与批删都先 `captureDeleteRecovery` 再删；编辑器删除走同一个 `App.handleDelete`，并把结果返回给编辑器（失败则留在编辑页） |
| 撤销入口 | 由 App 持有、主页呈现：编辑器里删除后回到主页同样出现 10 秒「撤销」，三类入口一个机制 |
| 部分写入 | 三个工作域写入失败时状态为 `partial`，**保留恢复记录**（每步只补缺失项 → 可重试且不会重复），并如实告知；不假设多个 `localStorage` 写入是事务 |
| 测试 | `test/deleteRecovery.test.ts` 13 例 + `test/deleteEntryPoints.test.ts` 3 例（渲染真实 App 驱动三个入口）；变异检验 3 组全部被捕获（1 / 8 / 8 条失败） |
| 真实浏览器 | `npm run verify:browser` **10/10 通过**（新增 4 项：主页单删→撤销、记录写不进去→拒绝删除、编辑器删除→回主页撤销、批删→撤销；撤销后 2 角色 / 1 关系 / 时间线 2 人 / 世界观 2 人，恢复记录已清除） |
| 未变 | `APP_VERSION` 2.27.0、`APP_SPRINT` 37.1、无标签、无推送、无部署；未引入依赖；未改业务数据格式；未动页面布局 |

**仍未解决**：恢复记录是**单槽位**，只保留最近一次删除（与原角色快照同一设计），更早的删除无法恢复；R-27（快照覆盖头像与三个工作域）未实施；R-33（导入路径仍非阻断）未动；R-34 未验证。
