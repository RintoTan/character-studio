// Proves that the published site is the build sitting in dist/.
//
// Usage: node scripts/verify-deploy.mjs [url]
//
// Fails (exit 1) when the live entry chunk, stylesheet or commit stamp differ
// from the local build. That is the check whose absence let the site sit at
// "Sprint 7.93" unnoticed.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Resolve the build output relative to the repository, not the caller's cwd, so
// the script behaves the same from `npm run verify:deploy` and from anywhere else.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const url = (process.argv[2] || "https://rintotan.github.io/character-studio/").replace(/\/?$/, "/");
const local = JSON.parse(readFileSync("dist/build-info.json", "utf8"));
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const problems = [];
const ok = (label, detail) => console.log(`  PASS  ${label.padEnd(22)} ${detail}`);
const bad = (label, detail) => {
  problems.push(`${label}: ${detail}`);
  console.log(`  FAIL  ${label.padEnd(22)} ${detail}`);
};

async function get(path) {
  const res = await fetch(new URL(path, url), { cache: "no-store" });
  return { status: res.status, body: await res.text() };
}

console.log(`live:  ${url}`);
console.log(`local: ${local.commitShort} (${local.commit.slice(0, 7) === head.slice(0, 7) ? "matches HEAD" : "differs from HEAD"})\n`);

const page = await get("index.html");
page.status === 200 ? ok("index.html", `${page.status}, ${page.body.length} bytes`) : bad("index.html", `HTTP ${page.status}`);

const liveEntry = page.body.match(/\/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
const liveCss = page.body.match(/\/assets\/(index-[\w-]+\.css)/)?.[1] ?? null;

liveEntry === local.entry ? ok("entry chunk", liveEntry ?? "not found") : bad("entry chunk", `live=${liveEntry} local=${local.entry}`);
liveCss === local.stylesheet
  ? ok("stylesheet", liveCss ?? "not found")
  : bad("stylesheet", `live=${liveCss} local=${local.stylesheet}`);

let info = null;
try {
  const res = await get("build-info.json");
  if (res.status === 200) info = JSON.parse(res.body);
} catch {
  info = null;
}

if (!info) {
  bad("build-info.json", "missing or unreadable on the live site");
} else {
  info.commit === local.commit
    ? ok("commit stamp", `${info.commitShort} @ ${info.builtAt}`)
    : bad("commit stamp", `live=${info.commitShort} local=${local.commitShort}`);

  const liveSizes = new Map(info.files.map((f) => [f.file, f.bytes]));
  const mismatched = local.files.filter((f) => liveSizes.get(f.file) !== f.bytes);
  mismatched.length === 0
    ? ok("file bytes", `${local.files.length} files identical`)
    : bad("file bytes", mismatched.map((f) => `${f.file} live=${liveSizes.get(f.file)} local=${f.bytes}`).join(", "));

  const missing = local.files.filter((f) => !liveSizes.has(f.file)).map((f) => f.file);
  if (missing.length) bad("missing files", missing.join(", "));
}

// Deep-link fallback: an unknown subpath must still return the app shell.
const deep = await get("developer");
// A 404 page can contain the app's markup and still mean the fallback is missing.
// The status is part of "returns the shell", not a detail beside it — without this an
// unpublished route passed the check that exists to catch exactly that.
const looksLikeShell =
  deep.status === 200 && deep.body.includes("/assets/") && deep.body.includes('id="root"');
looksLikeShell
  ? ok("deep link fallback", `/developer returns shell (HTTP ${deep.status})`)
  : bad("deep link fallback", `/developer did not return the app shell (HTTP ${deep.status})`);

console.log(problems.length ? `\n${problems.length} problem(s) found` : "\nDeployment matches the local build.");
process.exit(problems.length ? 1 : 0);
