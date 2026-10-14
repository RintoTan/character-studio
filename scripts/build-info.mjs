// Post-build step for the GitHub Pages release.
//
// 1. Writes dist/build-info.json, a machine-readable descriptor of exactly what
//    was built. Deploy verification compares it against the live site, so a
//    stale deployment becomes detectable instead of invisible.
// 2. Copies index.html to 404.html: Pages serves that file for unknown paths,
//    and the app reads its route from the URL on boot, so the shell doubles as
//    the deep-link fallback for /character-studio/developer.
// 3. Adds .nojekyll so Pages publishes the directory as-is.
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const dist = "dist";
const versionSource = readFileSync("src/config/version.ts", "utf8");

const pick = (name) => versionSource.match(new RegExp(`export const ${name} = "([^"]*)"`))?.[1] ?? "unknown";

const commit = process.env.VITE_BUILD_COMMIT || process.env.GITHUB_SHA || "local";
const builtAt = process.env.VITE_BUILD_TIME || new Date().toISOString();

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full, base)
      : [{ file: relative(base, full), bytes: statSync(full).size }];
  });
}

const files = walk(dist)
  .filter((entry) => entry.file !== "build-info.json")
  .sort((a, b) => a.file.localeCompare(b.file));

const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
const entry = indexHtml.match(/\/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
const stylesheet = indexHtml.match(/\/assets\/(index-[\w-]+\.css)/)?.[1] ?? null;

writeFileSync(
  join(dist, "build-info.json"),
  `${JSON.stringify(
    {
      app: "character-studio",
      version: pick("APP_VERSION"),
      sprint: pick("APP_SPRINT"),
      commit,
      commitShort: commit.slice(0, 7),
      builtAt,
      entry,
      stylesheet,
      files,
    },
    null,
    2,
  )}\n`,
);

copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
writeFileSync(join(dist, ".nojekyll"), "");

console.log(`build-info.json: ${commit.slice(0, 7)} @ ${builtAt}`);
console.log(`  entry      ${entry}`);
console.log(`  stylesheet ${stylesheet}`);
console.log(`  files      ${files.length}`);
