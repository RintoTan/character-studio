# Character Studio —— 项目状态总览

> 文档最后核查日期：**2026-10-25** ｜ 核查方式：源码 + Git 历史 + 本地只读检查（`tsc -b`、`vitest run`、`vite build`）+ 线上 `build-info.json`
> 本文只记录**有证据**的结论。凡未验证的，一律显式标注。
> **位置变更**：本文件原在仓库根目录，2026-10-15 随文档落位规整移入 `docs/`（根目录只保留 `README.md` / `CHANGELOG.md` / `Developer Handbook.md`）。文档索引见 [`README.md`](README.md)。

---

## 1. 当前状态

| 项目 | 值 |
| --- | --- |
| 应用版本 | **2.60.1**（2026-10-26 发布，`main`；上一发布 2.60.0 / 2026-10-25）（来源：`src/config/version.ts` 的 `APP_VERSION`，与 `package.json` 一致，`npm run verify:version` 通过）—— About 弹窗按阅读宽度排布、手机 About 布局精修、Developer Center 手机导航与徽章响应式修复、低缩放下卡片姓名回退；线上 commit 以 `npm run verify:deploy` 的比对结果为准 |
| Sprint | **54.10**（`APP_SPRINT`）—— 该标识自 2.57.x 起未再递增，2.58/2.59 的交付阶段记录在下方条目与 `CHANGELOG.md`；取值沿用发布历史既有的「版本记录所交付阶段」规则 |
| Build / Release Year | `2026` / `2026` |
| 分支 | `main`（v2.60.1 已发布；候选分支 `ui/mobile-dashboard-2.60.1` 已合并）
| 审计基线提交 | `93de13d`（2.39.0 发布前最后一个功能提交）—— 本文与 `docs/ARCHITECTURE.md` 的行号与行为描述以该版本为准 |
| 文档整理 | 2026-10-19：README 重写、四份历史快照归档、新增数据格式 / 测试 / 部署三份文档（提交见本轮 `git log`） |
| 工作区状态 | 以 `git status --porcelain` 为准；本轮收尾见下方「Sprint 56.x（2.59.0）」的发布记录 |
| Sprint 51.3 状态 | **已发布 2.47.0**（原记录：画布工作室已完成本地实现（拖动加固、撤销重做、对齐分布、多布局、五种预设、高级外观、沉浸工作室、局部样式、字号、聚光灯、透镜、书签、PNG/SVG 导出、导出样式内联、UI Pass A 信息架构与工具栏/工具坞整改、UI Pass B0 移动端独立布局与字号/图标规范、B1 节点形态与连线语言），**已于 2.40.0 发布** |
| 工作区状态 | 以 `git status --porcelain` 为准（本阶段只做本地提交） |
| 远端 | `origin` → `https://github.com/RintoTan/character-studio.git` |
| 线上地址 | <https://rintotan.github.io/character-studio/> |
| 线上部署提交 | 每次推送 `main` 由 CI 重新构建。核对方式：线上 `build-info.json` 的 `commit` 应等于 `main` 最新提交（`npm run verify:deploy` 自动比对，不一致则以非零码退出） |

### 2.59.6 验收补闭环（不新开 Sprint）

| 项 | 结论 |
| --- | --- |
| 375 左侧 | **真缺陷**：最左节点本身在视口外（left = -20），姓名外置被裁 20px → 改为左右对称翻转，姓名落在 40..75，完整可见 |
| 1440 左/右 | 姓名 372..408 / 1032..1068，与节点各留 5px，方向正确 |
| 375 顶/底 | 250..264 / 602..616，未变 |
| 多选探针 | 修正为先开多选模式再点三个不同 ID；375 与 1440 均得到 `c6 / c7 / c8`、3 环、0 姓名、计数「已选 3 个」 |
| 清除 | 环与姓名归零；`relationship-layout` 全程为 null（未写入） |
| 目视 | 13 张已逐张打开（375 全部 6 张、1440 顶/底/左/右/多选、卡片、40 单选）；`d1440-cleared` 与 `d1440-40-overview` 仅读数 |

### Sprint 61（2.59.5）

左右方向姓名对齐的真缺陷与修复。

| 项 | 结论 |
| --- | --- |
| 根因 | `.relationship-node-name { text-anchor: middle }`（样式表）压过 `<text textAnchor>` 呈现属性，左右姓名以节点中心居中：压节点，375px 下越右缘 2px |
| 修法 | ① 为 `[data-name-side="left"/"right"]` 补 `text-anchor: end/start`；② 右侧会越出图形右缘时改为节点内侧左读，判定用「绘制区最右节点 world x」而非 `view` 反推矩形 |
| 1440 左侧 | 姓名 303..338，节点 343..367 —— 5px 间距、方向正确（修复前 321..356 压在节点上） |
| 1440 右侧 | 姓名 1032..1068，节点 1073..1097 —— 5px 间距（修复前 1083..1120 压节点） |
| 375 右侧 | 姓名 299..335，节点 340..354 —— 节点左侧、完整可见（修复前 341..377，压节点且越界 2px）；已目视 |
| 375 顶部/底部 | 未变（250..264 / 602..616），与修复前同值 |
| 40 角色 | 总览 6 个枢纽姓名、单选后仍 6 个，`side=up` 未变 |
| 测试 | `namePlacement` 9 条 + `nameDrop` 5 条 + `cardName` 7 条通过 |

### Sprint 59（2.59.3）

选中姓名的径向外置。先做坐标核查，再做定位。

| 项 | 结论 |
| --- | --- |
| 坐标空间 | 实测：标签 `getScreenCTM()` = 0.1287（0.13× 档），受控 +100 局部单位 → 屏幕 +13px；标签、节点中心与 `positions` 同空间，换算即 `view.k × screenScale` |
| 定位公式 | `radialNamePlacement()`：方向取节点相对画布质心的主导轴；上下按 `halfHeight`、左右按 `max(halfWidth, halfHeight)` 取边；间距 8px ÷ 同一比例；越界先收敛，纵向收敛不下才翻到对侧 |
| 13%（375/100） | 顶 `up`、底 `down`：与节点不相交、`nodeHits 0`、未被裁切；左右侧落在正确一侧 |
| 29%（1440/100） | 四向均不相交、`nodeHits 0`、未裁切 |
| 28%（100 + 3 张卡片） | 卡片选中姓名在卡片上方，卡片形态与选中环不变 |
| 69%（40） | 枢纽标签 6 个位置未变；选中姓名改为环外（本轮的预期变化） |
| 清除后 | `names 0 / rings 0`（100 角色）；40 角色回到 6 个枢纽标签；`relationship-layout` 未被写入 |
| 测试 | `test/namePlacement.test.ts` 9 条通过；全量 81 文件 / 903 用例通过（`tsc -b` 0 错误） |
| 2.59.4 修正 | 2.59.3 的视口收敛把顶部姓名推进环内（离节点约 187px），已撤回：定位只保留几何部分，`bounds` 不再参与。代价是极靠边缘的节点姓名可能被裁 2px |

### Sprint 58（2.59.2）

低缩放下选中姓名压在节点上的定位缺陷。只改一处落点计算。

| 项 | 结论 |
| --- | --- |
| 根因 | 姓名被抬到 11px 后沿用的仍是旧落点：基线在节点下方 `halfHeight + 14` **世界单位**。0.13× 下 14 单位 = 1.8px，标签落在节点本体上并压住环上相邻两个节点；0.28× 下只剩 4px |
| 修法 | 新增 `nameDropWorld()`：间距改为屏幕像素（15px ≈ 11px 字身 + 6px 空隙），除以与字号相同的 `view.k × screenScale`；`max()` 保留样式自带间距，所以阅读缩放不受影响 |
| 13%（375/100） | 修复前后：标签由压在节点上改为节点下方约 10px，`nodeHits 0`，字号仍 14px |
| 29%（1440/100） | 同上，标签与节点边缘留出间隙；总览仍 0 个标签 |
| 28%（1440/100 + 3 张显式卡片） | 选中卡片：外层姓名 14px 位于卡片下方，卡片保持 47×16 形态并带选中环 |
| 69%（40 角色） | 标签位置与修复前一致（样式自带 61 单位间距大于 15px 的下限），截图逐像素同框 |
| 不变性 | `positions` / `nodeStyles` 未改；选中 → 清除后 `relationship-layout` 逐字节相同；多选 3 个仍只有 3 个环 + 计数、无姓名 |
| 测试 | `test/nameDrop.test.ts` 5 条；全量 80 文件 / 894 用例通过；`tsc -b` 0 错误 |
| 截图 | `CharacterStudio-Acceptance/sprint-58/`（before 4 张 + after 12 张） |

### Sprint 57（2.59.1）

关系网高密度画布的视觉验收（8 / 40 / 100 角色、深/浅、桌面 + 375），以及验收中发现的唯一阻断缺陷。

| 场景 | 结论 | 证据（真实屏幕读数） |
| --- | --- | --- |
| 8 角色总览（120%） | 全部 8 个姓名可读，无重叠、无微型文字 | 姓名 19px 盒高 / 13 单位字号；`overlaps 0` |
| 40 角色总览（69%） | 6 个枢纽姓名保留（15px），其余按规则隐去 | 6 个标签、17.6 单位字号、`overlaps 0` |
| 40 角色单选 | 选中姓名 14px，其余枢纽姓名不变 | `namePx [14,15]`、`rings 1` |
| 100 角色总览（29%） | 0 个标签：低缩放不画 5px 文字，环本身承载结构 | `names 0`；无重叠、无横向溢出 |
| 100 角色单选 | 选中姓名 14px（37.4 单位字号被抬到屏幕下限） | `names 1 / 14px / overlaps 0` |
| 100 角色相邻三选 | 三个选中环独立、计数「已选 3 个」清晰，姓名不叠（多选不抬名字） | `rings 3`、`names 0` |
| 100 角色悬停 | 29% 下悬停不产生 5px 微型文字，移开后无残留 | 悬停前后 `names` 均为 0 |
| 375 移动端 100（13%） | 单选姓名 14px、环完整；三选 3 环 + 计数；工具栏/画布/底部栏互不遮挡；无横向溢出 | `pageOverflowX false`；选择前后 `zoom 13%` 未跳动 |
| 显式卡片 + 普通节点（40, 63%） | 三张显式卡片保持卡片形态（plate/full），与邻近节点不重叠；选中卡片显示完整卡片（106×35）与卡内姓名；选中普通节点时卡片不变 | 卡内姓名 9px；`cards 3`、`overlaps 0` |
| 显式卡片低缩放（100, 28%） | **已修**：卡内 4px 姓名交还画布，选中卡片得到 14px 外层姓名；未选中卡片不再显示 4px 糊字 | 修复前 `cardNames 3 @4px`、选中后无姓名；修复后 `cardNamePx []`、`names 1 @14px` |
| 样式与坐标不变 | 选中 → 清除后 `relationship-layout` 逐字节相同，卡片仍为 3 张，选中环归零 | `localStorage` 前后一致（704 B） |
| 截图归档 | `CharacterStudio-Acceptance/sprint-57/`（见其 README 清单） | 逐张目视记录见当轮报告 |

发布记录：2.59.1 / `1d531ca`；CI run `39984680549` success；`npm run verify:deploy` 全项 PASS
（entry `index-C8UciPyx.js`、22 文件逐字节相同、`/developer` 404 回退命中）；本地 79 文件 / 889 用例通过、
`tsc -b` 0 错误、`build:pages` 22 文件、`verify:version OK`。归档 `screenshots.zip` 57 张、10,792,051 B、
`sha256_16 a7dcd4762bb10747`。

### Sprint 56.x（2.59.0）

About 弹窗的响应式收尾，以及 Developer Center 手机端两个响应式缺陷。均只改样式与测试，未触碰数据模型、关系网算法与备份恢复。

| 事项 | 结论 | 证据 |
| --- | --- | --- |
| About 宽屏排版（2.58.1） | 已完成：栏数由文本量决定，随窗口收窄 | 1440/1024 两栏；768/648/430/375/320 单栏；7 档均 `overflowX=false`、可滚到底 |
| About 手机标题栏 | 已修：关闭按钮回到标题行 | 320/375/430 由 `column` 改 `row`；关闭按钮 57×42，标题仍单行 |
| About 手机快捷键 | 已修：键值同行，不再键上说明下 | 6 行由 54px 降为 28px；整块 359 → 203px；320 下「⌘K / Ctrl+K」不换行不压字 |
| About 手机品牌区 | 已修：压缩尺寸不删内容 | 区高 341 → 211px；Logo 112 → 56px（桌面仍按「About 标志尺寸」）；版本/构建/标语/版权齐全 |
| About 手机总高度 | 已降：320/375/430 = 2582/2481/2352px（原 2920/2819/2689） | 探针逐项 DOM 读数；648 及以上读数改动前后完全相同（2205/2049/1426/1424） |
| 遗漏截图补验 | 已完成：6 张逐张目视 | 430 浅色顶/底、768 浅色、1024 浅色、648 浅色、375 深色中段；无溢出、无压字、品牌信息完整 |
| Developer 手机导航 | 已修：横向长条改为两列网格 | 375 下 nav `clientWidth` 357 = `scrollWidth` 357（原 1430），9/9 项在容器内；`overflow-x: visible` |
| Developer Hero 徽章 | 已修：不再截断 | `Prompt Library：external-inspiration-library.txt` 在 320/375/430 完整显示（320 换行两行）；8 个「视口×主题」组合 `clip=false` |
| 回归守卫 | 新增 6 条结构断言 | `test/developerMobileLayout.test.ts`；把导航改回横向长条后 2 条立刻变红（变异检验通过） |
| 本地验证 | `tsc -b` 0 错误；`vitest run` 全量通过（78 文件 / 882 用例，含新增 6 条）；`vite build` 22 文件；`verify:version OK —— 2.59.0` | 本轮命令输出 |
| 截图归档 | `.sprint56/final`（About 38 张 + Developer 导航修复 24 张）、`.sprint56/dev`（Developer 10 张）；打包见 `CharacterStudio-Acceptance/sprint-56/screenshots.zip` | 逐张目视记录见本轮报告 |
| 发布记录 | 见下方「发布记录」小节（CI 与部署核验均已执行） | — |

#### 发布记录

| 项目 | 值 |
| --- | --- |
| 版本 / 发布提交 | **2.59.0 / `49946d2`**（含 `31c6f62` 的 About 手机布局与 `49946d2` 的 Developer 修复，同一次未发布版本内合并） |
| CI | run `39982031328` @ `49946d2` — **success** |
| 部署核验 | `npm run verify:deploy` **全项 PASS**：`index.html` 200；entry `index-C3K3azu6.js`；stylesheet `index-OeR4wHwW.css`；commit stamp `49946d2 @ 2026-10-23T23:50:57+08:00`；22 文件逐字节相同；`/developer` 深链接经 Pages 404 回退命中同一份 shell |
| 归档 | `CharacterStudio-Acceptance/sprint-56/screenshots.zip`，76 张 PNG（`final/` 66 + `dev/` 10，dev 为修复前证据），8,471,132 B，`sha256_16 5507c6fba0e3b28b` |
| 已知遗留 | 320px 下 Hero 副标题「Character Studio 项目开发控制中心」会在行尾折出一字（CJK 允许任意断行，非本次范围）；Developer 页不含 Roadmap 区块，`update`/`debug`/`data`/`ai` 四个 section 分支在 `developerSections` 中不存在，属既有死代码 |

### Sprint 54.9（2.56.0）

全屏工作室交互整理、导出重构与选择状态机。

| 事项 | 结论 | 证据 |
| --- | --- | --- |
| 全屏导出 | 已修：面板被整页层级盖住 → 改为同级导出抽屉 | 全屏抽屉 392×847；四种格式真实下载（PNG/JPG/SVG/PDF） |
| 导出预览 | 已实现：预览即导出所用 SVG | 16:9 读数 2400×1350，SVG 1188×668 单位；100 角色 PNG 实测 2400×2400 |
| 图例拖动 | 已实现，含边界约束 | SVG 图例 (0.765,0.677) vs 预览 (0.763,0.677)；夹紧后仍在框内 |
| PDF | 单页、页面即画幅 | `MediaBox 1800×1800 pt`（2400×2400 px）、1 页、1 图像 |
| 选择/聚焦 | 已分离；多选弱化恒定 | 单选弱化 0；多选 1/2/3 → 7/6/5；组拖拽位移一致 +40/+25 |
| 箭头接缝 | 线身止于箭头基部 | 深色 20/50/100% 像素采样与放大裁图；4 条几何单测 |
| 手机 | 320/375/430 导出抽屉满宽、按钮可点 | 320 导出 PNG 成功（201 KB） |

### Sprint 54.8（2.55.0）

项目治理与关系网视觉整改。

| 事项 | 结论 | 证据 |
| --- | --- | --- |
| 验收截图归档 | 已移出仓库 | 9 轮 143 张 → `CharacterStudio-Acceptance/`，体积 27 MB → 7.8 MB |
| 标签显示策略 | 已实现 自动/始终/隐藏 | 8 角色 13/14；40 角色 83/89；100 角色 31% 缩放时明确提示放大到 60% |
| 多选栏瘦身 | 已实现 | 443×60，无外观/退出多选，撤销气泡移出选择行 |
| 面板信息架构 | 已完成四区归位 | 视图与显示／节点与姓名／关系线与关系标签／高级选项；线型与箭头已归位 |
| 抽屉底部间距 | 已实现 | 滚到底距边 30px（手机 34px） |

### Sprint 54.7（2.54.0）

关系线 DIY、连续数值控件、单线覆盖与全局优先级。**代码、单测、专项探针（22 项全 PASS）、8 张验收截图已完成。**

| 事项 | 结论 | 证据 |
| --- | --- | --- |
| 类型配色 | 已实现（可编辑调色板） | 8 种颜色，实测 7 种在用且全部命中 palette |
| 统一色模式 | 已实现 | 关闭后所有线 `rgb(152,162,179)` |
| 线宽/透明度 | 已实现 | 全局 4.5px / 45%；单线 5.5px / 30% |
| 虚线/点线 | 已实现 | `stroke-dasharray: 2px, 4px` |
| 连续数值控件 | 已覆盖 9 个参数 | 输入 140→1.4、999→2、`abc`→不变 |
| 单线覆盖/恢复 | 已实现 | 存储键删除，渲染回到全局值 |
| 预设不擦除覆盖 | 已实现 | `{r023:{width:5}}` 切换前后一致 |
| 旧数据兼容 | 已实现 | 缺字段按 1 / 空表补齐，仍按类型着色 |

### Sprint 54.6（2.53.0）

画布编辑可靠性、移动端多选与关系标签验收。**代码、单元测试（813）、专项探针（A 阶段 27 项、
B 阶段 21 项全部 PASS）、12 张验收截图均已完成并发布。**

| 事项 | 结论 | 证据 |
| --- | --- | --- |
| 网格吸附落点 | 已修复 | 三档缩放（49% / 96% / 150%）余数均 `[0, 0]` |
| 多选/分组拖动位移 | 已修复（不再二次叠加） | 两角色 `dx 43.44 / dy 36.56` 完全一致，中心落 (360,400) |
| Shift 锁轴 | 已修复（此前语义反向） | 锁定轴 y 180.21 → 180.21，自由轴落 40 的整数倍 |
| 辅助线与落点一致 | 已修复 | 释放后 x 与邻居 x 差 0.00；松手后线数 0 |
| Shift 提示竖带 | 已修复 | 1440 下 91×21 悬浮，右边距 25；1024 无竖列 |
| 设计抽屉标签控件 | 已修复整行宽度 | 328px = 抽屉内容宽，行宽 306 |
| 手机多选栏 | 已改单行 | 375: 312×62；320: 296×58（原 328×136 三行） |
| 选中关系标签 | 高密度下仍可见 | 100 角色：唯一标签属于 `r002` |
| 画布高度稳定性 | 已修复 | 切换工具前后 375×755 不变 |

**未完成需求台账（P1，本轮不实现、也不销项）**

1. ~~关系线颜色与线型 DIY~~ —— 2.54.0 已交付（类型调色板、线宽、透明度、实虚点、箭头、单线覆盖）；
2. 阵营颜色默认映射的准确性（本轮只做**关系类型**配色，阵营色表仍未与阵营语义逐项核对）；
3. ~~连续数值控件~~ —— 2.54.0 已覆盖 9 个连续参数；剩余档位按钮（头像大小、节点形态）属离散项，不改为滑块；
4. 控件旁显示实际数值（滑块只有区间，没有当前读数）；
5. 单线样式覆盖与全局样式的优先级说明（代码里按局部优先，文档未成文）；
6. 手机整体视觉密度与抽屉体验精修（单行多选栏已完成，抽屉仍是桌面内容竖排）。

### Sprint 54.2（2.50.0）

移动端信息架构与共享搜索。**代码、单元测试（813）、四页 375 截图、320/430 与深色检查均已完成**。

| 事项 | 位置 | 验证 |
| --- | --- | --- |
| 共享搜索状态机 | `src/components/WorkspaceSearch.tsx`，四页接入 | 展开聚焦、收起留查询并显示芯片、清空保展开、Escape 只关搜索；无原生双 ✕ |
| 手机 Hero 只留身份与主任务 | Dashboard / RelationshipGraph / WorldManager / Timeline | 图谱/管理进工作区；返回 Dashboard 为工作区轻量链接 |
| 工作区工具栏分层 | `.list-toolbar`、`.graph-canvas-head`、世界/时间线工具栏 | 375 无孤立按钮行；关系网搜索独占一行 |
| 手机回归 | `docs/sprint-54.2-acceptance/` | 375×8、320/430 各 4、深色 4、筛选生效 1、软键盘代理 1 |

### Sprint 54.1（2.49.0）

画布成员管理收尾。**代码、单元测试、浏览器专项（56/56，1 项跳过）均已完成**；视觉细节（手机抽屉里
筛选与统计分两行）为已知取舍，不阻塞。

| 事项 | 位置 | 验证 |
| --- | --- | --- |
| 成员管理面板（统计、全部/在画布/未加入、单个与批量加入移出） | `src/pages/RelationshipGraph.tsx` 的 `charactersPanelContent` | 浏览器专项：40 → 41、100 全部加入、批量、空画布刷新仍为空 |
| 两个入口共用同一面板 | 桌面工具栏「角色面板」；工作室抽屉；≤720 收进「更多」 | 56/56 含工作室可移出/加回 |
| 快照记录成员 + 坐标 + 取景 | `src/utils/layoutSnapshots.ts`、`src/utils/arrangeTransaction.ts` | 预览不写盘、取消回滚、确认事务、撤销、刷新后可用、旧快照兼容 |
| 自动取景上限（fit 120% / focus 200%） | `AUTO_FIT_MAX_ZOOM`、`AUTO_FOCUS_MAX_ZOOM` | 2 角色 223% → 120%；8/40/100 为 92%/49%/22%；手动缩放不受限 |
| 手机批量操作分层 | `.graph-members-selection`、`.graph-members-more` | 320/375/430 无横向溢出、无孤立按钮 |

### Sprint 48（2.38.0）

角色灵感工作室 2.0：本地结构化灵感库 + 规则生成 + 上下文参考 + 用户挑选后写入草稿。离线规则生成，不联网、不调用模型。

| 事项 | 位置 | 验证 |
| --- | --- | --- |
| 灵感库（七类） | `src/data/inspirationLibrary.ts` | 类型检查；引擎单测 11 例 |
| 生成与合并 | `src/inspiration/engine.ts` | 同种子确定、同批不重复、重抽避让、追加/替换/标签去重 |
| 工作室 UI | `src/components/InspirationStudio.tsx` | 1440 侧栏 460px、375 全屏、无溢出、Escape 关闭 |
| 编辑器接入 | `CharacterForm` 的「灵感工作室」 | 只改草稿；localStorage 在保存前不变 |

### 交互稳定性修复（2.38.0）

随 **2.38.0** 发布，与灵感工作室同一版本；不含新数据字段，存储协议与导入导出格式未变。

| 事项 | 实现 | 验证 |
| --- | --- | --- |
| 应用内返回来源栈 | `App.tsx` 的 `navStackRef` / `scrollMemoryRef`；关闭面板用 `replaceState`；`popstate` 清栈 | 返回落回来源页、取消不留在历史、375px 后退仍恢复工作区 |
| 编辑器取消导航 | 浏览态「返回」；取消回到预览而非绕过 | 编辑器 → 取消 → 预览 |
| 关系网默认图谱 | 无偏好时 `"graph"`，切换后持久化 | 首次图谱 / 管理可切换；重载保留 |
| 浮动工具避让 | 仅两项页面移动操作；任一 `aria-modal` 打开时隐藏 | 弹窗底栏不被遮挡；安全区 |
| 长名称关系行 | 名称换行、单元格等高、按钮留在行内、横向溢出裁掉 | 1440 行高 82/60、375 为 199/135、320 为 221/156，溢出 0 |
| 时间线弹窗 | 固定标题 / 滚动正文 / 常驻底栏 | 320–1440 底栏可见；未保存提示照旧 |

### 自由关系画布（2.39.0 / Sprint 49）

应用版本为 **2.39.0**。关系图从固定环形布局升级为可自由摆放的画布；自动布局保留为辅助整理。布局是独立的展示数据（`character-studio.relationship-layout`），不改角色字段、关系语义或世界观归属。

| 事项 | 实现 | 验证 |
| --- | --- | --- |
| 布局模型 | `src/storage/relationshipLayout.ts`：`schemaVersion`、按 ID 的坐标、视觉分组 | 归一化/裁剪/补位/分组 36 例 |
| 节点拖动 | `RelationshipGraph.tsx`：指针捕获、4/8px 阈值、rAF 合帧、松手写入 | 拖动中不落盘、松手坐标正确、刷新后一致 |
| 无界视图 | 现有 `view` 平移缩放；`viewBox` 只随可见集合变化 | 缩放/平移改变变换，重置视角不清坐标 |
| 自动整理 | 聚类（连通分量）与环形；可见/全部；预览、取消、确认、撤销 | 预览不落盘、取消复原、确认写入、撤销恢复 |
| 视觉分组 | 多选、命名、整体拖动、取消 | 两名成员位移一致；关系数据不变 |
| 备份 | ZIP/JSON 的 `relationshipLayout`；完全恢复/合并保护/ID 重映射/旧包兼容 | `canvasBackup` 5 例 + 布局合并 6 例 |
| 移动端 | 触屏拖动、单指点选、双指缩放、375 无溢出 | 5px 抖动不移动、40px 拖动不误开 |

### 关系管理与共享弹窗（2.39.0 / Sprint 49）

与自由画布同一版本验收。只改展示与交互结构，不改关系数据、角色字段或画布坐标。

| 事项 | 根因 | 修复 |
| --- | --- | --- |
| 角色选择器横向滚动 | 名称与次级信息同行，次级信息 `nowrap` 且右推，长职业撑宽整行 | 姓名/次级信息改上下两行；列表 `overflow-x: hidden`；姓名换行、次级单行省略 |
| 世界观底栏遮挡选择器 | 弹窗整体滚动，底栏是同一滚动容器里的 sticky | 标题 / 滚动正文 / 静态底栏三段，底栏移出滚动区 |
| 关系弹窗高度与关闭 | 单一容器，无未保存保护 | 同一三段结构 + 脏检查 + 放弃确认 + 焦点返回 |
| 备注挤占表格 | 备注整段铺开 | 单行摘要 + 展开/收起，方向说明移入工具栏 |

验证：`verify:browser` **75/75**；新增断言覆盖 320/375/1024/1440 的选择器溢出、末项可达、底栏不重叠、未保存确认与焦点返回。真机 iOS Safari 仍未验证（桌面 Chrome 的移动视口模拟不等价）。

### UX 一致性与布局（2026-10-19，2.37.2）

随 **2.37.2** 发布，Sprint 仍为 47。八项维护，不含新功能；存储协议与导入导出格式未变。

| 事项 | 实现 | 验证 |
| --- | --- | --- |
| 列表头像居中 | 修掉 `.settings-check span` 的 1px 内边距命中，以及残留选择器把 `.table-avatar` 变成无居中 flex 的问题 | 列表/弹窗、浅色/深色下偏差 0；行高不变 |
| 轻量弹层关闭 | `useLightDismiss` / `useEscapeDismiss`：外部点击、触发按钮、Escape、同级互斥、焦点归还 | Dashboard、时间线、世界观、关系网、选择器均有断言 |
| Tooltip | `TooltipLayer` portal：下方 6px、空间不足翻转、左右夹边、hover/focus/长按 | 320 与 1440 下贴控件、在视口内、不遮挡触发 |
| 动效 | 按压 1px、面板 150ms 淡入，沿用菜单/抽屉动画 | `reduced-motion` 下 0.001s |
| 编辑器字段 | 输入框 + 预设下拉，补 `aria-label` 与说明 | 保存、回显、375px 可编辑 |
| 移动端筛选 | 打开面板同步展开字段 | 375px 字段直接可见 |
| 时间线布局 | 880px 列 `margin-inline: auto`，页头同列 | 1440/1920 左右 120/120 |
| 世界观布局 | 树 52vh/520、间距 20、正文 40em | 详情下方空白 181→19px，正文约 40 字/行 |

### 移动端专项（2026-10-19，2.37.1）

随 **2.37.1** 发布，Sprint 仍为 47。只改手机上的导航、弹层与 320px 布局，不含新功能。

| 事项 | 实现 | 验证 |
| --- | --- | --- |
| 主导航底部抽屉 | `components/BottomSheet.tsx`（Portal、滚动锁定、Escape、焦点回归、安全区）+ `App.tsx` 的一份 `workspaceEntries` 同时供下拉与抽屉 | `verify:browser`：四项齐全、选中 1、贴底、可滚动、Escape 关闭且焦点回到 `.workspace-switch` |
| 「更多操作」抽屉 | `Dashboard.tsx` 同一份行内容，桌面下拉 / 手机抽屉 | 7 行、面板 295–812、内部滚动、Escape 关闭 |
| Dashboard 首屏 | 顶栏一行、隐藏重复标题带、范围计数下移、工具行四控件、视图与批量进抽屉 | 375px 首个角色卡片 y=321（此前 646） |
| 弹层外点判定 | Portal 层带 `data-sheet-root`，App 与 Dashboard 的外点 handler 放行 | 手指按下不会先关抽屉（synthetic click 测不出，代码层修正） |
| 320px 工具栏 | 手机端新建角色去掉 132px 下限；≤360px 统一 8px 间距、8px 内边距 | 320/375/390/430 均一行四项、42px 高、页面溢出 0 |
| 320px 时间线卡片 | 卡片头两列 grid：类型+日期一列、编辑/删除固定右列 | 8 张卡片操作与头部同排；长标题 2 行且不裁切 |
| 分组定位滚动提示 | `useHorizontalScrollHint` + `mask-image` 渐隐，只留在仍被裁切的一侧 | 起始 `has-overflow-end`、滚到末端变 `has-overflow-start`、末端完整可见 |

### 项目整理（2026-10-19，未发布应用版本）

只动文档与仓库卫生，不改应用行为、存储协议与版本号（仍为 2.37.1）。

| 事项 | 结果 |
| --- | --- |
| README | 重写为对外主页：定位、8 张真实界面截图、按任务组织的功能、数据边界、快速开始、状态、许可证 |
| 截图 | `docs/screenshots/` 新增 9 张，全部使用 CS-FIXTURE-100-V1 的虚构数据 |
| 历史资料 | `PROJECT_OVERVIEW` / `UI_AUDIT` / `UI_DESIGN_HANDOFF` / `CHATGPT_REVIEW_PACKAGE` 移入 `docs/archive/`，附归档说明 |
| 新文档 | `DATA_FORMATS.md`、`TESTING.md`、`DEPLOYMENT.md` |
| 索引 | `docs/README.md` 重写为职责表与「按目的找文档」 |
| 仓库卫生 | `.gitignore` 补充日志、临时 profile、构建缓存与本地环境文件；仓库内无已跟踪的构建产物 |
| 代码 | 未改；`typecheck` / 538 用例 / `build:pages` / 59 项浏览器检查均通过 |

### Sprint 47（2.37.0）

已随 2.37.0 发布。

| 事项 | 实现证据 | 验证 |
| --- | --- | --- |
| 角色档案 PDF（文字版，可选中/检索） | `src/utils/characterSheetPdf.ts`（642 行）、`src/utils/characterSheetExport.ts`、`src/utils/fontGlyphCoverage.ts`、`src/assets/fonts/NotoSansSC-CS.ttf` | pypdf 抽取中文文本；4 份样本 1–3 页、63–80 ms |
| 缺字形不静默丢失 | 同上 `safe()` / `findUnsupportedCharacters` | `test/characterSheetPdf.test.ts` 8 例；`special-chars-sheet.pdf` 15 个字符呈 □ |
| 关系网图谱 / 管理双模式 | `src/pages/RelationshipGraph.tsx`（2414 行） | 191 条关系分 10 页、姓名+备注搜索、类型/角色筛选、编辑删除定位；375px 条目化 |
| 工作区容器内距与阅读宽度 | `src/styles.css` 的 `--workspace-inset`、`.timeline-page` 880px、`.world-detail` 720px | 1440/375 无横向溢出；容器贴近卡片边缘的问题消失 |
| 时间线年份导航 | `src/pages/Timeline.tsx`（654 行） | 单行滚动、当前年入视野、点年份避开吸顶栏 |
| 世界观主从边界与移动端切换 | `src/pages/WorldManager.tsx`（706 行） | 手机一次一屏、返回列表左向 chevron、详情模式隐藏列表工具栏 |

**浏览器检查**：`npm run verify:browser` 59/59（新增管理视图、手机图谱适配、浮动栏新行为、移动端导航抽屉与首屏两组、320px 工具栏/时间线/分组提示）。**单元测试**：48 文件 / 538 用例。

**版本号口径**：`src/config/version.ts` 的 `APP_VERSION` 与 `package.json` 的 `version` 保持同值，由 `npm run verify:version` 在本地与 CI 中守卫。界面与构建产物只读 `version.ts`；`package.json` 是包元数据。

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
| 角色灵感工作室 | `components/InspirationStudio.tsx`、`data/inspirationLibrary.ts`、`inspiration/engine.ts` | 已实现 |
| 自由关系画布 | `pages/RelationshipGraph.tsx`、`storage/relationshipLayout.ts` | 已实现（2.39.0） |
| 搜索 / 筛选 / 排序 | `storage/dashboardPrefs.ts` + `Dashboard.tsx` 的 `getVisibleCharacters` | 已实现 |
| 批量选择 / 批量编辑 / 批量删除 / 批量复制 | `utils/bulkEdit.ts`、`Dashboard.tsx` 批量条 | 已实现 |
| 角色关系网（图谱 / 管理双模式） | `src/pages/RelationshipGraph.tsx`（2366 行）+ `storage/relationshipStorage.ts` + `storage/graphPrefs.ts` + `types/relationship.ts` | 已实现 |
| 世界观时间线 | `src/pages/Timeline.tsx`（649 行）+ `storage/timelineStorage.ts` | 已实现 |
| 世界观管理（分层条目） | `src/pages/WorldManager.tsx`（706 行）+ `storage/worldStorage.ts` | 已实现 |
| 角色档案 PDF 导出（文字版 / 截图版） | `utils/characterSheetPdf.ts` + `utils/characterSheetExport.ts` + `utils/fontGlyphCoverage.ts` + `assets/fonts/` | 已实现 |
| 开发者中心 | `src/pages/DeveloperCenter.tsx`（1199 行）+ `config/developerSettings.ts` | 已实现 |
| 头像（Emoji + 图片上传 / 裁剪 / 压缩） | `hooks/useAvatarEditing.ts`（433 行）、`utils/cropGeometry.ts`、`components/AvatarDisplay.tsx` | 已实现 |
| 头像素材库（IndexedDB） | `utils/avatarAssets.ts`（389 行） | 已实现 |
| 导入 / 导出 / 备份 / 恢复 | `utils/importExport.ts`（2184 行）、`storage/workspaceBackup.ts`、`storage/backup.ts` | 已实现 |
| 主题（浅色 / 深色 / 跟随系统） | `App.tsx` 主题 effect + `styles.css` 令牌 | 已实现 |
| 弹窗键盘控制 | `hooks/useDialogKeyboard.ts`（90 行） | 已实现 |
| 懒加载块自愈 | `utils/lazyImport.ts`（83 行） | 已实现 |
| 构建身份与部署校验 | `scripts/build-identity.mjs`、`build-info.mjs`、`verify-deploy.mjs`、`.github/workflows/deploy-pages.yml` | 已实现 |
| 单元测试 | `test/` **51 个文件 / 592 个用例** | 已实现 |

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

### 5.1 最近一次执行（2026-10-19，2.39.0）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | **通过**，退出码 0，无输出 |
| `npm test` | **通过**：51 个文件 / 592 个用例，0 失败 0 跳过 |
| `npm run build:pages` | **通过**，22 个产物文件；发布构建入口与样式见线上 `build-info.json` |
| `npm run verify:browser` | **73/73 通过**（新增返回来源、编辑器取消、图谱默认、灵感工作室、长名称关系行、自由画布五项断言；原有断言保留） |
| `npm run verify:version` | **通过**，2.39.0 |
| 线上 `build-info.json` | 部署后由 `npm run verify:deploy` 核对：版本 2.39.0、sprint 49、commit 等于发布提交，22 个文件逐字节一致 |

### 5.2 各模块的验证等级

| 等级 | 含义 | 覆盖的模块 |
| --- | --- | --- |
| **已测试** | 有单测覆盖，且 `vitest run` 通过 | 存储层（角色 / 关系 / 时间线 / 世界观 / 备份 / 引用清理 / 恢复快照 / 偏好）、纯逻辑（批量编辑 / 裁剪几何 / 年龄 / CSV / 导入导出 / 导入计划 / 关系语义与布局 / 分节规则）、PDF 文本结构、删除恢复、版本一致性 |
| **已测试（浏览器）** | `verify:browser` 覆盖真实 DOM 与交互 | 七个页面的进入与历史恢复、Dashboard 全流程、关系网双模式、时间线与世界观、导入预检、移动端抽屉与 320px 布局 |
| **需真机** | 桌面 Chrome 无法给出结论 | iPhone Safari 地址栏与安全区、软键盘、触控手感、Safari 渲染性能 |
| **未验证** | 无单测、无实测记录 | Developer Center 的多数控件回调、导出分辨率 3x 的实际文件大小 |

历史实测证据记录在 `CHANGELOG.md` 与 `docs/DEVELOPMENT_LOG.md`，本文不重复。

---

## 6. 已知问题

完整清单与复现条件见 **`docs/KNOWN_ISSUES.md`**。当前摘要：

- **KI-18（P3）** 完整备份 ZIP 的 `backup-info.json` 中 `appVersion` 固定为 `0.1.0`，与实际版本无关。
- **KI-19（P3）** PDF 字体是子集，极少数生僻字会以 `□` 呈现；导出后会提示具体字符，不会静默丢字。
- **KI-20（P3）** 手机端底部抽屉没有拖拽关闭手势，只支持遮罩、关闭按钮与 Escape。
- **KI-21（P3）** 软键盘弹起时未做 `visualViewport` 适配；目前依赖浏览器自身滚动。
- **KI-22（P2，需真机）** iPhone Safari 的地址栏收放、安全区与渲染性能未经真机验收。

早期台账中的 KI-01 – KI-17 已随 2.28 – 2.37 修复，过程见 `CHANGELOG.md`。

---

## 7. 当前阻塞因素与依赖

| 类型 | 内容 |
| --- | --- |
| 需真机 | iPhone Safari 的视口、安全区、软键盘与性能 |
| 产品边界 | 不引入账号与云端同步；跨设备只能依赖导出的完整备份 |
| 无技术阻塞 | 构建、测试、类型检查、部署流程当前均可用且一致 |

---

## 8. 下一阶段的重点

1. **Sprint 48 规划**：角色人生轨迹、动态人物关系、世界观与故事联动（均为规划中，见 `docs/ROADMAP.md`）。
2. **真机验收**：在 iPhone Safari 上过一遍导航抽屉、长列表与软键盘场景。
3. **补齐验证缺口**：3x 关系网导出的实际体积；Developer Center 的控件回调。
4. 文档维护：本轮已把 README、状态、架构、数据格式、测试与部署拆分为各自负责的文档。

---
## 9. 历史阶段记录（已迁出）

Sprint 38 – 54.5 的逐轮叙述原本写在这里，与 `CHANGELOG.md` 重复。现在职责拆开：

| 想知道 | 去哪看 |
| --- | --- |
| 某个版本改了什么、验证边界 | [`../CHANGELOG.md`](../CHANGELOG.md) |
| 某个决定的来由与口径更正 | [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md) |
| 某一轮的截图与证据是否还算数 | [`ACCEPTANCE.md`](ACCEPTANCE.md) |
| 当前状态、遗留问题、下一步 | 本文件 §1–§8 |

本文件只保留「现在」，历史只保留索引。
