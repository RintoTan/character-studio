import { useEffect, useRef, useState, type ReactNode } from "react";
import { CharacterForm } from "./pages/CharacterForm";
import { CharacterPreview } from "./pages/CharacterPreview";
import { Dashboard } from "./pages/Dashboard";
import { AvatarDisplay } from "./components/AvatarDisplay";
import {
  APP_BUILD,
  APP_RELEASE_LABEL,
  APP_SPRINT,
  APP_VERSION,
  RELEASE_YEAR,
} from "./config/version";
import {
  applyDeveloperSettings,
  defaultDeveloperSettings,
  loadDeveloperSettings,
  saveDeveloperSettings,
  type DeveloperSettings,
} from "./config/developerSettings";
import externalInspirationLibraryRaw from "./data/external-inspiration-library.txt?raw";
import {
  deleteCharacter,
  duplicateCharacter,
  loadCharacters,
  saveCharacters,
  upsertCharacter,
} from "./storage/characterStorage";
import type { Character } from "./types/character";
import {
  clearAvatarAssets,
  cleanupUnusedAvatarAssets,
  deleteAvatarAsset,
  exportAvatarAssetsJson,
  formatAssetSize,
  getAvatarAssetStats,
  importAvatarAssetsJson,
  listAvatarAssets,
  type AvatarAssetRecord,
} from "./utils/avatarAssets";
import {
  exportAllCharactersJson,
  exportFullBackupZip,
} from "./utils/importExport";

type Page = "dashboard" | "form" | "preview" | "developer";
type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "character-studio.theme";
const ABOUT_SEEN_KEY = "character-studio.about-seen";

const developerSections = [
  {
    id: "overview",
    icon: "📊",
    title: "项目概览",
    subtitle: "Overview",
    description: "查看项目版本、主题、数据状态和核心维护链接。",
    items: ["Version", "Sprint", "Build", "Theme", "Data Version", "Prompt Library"],
  },
  {
    id: "brand",
    icon: "🎨",
    title: "品牌资源",
    subtitle: "Brand Assets",
    description: "统一管理 Logo、图标、Favicon、默认头像等品牌资产入口。",
    items: ["Logo", "Dark Logo", "Light Logo", "SVG Logo", "PNG Logo", "Favicon", "App Icon", "PWA Icon", "Emoji 默认资源"],
  },
  {
    id: "design",
    icon: "🧩",
    title: "设计系统",
    subtitle: "Design System",
    description: "沉淀 Character Studio 的 UI Token 与组件规范，暂不修改现有 UI。",
    items: ["颜色", "字体", "字号", "圆角", "边框", "阴影", "动画", "间距", "Button", "Card", "Dialog", "Input", "Tag", "Badge", "Switch", "Checkbox", "Radio"],
  },
  {
    id: "content",
    icon: "📝",
    title: "内容中心",
    subtitle: "Content",
    description: "集中管理项目文案目录，未来支持文案维护与多版本说明。",
    items: ["About", "首次 About", "Settings", "Footer", "导入说明", "导出说明", "Toast", "Dialog", "Developer Handbook", "更新日志"],
  },
  {
    id: "prompt",
    icon: "✨",
    title: "Prompt 中心",
    subtitle: "Prompt Center",
    description: "管理随机灵感、示例、写作提示和外挂词库的未来入口。",
    items: ["随机灵感", "示例", "写作提示", "Prompt 模板", "外挂词库", "Prompt Library", "未来 Prompt 编辑器", "external-inspiration-library.txt"],
  },
  {
    id: "ai",
    icon: "🤖",
    title: "AI 开发",
    subtitle: "AI Development",
    description: "开发控制页面，不属于普通用户 AI 设置；当前不接入 AI。",
    items: ["🚧 开发中", "Prompt Engine", "Provider", "Template", "Debug", "API Workflow", "Connection Flow"],
  },
  {
    id: "application",
    icon: "⚙",
    title: "应用配置",
    subtitle: "Application",
    description: "展示默认主题、语言、导出格式、预览与 Emoji 等应用级配置入口。",
    items: ["默认主题", "默认语言", "默认导出格式", "默认 JPG", "默认 PDF", "默认 Preview", "默认 Emoji"],
  },
  {
    id: "experimental",
    icon: "🧪",
    title: "实验功能",
    subtitle: "Experimental",
    description: "集中放置未来仍在验证中的功能方向。",
    items: ["开发中", "关系图", "地图", "时间线", "AI Prompt V2", "Prompt Editor"],
  },
  {
    id: "debug",
    icon: "🪲",
    title: "调试工具",
    subtitle: "Debug",
    description: "只展示当前调试入口目录，不执行危险操作。",
    items: ["localStorage", "IndexedDB", "Theme", "Export", "Import", "Build", "Version", "Route", "Log"],
  },
  {
    id: "data",
    icon: "💾",
    title: "数据管理",
    subtitle: "Data",
    description: "展示角色、头像、素材和浏览器存储概况。",
    items: ["角色数量", "头像数量", "素材数量", "IndexedDB 大小", "localStorage 大小", "Prompt Library"],
  },
  {
    id: "update",
    icon: "📦",
    title: "更新中心",
    subtitle: "Update",
    description: "整理版本、Sprint、Roadmap 与 Changelog 的维护入口。",
    items: ["Version", "Sprint", "Build", "GitHub", "Developer Handbook", "Roadmap", "Changelog"],
  },
];

type DeveloperCenterProps = {
  characters: Character[];
  avatarAssetStats: { count: number; size: number };
  themeMode: ThemeMode;
  currentPage: Page;
  onOpenAssetLibrary: () => void;
  settings: DeveloperSettings;
  onSettingsChange: (settings: DeveloperSettings) => void;
  onResetModule: (module: keyof DeveloperSettings) => void;
  onResetAll: () => void;
  onResetFirstAbout: () => void;
  onExportCharactersJson: () => void;
  onExportFullBackup: () => void;
};

const editorSettingLabels: Record<keyof DeveloperSettings["editorDefaults"], string> = {
  expandAllSections: "默认展开全部 Section",
  collapseAllSections: "默认折叠全部 Section",
  autoSave: "默认启用自动保存",
  showPromptSection: "显示 AI Prompt 区",
  showPersonalPreferences: "显示个人偏好字段",
  compactMobileEditor: "小屏紧凑模式",
};

const editorSettingDescriptions: Record<keyof DeveloperSettings["editorDefaults"], string> = {
  expandAllSections: "新进入编辑页时展开所有可折叠模块。",
  collapseAllSections: "新进入编辑页时折叠所有非基础模块。",
  autoSave: "草稿角色停止输入后自动保存。",
  showPromptSection: "控制编辑页 AI Prompt 模块是否显示。",
  showPersonalPreferences: "控制编辑页个人偏好模块是否显示。",
  compactMobileEditor: "控制移动端编辑页是否启用紧凑样式。",
};

const dashboardSettingLabels: Record<
  keyof Pick<DeveloperSettings["dashboardDefaults"], "showDraftCount" | "showFavoriteCount" | "showUpdatedTime">,
  string
> = {
  showDraftCount: "显示草稿数量",
  showFavoriteCount: "显示收藏数量",
  showUpdatedTime: "显示角色更新时间",
};

const exportSettingLabels: Record<
  keyof Pick<DeveloperSettings["exportDefaults"], "pdfLightMode" | "includeFooter" | "includePromptSection" | "includeTimeInfo">,
  string
> = {
  pdfLightMode: "PDF Light Mode",
  includeFooter: "导出 Footer",
  includePromptSection: "导出 Prompt 区",
  includeTimeInfo: "导出时间信息",
};

const featureFlagLabels: Record<keyof DeveloperSettings["featureFlags"], string> = {
  developerCenter: "Developer Center",
  aiSettings: "AI Settings",
  promptCenter: "Prompt Center",
  assetLibrary: "Asset Library",
  personalPreferences: "Personal Preferences",
  compactMobileEditor: "Compact Mobile Editor",
  experimentalTimeline: "Experimental Timeline",
  experimentalRelationshipGraph: "Experimental Relationship Graph",
};

const appliedFeatureFlags = new Set<keyof DeveloperSettings["featureFlags"]>([
  "aiSettings",
  "promptCenter",
  "assetLibrary",
  "personalPreferences",
  "compactMobileEditor",
]);

type DeveloperFieldStatus = "applied" | "comingSoon" | "readonly";

function DeveloperStatusBadge({ status }: { status: DeveloperFieldStatus }) {
  const labelMap: Record<DeveloperFieldStatus, string> = {
    applied: "已应用",
    comingSoon: "暂未应用",
    readonly: "只读",
  };

  return <span className={`developer-status-badge ${status}`}>{labelMap[status]}</span>;
}

function ComingSoonNote() {
  return <span className="developer-coming-soon">Coming Soon · 当前仅展示，暂未应用</span>;
}

function getLocalStorageFootprint() {
  let total = 0;

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    total += key.length + (localStorage.getItem(key)?.length || 0);
  }

  return total;
}

function getSafeStorageStatus() {
  try {
    const key = "__character_studio_storage_check__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return "可用";
  } catch {
    return "不可用";
  }
}

function getSettingLabel(key: string, fallback: string) {
  return localStorage.getItem(key) || fallback;
}

function getSettingBooleanLabel(key: string, fallback: boolean) {
  const storedValue = localStorage.getItem(key);
  const value = storedValue === null ? fallback : storedValue === "true";
  return value ? "开启" : "关闭";
}

function getPromptLibraryStats() {
  const lines = externalInspirationLibraryRaw
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  const size = new Blob([externalInspirationLibraryRaw]).size;

  return { lines, size };
}

function DeveloperField({
  title,
  description,
  children,
  status = "applied",
}: {
  title: string;
  description: string;
  children: ReactNode;
  status?: DeveloperFieldStatus;
}) {
  return (
    <label className={status === "comingSoon" ? "developer-setting-field coming-soon" : "developer-setting-field"}>
      <span className="developer-setting-copy">
        <span className="developer-setting-title">
          <strong>{title}</strong>
          <DeveloperStatusBadge status={status} />
        </span>
        <small>{description}</small>
        {status === "comingSoon" && <ComingSoonNote />}
      </span>
      <span className="developer-setting-control">{children}</span>
    </label>
  );
}

function DeveloperSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={checked ? "developer-switch active" : "developer-switch"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span />
    </button>
  );
}

function DeveloperCenter({
  characters,
  avatarAssetStats,
  themeMode,
  currentPage,
  onOpenAssetLibrary,
  settings,
  onSettingsChange,
  onResetModule,
  onResetAll,
  onResetFirstAbout,
  onExportCharactersJson,
  onExportFullBackup,
}: DeveloperCenterProps) {
  const formalCharacters = characters.filter((character) => !character.isDraft).length;
  const draftCharacters = characters.filter((character) => character.isDraft).length;
  const favoriteCharacters = characters.filter((character) => character.favorite || character.isFavorite).length;
  const usedAvatarAssetIds = new Set(
    characters
      .map((character) => character.avatarAssetId)
      .filter((id): id is string => Boolean(id)),
  );
  const avatarBindings = usedAvatarAssetIds.size;
  const unboundAvatarAssets = Math.max(avatarAssetStats.count - avatarBindings, 0);
  const localStorageSize = getLocalStorageFootprint();
  const promptStats = getPromptLibraryStats();
  const indexedDbStatus = typeof indexedDB === "undefined" ? "不可用" : "可用";
  function updateDeveloperModule<T extends keyof DeveloperSettings>(
    module: T,
    value: Partial<DeveloperSettings[T]>,
  ) {
    onSettingsChange({
      ...settings,
      [module]: {
        ...settings[module],
        ...value,
      },
    });
  }

  const appConfig = [
    ["默认主题", themeMode],
    ["默认视图", settings.dashboardDefaults.viewMode],
    ["JPG 导出质量", String(settings.exportDefaults.jpgQuality)],
    ["PDF Light Mode", settings.exportDefaults.pdfLightMode ? "开启" : "关闭"],
    ["小屏简洁模式", settings.editorDefaults.compactMobileEditor ? "开启" : "关闭"],
    ["默认展开搜索", getSettingBooleanLabel("character-studio.settings.open-search", false)],
    ["自动隐藏低优先级信息", getSettingBooleanLabel("character-studio.settings.hide-low-priority", true)],
  ];
  const designComponents = [
    ["Primary Button", "主要按钮", <button className="primary-button" type="button">保存</button>, "用于主要确认与提交。"],
    ["Secondary Button", "次级按钮", <button className="ghost-button" type="button">取消</button>, "用于辅助操作。"],
    ["Card", "卡片", <div className="developer-mini-card">Card Preview</div>, "承载分组信息。"],
    ["Dialog", "弹窗", <div className="developer-mini-dialog">Dialog</div>, "用于确认、预览和设置。"],
    ["Input", "输入框", <input readOnly value="Character Studio" />, "用于文本录入。"],
    ["Select", "选择器", <select defaultValue="light"><option value="light">Light</option></select>, "用于有限选项选择。"],
    ["Tag", "标签", <span className="tag-button selected">冷静</span>, "用于性格标签。"],
    ["Badge", "徽章", <span className="status-badge">Active</span>, "用于状态信息。"],
    ["Switch", "开关", <span className="switch-control active" aria-hidden="true"><span /></span>, "用于开关型设置。"],
    ["Checkbox", "复选", <span className="checkbox-control checked" aria-hidden="true">✓</span>, "用于多选与确认。"],
    ["Radio", "单选", <span className="radio-control checked" aria-hidden="true"><span /></span>, "用于导入导出方式选择。"],
  ];
  const contentCards = [
    ["About", "项目介绍、功能说明、路线图与版权信息。"],
    ["首次 About", "首次进入时的轻量欢迎页与上手说明。"],
    ["Settings", "普通用户设置、AI 设置、导入导出与数据说明。"],
    ["Footer", "About、头像素材库、Settings 与版权入口。"],
    ["导入说明", "解释 JSON、ZIP、头像素材与导入确认流程。"],
    ["导出说明", "解释轻量 JSON、完整备份 ZIP、CSV 与展示导出。"],
    ["Toast", "成功、失败、警告、加载等即时反馈。"],
    ["Dialog", "确认、导入预览、素材库、设置等弹窗文案。"],
  ];
  const experiments = [
    ["关系网", "Planned"],
    ["时间线", "Planned"],
    ["世界观管理", "Planned"],
    ["阵营系统", "Planned"],
    ["地图", "Planned"],
    ["大世界时间", "Planned"],
    ["AI 创作辅助", "In Progress"],
    ["Prompt 编辑器", "Coming Soon"],
    ["词库编辑器", "Coming Soon"],
  ];

  return (
    <section className="developer-page">
      <div className="panel developer-hero">
        <div>
          <p className="eyebrow">Developer Center</p>
          <h1>开发者中心</h1>
          <p className="muted">Character Studio 项目开发控制中心</p>
        </div>
        <div className="developer-hero-badges">
          {settings.application.showVersion && <span className="status-badge">Version {APP_VERSION}</span>}
          {settings.application.showSprint && <span className="status-badge">Sprint {APP_SPRINT}</span>}
          {settings.application.showBuild && <span className="status-badge">Build {APP_BUILD}</span>}
          <span className="status-badge">Theme：{themeMode}</span>
          <span className="status-badge">数据版本：Local v1</span>
          <span className="status-badge">Prompt Library：external-inspiration-library.txt</span>
          <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">GitHub</a>
          <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">Developer Handbook</a>
        </div>
      </div>

      <div className="developer-layout">
        <aside className="developer-nav" aria-label="Developer Center 导航">
          {developerSections.map((section) => (
            <a href={`#developer-${section.id}`} key={section.id}>
              <span aria-hidden="true">{section.icon}</span>
              <strong>{section.title}</strong>
              <small>{section.subtitle}</small>
            </a>
          ))}
        </aside>

        <div className="developer-content">
          <article className="developer-card overview-card" id="developer-overview">
            <div className="developer-card-title">
              <span aria-hidden="true">📊</span>
              <div>
                <h2>项目概览</h2>
                <p>Overview</p>
              </div>
            </div>
            <svg className="developer-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
              <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
              <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
            </svg>
            <div className="developer-stat-grid">
              <span><strong>Version</strong>{APP_VERSION}</span>
              <span><strong>Sprint</strong>{APP_SPRINT}</span>
              <span><strong>Build</strong>{APP_BUILD}</span>
              <span><strong>当前主题</strong>{themeMode}</span>
              <span><strong>数据版本</strong>Local v1</span>
              <span><strong>Prompt Library</strong>external-inspiration-library.txt</span>
              <span><strong>最后更新时间</strong>{RELEASE_YEAR}</span>
              <span><strong>角色数量</strong>{characters.length}</span>
              <span><strong>草稿数量</strong>{draftCharacters}</span>
              <span><strong>头像素材</strong>{avatarAssetStats.count}</span>
              <span><strong>localStorage</strong>{getSafeStorageStatus()} · {formatAssetSize(localStorageSize)}</span>
              <span><strong>IndexedDB</strong>{indexedDbStatus} · {formatAssetSize(avatarAssetStats.size)}</span>
            </div>
            <div className="developer-link-row">
              <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">GitHub 项目仓库</a>
              <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">Developer Handbook</a>
            </div>
            <div className="developer-actions-row">
              <button className="ghost-button" onClick={() => onResetModule("appearance")} type="button">
                恢复默认外观
              </button>
              <button className="danger-button" onClick={onResetAll} type="button">
                重置全部 Developer 设置
              </button>
            </div>
          </article>

          {developerSections.filter((section) => section.id !== "overview").map((section) => (
            <article className="developer-card" id={`developer-${section.id}`} key={section.id}>
              <div className="developer-card-title">
                <span aria-hidden="true">{section.icon}</span>
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.subtitle}</p>
                </div>
              </div>
              <p>{section.description}</p>
              {section.id === "brand" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="App Logo" description="控制页面内品牌 Logo 是否显示。">
                      <DeveloperSwitch
                        checked={settings.brandAssets.showAppLogo}
                        onChange={(showAppLogo) => updateDeveloperModule("brandAssets", { showAppLogo })}
                      />
                    </DeveloperField>
                    <DeveloperField title="Header Logo" description="控制 Header 中 Logo 的显示预留。">
                      <DeveloperSwitch
                        checked={settings.brandAssets.showHeaderLogo}
                        onChange={(showHeaderLogo) => updateDeveloperModule("brandAssets", { showHeaderLogo })}
                      />
                    </DeveloperField>
                    <DeveloperField title="About Logo Size" description="控制 About 底部 Logo 的偏好尺寸。">
                      <select
                        value={settings.brandAssets.aboutLogoSize}
                        onChange={(event) =>
                          updateDeveloperModule("brandAssets", {
                            aboutLogoSize: event.target.value as DeveloperSettings["brandAssets"]["aboutLogoSize"],
                          })
                        }
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </DeveloperField>
                  </div>
                  <div className="developer-brand-grid">
                    {["Logo Light", "Logo Dark", "Favicon", "App Icon", "SVG Logo"].map((label) => (
                      <div className="developer-brand-item" key={label}>
                        <svg aria-hidden="true" viewBox="0 0 566.43 637.56">
                          <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                          <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
                        </svg>
                        <strong>{label}</strong>
                        <small>当前项目内置资源</small>
                      </div>
                    ))}
                    <div className="developer-brand-item">
                      <span className="developer-emoji-sample">🙂</span>
                      <strong>Emoji fallback</strong>
                      <small>Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji / Twemoji Mozilla</small>
                    </div>
                  </div>
                  <div className="developer-actions-row">
                    <button
                      className="ghost-button"
                      onClick={() => navigator.clipboard?.writeText(document.querySelector("svg")?.outerHTML || "")}
                      type="button"
                    >
                      复制 SVG
                    </button>
                    <button className="ghost-button" onClick={() => onResetModule("brandAssets")} type="button">
                      恢复默认品牌设置
                    </button>
                  </div>
                </>
              )}
              {section.id === "design" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="Accent Color" description="控制主要按钮与强调色，实时应用到全站。">
                      <input
                        value={settings.appearance.accentColor}
                        onChange={(event) => updateDeveloperModule("appearance", { accentColor: event.target.value })}
                        type="color"
                      />
                    </DeveloperField>
                    <DeveloperField title="Card Radius" description="控制 Card / Dialog 圆角，实时应用。">
                      <input
                        max="18"
                        min="4"
                        onChange={(event) => updateDeveloperModule("appearance", { cardRadius: Number(event.target.value) })}
                        type="range"
                        value={settings.appearance.cardRadius}
                      />
                    </DeveloperField>
                    <DeveloperField title="Button Radius" description="控制 Button / Icon Button 圆角，实时应用。">
                      <input
                        max="18"
                        min="4"
                        onChange={(event) => updateDeveloperModule("appearance", { buttonRadius: Number(event.target.value) })}
                        type="range"
                        value={settings.appearance.buttonRadius}
                      />
                    </DeveloperField>
                    <DeveloperField title="Input Radius" description="控制 Input / Select / Textarea 圆角，实时应用。">
                      <input
                        max="18"
                        min="4"
                        onChange={(event) => updateDeveloperModule("designTokens", { inputRadius: Number(event.target.value) })}
                        type="range"
                        value={settings.designTokens.inputRadius}
                      />
                    </DeveloperField>
                    <DeveloperField title="Shadow Strength" description="控制 Card / Dialog 等全局阴影强度。">
                      <select
                        value={settings.appearance.shadowStrength}
                        onChange={(event) =>
                          updateDeveloperModule("appearance", {
                            shadowStrength: event.target.value as DeveloperSettings["appearance"]["shadowStrength"],
                          })
                        }
                      >
                        <option value="none">None</option>
                        <option value="soft">Soft</option>
                        <option value="medium">Medium</option>
                        <option value="strong">Strong</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="Motion Level" description="控制全局基础动画时长。">
                      <select
                        value={settings.appearance.motionLevel}
                        onChange={(event) =>
                          updateDeveloperModule("appearance", {
                            motionLevel: event.target.value as DeveloperSettings["appearance"]["motionLevel"],
                          })
                        }
                      >
                        <option value="none">None</option>
                        <option value="reduced">Reduced</option>
                        <option value="normal">Normal</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="Font Scale" description="控制页面整体字号缩放。">
                      <input
                        max="1.12"
                        min="0.92"
                        onChange={(event) => updateDeveloperModule("appearance", { fontScale: Number(event.target.value) })}
                        step="0.01"
                        type="range"
                        value={settings.appearance.fontScale}
                      />
                    </DeveloperField>
                    <DeveloperField title="Compact UI" description="降低卡片和设置区域间距密度。">
                      <DeveloperSwitch
                        checked={settings.appearance.compactUi}
                        onChange={(compactUi) => updateDeveloperModule("appearance", { compactUi })}
                      />
                    </DeveloperField>
                  </div>
                  <div className="developer-component-grid">
                    {designComponents.map(([englishName, chineseName, preview, description]) => (
                      <div className="developer-component-item" key={String(englishName)}>
                        <div>
                          <strong>{chineseName}</strong>
                          <small>{englishName}</small>
                        </div>
                        <div className="developer-component-preview">{preview}</div>
                        <p>{description}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        appearance: defaultDeveloperSettings.appearance,
                        designTokens: defaultDeveloperSettings.designTokens,
                      })
                    }
                    type="button"
                  >
                    恢复默认设计参数
                  </button>
                </>
              )}
              {section.id === "content" && (
                <div className="developer-readonly-grid">
                  {contentCards.map(([title, description]) => (
                    <span key={title}><strong>{title}</strong>{description}</span>
                  ))}
                </div>
              )}
              {section.id === "prompt" && !settings.featureFlags.promptCenter && (
                <div className="developer-readonly-grid">
                  <span><strong>Prompt Center</strong><ComingSoonNote /></span>
                  <span><strong>说明</strong>该模块已由 Feature Flag 暂停显示，随机系统继续使用当前已保存配置。</span>
                </div>
              )}
              {section.id === "prompt" && settings.featureFlags.promptCenter && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="启用外挂词库" description="控制随机灵感是否优先使用外部词库。">
                      <DeveloperSwitch
                        checked={settings.promptCenter.externalLibraryEnabled}
                        onChange={(externalLibraryEnabled) => updateDeveloperModule("promptCenter", { externalLibraryEnabled })}
                      />
                    </DeveloperField>
                    <DeveloperField title="随机缺失字段" description="控制随机角色生成时是否允许部分字段留白。">
                      <DeveloperSwitch
                        checked={settings.promptCenter.randomMissingFields}
                        onChange={(randomMissingFields) => updateDeveloperModule("promptCenter", { randomMissingFields })}
                      />
                    </DeveloperField>
                    <DeveloperField title="随机复杂度" description="影响随机灵感组合密度。">
                      <select
                        value={settings.promptCenter.complexity}
                        onChange={(event) =>
                          updateDeveloperModule("promptCenter", {
                            complexity: event.target.value as DeveloperSettings["promptCenter"]["complexity"],
                          })
                        }
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="重复控制" description="控制随机灵感短期重复规避强度。">
                      <select
                        value={settings.promptCenter.repeatControl}
                        onChange={(event) =>
                          updateDeveloperModule("promptCenter", {
                            repeatControl: event.target.value as DeveloperSettings["promptCenter"]["repeatControl"],
                          })
                        }
                      >
                        <option value="off">关闭</option>
                        <option value="normal">普通</option>
                        <option value="strict">严格</option>
                      </select>
                    </DeveloperField>
                  </div>
                  <div className="developer-stat-grid compact">
                    <span><strong>当前词库</strong>external-inspiration-library.txt</span>
                    <span><strong>接入状态</strong>{settings.promptCenter.externalLibraryEnabled ? "已启用" : "已停用"}</span>
                    <span><strong>用途</strong>随机灵感、示例、写作提示、随机角色生成</span>
                    <span><strong>行数</strong>{promptStats.lines}</span>
                    <span><strong>文本大小</strong>{formatAssetSize(promptStats.size)}</span>
                    <span><strong>未来能力</strong>词库编辑器、Prompt 模板、导入导出</span>
                  </div>
                  <button className="ghost-button" onClick={() => onResetModule("promptCenter")} type="button">
                    恢复默认 Prompt 设置
                  </button>
                </>
              )}
              {section.id === "ai" && !settings.featureFlags.aiSettings && (
                <div className="developer-readonly-grid">
                  <span><strong>AI Development</strong><ComingSoonNote /></span>
                  <span><strong>说明</strong>AI Settings 入口已由 Feature Flag 隐藏，当前不会调用 AI。</span>
                </div>
              )}
              {section.id === "ai" && settings.featureFlags.aiSettings && (
                <div className="developer-readonly-grid">
                  <span><strong>当前状态</strong>🚧 开发中</span>
                  <span><strong>数据安全</strong>当前不调用 AI，不发送用户数据。</span>
                  <span><strong>用户配置</strong>API Key 未来由 Settings → AI 设置填写。</span>
                  <span><strong>开发原则</strong>Developer Center 不保存用户 API Key。</span>
                  {["AI 人设生成", "AI 润色", "AI 翻译", "AI Prompt 优化", "AI 世界观生成"].map((item) => (
                    <span key={item}><strong>{item}</strong>Coming Soon</span>
                  ))}
                </div>
              )}
              {section.id === "application" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="默认页面标题" description="立即同步到浏览器标题。">
                      <input
                        value={settings.application.pageTitle}
                        onChange={(event) => updateDeveloperModule("application", { pageTitle: event.target.value })}
                      />
                    </DeveloperField>
                    <DeveloperField title="默认 Footer 文案" description="控制 App/Footer 默认显示文案。">
                      <input
                        value={settings.application.footerText}
                        onChange={(event) => updateDeveloperModule("application", { footerText: event.target.value })}
                      />
                    </DeveloperField>
                    <DeveloperField title="语言显示方式" description="未来用于全局文案展示策略，当前暂未接入。" status="comingSoon">
                      <select
                        disabled
                        value={settings.application.languageMode}
                        onChange={(event) =>
                          updateDeveloperModule("application", {
                            languageMode: event.target.value as DeveloperSettings["application"]["languageMode"],
                          })
                        }
                      >
                        <option value="zh">中文</option>
                        <option value="bilingual">中英对照</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="首次显示 About" description="控制下次新环境是否自动展示首次 About。">
                      <DeveloperSwitch
                        checked={settings.application.showFirstAbout}
                        onChange={(showFirstAbout) => updateDeveloperModule("application", { showFirstAbout })}
                      />
                    </DeveloperField>
                    {(["showVersion", "showSprint", "showBuild"] as const).map((key) => (
                      <DeveloperField key={key} title={key} description="控制版本信息显示偏好。">
                        <DeveloperSwitch
                          checked={settings.application[key]}
                          onChange={(value) => updateDeveloperModule("application", { [key]: value })}
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <div className="developer-actions-row">
                    <button className="ghost-button" onClick={onResetFirstAbout} type="button">
                      重置首次 About 显示状态
                    </button>
                    <button className="ghost-button" onClick={() => onResetModule("application")} type="button">
                      恢复默认应用配置
                    </button>
                  </div>
                  <h3 className="developer-subtitle">Editor / 编辑页默认行为</h3>
                  <div className="developer-settings-grid">
                    {(Object.entries(settings.editorDefaults) as Array<[keyof DeveloperSettings["editorDefaults"], boolean]>).map(([key, value]) => (
                      <DeveloperField key={key} title={editorSettingLabels[key]} description={editorSettingDescriptions[key]}>
                        <DeveloperSwitch
                          checked={Boolean(value)}
                          onChange={(nextValue) =>
                            updateDeveloperModule("editorDefaults", {
                              [key]: nextValue,
                            } as Partial<DeveloperSettings["editorDefaults"]>)
                          }
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <h3 className="developer-subtitle">Dashboard / 主页默认行为</h3>
                  <div className="developer-settings-grid">
                    <DeveloperField title="默认视图" description="卡片 / 列表，写入现有 Dashboard 偏好。">
                      <select
                        value={settings.dashboardDefaults.viewMode}
                        onChange={(event) =>
                          updateDeveloperModule("dashboardDefaults", {
                            viewMode: event.target.value as DeveloperSettings["dashboardDefaults"]["viewMode"],
                          })
                        }
                      >
                        <option value="cards">卡片</option>
                        <option value="list">列表</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="默认排序" description="写入现有 Dashboard 偏好。">
                      <select
                        value={settings.dashboardDefaults.sortMode}
                        onChange={(event) =>
                          updateDeveloperModule("dashboardDefaults", {
                            sortMode: event.target.value as DeveloperSettings["dashboardDefaults"]["sortMode"],
                          })
                        }
                      >
                        <option value="updated-desc">最近编辑</option>
                        <option value="created-desc">最近创建</option>
                        <option value="name-asc">名称 A-Z</option>
                        <option value="name-desc">名称 Z-A</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="卡片标签数量" description="控制 Dashboard 卡片最多展示多少个性格标签。">
                      <input
                        max="8"
                        min="0"
                        onChange={(event) => updateDeveloperModule("dashboardDefaults", { cardTagCount: Number(event.target.value) })}
                        type="number"
                        value={settings.dashboardDefaults.cardTagCount}
                      />
                    </DeveloperField>
                    {(["showDraftCount", "showFavoriteCount", "showUpdatedTime"] as const).map((key) => (
                      <DeveloperField key={key} title={dashboardSettingLabels[key]} description="Dashboard 信息显示偏好，实时应用。">
                        <DeveloperSwitch
                          checked={settings.dashboardDefaults[key]}
                          onChange={(value) => updateDeveloperModule("dashboardDefaults", { [key]: value })}
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <h3 className="developer-subtitle">Export / 导出默认值</h3>
                  <div className="developer-settings-grid">
                    <DeveloperField title="JPG 默认质量" description="同步到现有 JPG 导出设置。">
                      <input
                        max="1"
                        min="0.1"
                        onChange={(event) => updateDeveloperModule("exportDefaults", { jpgQuality: Number(event.target.value) })}
                        step="0.1"
                        type="number"
                        value={settings.exportDefaults.jpgQuality}
                      />
                    </DeveloperField>
                    <DeveloperField title="PNG 导出倍率" description="控制 Preview 图片与 PDF 截图倍率，实时应用。" status="applied">
                      <input
                        max="4"
                        min="1"
                        onChange={(event) => updateDeveloperModule("exportDefaults", { pngScale: Number(event.target.value) })}
                        step="1"
                        type="number"
                        value={settings.exportDefaults.pngScale}
                      />
                    </DeveloperField>
                    {(["pdfLightMode", "includeFooter", "includePromptSection", "includeTimeInfo"] as const).map((key) => (
                      <DeveloperField
                        key={key}
                        title={exportSettingLabels[key]}
                        description={key === "includeFooter" ? "控制 Preview 展示导出是否附加轻量 Footer。" : "展示导出偏好，Preview 导出时应用。"}
                      >
                        <DeveloperSwitch
                          checked={settings.exportDefaults[key]}
                          onChange={(value) => updateDeveloperModule("exportDefaults", { [key]: value })}
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <div className="developer-stat-grid compact">
                    {appConfig.map(([label, value]) => (
                      <span key={label}><strong>{label}</strong>{value}</span>
                    ))}
                  </div>
                </>
              )}
              {section.id === "experimental" && (
                <>
                  <div className="developer-settings-grid">
                    {(Object.entries(settings.featureFlags) as Array<[keyof DeveloperSettings["featureFlags"], boolean]>).map(([key, value]) => {
                      const isApplied = appliedFeatureFlags.has(key);
                      return (
                      <DeveloperField
                        key={key}
                        title={featureFlagLabels[key]}
                        description={isApplied ? "控制对应模块入口或状态。" : "预留实验能力，当前仅展示规划。"}
                        status={isApplied ? "applied" : "comingSoon"}
                      >
                        <DeveloperSwitch
                          checked={Boolean(value)}
                          disabled={!isApplied}
                          onChange={(nextValue) =>
                            updateDeveloperModule("featureFlags", {
                              [key]: nextValue,
                            } as Partial<DeveloperSettings["featureFlags"]>)
                          }
                        />
                      </DeveloperField>
                      );
                    })}
                  </div>
                  <div className="developer-chip-list status-list">
                    {experiments.map(([name, status]) => (
                      <span key={name}><strong>{name}</strong>{status}</span>
                    ))}
                  </div>
                  <button className="ghost-button" onClick={() => onResetModule("featureFlags")} type="button">
                    恢复默认实验功能
                  </button>
                </>
              )}
              {section.id === "debug" && (
                <>
                  <div className="developer-stat-grid compact">
                    <span><strong>localStorage</strong>{getSafeStorageStatus()}</span>
                    <span><strong>IndexedDB</strong>{indexedDbStatus}</span>
                    <span><strong>当前 Theme</strong>{themeMode}</span>
                    <span><strong>当前路由</strong>{currentPage === "developer" ? "/developer" : currentPage}</span>
                    <span><strong>数据版本</strong>Local v1</span>
                    <span><strong>角色数量</strong>{characters.length}</span>
                    <span><strong>素材数量</strong>{avatarAssetStats.count}</span>
                  </div>
                  <textarea className="developer-json-preview" readOnly value={JSON.stringify(settings, null, 2)} />
                  <button
                    className="ghost-button"
                    onClick={() => void navigator.clipboard?.writeText(JSON.stringify(settings, null, 2))}
                    type="button"
                  >
                    复制 Developer Settings JSON
                  </button>
                </>
              )}
              {section.id === "data" && (
                <div className="developer-stat-grid compact">
                  <span><strong>角色数量</strong>{characters.length}</span>
                  <span><strong>正式角色</strong>{formalCharacters}</span>
                  <span><strong>草稿数量</strong>{draftCharacters}</span>
                  <span><strong>收藏数量</strong>{favoriteCharacters}</span>
                  <span><strong>头像素材</strong>{avatarAssetStats.count}</span>
                  <span><strong>已绑定头像</strong>{avatarBindings}</span>
                  <span><strong>未绑定头像</strong>{unboundAvatarAssets}</span>
                  <span><strong>IndexedDB 估算</strong>{formatAssetSize(avatarAssetStats.size)}</span>
                  <span><strong>localStorage 估算</strong>{formatAssetSize(localStorageSize)}</span>
                  <span><strong>Prompt Library</strong>external-inspiration-library.txt</span>
                </div>
              )}
              {section.id === "data" && (
                <div className="developer-actions-row">
                  <button className="ghost-button" onClick={onOpenAssetLibrary} type="button">
                    打开头像素材库
                  </button>
                  <button className="ghost-button" onClick={onExportCharactersJson} type="button">
                    导出角色 JSON
                  </button>
                  <button className="ghost-button" onClick={onExportFullBackup} type="button">
                    导出完整备份 ZIP
                  </button>
                </div>
              )}
              {section.id === "update" && (
                <div className="developer-readonly-grid">
                  <span><strong>Version</strong>{APP_VERSION}</span>
                  <span><strong>Sprint</strong>{APP_SPRINT}</span>
                  <span><strong>Build</strong>{APP_BUILD}</span>
                  <span><strong>Roadmap</strong>关系网、时间线、世界观管理、AI 创作辅助。</span>
                  <span><strong>最近记录</strong>Sprint {APP_SPRINT}：Developer Center 功能落地。</span>
                  <span><strong>发布标签</strong>{APP_RELEASE_LABEL}</span>
                </div>
              )}
              <div className="developer-chip-list">
                {section.items.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [page, setPage] = useState<Page>(() =>
    window.location.pathname === "/developer" ? "developer" : "dashboard",
  );
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isAppAboutOpen, setIsAppAboutOpen] = useState(false);
  const [isFirstAboutOpen, setIsFirstAboutOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isAppAssetLibraryOpen, setIsAppAssetLibraryOpen] = useState(false);
  const [isAppAssetCleanupOpen, setIsAppAssetCleanupOpen] = useState(false);
  const [isAppClearDataOpen, setIsAppClearDataOpen] = useState(false);
  const [isDeveloperResetOpen, setIsDeveloperResetOpen] = useState(false);
  const [pendingAppAssetDelete, setPendingAppAssetDelete] = useState<AvatarAssetRecord | null>(null);
  const [pendingAppAssetBatchDeleteIds, setPendingAppAssetBatchDeleteIds] = useState<string[]>([]);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [selectedAppAssetIds, setSelectedAppAssetIds] = useState<string[]>([]);
  const [avatarAssetStats, setAvatarAssetStats] = useState({ count: 0, size: 0 });
  const [showQuickBackToTop, setShowQuickBackToTop] = useState(false);
  const [editorSaveSignal, setEditorSaveSignal] = useState(0);
  const [editorDraftSaveSignal, setEditorDraftSaveSignal] = useState(0);
  const [previewExportSignal, setPreviewExportSignal] = useState(0);
  const [dashboardSearchSignal, setDashboardSearchSignal] = useState(0);
  const [developerSettings, setDeveloperSettings] = useState(loadDeveloperSettings);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "system";
  });
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(
    null,
  );
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const appAssetImportInputRef = useRef<HTMLInputElement>(null);
  const isHistoryNavigationRef = useRef(false);

  useEffect(() => {
    setCharacters(loadCharacters());
    setIsLoading(false);
    if (localStorage.getItem(ABOUT_SEEN_KEY) !== "true") {
      setIsFirstAboutOpen(true);
      setIsAppAboutOpen(true);
    }
  }, []);

  useEffect(() => {
    function handleScroll() {
      setShowQuickBackToTop(
        window.scrollY > 280 &&
          document.documentElement.scrollHeight > window.innerHeight + 120,
      );
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        themeMenuRef.current &&
        !themeMenuRef.current.contains(event.target as Node)
      ) {
        setIsThemeMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsThemeMenuOpen(false);
        setIsAppAboutOpen(false);
        setIsFirstAboutOpen(false);
        setIsAppAssetLibraryOpen(false);
        setPendingAppAssetDelete(null);
        setIsAppAssetCleanupOpen(false);
        setIsAppClearDataOpen(false);
        setIsDeveloperResetOpen(false);
        setPendingAppAssetBatchDeleteIds([]);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const resolvedTheme =
        themeMode === "system"
          ? mediaQuery.matches
            ? "dark"
            : "light"
          : themeMode;

      document.documentElement.dataset.theme = resolvedTheme;
      localStorage.setItem(THEME_KEY, themeMode);
    }

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    saveDeveloperSettings(developerSettings);
    applyDeveloperSettings(developerSettings);
    localStorage.setItem("character-studio.settings.jpg-quality", String(developerSettings.exportDefaults.jpgQuality));
    localStorage.setItem("character-studio.settings.png-scale", String(developerSettings.exportDefaults.pngScale));
    localStorage.setItem("character-studio.settings.pdf-light", String(developerSettings.exportDefaults.pdfLightMode));
    localStorage.setItem("character-studio.settings.export-footer", String(developerSettings.exportDefaults.includeFooter));
    localStorage.setItem("character-studio.settings.export-prompt", String(developerSettings.exportDefaults.includePromptSection));
    localStorage.setItem("character-studio.settings.export-time", String(developerSettings.exportDefaults.includeTimeInfo));
    localStorage.setItem("character-studio.settings.compact-mobile", String(developerSettings.editorDefaults.compactMobileEditor));
    localStorage.setItem("character-studio.prompt.external-library", String(developerSettings.promptCenter.externalLibraryEnabled));
    localStorage.setItem("character-studio.prompt.random-missing-fields", String(developerSettings.promptCenter.randomMissingFields));
    localStorage.setItem("character-studio.prompt.complexity", developerSettings.promptCenter.complexity);
    localStorage.setItem("character-studio.prompt.repeat-control", developerSettings.promptCenter.repeatControl);

    if (!developerSettings.application.showFirstAbout) {
      localStorage.setItem(ABOUT_SEEN_KEY, "true");
    }

    try {
      const dashboardPrefs = JSON.parse(localStorage.getItem("character-studio.dashboard-prefs") || "{}");
      localStorage.setItem(
        "character-studio.dashboard-prefs",
        JSON.stringify({
          searchTerm: "",
          worldviewFilter: "全部",
          genderFilter: "全部",
          visualStyleFilter: "全部",
          favoriteMode: "all",
          ...dashboardPrefs,
          viewMode: developerSettings.dashboardDefaults.viewMode,
          sortMode: developerSettings.dashboardDefaults.sortMode,
        }),
      );
    } catch {
      localStorage.setItem(
        "character-studio.dashboard-prefs",
        JSON.stringify({
          searchTerm: "",
          worldviewFilter: "全部",
          genderFilter: "全部",
          visualStyleFilter: "全部",
          favoriteMode: "all",
          viewMode: developerSettings.dashboardDefaults.viewMode,
          sortMode: developerSettings.dashboardDefaults.sortMode,
        }),
      );
    }
  }, [developerSettings]);

  useEffect(() => {
    if (!isAppSettingsOpen && !isAppAssetLibraryOpen) {
      return;
    }

    void refreshAvatarAssetStats();
  }, [isAppSettingsOpen, isAppAssetLibraryOpen]);

  async function refreshAvatarAssetStats() {
    try {
      const [stats, assets] = await Promise.all([
        getAvatarAssetStats(),
        listAvatarAssets(),
      ]);

      setAvatarAssetStats(stats);
      setAvatarAssets(assets);
      setSelectedAppAssetIds((current) =>
        current.filter((id) => assets.some((asset) => asset.id === id)),
      );
    } catch {
      setAvatarAssetStats({ count: 0, size: 0 });
      setAvatarAssets([]);
      setSelectedAppAssetIds([]);
    }
  }

  async function confirmAppAssetCleanup() {
    const usedAssetIds = characters
      .map((character) => character.avatarAssetId)
      .filter((id): id is string => Boolean(id));

    await cleanupUnusedAvatarAssets(usedAssetIds);
    await refreshAvatarAssetStats();
    setIsAppAssetCleanupOpen(false);
  }

  function getAssetUsageCount(assetId: string) {
    return characters.filter((character) => character.avatarAssetId === assetId).length;
  }

  async function requestAppAssetDelete(asset: AvatarAssetRecord) {
    if (getAssetUsageCount(asset.id) > 0) {
      setPendingAppAssetDelete(asset);
      return;
    }

    await deleteAvatarAsset(asset.id);
    await refreshAvatarAssetStats();
  }

  async function confirmAppAssetDelete() {
    if (!pendingAppAssetDelete) {
      return;
    }

    await deleteAvatarAsset(pendingAppAssetDelete.id);
    const nextCharacters = characters.map((character) =>
      character.avatarAssetId === pendingAppAssetDelete.id
        ? { ...character, avatarAssetId: "", updatedAt: new Date().toISOString() }
        : character,
    );

    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    if (selectedCharacter?.avatarAssetId === pendingAppAssetDelete.id) {
      setSelectedCharacter({ ...selectedCharacter, avatarAssetId: "" });
    }
    setPendingAppAssetDelete(null);
    await refreshAvatarAssetStats();
  }

  function toggleAppAssetSelected(assetId: string) {
    setSelectedAppAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    );
  }

  function toggleAllAppAssetsSelected() {
    setSelectedAppAssetIds((current) =>
      current.length === avatarAssets.length ? [] : avatarAssets.map((asset) => asset.id),
    );
  }

  async function deleteAppAssets(assetIds: string[]) {
    await Promise.all(assetIds.map((id) => deleteAvatarAsset(id)));
    const deletedIds = new Set(assetIds);
    const nextCharacters = characters.map((character) =>
      character.avatarAssetId && deletedIds.has(character.avatarAssetId)
        ? { ...character, avatarAssetId: "", updatedAt: new Date().toISOString() }
        : character,
    );

    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    if (selectedCharacter?.avatarAssetId && deletedIds.has(selectedCharacter.avatarAssetId)) {
      setSelectedCharacter({ ...selectedCharacter, avatarAssetId: "" });
    }
    setSelectedAppAssetIds([]);
    await refreshAvatarAssetStats();
  }

  async function deleteSelectedAppUnusedAssets() {
    const unusedIds = selectedAppAssetIds.filter((id) => getAssetUsageCount(id) === 0);

    if (unusedIds.length === 0) {
      return;
    }

    await deleteAppAssets(unusedIds);
  }

  function requestSelectedAppAssetDelete() {
    if (selectedAppAssetIds.length === 0) {
      return;
    }

    if (selectedAppAssetIds.some((id) => getAssetUsageCount(id) > 0)) {
      setPendingAppAssetBatchDeleteIds(selectedAppAssetIds);
      return;
    }

    void deleteAppAssets(selectedAppAssetIds);
  }

  async function confirmAppAssetBatchDelete() {
    if (pendingAppAssetBatchDeleteIds.length === 0) {
      return;
    }

    await deleteAppAssets(pendingAppAssetBatchDeleteIds);
    setPendingAppAssetBatchDeleteIds([]);
  }

  async function clearAppLocalData() {
    localStorage.clear();
    await clearAvatarAssets();
    saveCharacters([]);
    setCharacters([]);
    setSelectedCharacter(null);
    setAvatarAssets([]);
    setAvatarAssetStats({ count: 0, size: 0 });
    setSelectedAppAssetIds([]);
    setIsAppClearDataOpen(false);
    setIsAppSettingsOpen(false);
    setPage("dashboard");
  }

  async function handleAppImportAvatarAssets(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      await importAvatarAssetsJson(file);
      await refreshAvatarAssetStats();
    } catch {
      // Dashboard has toast feedback; app-level Settings keeps the import failure non-fatal.
    } finally {
      if (appAssetImportInputRef.current) {
        appAssetImportInputRef.current.value = "";
      }
    }
  }

  function closeAppOverlays() {
    setIsThemeMenuOpen(false);
    setIsAppAboutOpen(false);
    setIsFirstAboutOpen(false);
    setIsAppSettingsOpen(false);
    setIsAppAssetLibraryOpen(false);
    setIsAppAssetCleanupOpen(false);
    setIsAppClearDataOpen(false);
    setIsDeveloperResetOpen(false);
    setPendingAppAssetDelete(null);
    setPendingAppAssetBatchDeleteIds([]);
  }

  function updateDeveloperSettings(nextSettings: DeveloperSettings) {
    setDeveloperSettings(nextSettings);
  }

  function resetDeveloperModule(module: keyof DeveloperSettings) {
    setDeveloperSettings((current) => ({
      ...current,
      [module]: defaultDeveloperSettings[module],
    }));
  }

  function confirmDeveloperSettingsReset() {
    setDeveloperSettings(defaultDeveloperSettings);
    setIsDeveloperResetOpen(false);
  }

  function resetFirstAboutState() {
    localStorage.removeItem(ABOUT_SEEN_KEY);
    setIsFirstAboutOpen(true);
    setIsAppAboutOpen(true);
  }

  function exportDeveloperCharactersJson() {
    exportAllCharactersJson(characters);
  }

  function exportDeveloperFullBackup() {
    void exportFullBackupZip(characters);
  }

  useEffect(() => {
    const initialPage = window.location.pathname === "/developer" ? "developer" : "dashboard";
    window.history.replaceState({ characterStudioPage: initialPage }, "", window.location.href);

    function handlePopState(event: PopStateEvent) {
      isHistoryNavigationRef.current = true;
      const nextPage = event.state?.characterStudioPage;
      setPage(
        nextPage === "form" || nextPage === "preview" || nextPage === "developer"
          ? nextPage
          : "dashboard",
      );
      setIsAppAboutOpen(false);
      setIsFirstAboutOpen(false);
      setIsAppSettingsOpen(false);
      setIsAppAssetLibraryOpen(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (isHistoryNavigationRef.current) {
      isHistoryNavigationRef.current = false;
      return;
    }

    window.history.pushState(
      { characterStudioPage: page },
      "",
      page === "developer" ? "/developer" : window.location.pathname === "/developer" ? "/" : window.location.href,
    );
  }, [page]);

  useEffect(() => {
    if (page !== "preview") {
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [page, selectedCharacter?.id]);

  function goBack() {
    if (window.history.state?.characterStudioPage && window.history.length > 1) {
      window.history.back();
      return;
    }

    setPage("dashboard");
  }

  function handleSave(character: Character) {
    if (character.isDraft) {
      handlePromoteDraft(character);
      return;
    }

    const savedCharacter = {
      ...character,
      isDraft: false,
      draftOfId: undefined,
    };
    setCharacters(upsertCharacter(savedCharacter));
    setSelectedCharacter(savedCharacter);
    setPage("preview");
  }

  function handleDraftSave(character: Character) {
    const sourceCharacter = selectedCharacter;
    const existingDraft =
      sourceCharacter && !sourceCharacter.isDraft
        ? characters.find((item) => item.draftOfId === sourceCharacter.id)
        : null;
    const draftCharacter = {
      ...character,
      id: sourceCharacter?.isDraft
        ? sourceCharacter.id
        : existingDraft?.id || crypto.randomUUID(),
      isDraft: true,
      draftOfId: sourceCharacter?.isDraft
        ? sourceCharacter.draftOfId
        : sourceCharacter?.id,
      createdAt: existingDraft?.createdAt || character.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCharacters(upsertCharacter(draftCharacter));
    setSelectedCharacter(draftCharacter);
    setPage("dashboard");
  }

  function handlePromoteDraft(draft: Character) {
    const now = new Date().toISOString();
    const officialCharacter: Character = {
      ...draft,
      id: draft.draftOfId || draft.id,
      isDraft: false,
      draftOfId: undefined,
      createdAt:
        characters.find((character) => character.id === draft.draftOfId)?.createdAt ||
        draft.createdAt ||
        now,
      updatedAt: now,
    };
    const nextCharacters = characters.filter(
      (character) => character.id !== draft.id && character.id !== officialCharacter.id,
    );

    saveCharacters([officialCharacter, ...nextCharacters]);
    setCharacters([officialCharacter, ...nextCharacters]);
    setSelectedCharacter(officialCharacter);
    setPage("preview");
  }

  function handleAutoSave(character: Character) {
    setCharacters(upsertCharacter(character));
    setSelectedCharacter(character);
  }

  function handleCreate() {
    closeAppOverlays();
    setSelectedCharacter(null);
    setPage("form");
  }

  function handleEdit(character: Character) {
    closeAppOverlays();
    setSelectedCharacter(character);
    setPage("form");
  }

  function handlePreview(character: Character) {
    closeAppOverlays();
    setSelectedCharacter(character);
    setPage("preview");
  }

  function handleDelete(character: Character) {
    setCharacters(deleteCharacter(character.id));

    if (selectedCharacter?.id === character.id) {
      setSelectedCharacter(null);
    }
  }

  function handleDuplicate(character: Character) {
    setCharacters(duplicateCharacter(character));
  }

  function handleToggleFavorite(character: Character) {
    const isFavorite = character.favorite ?? character.isFavorite ?? false;
    const updatedCharacter = {
      ...character,
      favorite: !isFavorite,
      isFavorite: undefined,
    };
    setCharacters(upsertCharacter(updatedCharacter));

    if (selectedCharacter?.id === character.id) {
      setSelectedCharacter(updatedCharacter);
    }
  }

  function handleBulkDelete(characterIds: string[]) {
    const nextCharacters = characters.filter(
      (character) => !characterIds.includes(character.id),
    );
    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);

    if (selectedCharacter && characterIds.includes(selectedCharacter.id)) {
      setSelectedCharacter(null);
    }
  }

  function handleBulkDuplicate(charactersToDuplicate: Character[]) {
    const copies = charactersToDuplicate.map((character) => ({
      ...character,
      id: crypto.randomUUID(),
      name: `${character.name || "未命名角色"} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const nextCharacters = [...copies, ...characters];
    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
  }

  function handleImport(nextCharacters: Character[]) {
    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    closeAppOverlays();
    setPage("dashboard");
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
    setIsThemeMenuOpen(false);
  }

  function goDashboard() {
    closeAppOverlays();
    setPage("dashboard");
  }

  const isAppOverlayOpen =
    isAppAboutOpen ||
    isAppSettingsOpen ||
    isAppAssetLibraryOpen ||
    isAppAssetCleanupOpen ||
    isAppClearDataOpen ||
    Boolean(pendingAppAssetDelete) ||
    pendingAppAssetBatchDeleteIds.length > 0;

  return (
    <main className="app-shell">
      <nav className="topbar">
        <button className="brand-button" onClick={goDashboard}>
          <svg className="brand-mark" aria-hidden="true" viewBox="0 0 566.43 637.56">
            <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
            <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
          </svg>
          Character Studio
        </button>
        <div className="nav-actions">
          <button className="ghost-button" onClick={goDashboard}>
            Dashboard
          </button>
          <div className="theme-menu-wrap" ref={themeMenuRef}>
            <div className="theme-combo" aria-label="主题控制">
              <button
                aria-label="切换浅色或深色主题"
                className="theme-combo-button theme-combo-main"
                onClick={toggleTheme}
                type="button"
              >
                ◐
              </button>
              <button
                aria-label="打开主题菜单"
                className="theme-combo-button theme-combo-arrow"
                onClick={() => setIsThemeMenuOpen((current) => !current)}
                type="button"
              >
                ▾
              </button>
            </div>
            {isThemeMenuOpen && (
              <div className="theme-menu">
                <button
                  className={themeMode === "system" ? "selected" : ""}
                  onClick={() => {
                    setThemeMode("system");
                    setIsThemeMenuOpen(false);
                  }}
                  type="button"
                >
                  跟随系统
                </button>
                <button
                  className={themeMode === "light" ? "selected" : ""}
                  onClick={() => {
                    setThemeMode("light");
                    setIsThemeMenuOpen(false);
                  }}
                  type="button"
                >
                  浅色
                </button>
                <button
                  className={themeMode === "dark" ? "selected" : ""}
                  onClick={() => {
                    setThemeMode("dark");
                    setIsThemeMenuOpen(false);
                  }}
                  type="button"
                >
                  深色
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {page === "dashboard" && (
        <Dashboard
          characters={characters}
          dashboardSettings={developerSettings.dashboardDefaults}
          aiSettingsEnabled={developerSettings.featureFlags.aiSettings}
          assetLibraryEnabled={developerSettings.featureFlags.assetLibrary}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onPreview={handlePreview}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onBulkDelete={handleBulkDelete}
          onBulkDuplicate={handleBulkDuplicate}
          onImport={handleImport}
          onPromoteDraft={handlePromoteDraft}
          onToggleFavorite={handleToggleFavorite}
          isLoading={isLoading}
          onToggleTheme={toggleTheme}
          themeMode={themeMode}
          onSetThemeMode={setThemeMode}
          searchSignal={dashboardSearchSignal}
          footerText={developerSettings.application.footerText}
        />
      )}

      {page === "form" && (
        <CharacterForm
          character={selectedCharacter}
          editorSettings={developerSettings.editorDefaults}
          featureFlags={developerSettings.featureFlags}
          onSave={handleSave}
          onDraftSave={handleDraftSave}
          onAutoSave={handleAutoSave}
          onDelete={handleDelete}
          onCancel={() => setPage("dashboard")}
          saveSignal={editorSaveSignal}
          draftSaveSignal={editorDraftSaveSignal}
        />
      )}

      {page === "preview" && selectedCharacter && (
        <CharacterPreview
          character={selectedCharacter}
          exportSettings={developerSettings.exportDefaults}
          onBack={() => setPage("dashboard")}
          onEdit={() => handleEdit(selectedCharacter)}
          onToggleFavorite={() => handleToggleFavorite(selectedCharacter)}
          exportSignal={previewExportSignal}
        />
      )}

      {page === "developer" && (
        <DeveloperCenter
          avatarAssetStats={avatarAssetStats}
          characters={characters}
          currentPage={page}
          onExportCharactersJson={exportDeveloperCharactersJson}
          onExportFullBackup={exportDeveloperFullBackup}
          onOpenAssetLibrary={() => {
            setIsAppAssetLibraryOpen(true);
            void refreshAvatarAssetStats();
          }}
          onResetAll={() => setIsDeveloperResetOpen(true)}
          onResetFirstAbout={resetFirstAboutState}
          onResetModule={resetDeveloperModule}
          onSettingsChange={updateDeveloperSettings}
          settings={developerSettings}
          themeMode={themeMode}
        />
      )}

      <div className="floating-actions" aria-label="快捷操作">
        {showQuickBackToTop && (
          <button
            aria-label="回到顶部"
            className="floating-action"
            data-tooltip="回到顶部"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            type="button"
          >
            ↑
          </button>
        )}
        {isAppOverlayOpen && (
          <button
            aria-label="返回"
            className="floating-action"
            data-tooltip="返回"
            onClick={closeAppOverlays}
            type="button"
          >
            ←
          </button>
        )}
        {isAppOverlayOpen && (
          <button
            aria-label="回到主页"
            className="floating-action"
            data-tooltip="回到主页"
            onClick={goDashboard}
            type="button"
          >
            ⌂
          </button>
        )}
        {!isAppOverlayOpen && page === "dashboard" && showQuickBackToTop && (
          <button
            aria-label="新建角色"
            className="floating-action"
            data-tooltip="新建角色"
            onClick={handleCreate}
            type="button"
          >
            +
          </button>
        )}
        {!isAppOverlayOpen && page === "dashboard" && showQuickBackToTop && (
          <button
            aria-label="搜索 / 筛选"
            className="floating-action"
            data-tooltip="搜索 / 筛选"
            onClick={() => setDashboardSearchSignal((current) => current + 1)}
            type="button"
          >
            ⌕
          </button>
        )}
        {!isAppOverlayOpen && page !== "dashboard" && (
          <button
            aria-label="回到主页"
            className="floating-action"
            data-tooltip="回到主页"
            onClick={goDashboard}
            type="button"
          >
            ⌂
          </button>
        )}
        {!isAppOverlayOpen && page === "preview" && selectedCharacter && (
          <button
            aria-label="编辑角色"
            className="floating-action"
            data-tooltip="编辑角色"
            onClick={() => handleEdit(selectedCharacter)}
            type="button"
          >
            ⌁
          </button>
        )}
        {!isAppOverlayOpen && page === "preview" && selectedCharacter && (
          <button
            aria-label="导出"
            className="floating-action"
            data-tooltip="导出"
            onClick={() => setPreviewExportSignal((current) => current + 1)}
            type="button"
          >
            ↓
          </button>
        )}
        {!isAppOverlayOpen && page === "form" && (
          <button
            aria-label="保存角色"
            className="floating-action"
            data-tooltip="保存角色"
            onClick={() => setEditorSaveSignal((current) => current + 1)}
            type="button"
          >
            ✓
          </button>
        )}
        {!isAppOverlayOpen && page === "form" && (
          <button
            aria-label="临时保存"
            className="floating-action"
            data-tooltip="临时保存"
            onClick={() => setEditorDraftSaveSignal((current) => current + 1)}
            type="button"
          >
            ◇
          </button>
        )}
      </div>

      {page !== "dashboard" && (
        <footer className="dashboard-footer app-footer" data-pdf-hidden="true">
          <button onClick={() => {
            setIsFirstAboutOpen(false);
            setIsAppAboutOpen(true);
          }} type="button">
            About Character Studio
          </button>
          {developerSettings.featureFlags.assetLibrary && (
            <button onClick={() => setIsAppAssetLibraryOpen(true)} type="button">
              头像素材库
            </button>
          )}
          <button onClick={() => setIsAppSettingsOpen((current) => !current)} type="button">
            Settings
          </button>
          <span>{developerSettings.application.footerText}</span>
        </footer>
      )}

      {isAppAboutOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsAppAboutOpen(false);
            setIsFirstAboutOpen(false);
          }
        }} role="presentation">
          <div className="about-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">About</p>
                <h2>About Character Studio</h2>
              </div>
              <button className="ghost-button" onClick={() => {
                setIsAppAboutOpen(false);
                setIsFirstAboutOpen(false);
              }} type="button">
                关闭
              </button>
            </div>
            {isFirstAboutOpen ? (
              <div className="first-about">
                <div className="first-about-hero">
                  <svg className="first-about-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
                    <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                    <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
                  </svg>
                  <h2>Character Studio</h2>
                  <p>轻量、高效、专注于原创角色创作</p>
                  <div className="about-version-row">
                    {developerSettings.application.showVersion && <span className="status-badge">Version {APP_VERSION}</span>}
                    {developerSettings.application.showSprint && <span className="status-badge">Sprint {APP_SPRINT}</span>}
                    {developerSettings.application.showBuild && <span className="status-badge">Build {APP_BUILD}</span>}
                  </div>
                </div>
                <div className="first-about-cards">
                  <article>
                    <h3>这是什么</h3>
                    <p>一个面向 OC 创作的本地优先工作台，用来整理角色资料、草稿、预览与备份。</p>
                  </article>
                  <article>
                    <h3>核心功能</h3>
                    <p>Dashboard 管理角色，Editor 编写设定，Preview 生成分享展示，并支持头像素材库。</p>
                  </article>
                  <article>
                    <h3>导入 / 导出</h3>
                    <p>支持单角色 JSON、完整备份 ZIP、CSV，以及 PDF / JPG / PNG 展示导出。</p>
                  </article>
                </div>
                <div className="first-about-links">
                  <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">
                    GitHub 项目仓库
                  </a>
                  <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">
                    Developer Handbook 开发手册
                  </a>
                </div>
                <p className="first-about-credit">RINTO × Codex 共同开发 {RELEASE_YEAR}</p>
                <label className="settings-check first-about-switch">
                  <input
                    type="checkbox"
                    onChange={(event) =>
                      localStorage.setItem(ABOUT_SEEN_KEY, String(event.target.checked))
                    }
                  />
                  <span>不再自动显示</span>
                </label>
              </div>
            ) : (
              <>
            <div className="about-grid">
              <article>
                <h3>Character Studio 是什么</h3>
                <p>一个面向 OC 创作的轻量角色工作台，用于整理角色资料、草稿、预览和备份。</p>
              </article>
              <article>
                <h3>核心功能</h3>
                <ul className="about-list">
                  <li>Dashboard、Editor、Preview、草稿箱与收藏夹。</li>
                  <li>主题切换、导入导出、PDF / JPG / PNG 输出。</li>
                </ul>
              </article>
              {isFirstAboutOpen && (
                <article>
                  <h3>当前版本</h3>
                  <div className="about-version-row">
                    {developerSettings.application.showVersion && <span className="status-badge">Version {APP_VERSION}</span>}
                    {developerSettings.application.showSprint && <span className="status-badge">Sprint {APP_SPRINT}</span>}
                    {developerSettings.application.showBuild && <span className="status-badge">Build {APP_BUILD}</span>}
                  </div>
                </article>
              )}
              {!isFirstAboutOpen && (
                <article>
                  <h3>快捷键</h3>
                  <dl className="shortcut-list">
                    <div><dt>N</dt><dd>新建角色</dd></div>
                    <div><dt>/</dt><dd>打开搜索</dd></div>
                    <div><dt>Esc</dt><dd>关闭弹层</dd></div>
                    <div><dt>⌘K / Ctrl+K</dt><dd>打开 Command Palette</dd></div>
                    <div><dt>Enter</dt><dd>打开搜索结果</dd></div>
                    <div><dt>Tab</dt><dd>切换输入焦点</dd></div>
                  </dl>
                </article>
              )}
              {!isFirstAboutOpen && (
                <article>
                  <h3>Roadmap</h3>
                  <div className="roadmap-columns">
                    <div>
                      <h4>已完成</h4>
                      <ul className="about-list">
                        <li>Dashboard</li>
                        <li>Character Editor</li>
                        <li>Character Preview</li>
                        <li>Draft Box</li>
                        <li>Favorites</li>
                        <li>Theme</li>
                        <li>JSON / CSV / PDF 导入导出</li>
                      </ul>
                    </div>
                    <div>
                      <h4>计划开发</h4>
                      <ul className="about-list">
                        <li>Character Relationship</li>
                        <li>Timeline</li>
                        <li>World Manager</li>
                        <li>AI Assistant</li>
                        <li>Cloud Sync</li>
                      </ul>
                    </div>
                  </div>
                </article>
              )}
              <article>
                <h3>导入 / 导出说明</h3>
                <ul className="about-list">
                  <li>单角色 JSON：包含角色；如有上传头像，会携带头像数据，适合分享单个角色。</li>
                  <li>角色 JSON：仅角色文字数据，不含头像，适合轻量备份。</li>
                  <li>完整备份 ZIP：包含角色、头像绑定信息与头像素材，适合跨设备迁移。</li>
                  <li>头像素材 JSON：可独立导入 / 导出素材库，不强制绑定角色。</li>
                  <li>CSV、PDF、JPG、PNG：用于查看、归档或展示，不用于重新导入。</li>
                </ul>
              </article>
              <article>
                <h3>项目信息</h3>
                <div className="project-link-grid">
                  <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">
                    <span>GitHub</span>
                    <strong>项目仓库</strong>
                  </a>
                  <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">
                    <span>Handbook</span>
                    <strong>开发手册</strong>
                  </a>
                </div>
                <p className="muted">RINTO 联合 Codex 共同开发 {RELEASE_YEAR}。</p>
              </article>
              {!isFirstAboutOpen && (
                <article>
                  <h3>鸣谢</h3>
                  <p>感谢 OpenAI Codex、React、TypeScript、Vite、jsPDF 与 html2canvas 提供支持。</p>
                </article>
              )}
              {!isFirstAboutOpen && (
                <article>
                  <h3>Changelog</h3>
                  <p>近期版本重点完善了 Avatar、头像素材库、导入导出、Design System 与移动端体验。</p>
                </article>
              )}
              {isFirstAboutOpen && (
                <article>
                  <h3>首次提示</h3>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      onChange={(event) =>
                        localStorage.setItem(ABOUT_SEEN_KEY, String(event.target.checked))
                      }
                    />
                    <span>不再自动显示</span>
                  </label>
                </article>
              )}
            </div>
            {!isFirstAboutOpen ? (
              <div className="about-brand-footer">
                <svg className="about-brand-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
                  <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                  <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
                </svg>
                <div className="about-brand-meta">
                  <h3>Character Studio</h3>
                  {developerSettings.application.showVersion && <p>Version {APP_VERSION}</p>}
                  {developerSettings.application.showSprint && <p>Sprint {APP_SPRINT}</p>}
                  <p>Released {RELEASE_YEAR}</p>
                </div>
                <p className="about-brand-tagline">轻量、高效、专注于原创角色创作。</p>
                <div className="about-brand-links">
                  <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">
                    GitHub
                  </a>
                  <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">
                    Developer Handbook
                  </a>
                </div>
                <div className="about-brand-credit">
                  <span>Designed &amp; Developed by</span>
                  <strong>RINTO × Codex</strong>
                  <span>{RELEASE_YEAR}</span>
                </div>
                <p className="about-brand-copyright">
                  © {RELEASE_YEAR} RINTO<br />
                  All Rights Reserved.
                </p>
              </div>
            ) : (
              <p className="about-footer">RINTO © {RELEASE_YEAR}</p>
            )}
              </>
            )}
          </div>
        </div>
      )}

      {isAppSettingsOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsAppSettingsOpen(false);
        }} role="presentation">
          <div className="settings-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>设置</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAppSettingsOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="settings-grid">
              <article>
                <h3>Appearance</h3>
                <div className="segmented-row">
                  {(["system", "light", "dark"] as const).map((mode) => (
                    <button
                      className={themeMode === mode ? "active" : ""}
                      key={mode}
                      onClick={() => setThemeMode(mode)}
                      type="button"
                    >
                      {mode === "system" ? "Follow System" : mode === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </article>
              {developerSettings.featureFlags.aiSettings && (
              <article className="ai-settings-card">
                <div className="settings-card-head">
                  <h3>AI 设置 / AI Settings</h3>
                  <span className="status-badge">🚧 Coming Soon</span>
                </div>
                <p className="muted">面向所有用户，开发中。当前不会调用 AI，也不会上传任何用户数据；未来可填写自己的 API Key。</p>
                <div className="settings-form-grid">
                  <label>
                    Provider
                    <select defaultValue={localStorage.getItem("character-studio.ai.provider") || "custom"} onChange={(event) => localStorage.setItem("character-studio.ai.provider", event.target.value)}>
                      <option value="custom">Custom</option>
                      <option value="openai">OpenAI Compatible</option>
                    </select>
                  </label>
                  <label>
                    API Key
                    <input type="password" placeholder="暂不需要填写" defaultValue={localStorage.getItem("character-studio.ai.api-key") || ""} onChange={(event) => localStorage.setItem("character-studio.ai.api-key", event.target.value)} />
                  </label>
                  <label>
                    Base URL
                    <input placeholder="https://api.example.com/v1" defaultValue={localStorage.getItem("character-studio.ai.base-url") || ""} onChange={(event) => localStorage.setItem("character-studio.ai.base-url", event.target.value)} />
                  </label>
                  <label>
                    Model
                    <input placeholder="model-name" defaultValue={localStorage.getItem("character-studio.ai.model") || ""} onChange={(event) => localStorage.setItem("character-studio.ai.model", event.target.value)} />
                  </label>
                  <label>
                    Temperature
                    <input type="number" min="0" max="2" step="0.1" defaultValue={localStorage.getItem("character-studio.ai.temperature") || "0.8"} onChange={(event) => localStorage.setItem("character-studio.ai.temperature", event.target.value)} />
                  </label>
                  <label>
                    Top P
                    <input type="number" min="0" max="1" step="0.05" defaultValue={localStorage.getItem("character-studio.ai.top-p") || "1"} onChange={(event) => localStorage.setItem("character-studio.ai.top-p", event.target.value)} />
                  </label>
                  <label>
                    Max Tokens
                    <input type="number" min="1" step="1" defaultValue={localStorage.getItem("character-studio.ai.max-tokens") || "1200"} onChange={(event) => localStorage.setItem("character-studio.ai.max-tokens", event.target.value)} />
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" defaultChecked={localStorage.getItem("character-studio.ai.streaming") === "true"} onChange={(event) => localStorage.setItem("character-studio.ai.streaming", String(event.target.checked))} />
                    <span>Streaming</span>
                  </label>
                </div>
                <button className="ghost-button" disabled type="button">连接测试 / Connection Test</button>
              </article>
              )}
              <article>
                <h3>About Data</h3>
                <p className="muted">当前数据保存在浏览器 localStorage。换设备不会自动同步。</p>
                <div className="settings-actions">
                  <button className="danger-button" onClick={() => setIsAppClearDataOpen(true)} type="button">
                    清空本地数据
                  </button>
                </div>
              </article>
              {developerSettings.featureFlags.assetLibrary && (
              <article>
                <h3>头像素材库</h3>
                <p className="muted">
                  本地头像素材 {avatarAssetStats.count} 个，占用约 {formatAssetSize(avatarAssetStats.size)}。轻量 JSON 不包含头像图片二进制。
                </p>
                <p className="muted">图片只保存在当前浏览器 IndexedDB，换设备不会自动同步。</p>
                <div className="settings-actions">
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setIsAppSettingsOpen(false);
                      setIsAppAssetLibraryOpen(true);
                    }}
                    type="button"
                  >
                    打开头像素材库
                  </button>
                </div>
              </article>
              )}
            </div>
          </div>
        </div>
      )}

      {isAppAssetLibraryOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsAppAssetLibraryOpen(false);
        }} role="presentation">
          <div className="settings-dialog asset-library-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">头像素材库</p>
                <h2>头像素材库</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAppAssetLibraryOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="settings-grid">
              <article>
                <h3>头像素材</h3>
                <p className="muted">
                  共 {avatarAssetStats.count} 个素材，占用约 {formatAssetSize(avatarAssetStats.size)}。素材仅保存在当前浏览器 IndexedDB。
                </p>
                <div className="settings-actions">
                  <input
                    accept="application/json,.json"
                    className="hidden-input"
                    onChange={(event) => void handleAppImportAvatarAssets(event.target.files?.[0])}
                    ref={appAssetImportInputRef}
                    type="file"
                  />
                  <button className="ghost-button" onClick={() => appAssetImportInputRef.current?.click()} type="button">
                    导入头像素材
                  </button>
                  <button className="ghost-button" onClick={() => void exportAvatarAssetsJson()} type="button">
                    导出头像素材
                  </button>
                  <button className="ghost-button" onClick={() => setIsAppAssetCleanupOpen(true)} type="button">
                    清理未使用素材
                  </button>
                </div>
              </article>
              <article>
                <h3>素材统计</h3>
                <div className="import-preview-stats">
                  <span>素材总数量：{avatarAssetStats.count}</span>
                  <span>已绑定数量：{avatarAssets.filter((asset) => getAssetUsageCount(asset.id) > 0).length}</span>
                  <span>未绑定数量：{avatarAssets.filter((asset) => getAssetUsageCount(asset.id) === 0).length}</span>
                  <span>引用角色数量：{characters.filter((character) => character.avatarAssetId).length}</span>
                  <span>总占用空间：{formatAssetSize(avatarAssetStats.size)}</span>
                </div>
              </article>
            </div>
            {avatarAssets.length > 0 ? (
              <>
                <div className="settings-asset-toolbar">
                  <button className="ghost-button" onClick={toggleAllAppAssetsSelected} type="button">
                    {selectedAppAssetIds.length === avatarAssets.length ? "取消全选" : "全选"}
                  </button>
                  <button className="ghost-button" disabled={selectedAppAssetIds.length === 0} onClick={() => void exportAvatarAssetsJson(selectedAppAssetIds)} type="button">
                    导出所选
                  </button>
                  <button className="ghost-button" disabled={selectedAppAssetIds.length === 0} onClick={() => void deleteSelectedAppUnusedAssets()} type="button">
                    删除未使用
                  </button>
                  <button className="danger-button" disabled={selectedAppAssetIds.length === 0} onClick={requestSelectedAppAssetDelete} type="button">
                    删除所选
                  </button>
                </div>
                <div className="settings-asset-list">
                  {avatarAssets.map((asset) => {
                    const usageCount = getAssetUsageCount(asset.id);

                    return (
                      <div className="settings-asset-item" key={asset.id}>
                        <label className="asset-select-check">
                          <input
                            checked={selectedAppAssetIds.includes(asset.id)}
                            onChange={() => toggleAppAssetSelected(asset.id)}
                            type="checkbox"
                          />
                          <span className="sr-only">选择素材</span>
                        </label>
                        <AvatarDisplay assetId={asset.id} className="settings-asset-thumb" emoji="🙂" />
                        <div>
                          <strong>{asset.name || "avatar"}</strong>
                          <span>
                            {(asset.mimeType || asset.blob?.type || "image").replace("image/", "").toUpperCase()} ·{" "}
                            {formatAssetSize(asset.size || asset.blob?.size || 0)}
                          </span>
                          <small>{usageCount > 0 ? `正在被 ${usageCount} 个角色使用` : "未使用 / 无主素材"}</small>
                        </div>
                        <button
                          className={usageCount > 0 ? "danger-button" : "ghost-button"}
                          onClick={() => void requestAppAssetDelete(asset)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted">暂无本地头像素材。</p>
            )}
          </div>
        </div>
      )}

      {isAppAssetCleanupOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清理头像素材</h2>
            <p>确定要清理未被任何角色使用的本地头像素材吗？正在使用的头像不会被删除。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsAppAssetCleanupOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmAppAssetCleanup} type="button">
                确认清理
              </button>
            </div>
          </div>
        </div>
      )}

      {isAppClearDataOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清空本地数据</h2>
            <p>确定要清空角色、设置和所有本地头像素材吗？此操作不可撤销。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsAppClearDataOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void clearAppLocalData()} type="button">
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeveloperResetOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>重置 Developer Center 设置</h2>
            <p>这只会恢复 Developer Center 的全局配置，不会删除角色、草稿、头像素材或导入导出数据。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsDeveloperResetOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmDeveloperSettingsReset} type="button">
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAppAssetBatchDeleteIds.length > 0 && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>批量删除头像素材</h2>
            <p>选中的素材中有正在被角色使用的头像。删除后相关角色会自动回退到 Emoji 头像。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingAppAssetBatchDeleteIds([])} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void confirmAppAssetBatchDelete()} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAppAssetDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>删除正在使用的头像素材</h2>
            <p>
              这个头像素材正在被 {getAssetUsageCount(pendingAppAssetDelete.id)} 个角色使用。
              删除后这些角色会自动回退到 Emoji 头像。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingAppAssetDelete(null)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void confirmAppAssetDelete()} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
