# Character Studio Developer Handbook

## 1. 项目简介

Character Studio 是一个面向 OC（Original Character，原创角色）创作的本地优先角色工作台。它不是单纯的表单工具，也不是云端角色数据库，而是一个在浏览器中运行、以本地数据为核心的创作软件原型。

项目的核心定位是：

- 帮助创作者整理角色的身份、外貌、性格、能力、背景故事与视觉 Prompt。
- 支持角色从草稿、编辑、预览、导出到备份迁移的完整闭环。
- 在不依赖服务器的前提下，提供稳定、可维护、可扩展的创作体验。
- 为未来的关系网、时间线、世界观管理、AI 创作辅助和云同步留下结构余地。

Character Studio 的设计理念是“简洁、克制、可长期维护”。它参考 Apple、Linear、Notion 一类工具的视觉语言：清晰层级、柔和边框、低饱和颜色、统一控件、少量动效和强可读性。它更像一个创作工作台，而不是营销页面或炫技型 Demo。

### 为什么采用 Local First

项目从一开始就选择 Local First，而不是先做后端或账号系统，原因有四点。

第一，OC 创作数据通常很私人。角色设定、草稿、背景故事、Prompt、头像素材等内容未必适合一开始就上传到服务器。本地优先可以降低用户心理负担。

第二，MVP 阶段最重要的是创作体验，而不是账号、权限、账单、同步冲突和云端资产管理。Local First 让项目能优先打磨 Dashboard、Editor、Preview、导入导出和素材管理。

第三，本地版本更容易部署。当前项目可以通过 Vite 构建为静态站点，部署到 Vercel 等平台，不需要数据库、对象存储、API 服务或认证服务。

第四，本地数据结构一旦稳定，未来再接入云同步会更安全。现在的 localStorage、IndexedDB、manifest、backup-info、assetId 设计，都可以看作未来同步协议的前身。

### 为什么不使用服务器

当前阶段明确不使用服务器。不要为了新增功能临时引入后端。

原因包括：

- 服务器会立即带来认证、授权、数据隔离、成本、部署、错误监控和安全问题。
- 头像图片、导出文件、角色备份等资产在本地已经可以完成闭环。
- 多设备迁移目前通过 JSON 和 ZIP 备份解决。
- 云同步应作为未来明确版本目标，而不是穿插在当前前端架构中。

因此，当前所有功能都应优先在浏览器端完成。除非未来进入 Cloud Sync 版本，否则不要新增服务器依赖。

### 为什么使用 localStorage + IndexedDB

Character Studio 采用两类本地存储：

- localStorage：保存角色文字数据、Dashboard 偏好、主题、Settings、首次 About 显示状态等轻量数据。
- IndexedDB：保存头像图片 Blob、压缩后的头像素材、素材元数据等二进制或较大数据。

不要把图片直接存入 localStorage。localStorage 适合小体积 JSON，不适合 Base64 图片。图片用 Base64 放进 localStorage 会快速膨胀体积，影响性能，甚至触发浏览器存储限制。

因此角色数据只保存 `avatarAssetId`，真正的图片 Blob 放在 IndexedDB。这个设计让角色 JSON 保持轻量，也让完整备份 ZIP 可以更清晰地拆分角色数据和素材资源。

### 为什么保持单机版本

当前项目是单机创作工作台，不是多人协作软件。保持单机版本有利于：

- 快速验证角色编辑体验。
- 降低数据丢失和同步冲突风险。
- 保持部署简单。
- 保持用户数据隐私。
- 为未来云同步留下清晰边界。

单机并不意味着封闭。导入导出系统已经支持单角色分享、轻量备份、完整备份 ZIP、头像素材独立管理、CSV 文本归档、PDF/JPG/PNG 展示导出。这些能力构成了当前阶段的数据生态。

### 适用人群

Character Studio 的主要目标用户包括：

- OC 创作者。
- 小说、跑团、乙游、企划、插画角色设定作者。
- 需要管理多个角色设定的人。
- 需要整理 AI 绘图 Prompt 的创作者。
- 希望离线管理角色资料、不想依赖云端账号的人。

### 未来发展方向

长期看，Character Studio 可以发展为完整的创作宇宙管理工具：

- 角色关系网。
- 时间线。
- 世界观管理。
- 阵营与组织。
- 地图与地点。
- 多版本角色。
- AI 创作辅助。
- 云同步。
- 插件化素材系统。

但在当前阶段，必须继续保护好已经稳定的基础能力：角色 CRUD、草稿箱、收藏、头像、素材库、导入导出、Preview 和本地存储兼容。

## 2. 项目发展历史

Character Studio 是通过连续 Sprint 逐步演化出来的。理解历史很重要，因为项目中许多设计不是一次性规划出来的，而是在解决真实体验问题的过程中沉淀出来的。

### 0.0：项目骨架

最初目标是创建 Vite + React + TypeScript 的前端项目，项目名为 `character-studio`。

这一阶段完成：

- 基础页面结构。
- Dashboard。
- CharacterForm。
- CharacterPreview。
- Character 类型定义。
- localStorage 存储工具。
- 简约白底、浅灰背景、圆角卡片、响应式布局。

这一阶段刻意没有做：

- 登录。
- 后端。
- 数据库。
- AI API。
- PDF 导出。
- 复杂动画。

经验：早期不要引入服务器，也不要让 MVP 变成大而全系统。项目最核心的是角色数据结构和页面流转。

### Sprint 2：基础 CRUD

这一阶段围绕角色基础管理：

- 编辑名字、性别、年龄、种族、职业、世界观、外貌、能力、背景故事。
- 保存到 localStorage。
- Dashboard 自动显示所有角色。
- 点击角色重新编辑。
- 删除角色。
- 复制角色。
- 刷新后数据不丢失。
- Empty State。

经验：localStorage 足以支撑早期文字数据。删除和复制是角色管理最早需要稳定的行为，不应依赖后端。

### Sprint 3：标签、随机生成、Prompt 生成

这一阶段把表单从资料录入推进到创作辅助：

- 性格标签多选。
- 世界观选择。
- 视觉风格选择。
- 随机生成角色。
- 中文人物关键词。
- 英文 AI 绘图 Prompt。
- 所有生成逻辑只使用本地词库和字符串拼接。

明确没有接入 AI API。原因是要先稳定本地规则和数据结构，否则一开始接 AI 会掩盖基础体验问题。

经验：Prompt 生成功能应保持可解释、可编辑、可重复生成。生成内容必须落到普通字段里，而不是成为不可编辑的黑盒结果。

### Sprint 3.5：体验修复与随机库优化

这一阶段解决早期体验问题：

- 删除二次确认。
- Dashboard 明确编辑按钮。
- 性格标签支持自定义。
- 随机库扩容。
- 中文关键词和英文 Prompt 标点修复。
- 随机生成按钮反馈。
- 手动输入后也可生成关键词与 Prompt。

经验：自动生成永远不能只服务随机结果，也要服务用户手写内容。提示、Toast、二次确认是基础安全感的一部分。

### Sprint 4：CharacterPreview 展示页优化

Preview 从简单展示变成角色设定展示页：

- 角色名大标题。
- 基础资料卡片。
- 性格标签。
- 视觉风格。
- 外貌、能力、背景故事。
- 中文关键词。
- 英文 Prompt。
- 复制完整设定、关键词、Prompt。
- Toast、Hover、淡入、空字段兜底。

经验：Preview 是未来导出 PDF/JPG/PNG 的基础，因此它不是普通详情页，而是展示稿。所有导出相关样式都应围绕 Preview 考虑。

### Sprint 5：Import & Export

这一阶段建立第一版导入导出系统：

- 当前角色 JSON。
- 全部角色 JSON。
- JSON 导入。
- CSV 导出。
- PDF 导出。
- Dashboard 导入导出入口。
- Preview 导出入口。
- Loading 与 Toast。

使用 html2canvas + jsPDF 完成 PDF 导出。

经验：浏览器截图导出很容易受 CSS 颜色函数、深色模式、DOM 节点选择、按钮隐藏影响。导出区域必须有明确边界，不要截图整个页面。

### Sprint 5.5：导入导出与表单体验修复

新增：

- 批量选择。
- 批量删除。
- 批量复制。
- 导出菜单整理。
- 表单校验改为统一 Toast。
- 年龄输入优化。
- 性别选择优化。
- PDF 导出不包含按钮和操作控件。

经验：一旦角色数量增长，批量操作就成为 Dashboard 必备能力。批量模式必须和普通浏览模式分离，否则页面会变拥挤。

### Sprint 5.6：Dashboard 操作区与批量选择体验优化

主要目标是减少顶部按钮数量：

- 顶部只保留新建角色。
- 增加更多操作菜单。
- 默认不显示选择框。
- 点击批量选择后才显示批量操作。
- 圆形选择控件。
- 退出批量模式清空选择。

经验：Dashboard 常规状态应该干净。批量能力只有在用户主动进入时才出现。

### Sprint 5.7：Dashboard 管理体验

新增：

- 搜索。
- 排序。
- 筛选。
- createdAt / updatedAt。
- 单卡片导出 JSON。
- 选中角色导出 JSON。
- 删除撤销。
- 搜索无结果状态。
- Dashboard 卡片信息增强。

经验：角色管理不是单纯展示列表，而是长期维护多角色集合。搜索、筛选、排序和撤销删除是核心管理能力。

### Sprint 5.8 / 5.9：Dashboard 视觉打磨

这一阶段持续优化 Dashboard：

- Header / Hero 收敛。
- 搜索筛选布局。
- 卡片固定高度。
- 默认头像区域。
- 更多菜单。
- 收藏与置顶。
- 深色模式。
- Dashboard 偏好保存。
- 主题菜单。
- 回到顶部按钮。
- Footer 版权。

经验：视觉统一不是一次完成的。Dashboard 是项目的第一印象，也是交互密度最高的页面，必须反复打磨。

### Sprint 6：Character Workspace

CharacterForm 升级为角色创作工作台：

- 模块化结构：基础信息、外貌、性格、能力、背景故事、AI Prompt。
- 模块导航。
- 模块折叠。
- 自动保存。
- 保存状态。
- Textarea 自动高度。
- 创作辅助。
- 编辑 / 预览切换。
- Emoji 头像。
- 全局右下角快捷操作栏。

经验：角色编辑不是普通表单。模块化、自动保存、创作辅助和预览切换让它更接近创作工作区。

### Sprint 6 Hotfix 系列：Editor / Preview / Dashboard 体验收敛

大量修复集中在：

- Hero 操作栏。
- 搜索、收藏、草稿状态。
- 卡片点击区域。
- Emoji Picker。
- 草稿临时保存。
- 写作辅助 Dialog。
- 导出菜单宽度。
- 最后编辑时间。
- Footer、About、Settings。
- Command Palette。
- Skeleton Loading。
- 深色模式。
- 快捷键。

经验：当功能变多后，最大问题不是功能缺失，而是入口混乱、状态冲突和控件风格割裂。必须优先统一交互语言。

### Sprint 6.4：标签、视图、批量、图片导出

尝试引入更完整标签系统、列表视图、批量导出 JPG/PNG/PDF、批量修改标签等。

后续因为角色标签和性格标签重复，进行了精简：

- 删除独立角色标签系统。
- 保留性格标签作为唯一标签。
- 标签颜色通过文字 Hash 稳定生成。
- 标签筛选移除，避免复杂性过高。

经验：不要为了“管理能力”过度设计标签系统。当前阶段性格标签已足够表达角色气质，独立标签系统会造成认知负担和数据重复。

### Sprint 6.6 / 6.7 / 6.8：移动端和交互热修

重点解决：

- 小屏卡片拥挤。
- 列表视图溢出。
- About 页面移动端溢出。
- Preview 导出入口合并。
- Settings 入口。
- 收藏系统重新定义。
- Footer 闪烁。
- 小屏菜单遮挡。
- 悬浮按钮重叠。
- 浏览器后退支持。
- 创作辅助写入方式修复。
- 小屏头像比例修复。

经验：移动端不能简单缩小桌面端。按钮要收纳，菜单要防裁切，头像必须固定比例，底部安全区必须考虑。

### Sprint 7：Avatar Upload & Local Asset Storage

头像系统从 Emoji 扩展到上传图片：

- Avatar 支持 Emoji / Image。
- 上传头像。
- 裁剪。
- 压缩。
- IndexedDB 存储。
- avatarAssetId 绑定。
- Dashboard / Editor / Preview / List View 显示。
- PDF/JPG/PNG 导出兼容。
- Settings 素材统计。

明确不把图片存 localStorage。

经验：头像看似是 UI 功能，本质是本地素材系统的开端。必须用 assetId 绑定，避免角色数据和二进制数据混在一起。

### Sprint 7.0 Hotfix：裁剪、素材库、导入导出

修复：

- 裁剪结果偏移。
- 未保存头像进入素材库。
- 上传入口合并。
- 卡片头像椭圆变形。
- 弹窗适配。
- Preview / Editor 头像放大。
- 素材库批量操作。
- 完整备份导入导出。

经验：裁剪器最容易出现“看到的框”和“最终结果”不一致。裁剪坐标、缩放、边缘约束、预览和最终压缩必须保持同一套数学逻辑。

### Sprint 7.3：Avatar / Asset Library / Export / Floating Actions

完成：

- 导出头像修复。
- 素材库 JSON 导入导出。
- 清除本地数据联动 IndexedDB。
- Dashboard / Settings 素材库入口。
- 全局菜单自动关闭。
- 悬浮按钮重构。
- Avatar 区按钮统一。
- 小屏裁剪适配。

经验：菜单和 Dialog 必须互斥。页面切换、Dialog 打开时应关闭 Dropdown，否则很容易出现多个浮层残留。

### Sprint 7.3B / 7.3C：头像输入方式与上传面板

新增或优化：

- URL 上传。
- 拖拽上传。
- 粘贴上传。
- 统一上传面板。
- 粘贴只在面板打开时生效。
- 删除不准确的小预览图。
- 鼠标滚轮缩放。
- 缩放按钮。
- 裁剪边缘修复。

经验：粘贴监听不要做成全局，否则会误触发。上传入口应集中到一个面板，减少按钮数量。

### Sprint 7.4 / 7.6：导入导出生态与 Asset Library

建立完整数据生态：

- 单角色 JSON 携带头像 Base64。
- 多角色轻量 JSON。
- 完整备份 ZIP。
- characters.json。
- manifest.json。
- backup-info.json。
- assets/avatar/*。
- ZIP 导入。
- 导入预览确认。
- Asset Library 独立弹窗。
- Footer 增加头像素材库入口。

经验：完整备份必须依赖 manifest 绑定，禁止靠旧 ID、文件名、素材名称猜测。导入必须先预览，确认后再写入 localStorage 和 IndexedDB。

### Sprint 7.7：导入导出体验打磨

目标是让普通用户理解 JSON 和 ZIP 的区别：

- 导入入口改为“导入角色 JSON/ZIP”。
- 导出入口改为“导出角色 JSON/ZIP”。
- 导出方式 Dialog。
- 导入预览摘要化。
- 详细信息折叠。
- 全中文文案。
- Asset Library 改名为“头像素材库”。

经验：技术正确不等于用户理解。导入导出这种高风险操作必须用清晰、短句、中文、确认流程解释。

### Sprint 7.72 / 7.73：Design System 和 UI 细节修复

完成：

- Checkbox / Radio / Switch / Select / Input / Button 基础样式统一。
- Switch thumb 定位修复。
- 导入导出选择卡片 Radio 对齐。
- 导入详情按钮轻量化。
- 导出 JPG/PNG/PDF 标签颜色修复。
- Settings 文案中文化。
- 收藏不再改变 updatedAt，避免卡片跳位。

经验：Design System 层的修复要小心影响范围。Switch 可以复用 checkbox 的语义，但不能继承 checkbox 的居中布局。收藏是 quick access 状态，不应被视为编辑行为。

## 3. 整体项目架构

Character Studio 目前由以下核心模块组成。

### Dashboard

Dashboard 是角色管理中心。它负责：

- 展示角色列表。
- 卡片视图。
- 列表视图。
- 搜索。
- 筛选。
- 排序。
- 收藏视图。
- 草稿箱视图。
- 批量选择。
- 批量复制。
- 批量删除。
- 批量收藏 / 移出收藏。
- 导入角色。
- 导出角色 JSON / ZIP / CSV。
- 打开 About、Settings、头像素材库。

Dashboard 不应该承担角色编辑细节，也不应该直接实现头像裁剪或 Prompt 生成。它只负责管理和导航。

### Character Editor

当前文件名仍是 `CharacterForm.tsx`，但产品层面已经升级为 Character Workspace / Editor。

它负责：

- 创建角色。
- 编辑角色。
- 自动保存草稿。
- 临时保存。
- 正式保存。
- 删除 / 清空。
- 模块导航。
- 模块折叠。
- 随机生成角色。
- 生成中文关键词。
- 生成英文 Prompt。
- Avatar Picker。
- 头像上传。
- 裁剪。
- 从本地素材库选择头像。
- 创作辅助 Dialog。

Editor 的职责是“写作和编辑”。不要把 Dashboard 管理逻辑放进 Editor。

### Character Preview

Preview 是角色设定展示页，也是展示导出的基础。

它负责：

- 展示角色资料。
- 展示头像。
- 展示基础资料、性格标签、视觉风格、外貌、能力、背景、关键词、Prompt。
- 复制设定。
- 收藏切换。
- 编辑入口。
- 导出 JSON / PDF / JPG / PNG。
- 点击头像大图预览。

Preview 的 DOM 结构必须稳定，因为 PDF/JPG/PNG 导出依赖它。不要随意改变 `data-pdf-export-root`、`pdf-safe` 或导出隐藏逻辑。

### Draft Box

草稿箱用于保存未正式提交的角色。

它负责：

- 显示草稿角色。
- 草稿继续编辑。
- 草稿转正式。
- 删除草稿。
- 草稿批量操作。

草稿不应污染正式角色列表。编辑正式角色时临时保存应产生对应草稿版本，而不是直接覆盖正式角色。

### Favorites

收藏是 quick access 状态。

它只表示“快速访问”，不是标签，不是分类，不是筛选字段。

规则：

- `favorite` / `isFavorite` 仅为布尔状态。
- 收藏视图只显示正式角色，不显示草稿。
- 收藏不应改变 `updatedAt`。
- 收藏不应让卡片在默认排序里跳位。

### About

About 是产品说明和基础帮助入口。

它包含：

- Character Studio 是什么。
- 核心功能。
- 快捷键。
- Roadmap。
- Changelog。
- 导入导出说明。
- 首次提示“不再自动显示”。

About 不是 README，也不是开发文档。开发文档是本文件。

### Settings

Settings 保存基础偏好：

- Appearance。
- Default View。
- Mobile。
- Export。
- Data。
- About Data。

Settings 不再直接承载完整素材库。素材库已独立为“头像素材库”。

### 头像素材库

头像素材库是 Asset Library 的当前阶段实现。

它负责：

- 浏览头像素材。
- 查看素材统计。
- 多选。
- 全选。
- 导入头像素材 JSON。
- 导出头像素材 JSON。
- 删除素材。
- 删除未使用素材。
- 清理未使用素材。
- 显示素材引用情况。

未来 Asset Library 可以扩展到背景、地图、世界观图片、立绘等。

### Avatar Picker

Avatar Picker 管理角色头像选择。

包括：

- Emoji 分类选择。
- 最近使用。
- 上传头像。
- URL / 拖拽 / 粘贴输入。
- 裁剪。
- 压缩。
- 从素材库选择。
- 移除图片回到 Emoji。

### Import / Export

导入导出是数据生态核心。

包括：

- 单角色 JSON。
- 全角色轻量 JSON。
- 完整备份 ZIP。
- CSV。
- PDF。
- JPG。
- PNG。
- 头像素材 JSON。

导入必须遵循“解析 → 预览 → 确认 → 写入”。

### Floating Actions

右下角悬浮快捷按钮负责页面导航和当前页面快捷操作。

不同页面显示不同按钮：

- Dashboard：回到顶部、新建、搜索。
- Editor：返回 Dashboard、保存、临时保存、回到顶部。
- Preview：返回 Dashboard、返回编辑、导出、回到顶部。
- About / Settings：返回上一页、返回 Dashboard、回到顶部。

悬浮按钮不能遮挡底部操作栏或 Footer。

### Search / Filter

搜索和筛选属于 Dashboard 管理能力。

支持：

- 搜索角色名、职业、世界观、性格标签。
- 范围切换。
- 排序。
- 世界观筛选。
- 性别筛选。
- 视觉风格筛选。

标签筛选曾经尝试过，但后来删除。当前标签只作为显示和搜索文本的一部分。

## 4. 目录结构

当前目录结构简洁，适合小型 React 应用。

```text
src/
  App.tsx
  main.tsx
  styles.css
  components/
    AvatarDisplay.tsx
  pages/
    Dashboard.tsx
    CharacterForm.tsx
    CharacterPreview.tsx
  storage/
    characterStorage.ts
  types/
    character.ts
  utils/
    avatarAssets.ts
    importExport.ts
```

### App.tsx

应用主入口，负责：

- 页面状态。
- 角色列表状态。
- 全局 Theme。
- 全局 Footer。
- 全局 About / Settings / 头像素材库弹窗。
- 悬浮按钮。
- 页面切换。
- 浏览器历史。

不要把具体页面的大量业务细节继续塞进 App。App 已经较重，未来可以逐步拆分全局弹窗和布局组件，但不要贸然大重构。

### pages/

页面级模块。

- `Dashboard.tsx`：角色管理中心。
- `CharacterForm.tsx`：角色编辑工作台。
- `CharacterPreview.tsx`：展示和导出。

未来新增页面应放在 `pages/`，例如：

- `RelationshipGraph.tsx`
- `Timeline.tsx`
- `WorldManager.tsx`
- `MapManager.tsx`

### components/

可复用组件。

当前只有 `AvatarDisplay.tsx`。这是头像显示的统一入口，应继续维护。

未来可新增：

- `Dialog.tsx`
- `Button.tsx`
- `Switch.tsx`
- `RadioGroup.tsx`
- `Toast.tsx`
- `Tooltip.tsx`
- `AssetLibraryDialog.tsx`

但新增组件前要确认不会引发大规模重构。

### storage/

保存角色数据的本地存储逻辑。

`characterStorage.ts` 负责：

- 从 localStorage 读取角色。
- 保存角色。
- 删除角色。
- 复制角色。
- upsert 角色。

不要在 UI 组件里直接散落 localStorage 操作，除非是偏好设置这种轻量状态。

### types/

角色类型定义。

`character.ts` 是所有页面共享的角色数据契约。任何新增字段都必须考虑：

- 旧数据兼容。
- JSON 导入兼容。
- 导出兼容。
- Preview 兜底展示。
- localStorage 中旧角色不会崩溃。

### utils/

工具层。

`avatarAssets.ts`：

- IndexedDB。
- 头像 Blob 保存。
- 头像读取。
- 头像删除。
- 素材统计。
- 素材导入导出。

`importExport.ts`：

- JSON 导出。
- CSV 导出。
- ZIP 完整备份。
- 导入预览计划。
- 导入提交。
- PDF/JPG/PNG 导出。
- 批量快照导出。

这些工具是数据生态核心，不要轻易重写。

### styles.css

全局样式和 Design System 基础。

包含：

- Theme token。
- Button。
- Input。
- Select。
- Checkbox / Radio / Switch。
- Card。
- Dialog。
- Toast。
- Tooltip。
- Scrollbar。
- Dashboard。
- Editor。
- Preview。
- Avatar。
- Responsive。
- PDF safe。

当前样式较长，未来可以拆分，但不要在未规划的 Sprint 中随意拆分。

## 5. 数据结构

### Character 数据

角色数据保存在 localStorage 中，核心字段包括：

- `id`
- `name`
- `avatarEmoji`
- `avatarAssetId`
- `favorite`
- `isDraft`
- `draftOfId`
- `gender`
- `age`
- `birthDate`
- `species`
- `occupation`
- `worldview`
- `personalityTags`
- `appearanceDescription`
- `abilityDescription`
- `backstory`
- `visualStyle`
- `characterKeywords`
- `imagePrompt`
- `createdAt`
- `updatedAt`

兼容字段：

- `isFavorite`
- `birthYear`
- `tags`

这些字段是历史迭代留下的兼容点。不要轻易删除读取兼容逻辑，否则旧 JSON 可能导入失败。

### localStorage

localStorage 保存：

- 角色数据。
- Dashboard 偏好。
- Dashboard flags。
- Theme。
- Settings。
- About 首次显示状态。
- Emoji 最近使用。

localStorage 适合轻量 JSON。不要保存头像图片。

### IndexedDB

IndexedDB 保存头像素材。

头像素材记录包含：

- `id`
- `type`
- `name`
- `mimeType`
- `blob`
- `size`
- `width`
- `height`
- `createdAt`
- `updatedAt`

角色通过 `avatarAssetId` 引用头像素材。

### Settings

Settings 当前主要通过 localStorage 分散保存，例如：

- Theme。
- 默认视图。
- 移动端简洁模式。
- 默认展开搜索。
- 自动隐藏低优先级信息。
- JPG 导出质量。
- PDF Light Mode。

未来可以统一成一个 settings 对象，但不要在当前阶段为此大重构。

### Theme

Theme 支持：

- Follow System。
- Light。
- Dark。

通过 `document.documentElement.dataset.theme` 控制 CSS Variables。

新增 UI 时必须使用 CSS Variables，不要在组件里写死大量颜色。

### schemaVersion

`schemaVersion` 用于未来导入导出格式升级。

目前完整备份 ZIP 中有 schemaVersion。它的意义是让未来版本能判断备份格式，并做迁移处理。

当前不要因为 schemaVersion 不存在就拒绝旧 JSON。旧数据兼容优先。

### manifest

manifest 是完整备份 ZIP 中的头像绑定文件。

它保存：

- 原角色 ID。
- 原素材 key。
- 素材文件路径。
- 素材 hash 或等价标识。
- mimeType。
- size。

导入时禁止根据文件名、旧角色 ID、旧素材 ID、素材名称猜测绑定。只能依据 manifest。

### backup-info

backup-info 是完整备份描述文件。

包含：

- schemaVersion。
- exportedAt。
- appVersion。
- characterCount。
- avatarAssetCount。
- assetTotalSize。
- exportType。
- notes。

它用于给导入预览提供上下文，也为未来版本迁移做准备。

## 6. Avatar 系统

Avatar 系统是项目中最复杂的模块之一。它从简单 Emoji 演化为 Emoji + 图片 + 裁剪 + IndexedDB + 素材库 + 导入导出。

### Avatar 模式

角色头像有两种模式：

- Emoji。
- Image。

显示优先级：

1. 如果 `avatarAssetId` 存在且 IndexedDB 能读取图片，显示图片。
2. 如果图片读取失败，回退到 `avatarEmoji`。
3. 如果 Emoji 也不存在，使用默认 `🙂`。

### AvatarDisplay

`AvatarDisplay.tsx` 是头像显示统一组件。

Dashboard、Editor、Preview、List View、Settings 素材库都应尽量使用它。

不要在新页面里单独写一套头像图片显示逻辑，否则很容易再次出现：

- 图片拉伸。
- 椭圆变形。
- object-fit 丢失。
- 小屏 flex 压缩。
- 导出不显示头像。

### Emoji Avatar

Emoji 是默认头像方案。

优点：

- 轻量。
- 无需存储图片。
- 可跨设备 JSON 恢复。
- 对旧数据友好。

Emoji Picker 经过优化，只保留角色相关分类，而不是完整聊天 Emoji 面板。

### 上传头像

头像上传支持：

- 本地文件。
- URL。
- 拖拽。
- 粘贴。

统一在上传头像面板内处理。粘贴监听只在面板打开时生效，避免全局误触发。

### Cropper

裁剪器要求：

- 固定 1:1。
- 正方形裁剪框。
- 拖动图片。
- 缩放图片。
- 鼠标滚轮缩放。
- 放大 / 缩小按钮。
- 裁剪结果与用户看到的裁剪框一致。
- 禁止输出白边。
- 小屏按钮可见。

不要随便改裁剪坐标计算。裁剪相关代码最容易出现显示和输出不一致。

### 压缩

裁剪后压缩为头像 Blob。

建议输出：

- 512 × 512。
- WebP 优先。
- JPEG 兜底。
- quality 约 0.8。

### 为什么不用 localStorage 保存头像

头像是二进制数据。Base64 会变大，而且 localStorage 容量有限。将图片塞进 localStorage 会导致：

- 数据膨胀。
- 读取变慢。
- 导入导出变重。
- 浏览器存储容易超限。

因此头像存在 IndexedDB，角色只保存 `avatarAssetId`。

### 头像绑定

角色与头像通过 `avatarAssetId` 绑定。

删除素材时：

- 如果未被使用，可以直接删除。
- 如果正在使用，需要二次确认。
- 删除后受影响角色回退 Emoji。

### 头像导出

导出 PDF/JPG/PNG 时，需要先确保头像图片已从 IndexedDB 读取，并能被 html2canvas 捕获。

导出时如果头像读取失败，回退 Emoji。

### 头像导入

单角色 JSON 可以携带头像 Base64，并在导入时写入 IndexedDB，再绑定新 assetId。

完整备份 ZIP 则通过 manifest 恢复头像绑定。

### 未来扩展

Avatar 系统未来可扩展：

- SVG Avatar。
- 多头像版本。
- 角色立绘。
- AI 头像。
- 头像裁剪历史。
- 头像素材标签。

但不要破坏现有 `avatarEmoji` + `avatarAssetId` 的兼容结构。

## 7. Asset Library

当前产品文案中叫“头像素材库”，但架构上它是 Asset Library 的第一阶段。

### 为什么独立存在

头像素材不属于 Settings。Settings 是偏好配置，Asset Library 是资源管理。

独立素材库的意义：

- 管理浏览器 IndexedDB 中的素材。
- 查看素材占用空间。
- 查看引用关系。
- 删除无主素材。
- 导入导出素材。
- 为未来更多素材类型留入口。

### 当前支持

当前支持头像素材：

- 浏览。
- 统计。
- 多选。
- 全选。
- 导入头像素材 JSON。
- 导出头像素材 JSON。
- 导出所选。
- 删除所选。
- 删除未使用。
- 清理未使用。

### 引用关系

引用关系通过角色的 `avatarAssetId` 判断。

统计信息包括：

- 素材总数量。
- 已绑定数量。
- 未绑定数量。
- 引用角色数量。
- 总占用空间。

### 删除逻辑

删除素材时：

- 引用数量为 0：可以直接删除。
- 引用数量大于 0：必须二次确认。
- 删除后相关角色回退 Emoji。

### 未来可放入的素材

未来 Asset Library 可扩展到：

- 头像。
- 背景。
- 地图。
- 世界观图片。
- 角色立绘。
- 阵营徽章。
- 道具图片。
- 场景参考。

届时可能需要给 asset 增加类型、标签、引用来源、预览尺寸和导出策略。

## 8. 导入导出系统

导入导出系统是 Character Studio 的数据安全核心。

### 单角色 JSON

用途：

- 分享单个角色。
- 轻量迁移单个角色。

特点：

- 始终是一个 JSON。
- 如果角色使用上传头像，会携带头像 Base64。
- 导入时恢复头像素材，并生成新的 assetId。
- 不依赖旧 avatarAssetId。

### 角色 JSON

用途：

- 导出所有角色文字数据。
- 轻量备份。

特点：

- 不包含头像二进制。
- 保留 avatarEmoji。
- 可能保留 avatarAssetId，但跨设备无法恢复对应图片。

适合快速备份，不适合完整迁移头像。

### 完整备份 ZIP

用途：

- 跨设备迁移。
- 完整备份角色和头像。

结构：

```text
characters.json
manifest.json
backup-info.json
assets/avatar/*
```

`characters.json` 保存角色数据。

`manifest.json` 保存角色与头像素材绑定关系。

`backup-info.json` 保存备份说明。

`assets/avatar/*` 保存头像图片。

### CSV

CSV 只导出文字资料。

用途：

- 表格归档。
- Excel 查看。
- 批量阅读角色文字资料。

CSV 不能重新导入为完整角色，也不包含头像。

### PDF / JPG / PNG

这些是展示导出。

用途：

- 分享角色设定图。
- 保存预览稿。
- 归档展示。

它们不能重新导入为角色数据。

### 为什么不能互相代替

不同导出格式服务不同目的：

- JSON：数据迁移。
- ZIP：完整迁移。
- CSV：文字归档。
- PDF/JPG/PNG：展示分享。
- 素材 JSON：独立管理头像素材。

不要试图用一个格式解决所有问题。

### Manifest 工作方式

导入完整备份时：

1. 读取角色数据。
2. 读取素材文件。
3. 读取头像绑定信息。
4. 建立原角色 ID 到新角色 ID 的映射。
5. 建立原素材 key 到新 assetId 的映射。
6. 只根据头像绑定信息恢复角色头像。

禁止根据文件名、素材名称、旧 ID 猜测绑定。

### 导入流程

统一流程：

1. 用户选择 JSON 或 ZIP。
2. 系统解析文件。
3. 显示导入预览。
4. 用户确认。
5. 写入 localStorage 和 IndexedDB。

取消导入时不得写入任何数据。

### 导出流程

角色导出：

- Dashboard 通过“导出角色 JSON/ZIP”打开 Dialog。
- 用户选择轻量 JSON、完整 ZIP 或 CSV。
- 确认后执行。

Preview 导出：

- JSON。
- PDF。
- JPG。
- PNG。

批量导出：

- JSON。
- 完整 ZIP。
- PDF/JPG/PNG ZIP。

### 安全策略

导入导出必须遵循：

- 旧 JSON 可导入。
- ID 冲突自动生成新 ID。
- 重复素材复用。
- 写入前预览。
- 导入失败 Toast。
- 不静默失败。
- 不破坏现有角色。

## 9. UI 设计规范

Character Studio 的 UI 风格是简洁、克制、现代、工具化。

### 总体原则

- 白底 / 浅灰背景。
- 深色模式完整支持。
- 低饱和颜色。
- 圆角卡片。
- 柔和阴影。
- 清晰字体层级。
- 小幅 Hover 动效。
- 避免夸张动画。
- 避免大面积彩色渐变。
- 避免视觉噪音。

### Button

按钮类型：

- Primary。
- Secondary / Ghost。
- Danger。
- Icon Button。
- Toolbar Button。
- Floating Button。

按钮应统一高度、圆角、字体、padding、hover、active、disabled。

Danger 按钮必须克制，不要高饱和大红块。

### Card

卡片用于角色、设置分组、Preview 模块、Dialog 内容。

不要卡片套卡片。页面大区块不要全部做成浮动卡片。

### Dialog

所有 Dialog 应统一：

- Header。
- 标题。
- 关闭按钮。
- 内容间距。
- Footer 按钮。
- 取消为 secondary。
- 确认为 primary。

Dialog 内容能完整展示时不要出现滚动条，只有超出视口才允许内部滚动。

### Dropdown / Menu

菜单要求：

- 圆角。
- 阴影。
- hover 清晰。
- 不被父容器裁切。
- 小屏空间不足时用 Bottom Sheet 或 Dialog。
- 点击空白处关闭。
- Esc 关闭。
- 同时只打开一个菜单。

### Tooltip

Tooltip 应统一延迟、背景、字号、圆角和出现动画。

### Scrollbar

全局滚动条已自定义。

不要在局部组件里做突兀滚动条。

### Footer

Footer 保留：

- About Character Studio。
- 头像素材库。
- Settings。
- RINTO © 2026。

导出 PDF/JPG/PNG 时 Footer 不应出现。

### Hero

Hero 是 Dashboard 的状态与主要入口，不要塞入过多文字。

新增操作应优先进入“更多操作”或图标按钮，不要把 Hero 变成按钮墙。

## 10. 响应式规范

### Desktop

桌面端可以展示更多信息：

- Dashboard 4 列卡片。
- 完整操作按钮。
- 筛选器一行展示。
- 列表视图使用较完整字段。
- Dialog 可居中显示。

### Tablet

Tablet 介于桌面和移动端：

- Dashboard 3 列或稳定布局。
- 按钮可逐步收纳。
- 菜单宽度要防溢出。

### Mobile

移动端必须优先保证内容阅读，不要强行显示桌面端所有控件。

规则：

- 小屏可切换单列。
- 卡片按钮减少。
- 编辑入口可收入更多菜单。
- 批量工具栏不能变成多行按钮墙。
- 标签数量减少。
- 年龄等低优先级信息可隐藏。
- 菜单避免被卡片遮挡。
- Footer 居中。
- 悬浮按钮避开底部栏。
- 头像固定比例，不允许变椭圆。

移动端不是完整 App，但必须可用、可读、不遮挡。

## 11. 开发规范

这是本手册最重要的一章。

### 不要主动重构

Character Studio 是 Sprint 驱动项目，很多结构是为兼容历史数据和避免大改而形成的。不要在实现小需求时顺手重构大模块。

允许小范围整理，但必须服务当前任务。

### 不要修改稳定结构

以下模块较稳定，修改要谨慎：

- Character 类型。
- localStorage 存储。
- IndexedDB 头像素材。
- 导入导出工具。
- Preview 导出 DOM。
- AvatarDisplay。
- Theme token。

### 保持数据向后兼容

新增字段必须：

- 有默认值。
- 旧数据不崩溃。
- 导入旧 JSON 不报错。
- Preview 空字段显示“未填写”。
- 导出仍能工作。

不要删除旧字段读取兼容逻辑，例如 `isFavorite`、`birthYear`、`tags`。

### 不要新增服务器

当前阶段禁止为了方便新增后端。

不要引入：

- 数据库。
- 登录。
- 远程 API。
- 云存储。
- 图床。

除非项目明确进入 Cloud Sync Sprint。

### 不要引入复杂依赖

新增依赖必须有明确理由。

优先使用：

- 浏览器原生 API。
- 当前已有工具。
- 小型、明确用途的依赖。

不要为了一个小 UI 问题引入大型 UI 框架。

### 新功能必须考虑

任何新增功能都必须检查：

- Light / Dark。
- Mobile。
- localStorage。
- IndexedDB。
- 导入导出。
- Preview。
- PDF/JPG/PNG。
- 旧数据。
- Empty State。
- Toast。
- Dialog。
- Keyboard / Esc。

### 导出兼容优先

Preview 和导出逻辑非常脆弱。新增样式时要注意：

- html2canvas 不支持某些现代颜色函数。
- 导出区域不要使用 `oklch()`、`color()`、`lab()`。
- PDF safe 样式使用 hex / rgb / rgba。
- 不要导出按钮、Footer、导航、悬浮按钮。

### 收藏不是编辑

收藏只是 quick access 状态。不要因为收藏切换更新 `updatedAt`。否则默认最近编辑排序会让卡片跳位。

### 标签系统保持简单

当前仅保留性格标签。不要重新引入独立角色标签系统，除非未来有完整设计。

## 12. AI 协作规范

本项目大量功能由用户与 AI 协作逐 Sprint 完成。未来 AI 接手时必须遵守以下习惯。

### 一个 Sprint 只解决一个主题

不要一次实现多个大型功能。每次只围绕用户明确要求。

### 不要主动优化未要求内容

除非用户要求，否则不要顺手：

- 重构文件。
- 改目录。
- 改命名。
- 改 UI 风格。
- 改数据结构。
- 添加依赖。

### 先读上下文再改

动手前先看相关文件，不要凭空猜。

常用定位：

- Dashboard：`src/pages/Dashboard.tsx`
- Editor：`src/pages/CharacterForm.tsx`
- Preview：`src/pages/CharacterPreview.tsx`
- Avatar：`src/components/AvatarDisplay.tsx`、`src/utils/avatarAssets.ts`
- 导入导出：`src/utils/importExport.ts`
- 类型：`src/types/character.ts`
- 样式：`src/styles.css`

### 使用 apply_patch

手工编辑文件时优先使用 `apply_patch`。不要用脚本随意重写文件。

### 构建要求

除非用户明确说不要运行，否则完成代码修改后运行：

```bash
npm run build
```

如果用户明确说不要运行 npm，则不要运行。

不要启动 `npm run dev`，除非用户要求。

不要打开浏览器，除非用户要求。

### 汇报格式

完成后汇报：

- 本次修改内容。
- 修改文件。
- 是否新增依赖。
- 是否还有已知问题。

如果没跑测试或 build，必须说明。

### 遇到需求冲突

按最新用户消息执行。

例如用户说“不要修改代码，只写文档”，就只写文档，不要顺手修代码。

## 13. Roadmap

### 1.x：完善本地创作工作台

目标是把当前功能稳定到正式本地版。

可能包括：

- 更稳定的导入预览。
- 数据备份提示。
- 自动备份到本地文件。
- 更完整的素材库。
- 更稳定的移动端体验。
- 基础测试。
- 更细的错误提示。

### 2.x：关系网与时间线

角色创作天然需要关系和事件。

可加入：

- Character Relationship。
- 关系图。
- 关系类型。
- 亲密度 / 冲突 / 阵营。
- Timeline。
- 角色事件。
- 世界事件。
- 时间轴筛选。

### 3.x：World Manager

世界观管理是角色系统的自然扩展。

可加入：

- 世界观条目。
- 地点。
- 阵营。
- 组织。
- 物种。
- 魔法 / 科技规则。
- 地图。
- 世界树。

### 4.x：多版本角色

角色可能有不同版本：

- 年龄阶段。
- 平行世界。
- 剧情阶段。
- 服装版本。
- 设定修订。

可设计角色版本树，但要小心不要破坏当前 Character 主结构。

### 5.x：AI Assistant

AI 创作辅助可以包括：

- 扩写背景故事。
- 生成外貌变化。
- Prompt 优化。
- 关系建议。
- 时间线建议。
- 世界观冲突检查。

AI 必须作为可选辅助，不应替代本地编辑能力。

### 6.x：Cloud Sync

云同步是长期目标，不是当前目标。

需要考虑：

- 用户账号。
- 数据加密。
- 头像素材上传。
- 同步冲突。
- 离线编辑。
- 多设备恢复。
- 备份版本。

现有 localStorage + IndexedDB + ZIP 备份结构可以为云同步提供基础模型。

## 14. 后续建议

### 性能优化

随着角色和素材增多，Dashboard 渲染和 IndexedDB 读取可能变慢。

未来可考虑：

- 列表虚拟化。
- 头像懒加载。
- 素材缩略图缓存。
- 搜索索引。
- 导出任务进度队列。

### 测试

当前项目缺少自动化测试。

建议优先补：

- importExport 工具测试。
- avatarAssets 工具测试。
- characterStorage 测试。
- JSON / ZIP 导入导出回归测试。
- Dashboard 排序筛选测试。

### 数据安全

可考虑：

- 自动提醒用户导出备份。
- 本地定期备份。
- 导入前数据快照。
- 清空数据前二次确认增强。
- 大版本 schema migration。

### 国际化

当前项目全中文。未来可加入 i18n，但不要过早引入复杂国际化框架。

### 插件化

长期可支持插件：

- Prompt 模板。
- 世界观模板。
- 角色卡模板。
- 导出模板。
- 主题包。

但插件化需要稳定的数据结构和安全边界。

### 素材系统

Asset Library 可继续扩展：

- 多类型素材。
- 文件夹。
- 标签。
- 引用关系图。
- 未使用素材检测。
- 素材导入导出包。

### 世界树

世界树可以把角色、地点、事件、阵营、道具、关系连接起来，是未来高级功能核心。

### 主题系统

当前只有 Light / Dark / System。未来可扩展：

- 自定义主题。
- 高对比模式。
- 打印 / 导出主题。
- 色弱友好模式。

## 15. 维护说明

### 不要轻易修改的内容

以下内容属于核心稳定层：

- Character 类型兼容逻辑。
- `characterStorage.ts`。
- `avatarAssets.ts`。
- `importExport.ts` 中的备份结构。
- Preview 导出 DOM。
- `pdf-safe` 样式。
- AvatarDisplay。
- localStorage key。
- IndexedDB store 名称。

这些内容一旦改变，可能影响旧数据、导入导出、头像恢复和部署版本。

### 最稳定模块

相对稳定：

- 角色 CRUD。
- localStorage 角色存储。
- Dashboard 基础显示。
- Preview 基础展示。
- Emoji Avatar。
- Theme token。

### 仍在开发中的模块

变化较多：

- Editor 创作辅助。
- Avatar Upload / Cropper。
- Asset Library。
- Import Preview。
- 批量导出。
- 移动端菜单。
- Design System 控件。

这些模块可继续优化，但要保持兼容。

### 最容易扩展的模块

适合未来扩展：

- `components/`：拆出可复用 UI。
- `utils/importExport.ts`：增加新导出格式或迁移工具。
- `utils/avatarAssets.ts`：扩展素材类型。
- `pages/`：新增关系网、时间线、世界观页面。
- `styles.css`：继续沉淀 Design System token。

### 长期维护原则

维护 Character Studio 时，请记住：

- 它是本地优先创作工具。
- 它优先保护用户数据。
- 它不追求炫技，而追求稳定、清晰、可长期使用。
- 每次 Sprint 都应小步前进。
- 不要为了短期方便破坏导入导出和旧数据兼容。

如果未来开发者或 AI 只读一份文档，请先读这份 Developer Handbook。
