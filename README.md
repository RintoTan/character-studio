# Character Studio

**Character Studio** 是一个面向 OC（Original Character，原创角色）创作的本地优先角色工作台。

它用于创建、编辑、管理、预览、备份和导出角色设定，适合小说、插画、跑团、乙游企划、世界观创作和 AI 绘图 Prompt 整理。

当前版本采用纯前端架构，不需要登录、不接入服务器、不上传角色数据。角色资料保存在浏览器本地，头像素材保存在 IndexedDB 中。

---

## 核心特性

### Dashboard 角色管理

- 角色卡片视图与列表视图
- 搜索角色名、职业、世界观、性格标签
- 按最近编辑、创建时间、名称排序
- 按世界观、性别、视觉风格筛选
- 收藏夹视图
- 草稿箱视图
- 置顶角色
- 批量选择、复制、删除、收藏、导出
- 删除撤销
- Empty State 与搜索无结果状态
- Light / Dark / Follow System 主题

### Character Editor 角色创作工作台

- 基础信息、外貌设定、性格设定、能力设定、背景故事、AI Prompt 分区编辑
- Emoji 头像与上传头像
- 头像裁剪、压缩、本地保存
- 从头像素材库选择头像
- 性格标签与自定义标签
- 随机生成角色
- 本地规则生成中文人物关键词
- 本地规则生成英文 AI 绘图 Prompt
- 自动保存草稿
- 临时保存
- 编辑 / 预览切换
- 创作辅助：示例、随机灵感、写作提示

### Character Preview 展示页

- 简洁角色设定展示页
- 头像、基础资料、性格标签、视觉风格、外貌、能力、背景故事、关键词、Prompt
- 复制完整角色设定
- 复制中文关键词
- 复制英文 Prompt
- 收藏切换
- 点击上传头像查看大图
- 导出 JSON / PDF / JPG / PNG

### 头像素材库

头像素材库用于管理当前浏览器中的本地头像资源。

- 浏览头像素材
- 查看素材数量与占用空间
- 查看素材是否被角色引用
- 导入头像素材 JSON
- 导出头像素材 JSON
- 多选、全选、批量删除
- 清理未使用素材
- 删除被引用素材时自动提示影响角色

图片素材不会存入 localStorage，而是存入 IndexedDB。角色数据只保存头像引用 ID。

### 导入 / 导出

Character Studio 支持多种导入导出方式：

| 类型 | 用途 | 是否包含头像图片 | 是否可重新导入 |
| --- | --- | --- | --- |
| 单角色 JSON | 分享单个角色 | 如有上传头像，会包含头像数据 | 是 |
| 角色 JSON | 轻量备份所有角色文字资料 | 否 | 是 |
| 完整备份 ZIP | 跨设备迁移角色和头像 | 是 | 是 |
| 头像素材 JSON | 独立备份头像素材库 | 是 | 是 |
| CSV | 导出文字资料用于表格查看 | 否 | 否 |
| PDF | 展示和归档 | 显示当前头像 | 否 |
| JPG / PNG | 图片分享 | 显示当前头像 | 否 |

完整备份 ZIP 包含：

```text
characters.json
manifest.json
backup-info.json
assets/avatar/*
```

导入角色时会先显示导入预览，确认后才写入本地数据。

---

## Local First

Character Studio 当前是 Local First 应用。

- 角色文字数据保存在 `localStorage`
- 上传头像和头像素材保存在 `IndexedDB`
- 不需要账号
- 不依赖服务器
- 不上传角色资料
- 可通过 JSON / ZIP 完成备份和迁移

请注意：清除浏览器缓存或站点数据可能导致本地数据丢失。建议定期导出角色 JSON 或完整备份 ZIP。

---

## 技术栈

| 技术 | 用途 |
| --- | --- |
| React | 前端 UI |
| TypeScript | 类型约束 |
| Vite | 开发与构建 |
| html2canvas | 展示页截图导出 |
| jsPDF | PDF 导出 |
| localStorage | 角色文字数据与偏好 |
| IndexedDB | 头像素材 Blob 存储 |

---

## 项目结构

```text
src/
├── App.tsx
├── main.tsx
├── styles.css
├── components/
│   └── AvatarDisplay.tsx
├── pages/
│   ├── Dashboard.tsx
│   ├── CharacterForm.tsx
│   └── CharacterPreview.tsx
├── storage/
│   └── characterStorage.ts
├── types/
│   └── character.ts
└── utils/
    ├── avatarAssets.ts
    └── importExport.ts
```

更完整的架构、历史和维护说明请阅读：

```text
Developer Handbook.md
```

---

## 安装与运行

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

本地预览生产构建：

```bash
npm run preview
```

---

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `N` | 新建角色 |
| `/` | 打开搜索 |
| `Esc` | 关闭弹窗、菜单、搜索面板 |
| `Enter` | 打开第一个搜索结果 |
| `Ctrl / Cmd + K` | 打开 Command Palette |
| `Tab` | 切换输入焦点 |

输入框、文本域和选择控件聚焦时，快捷键不会干扰正常输入。

---

## 主题与响应式

Character Studio 支持：

- Light
- Dark
- Follow System

Dashboard、Editor、Preview、Settings、About、头像素材库、Dialog、Toast、Tooltip 均适配深色模式。

移动端会自动收敛部分按钮和信息，优先保证角色卡片、菜单、导出弹窗和编辑区域可用。

---

## 当前状态

当前版本已经具备完整的本地角色创作与管理闭环：

- 角色 CRUD
- 草稿箱
- 收藏夹
- 搜索、筛选、排序
- Emoji / Image Avatar
- 本地头像素材库
- JSON / ZIP / CSV / PDF / JPG / PNG 导入导出
- Preview 展示页
- Light / Dark Theme
- 基础 Design System 控件

---

## Roadmap

未来可能扩展：

- Character Relationship：角色关系网
- Timeline：角色和世界事件时间线
- World Manager：世界观管理
- Faction / Organization：阵营与组织
- Map / Location：地图与地点
- Multi-version Character：多版本角色
- AI Assistant：AI 创作辅助
- Cloud Sync：云同步
- Plugin System：插件与模板系统

当前阶段仍以本地优先、数据安全、导入导出稳定和 UI 一致性为主。

---

## 开发文档

如果你是新的开发者或 AI 协作者，请先阅读：

```text
Developer Handbook.md
```

这份文档包含：

- 项目发展历史
- 架构说明
- 数据结构说明
- Avatar 与 Asset Library 设计
- 导入导出系统设计
- UI 规范
- 响应式规范
- 开发规范
- AI 协作规范
- Roadmap 与维护说明

---

## Credits

Designed & developed by **RINTO**.

Built with:

- React
- TypeScript
- Vite
- html2canvas
- jsPDF

---

## License

当前仓库未声明开源许可证。使用、分发或二次开发前请先确认授权方式。
