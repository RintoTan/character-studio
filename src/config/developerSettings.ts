import { defaultContent } from "../content/defaultContent";
import { APP_BUILD, APP_RELEASE_LABEL, APP_SPRINT, APP_VERSION, RELEASE_YEAR } from "./version";

export type DeveloperSettings = {
  project: {
    version: string;
    sprint: string;
    build: string;
    releaseLabel: string;
    releaseYear: string;
  };
  content: {
    aboutTitle: string;
    aboutSummary: string;
    firstAboutTagline: string;
    footerText: string;
    settingsSummary: string;
    importGuide: string;
    exportGuide: string;
    dialogCopy: string;
    toastCopy: string;
    privacy: string;
    license: string;
  };
  appearance: {
    accentColor: string;
    cardRadius: number;
    buttonRadius: number;
    shadowStrength: "none" | "soft" | "medium" | "strong";
    motionLevel: "none" | "reduced" | "normal";
    compactUi: boolean;
    fontScale: number;
  };
  // `spacingDensity` and `animationSpeed` used to sit here. Both were declared,
  // defaulted and persisted, but nothing ever read them: `motionLevel` above is
  // what actually drives the durations, and spacing was never given a control.
  // A setting that looks applied and is not is worse than no setting, so they are
  // gone rather than left for the next reader to wire up by mistake.
  designTokens: {
    inputRadius: number;
  };
  brandAssets: {
    showAppLogo: boolean;
    showHeaderLogo: boolean;
    aboutLogoSize: "small" | "medium" | "large";
  };
  editorDefaults: {
    expandAllSections: boolean;
    collapseAllSections: boolean;
    autoSave: boolean;
    showPromptSection: boolean;
    showPersonalPreferences: boolean;
    compactMobileEditor: boolean;
  };
  dashboardDefaults: {
    viewMode: "cards" | "list";
    sortMode: "updated-desc" | "created-desc" | "name-asc" | "name-desc";
    cardTagCount: number;
    showDraftCount: boolean;
    showFavoriteCount: boolean;
    showUpdatedTime: boolean;
    openSearch: boolean;
  };
  exportDefaults: {
    jpgQuality: number;
    pngScale: number;
    pdfLightMode: boolean;
    includeFooter: boolean;
    includePromptSection: boolean;
    includeTimeInfo: boolean;
  };
  promptCenter: {
    externalLibraryEnabled: boolean;
    randomMissingFields: boolean;
    complexity: "low" | "medium" | "high";
    repeatControl: "off" | "normal" | "strict";
    customLibraryText: string;
  };
  application: {
    pageTitle: string;
    footerText: string;
    languageMode: "zh" | "bilingual";
    showVersion: boolean;
    showSprint: boolean;
    showBuild: boolean;
    showFirstAbout: boolean;
  };
  featureFlags: {
    developerCenter: boolean;
    aiSettings: boolean;
    promptCenter: boolean;
    assetLibrary: boolean;
    personalPreferences: boolean;
    compactMobileEditor: boolean;
    experimentalTimeline: boolean;
    experimentalRelationshipGraph: boolean;
    worldManager: boolean;
  };
  developerMode: {
    enabled: boolean;
  };
};

export const DEVELOPER_SETTINGS_KEY = "character-studio-developer-settings";

export const defaultDeveloperSettings: DeveloperSettings = {
  project: {
    version: APP_VERSION,
    sprint: APP_SPRINT,
    build: APP_BUILD,
    releaseLabel: APP_RELEASE_LABEL,
    releaseYear: RELEASE_YEAR,
  },
  content: defaultContent,
  appearance: {
    accentColor: "#635ab2",
    cardRadius: 8,
    buttonRadius: 8,
    shadowStrength: "soft",
    motionLevel: "normal",
    compactUi: false,
    fontScale: 1,
  },
  designTokens: {
    inputRadius: 8,
  },
  brandAssets: {
    showAppLogo: true,
    showHeaderLogo: true,
    aboutLogoSize: "large",
  },
  editorDefaults: {
    expandAllSections: false,
    collapseAllSections: false,
    autoSave: true,
    showPromptSection: true,
    showPersonalPreferences: true,
    compactMobileEditor: true,
  },
  dashboardDefaults: {
    viewMode: "cards",
    sortMode: "updated-desc",
    cardTagCount: 5,
    showDraftCount: true,
    showFavoriteCount: true,
    showUpdatedTime: true,
    openSearch: false,
  },
  exportDefaults: {
    jpgQuality: 0.9,
    pngScale: 2,
    pdfLightMode: true,
    includeFooter: false,
    includePromptSection: true,
    includeTimeInfo: true,
  },
  promptCenter: {
    externalLibraryEnabled: true,
    randomMissingFields: true,
    complexity: "medium",
    repeatControl: "normal",
    customLibraryText: "",
  },
  application: {
    pageTitle: "Character Studio",
    footerText: defaultContent.footerText,
    languageMode: "zh",
    showVersion: true,
    showSprint: true,
    showBuild: true,
    showFirstAbout: true,
  },
  featureFlags: {
    developerCenter: true,
    aiSettings: true,
    promptCenter: true,
    assetLibrary: true,
    personalPreferences: true,
    compactMobileEditor: true,
    // Now gates a shipped screen rather than a plan.
    experimentalTimeline: true,
    // Now gates a shipped screen rather than a plan.
    experimentalRelationshipGraph: true,
    worldManager: true,
  },
  developerMode: {
    enabled: true,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Only declared fields survive a merge.
//
// Spreading the stored record instead let a key that no longer exists in the type
// travel through load and back out to storage on every save, forever: a retired
// design token would still be sitting in the object, indistinguishable from a
// setting that works. Anything the defaults do not declare is dropped here, once.
function pickKnown<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
  if (!isRecord(stored)) {
    return { ...defaults };
  }

  const next = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = stored[key as string];
    if (value !== undefined) {
      next[key] = value as T[keyof T];
    }
  }

  return next;
}

export function mergeDeveloperSettings(value: unknown): DeveloperSettings {
  if (!isRecord(value)) {
    return defaultDeveloperSettings;
  }

  return {
    project: pickKnown(defaultDeveloperSettings.project, value.project),
    content: pickKnown(defaultDeveloperSettings.content, value.content),
    appearance: pickKnown(defaultDeveloperSettings.appearance, value.appearance),
    designTokens: pickKnown(defaultDeveloperSettings.designTokens, value.designTokens),
    brandAssets: pickKnown(defaultDeveloperSettings.brandAssets, value.brandAssets),
    editorDefaults: pickKnown(defaultDeveloperSettings.editorDefaults, value.editorDefaults),
    dashboardDefaults: pickKnown(defaultDeveloperSettings.dashboardDefaults, value.dashboardDefaults),
    exportDefaults: pickKnown(defaultDeveloperSettings.exportDefaults, value.exportDefaults),
    promptCenter: pickKnown(defaultDeveloperSettings.promptCenter, value.promptCenter),
    application: pickKnown(defaultDeveloperSettings.application, value.application),
    featureFlags: pickKnown(defaultDeveloperSettings.featureFlags, value.featureFlags),
    developerMode: pickKnown(defaultDeveloperSettings.developerMode, value.developerMode),
  };
}

// Several settings used to be duplicated as individual localStorage keys and
// written from this object by a mirror in App.tsx, while consumers read the flat
// keys directly. The two copies could disagree, and a settings change would
// silently revert a dashboard toggle. The flat keys are now migration input
// only: they seed this object once, on the first load after the change, and are
// never written again.
function migrateLegacySettings(settings: DeveloperSettings): DeveloperSettings {
  const read = (key: string) => localStorage.getItem(key);
  const bool = (key: string, fallback: boolean) => {
    const raw = read(key);
    return raw === null ? fallback : raw === "true";
  };
  const text = <T extends string>(key: string, fallback: T): T => {
    const raw = read(key);
    return raw === null ? fallback : (raw as T);
  };
  const num = (key: string, fallback: number) => {
    const raw = read(key);
    const parsed = Number(raw);
    return raw === null || Number.isNaN(parsed) ? fallback : parsed;
  };

  return {
    ...settings,
    dashboardDefaults: {
      ...settings.dashboardDefaults,
      openSearch: bool("character-studio.settings.open-search", settings.dashboardDefaults.openSearch),
    },
    editorDefaults: {
      ...settings.editorDefaults,
      compactMobileEditor: bool("character-studio.settings.compact-mobile", settings.editorDefaults.compactMobileEditor),
    },
    exportDefaults: {
      ...settings.exportDefaults,
      jpgQuality: num("character-studio.settings.jpg-quality", settings.exportDefaults.jpgQuality),
      pngScale: num("character-studio.settings.png-scale", settings.exportDefaults.pngScale),
      pdfLightMode: bool("character-studio.settings.pdf-light", settings.exportDefaults.pdfLightMode),
      includeFooter: bool("character-studio.settings.export-footer", settings.exportDefaults.includeFooter),
      includePromptSection: bool("character-studio.settings.export-prompt", settings.exportDefaults.includePromptSection),
      includeTimeInfo: bool("character-studio.settings.export-time", settings.exportDefaults.includeTimeInfo),
    },
    promptCenter: {
      ...settings.promptCenter,
      externalLibraryEnabled: bool("character-studio.prompt.external-library", settings.promptCenter.externalLibraryEnabled),
      randomMissingFields: bool("character-studio.prompt.random-missing-fields", settings.promptCenter.randomMissingFields),
      complexity: text("character-studio.prompt.complexity", settings.promptCenter.complexity),
      repeatControl: text("character-studio.prompt.repeat-control", settings.promptCenter.repeatControl),
      customLibraryText: text("character-studio.prompt.custom-library", settings.promptCenter.customLibraryText),
    },
  };
}

// Reads one editable copy string. The Developer Center exposes these as content
// fields, so screens read them through one accessor instead of each inventing a
// localStorage lookup of its own.
export function getContentCopy<K extends keyof DeveloperSettings["content"]>(key: K): string {
  try {
    return loadDeveloperSettings().content[key] ?? "";
  } catch {
    return "";
  }
}

export function loadDeveloperSettings() {
  try {
    // Only migrate when this app has never stored the unified object, so a
    // deliberate change is never overwritten by a stale flat key.
    const stored = localStorage.getItem(DEVELOPER_SETTINGS_KEY);
    const merged = mergeDeveloperSettings(JSON.parse(stored || "null"));
    return stored ? merged : migrateLegacySettings(merged);
  } catch {
    return defaultDeveloperSettings;
  }
}

export function saveDeveloperSettings(settings: DeveloperSettings) {
  localStorage.setItem(DEVELOPER_SETTINGS_KEY, JSON.stringify(settings));
}

export function resetDeveloperSettings() {
  saveDeveloperSettings(defaultDeveloperSettings);
  return defaultDeveloperSettings;
}

// The accent colour is user-configurable, so the colour of any text sitting on
// top of it has to be derived instead of hard-coded: picking whichever of white
// or near-black actually has the better contrast keeps the primary button, the
// primary icon button and the selected tag readable for any accent.
function relativeLuminance(hex: string): number | null {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }

  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255);
  const linear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function readableTextOn(hex: string): string {
  const luminance = relativeLuminance(hex);
  if (luminance === null) {
    return "#ffffff";
  }

  const against = (other: number) =>
    (Math.max(luminance, other) + 0.05) / (Math.min(luminance, other) + 0.05);

  return against(1) >= against(relativeLuminance("#111827") as number) ? "#ffffff" : "#111827";
}

// The accent doubles as the hover colour of the same controls, so assigning the
// identical value made hover a silent no-op. Derive a visibly different shade
// while keeping white text legible on it: darken by default, lighten only when
// the accent is so dark that darkening would be imperceptible.
function hoverVariantOf(hex: string): string {
  const value = hex.trim().replace(/^#/, "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return hex;
  }

  const channels = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  const luminance = relativeLuminance(hex) ?? 0;
  const target = luminance < 0.08 ? 255 : 0;
  const weight = luminance < 0.08 ? 0.25 : 0.14;

  return `#${channels
    .map((channel) => Math.round(channel + (target - channel) * weight))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function applyDeveloperSettings(settings: DeveloperSettings) {
  const root = document.documentElement;
  const shadowMap = {
    none: ["none", "none"],
    soft: ["0 10px 28px rgba(15, 23, 42, 0.06)", "0 16px 34px rgba(15, 23, 42, 0.1)"],
    medium: ["0 12px 32px rgba(15, 23, 42, 0.1)", "0 18px 42px rgba(15, 23, 42, 0.16)"],
    strong: ["0 14px 38px rgba(15, 23, 42, 0.16)", "0 22px 54px rgba(15, 23, 42, 0.24)"],
  }[settings.appearance.shadowStrength];
  const motionMap = {
    none: ["0ms", "0ms"],
    reduced: ["90ms", "120ms"],
    normal: ["150ms", "190ms"],
  }[settings.appearance.motionLevel];

  document.title = settings.application.pageTitle || "Character Studio";
  root.style.setProperty("--primary", settings.appearance.accentColor);
  root.style.setProperty("--primary-hover", hoverVariantOf(settings.appearance.accentColor));
  root.style.setProperty("--on-primary", readableTextOn(settings.appearance.accentColor));
  root.style.setProperty("--control-radius", `${settings.designTokens.inputRadius}px`);
  root.style.setProperty("--developer-card-radius", `${settings.appearance.cardRadius}px`);
  root.style.setProperty("--developer-button-radius", `${settings.appearance.buttonRadius}px`);
  root.style.setProperty("--developer-font-scale", String(settings.appearance.fontScale));
  root.style.setProperty("--shadow", shadowMap[0]);
  root.style.setProperty("--shadow-strong", shadowMap[1]);
  root.style.setProperty("--duration-fast", motionMap[0]);
  root.style.setProperty("--duration-medium", motionMap[1]);
  root.dataset.compactUi = settings.appearance.compactUi ? "true" : "false";
  root.dataset.showAppLogo = settings.brandAssets.showAppLogo ? "true" : "false";
  root.dataset.showHeaderLogo = settings.brandAssets.showHeaderLogo ? "true" : "false";
  root.dataset.aboutLogoSize = settings.brandAssets.aboutLogoSize;
  root.dataset.compactMobileEditor =
    settings.editorDefaults.compactMobileEditor && settings.featureFlags.compactMobileEditor
      ? "true"
      : "false";
}
