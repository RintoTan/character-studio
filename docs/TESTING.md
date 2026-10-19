# Character Studio —— 测试说明

> 用途：改了代码后该跑什么、这些测试各覆盖什么、以及哪些结论**不能**由它们得出。
> 最近核对：2026-10-19（2.37.1）。

---

## 1. 三层验证

| 层 | 命令 | 覆盖 | 不覆盖 |
| --- | --- | --- | --- |
| 类型 | `pnpm typecheck` | 跨文件类型、未使用导入、接口变化 | 运行时行为 |
| 单元 | `pnpm test` | 纯逻辑、存储读写、导入计划、PDF 文本结构 | 真实布局、浏览器差异 |
| 浏览器 | `pnpm verify:browser` | 页面渲染、交互、响应式、深链接、存储恢复 | 真机 Safari、触控手势、软键盘 |

另有两条发布期检查：

- `pnpm verify:version`：`src/config/version.ts` 与 `package.json` 版本一致。
- `pnpm verify:deploy`：线上 `build-info.json` 的 commit 与本地 HEAD 一致，且构建产物逐字节一致。

---

## 2. 单元测试（`test/`，48 个文件 / 538 个用例）

环境：vitest 3 + happy-dom + fake-indexeddb，不需要真实浏览器。

| 范围 | 代表文件 |
| --- | --- |
| 角色存储与迁移 | `characterStorage.test.ts`、`dashboardPrefs.test.ts`、`legacyFavorites.test.ts` |
| 关系语义与布局 | `relationshipSemantics.test.ts`、`relationshipLayout.test.ts`、`relationshipStorage.test.ts` |
| 时间线与世界观 | `timelineView.test.ts`、`worldView.test.ts`、`worldStorage.test.ts` |
| 导入导出与备份 | `importPlan.test.ts`、`importExport.test.ts`、`backup.test.ts`、`workspaceBackup.test.ts`、`workspaceCsv.test.ts`、`csvImport.test.ts`、`csvNameCollision.test.ts` |
| 删除与引用完整性 | `deleteRecovery.test.ts`、`referenceIntegrity.test.ts`、`deleteEntryPoints.test.ts` |
| PDF | `characterSheetPdf.test.ts`、`pdfPageSlices.test.ts` |
| 编辑器与草稿 | `useCharacterSave.test.ts`、`editorSections.test.ts`、`editorUiState.test.ts` |
| 交互 Hook | `useDialogKeyboard.test.ts`、`useAvatarEditing.test.ts`、`useIdentityEditing.test.ts` |
| 版本与页面 | `versionConsistency.test.ts`、`restorablePages.test.ts` |

写用例时的三条约定：

1. **先确认观测点有区分度**：用已知的开 / 关状态各测一次，再测被测行为。
2. **受控组件要真的让父组件应用状态**，否则「重排」「过滤」类断言可能什么都没测。
3. **一个用例只验证一个决定**；需要多个条件时用具名 `conditions` 对象，失败时能直接看出哪一条不成立。

---

## 3. 浏览器回归（`scripts/verify-browser.mjs`，59 项）

脚本通过 Chrome DevTools Protocol 驱动**本机 Chrome**（不是 Playwright），注入确定性种子数据后操作真实 DOM。

覆盖范围：

- 页面与深链接：7 个页面的进入、返回、刷新与 History 恢复
- Dashboard：搜索、筛选、排序、视图切换、批量操作、批量编辑、草稿、收藏
- 编辑器与预览：分节、保存、草稿、头像、导出入口
- 关系网：图谱 / 管理双模式、聚焦、筛选、分页、方向语义、编辑与删除同步
- 时间线与世界观：年份导航、筛选、编辑、树形层级、移动端列表 / 详情切换
- 导入导出：预检、冲突、缺失引用、恢复快照
- 移动端：底部抽屉（四项、选中态、遮罩与 Escape）、更多抽屉、320px 工具栏 / 时间线 / 分组提示、375px 首屏与无横向溢出
- 浮动操作栏、主题、无横向溢出的页面级检查

运行注意：

- 脚本会以 `ONLY=<子串>` 只跑匹配项；**跳过项不计为通过**，退出码仍反映真实结果。
- 每个检查自行设置视口，不继承上一项；否则结果会随执行顺序变化。
- 种子写入后必须确认数据真的落盘并渲染出来，再开始断言。
- 失败信息包含具体读数（元素尺寸、行数、遮挡情况），不要只看 PASS / FAIL。

---

## 4. 视觉与真机边界

以下内容**不能**由无头 Chrome 得出结论：

| 项目 | 原因 |
| --- | --- |
| 真实 iPhone Safari 的地址栏收放 | `dvh` 与浏览器 chrome 行为在桌面模拟中不成立 |
| 安全区（刘海 / 底部横条） | 模拟环境 `env(safe-area-inset-*)` 为 0 |
| 软键盘与 `visualViewport` | 未实现软键盘适配，桌面无法复现 |
| 底部抽屉的拖拽手势 | 当前未实现拖拽关闭 |
| Safari 的 `backdrop-filter` 性能 | 需要真机观察掉帧情况 |
| 触控目标的手感 | 只能测尺寸，不能测实际点击命中 |

截图与几何检查只能证明「在给定视口与字体下布局正确」，不能替代真机验收。

---

## 5. 提交前检查清单

```bash
pnpm typecheck
pnpm test
pnpm build:pages
pnpm verify:browser
```

涉及版本或发布时再运行：

```bash
pnpm verify:version
pnpm verify:deploy
```

如果改动触及导入导出、存储键或备份结构，必须同时更新 `docs/DATA_FORMATS.md` 与相应用例；如果改动触及页面布局，补一条浏览器断言，不要只依赖截图。
