#!/usr/bin/env node
/**
 * A local, throwaway preview of the built app with three test scenarios.
 *
 * Isolation is by origin, not by hoping: localStorage is scoped to scheme + host +
 * port, so each scenario gets its own port and therefore its own storage. Nothing
 * here can reach the data the real site keeps on its own origin, and the seed only
 * writes when the scenario has no data yet (or when ?fixture=reset is asked for) —
 * it never clears a browser profile it did not fill.
 *
 * Usage:
 *   node scripts/preview-local.mjs           # build if needed, serve 8 / 40 / 100
 *   node scripts/preview-local.mjs --no-build
 *   node scripts/preview-local.mjs --scenario 40
 */
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const fixtureDir = join(root, "..", ".character-studio-fixture-100", "data");
const BASE = "/character-studio";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const args = process.argv.slice(2);
const only = args.includes("--scenario") ? Number(args[args.indexOf("--scenario") + 1]) : null;
const skipBuild = args.includes("--no-build");

if (!skipBuild) {
  console.log("building (npm run build:pages)…");
  const build = spawnSync("npm", ["run", "build:pages"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

  if (build.status !== 0) {
    console.error("build failed — nothing served.");
    process.exit(1);
  }
}

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/index.html is missing. Run `npm run build:pages` first.");
  process.exit(1);
}

const characters = JSON.parse(readFileSync(join(fixtureDir, "characters.json"), "utf8")).characters;
const relationships = JSON.parse(readFileSync(join(fixtureDir, "workspace.json"), "utf8")).relationships ?? [];

const scenarios = [
  { size: 8, label: "场景 A · 8 个角色（选择、对齐、分布、分组）" },
  { size: 40, label: "场景 B · 40 个角色（卡片、搜索、局部样式）" },
  { size: 100, label: "场景 C · CS-FIXTURE-100-V1（100 角色 / 191 关系）" },
].filter((scenario) => only === null || scenario.size === only);

const subset = (size) => {
  const chosen = characters.slice(0, size);
  const ids = new Set(chosen.map((c) => c.id));

  return { characters: chosen, relationships: relationships.filter((r) => ids.has(r.fromId) && ids.has(r.toId)) };
};

const seedScript = (size) => {
  const data = subset(size);

  return `<script>(function(){
  var KEY="character-studio.preview-fixture";
  var want="v1-${size}";
  var reset=/[?&]fixture=reset\\b/.test(location.search);
  var current=null;
  try{current=localStorage.getItem(KEY);}catch(e){}
  if(current===want&&!reset){return;}
  try{
    localStorage.setItem("character-studio.characters",${JSON.stringify(JSON.stringify(data.characters))});
    localStorage.setItem("character-studio.relationships",${JSON.stringify(JSON.stringify(data.relationships))});
    localStorage.setItem("character-studio.relationship-view","graph");
    localStorage.setItem("character-studio.about-seen","true");
    localStorage.removeItem("character-studio.relationship-layout");
    localStorage.setItem(KEY,want);
    console.log("[preview] fixture ${size} characters / ${data.relationships.length} relationships");
  }catch(e){console.warn("[preview] seed failed",e);}
})();</script>`;
};

/** The built index with the scenario's seed in front of the app's own scripts. */
const pageFor = (size) => {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const head = html.indexOf("</head>");

  return head === -1 ? html : `${html.slice(0, head)}${seedScript(size)}${html.slice(head)}`;
};

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });

const urls = [];

for (const [index, scenario] of scenarios.entries()) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname);

    if (path === "/" || path === "") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Character Studio · 本地预览</title>
<body style="font:15px/1.6 system-ui;padding:32px;max-width:720px">
<h1 style="font-size:20px">Character Studio 本地预览</h1>
<p>${scenario.label}</p>
<p><a href="${BASE}/?fixture=reset">打开画布（首次进入会重置本页的测试数据）</a></p>
<p style="color:#666">数据只存在这个端口（按 origin 隔离）。关闭终端即停止服务。</p>
</body>`);
      return;
    }

    if (path === `${BASE}/` || path === `${BASE}/index.html`) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(pageFor(scenario.size));
      return;
    }

    const rel = normalize(path.slice(BASE.length)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, rel);

    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
      return;
    }

    // History API routes fall back to the app shell.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(pageFor(scenario.size));
  });

  let port = 4820 + index * 3 + 1;
  let bound;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      bound = await listen(server, port);
      break;
    } catch {
      port += 1;
    }
  }

  if (!bound) {
    console.error(`could not bind a port for scenario ${scenario.size}`);
    process.exit(1);
  }

  urls.push({ size: scenario.size, label: scenario.label, url: `http://127.0.0.1:${bound}${BASE}/`, reset: `http://127.0.0.1:${bound}${BASE}/?fixture=reset` });
}

console.log("\nCharacter Studio 本地预览已启动（三个独立 origin，互不影响，也不影响正式站点数据）\n");
for (const entry of urls) {
  console.log(`  ${entry.label}`);
  console.log(`    ${entry.url}`);
}
console.log("\n  建议先试：点角色 → 多选 2~3 个 → 排列（左对齐 / 水平等距）→ 撤销；再试分组拖动与导出。");
console.log("  重置某个场景的数据：在对应地址后加 ?fixture=reset");
console.log("  停止：在此终端按 Ctrl+C（服务不会常驻，重启用同一条命令即可）。\n");

const stop = () => {
  console.log("\n已停止本地预览。");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
