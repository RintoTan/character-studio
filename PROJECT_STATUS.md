# Character Studio —— 项目状态总览

> 文档最后核查日期：**2026-10-15** ｜ 核查方式：源码 + Git 历史 + 本地只读检查（`tsc -b`、`vitest run`、`vite build`）+ 线上 `build-info.json`
> 本文只记录**有证据**的结论。凡未验证的，一律显式标注。

---

## 1. 当前状态

| 项目 | 值 |
| --- | --- |
| 应用版本 | **2.27.0**（来源：`src/config/version.ts` 的 `APP_VERSION`） |
| Sprint | **37.1**（`APP_SPRINT`） |
| Build / Release Year | `2026` / `2026` |
| 分支 | `main` |
| HEAD 提交 | `bccec24843e0ccdae0c97c8ab7d3d0484267e550`（短号 `bccec24`） |
| 工作区状态 | **干净**（`git status --porcelain` 无输出） |
| 远端 | `origin` → `https://github.com/RintoTan/character-studio.git` |
| 线上地址 | <https://rintotan.github.io/character-studio/> |
| 线上部署提交 | `bccec24` —— **与本地 HEAD 一致**（来源：线上 `build-info.json` 的 `commit` / `commitShort`） |

`package.json` 的 `version` 字段是 **`1.0.0`**，与应用版本号（2.27.0）**不同源**。
应用内所有版本显示读的是 `src/config/version.ts`；`package.json` 的版本号只作为包标识，不参与界面显示。这是一处**已知的口径不一致**，未在本轮修改（改它属于源码/配置改动，超出本次文档治理范围）。

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

### 5.1 本轮实际执行的检查（2026-10-15）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`（`tsc -b`） | **通过**，退出码 0，无输出 |
| `npm test`（`vitest run`） | **通过**：`Test Files 31 passed (31)`、`Tests 360 passed (360)`，用时 4.01s |
| `npm run build`（`tsc -b && vite build`） | 见 `docs/DEVELOPMENT_LOG.md` 的「本轮验证」一节 |
| 线上 `build-info.json` | `commit: bccec24…`（= 本地 HEAD）、`version: 2.27.0`、`entry: index-CJaOoWIX.js`、`stylesheet: index-C1wTYI6I.css`、列出 **19 个文件** |

### 5.2 各模块的验证等级

| 等级 | 含义 | 覆盖的模块 |
| --- | --- | --- |
| **已测试** | 有单测覆盖，且本轮 `vitest run` 通过 | 存储层（角色 / 关系 / 时间线 / 世界观 / 备份 / 引用清理 / 恢复快照 / 仪表盘偏好 / 图偏好 / 编辑器 UI 状态 / 最近头像）、纯逻辑（批量编辑 / 裁剪几何 / 年龄 / 文本片段 / CSV / 导入导出 / 图层声明 / 关系语义与布局 / 分节规则） |
| **仅静态检查** | 只有类型检查保证，无单测、无真实交互证据 | `useDialogKeyboard` 的键盘行为（Escape / Enter / 焦点）、`lazyImport` 之外的部署路径、Developer Center 的多数控件回调 |
| **未验证** | 既无单测也无实测记录 | 三档视口下的关系网重排、深色主题目视检查、导出分辨率 3x 的实际字节数、编辑页六节设计语言、设置弹窗的加宽/中文化方案 |

历史实测证据（真实浏览器、CDP 探针）记录在 `CHANGELOG.md` 与 `docs/DEVELOPMENT_LOG.md`，本文不重复。

---

## 6. 已知问题

完整清单见 **`docs/KNOWN_ISSUES.md`**。摘要：

- **KI-01**（P2）设置弹窗未加宽 / 未中文化 / 未折叠未发布项。
- **KI-02**（P2）编辑页六个分节设计语言未统一。
- **KI-03**（P2）浮动栏「贴近主栏」需求含义未确认，无法安全实施。
- **KI-04**（P3）Developer Center 有 4 组不可达分节渲染分支（`ai` / `debug` / `data` / `update`）。
- **KI-05**（P2）`useDialogKeyboard` 的键盘行为无有效验证证据。
- **KI-06**（P3）`compactMobileEditor` 开关写入 `data-compact-mobile-editor`，而样式表**无任何规则读取它**。
- **KI-07**（P3）`package.json` 版本号（1.0.0）与应用版本号（2.27.0）不同源。
- **KI-08**（P3）`styles.css` 仍有约 140 处硬编码颜色字面量。
- **KI-09**（P3）Developer Center 中 7 个文案字段与若干导出选项标注「暂未应用」。
- **KI-10**（待验证）Apple 设备日期控件、Windows Emoji 显示需真机验收。

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
