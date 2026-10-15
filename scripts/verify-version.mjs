#!/usr/bin/env node
// src/config/version.ts is what the app displays and what the build stamps into
// build-info.json; package.json carries the package version. They are two copies of
// one fact, and two copies drift - this repo reported 1.0.0 in one and 2.27.0 in the
// other for several versions (KI-07). This makes the drift fail on its own instead of
// depending on somebody noticing. It reads two files and compares two strings: no
// dependency, no build step, nothing else in the pipeline depends on it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readAppVersion(source) {
  return source.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

export function compareVersions(appVersion, packageVersion) {
  if (!appVersion) {
    return { ok: false, reason: "src/config/version.ts 里找不到 APP_VERSION" };
  }
  if (!packageVersion) {
    return { ok: false, reason: "package.json 里找不到 version" };
  }
  if (appVersion !== packageVersion) {
    return {
      ok: false,
      reason: `APP_VERSION 是 ${appVersion}，package.json 的 version 是 ${packageVersion}`,
    };
  }
  return { ok: true, reason: appVersion };
}

export function checkVersions() {
  const appSource = readFileSync(join(root, "src", "config", "version.ts"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return compareVersions(readAppVersion(appSource), manifest.version);
}

// Only when run as a command; importing this file must not exit the process.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = checkVersions();

  if (result.ok) {
    console.log(`verify:version OK —— ${result.reason}`);
  } else {
    console.error(`verify:version 失败 —— ${result.reason}`);
    console.error("两处版本号必须一致：改一个就要改另一个。");
    process.exit(1);
  }
}
