import {
  DEVELOPER_SETTINGS_KEY,
  defaultDeveloperSettings,
  loadDeveloperSettings,
  saveDeveloperSettings,
  type DeveloperSettings,
} from "../config/developerSettings";

export function exportDeveloperConfig() {
  return JSON.stringify(loadDeveloperSettings(), null, 2);
}

export function importDeveloperConfig(rawValue: string): DeveloperSettings {
  const nextSettings = {
    ...defaultDeveloperSettings,
    ...JSON.parse(rawValue),
  } as DeveloperSettings;

  saveDeveloperSettings(nextSettings);
  return nextSettings;
}

export function getDeveloperSettingsKey() {
  return DEVELOPER_SETTINGS_KEY;
}
