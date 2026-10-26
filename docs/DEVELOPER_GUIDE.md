# 开发者手册

> 适用版本 **2.60.1**（2026-10-26）。本文是长期开发手册：约定、结构、常见改法。
> 单点事实以代码为准，历史细节见 [`archive/DEVELOPER_HANDBOOK_2026-10-25.md`](archive/DEVELOPER_HANDBOOK_2026-10-25.md)
> 与 [`history/`](history/PROJECT_HISTORY.md)。

---

## 1. 环境与命令

Node ≥ 20，pnpm 10。命令表见根目录 [`AGENTS.md`](../AGENTS.md) 第 2 节，本文不重复。
两条容易忘的：

- `pnpm build:pages` 才会写入 `dist/build-info.json`（普通 `pnpm build` 不带 base 与构建身份）。
- `pnpm verify:browser` 需要本机 Chrome，会自己起临时 profile 与静态服务器。

## 2. 目录与职责

```
src/
  App.tsx            路由与工作区外壳、主题、全局快捷键、备份提示
  pages/             四个工作区 + 编辑器/预览/开发者中心
    dashboard/       Dashboard 的子视图（列表、卡片、筛选）
    editor/          角色编辑器的分段表单与控件
    timeline/        时间线子组件
    world/           世界观子组件
  components/        跨页面共享组件（含 Mantine 封装）
  ui/tokens.css      设计令牌：颜色、尺寸、间距、字体层级
  storage/           每个数据域一个模块 + 备份/恢复/完整性
  types/             实体与视图类型
  data/, content/    词库与静态内容（随机生成、提示文案）
  lib/, utils/, hooks/
  styles.css         全局样式（单文件、按区块注释）
scripts/             构建信息、版本/文档/部署校验、浏览器验收
test/                Vitest 用例（happy-dom + fake-indexeddb）
docs/                正式文档；docs/history/ 历史；docs/audit/ 审计原件（只读）
```

## 3. 状态流

没有全局 store。**每个页面自己持有视图状态，数据通过 `src/storage/*` 读写。**

```
用户操作 → 页面 state → storage 模块（校验 + 规范化）→ localStorage / IndexedDB
                                   ↓
                          其他页面在挂载时重新读取
```

由此产生的两条纪律：

1. **写存储前必须等数据加载完成**。任何「按当前 props 计算后写回」的 effect，在首屏
   props 还是空值时会把真实数据覆盖成空。判断条件不能只看集合是否为空。
2. **跨页面同步靠重读，不靠事件总线**。需要即时联动时改路由参数或共享上层 state，
   不要新造全局事件系统。

## 4. 数据与存储

键名、字段、备份结构以 [`DATA_FORMATS.md`](DATA_FORMATS.md) 为唯一权威。这里只讲规矩：

- 新增字段必须**向后兼容**：读取时给默认值，写入时保留未知字段。
- 改键名或结构必须写迁移函数 + 至少一条往返测试（写旧格式 → 读 → 迁移 → 再读）。
- 大二进制（头像图片）走 IndexedDB；不要塞进 localStorage（配额 5MB 量级）。
- 导入合并要建立 **旧 ID → 新 ID 映射**，否则关系/时间线引用断裂。
- 删除走可恢复路径，不要把记录直接从数组里删掉。

## 5. 跨模块关联

四个域之间只存 ID：

| 引用 | 存在哪 | 谁维护 |
| --- | --- | --- |
| 关系的两端角色 | `relationships[].fromId/toId` | 关系网页面 |
| 事件的关联角色 | `timeline[].characterIds` | 时间线页面 |
| 世界条目的关联角色 | `world[].characterIds` | 世界观页面 |
| 关系网画布坐标/样式 | `character-studio.relationship-layout` | 关系网，独立于实体 |

删除角色时必须级联清理引用或留下可解释的空引用；`src/storage/referenceIntegrity.ts`
是这条规则的实现处。

## 6. UI 约定

- **令牌优先**：颜色、圆角、控件高度用 `src/ui/tokens.css` 的变量；深浅色通过主题变量，
  不写两套样式表。
- **组件来源**：交互控件优先 Mantine（`@mantine/core`），并保留既有 class 名，
  因为浏览器检查按 class 与 `data-testid` 定位。
- **Mantine 的坑**：`Select` 是 combobox，`aria-expanded` 需要自己写；`ScrollArea` 里
  绝对定位的浮层会被裁切（用 Portal）。日期/数字输入的可见值来自库内部 state。
- **断点**：720（移动端）、900（双栏）、1024（宽屏）。移动端不是缩小版桌面：
  工具栏折叠成图标 + 抽屉，底部有固定操作坞。
- **可见性优先**：禁用态也要保持可读（对比度按禁用控件 3:1 计），说明文字不要低于 11px。

## 7. 常见修改流程

**加一个字段**：`types/` → `storage/`（读取默认值 + 写入保留）→ 表单 → 预览/列表展示 →
`DATA_FORMATS.md` → 一条往返测试。

**加一个页面级视图**：先在对应 `<area>/` 目录建组件，再在页面里加状态；不要动 App 路由，
除非确实是新工作区。

**改时间线/关系网布局**：先看 `styles.css` 对应区块的注释（多数规则写明了理由），改完跑
`--only=时间线` / `--only=布局` / `--only=外观`，并截图对比，不要只看断言。

**改外观面板**：面板状态挂在 `character-studio.relationship-layout` 的 `style` 字段，
预设与用户覆盖是两件事——预设只提供一组初始值，用户改动后 `preset` 变 `custom`。

## 8. 测试

三层，详见 [`TESTING.md`](TESTING.md)：

1. **单元测试**（`test/`，Vitest）：纯函数、存储往返、迁移、解析。
2. **静态守卫**：`verify:version`、`verify:docs`、定位器审计（`test/verifyBrowserLocators.test.ts`）。
3. **浏览器验收**（`scripts/verify-browser.mjs`）：真实 Chrome、真实交互、几何断言。

写断言的纪律：起点状态确定；观测点在两种状态下取值确实不同；「通过」不能是因为什么都没测到。

## 9. Git 与发布

- 分支：功能分支开发，`main` 只在发布时快进合并（`--ff-only`），保持线性历史。
- 禁止：`push --force`、`reset --hard`、`git clean -fd`、删除远端分支。
- 发布：改版本两处 → CHANGELOG → 文档状态 → `verify:docs`/`verify:version`/`typecheck`/
  `build:pages` → 完整三段浏览器验收 → 快进合并 → 推送 → 看 CI → `verify:deploy`。
  流程细节见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

## 10. 数据兼容边界

| 允许 | 需要迁移与测试 | 禁止 |
| --- | --- | --- |
| 新增可选字段 | 重命名字段 | 改变既有字段含义 |
| 新增独立存储键 | 改变键名 | 复用旧键存不同结构 |
| 放宽校验（旧的能读） | 收紧校验 | 静默丢弃读不懂的数据 |
| 追加备份内容 | 改变备份结构 | 让旧备份无法导入 |
