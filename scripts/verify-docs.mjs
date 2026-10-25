// Document consistency, kept deliberately small: this checks the things that quietly rot
// (a renamed image, a moved file, a version that drifted) and nothing that needs taste.
// Wording and whether a screenshot still looks current are for a human to judge.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const problems = [];
const notes = [];

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Markdown files that count as current documentation (history lives in docs/audit). */
const DOCS = ["README.md", "CHANGELOG.md", "Developer Handbook.md"];
const DOC_DIR = join(ROOT, "docs");
for (const name of readdirSync(DOC_DIR)) {
  if (name.endsWith(".md")) DOCS.push(join("docs", name));
}

const stripCode = (text) => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

// ---- 1. images referenced by README exist and are real screenshots -------------------
const readme = read("README.md");
// Markdown images plus the raw <img src> form, which is how a screenshot gets a width.
const images = [
  ...[...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
  ...[...readme.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
];
for (const src of images) {
  if (/^https?:/.test(src)) continue; // badges live on someone else's server
  const path = join(ROOT, decodeURIComponent(src));
  if (!existsSync(path)) problems.push(`README 图片不存在：${src}`);
  else if (statSync(path).size < 20_000) notes.push(`README 图片偏小（可能不是完整截图）：${src} ${statSync(path).size}B`);
}
if (images.length < 5) problems.push(`README 只引用了 ${images.length} 张截图，不足以展示四个模块`);

// Old-suite screenshots must not be referenced any more: the UI changed.
const stale = images.filter((src) => /screenshots\/[^/]+\.png$/.test(src));
if (stale.length) problems.push(`README 仍引用旧版截图：${stale.join(", ")}`);

// ---- 2. relative links in every current doc resolve to a file -----------------------
for (const doc of DOCS) {
  const text = stripCode(read(doc));
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [pathPart] = target.split("#");
    if (!pathPart) continue;
    const resolved = resolve(ROOT, dirname(doc), decodeURIComponent(pathPart));
    if (!existsSync(resolved)) problems.push(`${doc} 链接失效：${target}`);
  }
}

// ---- 3. anchors used inside README resolve to a heading -----------------------------
const headings = new Set(
  readme
    .split("\n")
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.replace(/^#{1,6} /, "").trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5 -]/g, "").replace(/ /g, "-")),
);
for (const match of readme.matchAll(/\]\(#([^)\s]+)\)/g)) {
  if (!headings.has(decodeURIComponent(match[1]).toLowerCase())) problems.push(`README 锚点不存在：#${match[1]}`);
}

// ---- 4. one version everywhere ------------------------------------------------------
const pkg = JSON.parse(read("package.json"));
const versionTs = /APP_VERSION = "([^"]+)"/.exec(read("src/config/version.ts"))?.[1];
if (pkg.version !== versionTs) problems.push(`版本不一致：package.json ${pkg.version} / version.ts ${versionTs}`);
const changelogTop = /^## ([0-9][^\s]*)/.exec(read("CHANGELOG.md"))?.[1];
if (changelogTop !== pkg.version) problems.push(`CHANGELOG 顶部版本 ${changelogTop} 与 package.json ${pkg.version} 不一致`);
if (!new RegExp(`v?${pkg.version.replace(/\./g, "\\.")}`).test(readme)) problems.push(`README 未提到当前版本 ${pkg.version}`);

// ---- 5. every command the README tells people to run exists --------------------------
const scripts = pkg.scripts ?? {};
const PNPM_BUILTIN = new Set(["install", "add", "run", "dlx"]);
for (const match of readme.matchAll(/pnpm ([a-z:]+)/g)) {
  if (!scripts[match[1]] && !PNPM_BUILTIN.has(match[1])) problems.push(`README 写的命令不存在：pnpm ${match[1]}`);
}
for (const match of readme.matchAll(/`(npm run [a-z:]+)`/g)) {
  const name = match[1].replace("npm run ", "");
  if (!scripts[name]) problems.push(`README 写的命令不存在：npm run ${name}`);
}

// ---- 6. the stack table matches the real dependencies ------------------------------
for (const dep of ["@mantine/core", "@mantine/hooks", "react", "vite", "typescript", "jspdf", "html2canvas"]) {
  if (!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep]) problems.push(`README 提到但未安装：${dep}`);
}
if (!/Mantine/.test(readme) || !pkg.dependencies["@mantine/core"]) problems.push("README 未说明 Mantine，或依赖缺失");

// ---- 7. retired / unimplemented features must not read as shipped ------------------
const RETIRED = ["云同步", "多语言适配"];
for (const phrase of RETIRED) {
  const line = readme.split("\n").find((entry) => entry.includes(phrase));
  if (line && !/(不在|未|没有|暂无)/.test(line)) problems.push(`README 把「${phrase}」写得像已实现：${line.trim().slice(0, 40)}`);
}

console.log(`文档 ${DOCS.length} 份 · README 截图 ${images.length} 张 · 版本 ${pkg.version}`);
if (notes.length) console.log(notes.map((note) => `  · ${note}`).join("\n"));
if (problems.length) {
  console.log(`\n${problems.length} 个问题：`);
  console.log(problems.map((problem) => `  ✗ ${problem}`).join("\n"));
  process.exit(1);
}
console.log("文档一致性检查通过");
