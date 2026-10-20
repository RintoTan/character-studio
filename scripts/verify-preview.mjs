#!/usr/bin/env node
/**
 * Proves the local preview works: starts it, opens every scenario in a headless
 * browser, and checks that the port got its own fixture and that the app booted.
 *
 * Each scenario is a different origin, so "the data is right" here means the seed
 * reached that origin's localStorage and the app read it back — not that a request
 * returned 200.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const preview = spawn("node", ["scripts/preview-local.mjs", "--no-build"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
preview.stdout.on("data", (chunk) => {
  output += String(chunk);
});
preview.stderr.on("data", (chunk) => {
  output += String(chunk);
});

const urls = [];
for (let i = 0; i < 120 && urls.length < 3; i += 1) {
  await sleep(250);
  const found = [...output.matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/character-studio\//g)].map((m) => m[0]);
  found.forEach((url) => {
    if (!urls.includes(url)) urls.push(url);
  });
}

if (urls.length < 3) {
  console.error("preview did not print three URLs");
  console.error(output);
  preview.kill("SIGTERM");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "cs-preview-"));
const port = 9400 + Math.floor(Math.random() * 90);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--window-size=1440,900",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank",
], { stdio: "ignore" });

let target;
for (let i = 0; i < 80 && !target; i += 1) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
  } catch {}
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (entry) {
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const val = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

  return result.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const expected = [8, 40, 100];
const failures = [];

for (const [index, url] of urls.entries()) {
  await send("Page.navigate", { url });
  let state = null;

  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    state = await val(`(()=>{const raw=localStorage.getItem("character-studio.characters");return {booted:Boolean(document.querySelector(".app-shell, .workspace-switch")),chars:raw?JSON.parse(raw).length:0,rels:(JSON.parse(localStorage.getItem("character-studio.relationships")||"[]")||[]).length,title:document.title,marker:localStorage.getItem("character-studio.preview-fixture")}})()`);
    if (state && state.booted && state.chars > 0) break;
  }

  const pass = state && state.booted && state.chars === expected[index] && state.marker === `v1-${expected[index]}`;
  console.log(`${pass ? "PASS" : "FAIL"} ${url} → ${state?.chars ?? "?"} 角色 / ${state?.rels ?? "?"} 关系（期望 ${expected[index]}）`);
  if (!pass) failures.push({ url, state });
}

ws.close();
chrome.kill();
preview.kill("SIGTERM");
await sleep(400);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // The browser may still be flushing its profile; the temp dir is disposable.
}
console.log(failures.length === 0 ? "verify:preview 通过" : `verify:preview 失败 ${failures.length} 项`);
process.exit(failures.length === 0 ? 0 : 1);
