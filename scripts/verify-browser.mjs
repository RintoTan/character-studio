#!/usr/bin/env node
// Browser regression checks for behaviour that unit tests cannot reach: what the Back
// button actually restores, and what the app does when the automatic snapshot cannot
// be written because storage is full.
//
// Why this lives in the repository: the earlier probes were run from a scratch
// directory outside it, so they were neither reviewable nor reproducible, and the
// only CI-level cover for KI-15 was a structural guard that reads the source.
//
// It serves dist/ under the /character-studio/ subpath (the real deployment shape),
// drives it through CDP in a throwaway Chrome profile, and exits non-zero if any
// check fails. It needs a local Chrome and a prior build:
//
//   npm run build:pages
//   npm run verify:browser
//
// CHROME_PATH overrides the browser, CHROME_BIN works too. It is not part of CI:
// the workflow has no browser step, and adding one is a separate decision.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { assignShards, buildPlan, collectChecks, describe } from "./lib/verify-plan.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(root, "dist");

// ---- sharding -------------------------------------------------------------------
//
// One run outgrew the platform's 900s cap, and a killed run cannot say which checks it
// never reached. `--shard=2/3` runs a third of them, writes a result file, and exits;
// `--list` prints the plan (id, name, shard) without starting a browser.
const argOf = (name) => {
  const hit = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const plan = (() => {
  const weights = JSON.parse(readFileSync(join(root, "scripts/lib/check-weights.json"), "utf8"));
  const checks = collectChecks(readFileSync(fileURLToPath(import.meta.url), "utf8"));
  const built = buildPlan(checks, weights);
  const shardArg = argOf("shard");
  if (!shardArg) {
    return { entries: built.map((entry) => ({ ...entry, shard: 0 })), shardIndex: 0, shardTotal: 0 };
  }
  const [indexText, totalText] = shardArg.split("/");
  const shardTotal = Number(totalText);
  const shardIndex = Number(indexText);
  if (!Number.isInteger(shardTotal) || !Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > shardTotal) {
    console.error(`--shard 需要 i/n 且 1 ≤ i ≤ n，收到：${shardArg}`);
    process.exit(2);
  }
  return { entries: assignShards(built, shardTotal), shardIndex, shardTotal };
})();
const BASE_PATH = "/character-studio";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    console.error("找不到 Chrome。用 CHROME_PATH=/path/to/chrome 指定。");
    process.exit(2);
  }
  return found;
}

// Serves dist at /character-studio/, with the SPA fallback the deployment relies on
// so that /character-studio/developer reaches the app instead of a 404.
function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith(BASE_PATH)) {
      response.writeHead(404).end("outside base path");
      return;
    }

    const relative = normalize(decodeURIComponent(url.pathname.slice(BASE_PATH.length))).replace(/^(\.\.[/\\])+/, "");
    const candidate = join(DIST, relative || "index.html");
    const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(DIST, "index.html");

    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const client = new Cdp(socket);
    socket.addEventListener("message", (event) => client.receive(JSON.parse(event.data)));
    return client;
  }

  receive(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
      return;
    }
    this.events.push(message);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    const started = Date.now();
    // VERIFY_TRACE=1 prints every command with its round trip. A check that times out
    // leaves no clue about *where* it stopped, and the whole point of the five 90s
    // failures is that they hang rather than throw -- so the last line printed is the
    // step to look at. CDP_TIMEOUT_MS bounds a single command: a promise that never
    // settles is a hang, not a slow product, and it should say which command it was.
    const trace = process.env.VERIFY_TRACE === "1";
    const budget = Number(process.env.CDP_TIMEOUT_MS ?? 0);
    const label = method === "Runtime.evaluate" ? `Runtime.evaluate ${String(params.expression ?? "").replace(/\s+/g, " ").slice(0, 70)}` : method;
    if (trace) {
      console.log(`  → ${label}`);
    }
    return new Promise((resolve, reject) => {
      const timer = budget
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`CDP 命令超时（${budget}ms）：${label}`));
          }, budget)
        : null;
      const done = (fn) => (value) => {
        if (timer) clearTimeout(timer);
        if (trace) console.log(`  ← ${label} ${Date.now() - started}ms`);
        fn(value);
      };
      this.pending.set(id, {
        resolve: done(resolve),
        reject: done(reject),
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async value(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return result.result.value;
  }

  async goto(url) {
    this.events.length = 0;
    await this.send("Page.navigate", { url });
    await this.waitFor("!!document.querySelector('.workspace-switch')", 15000);
  }

  async waitFor(expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.value(expression)) {
          return true;
        }
      } catch {
        // navigation still in flight; the context is replaced and evaluate throws
      }
      await sleep(100);
    }
    return false;
  }
}

// Per-screen ids only. Class-substring markers were tried first and read the world
// page as the timeline page, which produced two scenarios whose readings looked fine
// and had no discriminating power.
const PAGE_IDS = `
  (() => {
    if (document.querySelector("#workspace-relationships")) return "relationships";
    if (document.querySelector("#workspace-timeline")) return "timeline";
    if (document.querySelector("#workspace-world")) return "world";
    if (document.querySelector("section.workspace-shell")) return "form";
    if (document.querySelector("section.preview-page")) return "preview";
    if (document.querySelector("section.developer-page")) return "developer";
    // By id, not by the class of whatever the page happens to open with: this marker
    // survived the dashboard's hero being replaced by the shared header.
    if (document.querySelector("#page-dashboard")) return "dashboard";
    return "unknown";
  })()
`;

const SEED = `
  (() => {
    const now = "2026-01-01T00:00:00.000Z";
    const make = (index, name) => ({ id: "seed-" + index, name, createdAt: now, updatedAt: now, gender: "女", worldview: "北境" });
    localStorage.setItem("character-studio.characters", JSON.stringify([make(1, "沈青梧"), make(2, "陆停云")]));
    localStorage.setItem("character-studio.relationships", JSON.stringify([{ id: "rel-1", fromId: "seed-1", toId: "seed-2", kind: "friend", createdAt: now, updatedAt: now }]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([{ id: "tl-1", title: "初次相遇", date: "2026-01-01", kind: "origin", characterIds: ["seed-1", "seed-2"], createdAt: now, updatedAt: now }]));
    localStorage.setItem("character-studio.world", JSON.stringify([{ id: "w-1", name: "雾海纪", category: "location", characterIds: ["seed-1", "seed-2"], createdAt: now, updatedAt: now }]));
    return true;
  })()
`;

// Both seeded characters are referenced by every domain, so a delete of either one
// leaves one participant behind and the checks below stay independent of which card
// the dashboard happens to put first.
const CARD_MENU_ACTION = (label) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const more = document.querySelector('button[aria-label="更多"]');
    if (!more) throw new Error("card menu trigger missing");
    more.click();
    await sleep(250);
    const item = [...document.querySelectorAll(".card-menu button")].find((button) => button.textContent.trim() === ${JSON.stringify(label)});
    if (!item) throw new Error("card menu item missing: " + ${JSON.stringify(label)});
    item.click();
    await sleep(500);
    return true;
  })()
`;

// The editor's 删除角色 sits in its own overflow menu, which is the route a user takes.
const EDITOR_MORE_DELETE = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const trigger = document.querySelector(".editor-more-wrap > button");
    if (!trigger) throw new Error("editor menu trigger missing");
    trigger.click();
    await sleep(250);
    const item = [...document.querySelectorAll(".editor-more-menu button")].find((button) => button.textContent.trim() === "删除角色");
    if (!item) throw new Error("editor delete item missing");
    item.click();
    await sleep(300);
    return true;
  })()
`;

const BULK_DELETE = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const byLabel = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    const enter = byLabel("批量选择");
    if (!enter) throw new Error("bulk mode button missing");
    enter.click();
    await sleep(300);
    const all = byLabel("全选");
    if (!all) throw new Error("select-all button missing");
    all.click();
    await sleep(300);
    const remove = byLabel("批量删除");
    if (!remove) throw new Error("bulk delete button missing");
    remove.click();
    await sleep(300);
    return true;
  })()
`;

const CONFIRM_DIALOG = (label) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const dialog = document.querySelector(".confirm-dialog");
    if (!dialog) throw new Error("confirm dialog missing");
    const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === ${JSON.stringify(label)});
    if (!confirm) throw new Error("confirm button missing: " + ${JSON.stringify(label)});
    confirm.click();
    await sleep(600);
    return true;
  })()
`;

const UNDO_DELETE = `
  (async () => {
    const button = document.querySelector("[data-undo-delete='true']");
    if (!button) throw new Error("undo button missing");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return true;
  })()
`;

// Any key the delete touches, so a check can see the whole effect of one press. The
// two expectations live here rather than in the checks so that all four delete checks
// read the same state the same way: one character fewer with one participant left in
// each domain, and the shared edge gone.
const READ_DELETE_STATE = `
  (() => {
    const read = (key) => JSON.parse(localStorage.getItem(key) || "[]");
    const state = {
      characters: read("character-studio.characters").map((item) => item.id),
      relationships: read("character-studio.relationships").map((item) => item.id),
      timelineParticipants: (read("character-studio.timeline")[0] || {}).characterIds || [],
      worldParticipants: (read("character-studio.world")[0] || {}).characterIds || [],
      recovery: JSON.parse(localStorage.getItem("character-studio.delete-recovery") || "null"),
      undo: Boolean(document.querySelector("[data-undo-delete='true']")),
      toast: (document.querySelector(".toast") || {}).textContent || "",
    };
    state.deletedOk =
      state.characters.length === 1 &&
      state.relationships.length === 0 &&
      state.timelineParticipants.length === 1 &&
      state.worldParticipants.length === 1 &&
      state.recovery !== null &&
      state.undo;
    state.restoredOk =
      state.characters.length === 2 &&
      state.relationships.length === 1 &&
      state.timelineParticipants.length === 2 &&
      state.worldParticipants.length === 2 &&
      state.recovery === null;
    state.detail =
      state.characters.length + " 个角色 / " +
      state.relationships.length + " 条关系 / 时间线 " +
      state.timelineParticipants.length + " 人 / 世界观 " +
      state.worldParticipants.length + " 人 / 恢复记录 " +
      (state.recovery ? "在" : "已清除") + " / 撤销入口 " +
      (state.undo ? "有" : "无");
    return state;
  })()
`;

// The delete-recovery copy is refused on its own key, so the refusal is the one the
// decision depends on rather than a blanket storage failure.
const REFUSE_RECOVERY_WRITES = `
  (() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key) === "character-studio.delete-recovery") {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      return original.call(this, key, value);
    };
    return true;
  })()
`;



const clickWorkspace = (label) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector(".workspace-switch").click();
    await sleep(350);
    // Below 720px the same list opens as a bottom sheet; above it, as a dropdown. One
    // helper, both presentations — otherwise every navigation check would have to know
    // which width it is running at.
    const inSheet = [...document.querySelectorAll('[data-testid="workspace-sheet"] .sheet-row')];
    const item = (inSheet.length > 0 ? inSheet : [...document.querySelectorAll('button[role="menuitem"]')])
      .find((button) => button.textContent.includes(${JSON.stringify(label)}));
    if (!item) throw new Error("menu item missing: " + ${JSON.stringify(label)});
    item.click();
    await sleep(700);
    return true;
  })()
`;

// Search is a compact trigger until it is opened, on every workspace. Both handles are
// the ones WorkspaceSearch publishes (data-testid), so a probe no longer depends on the
// class names the control happened to have when this check was written.
const openGraphSearch = async (cdp) => {
  await cdp.value(`(() => {
    if (document.querySelector('[data-testid="graph-search-input"]')) return true;
    const trigger = document.querySelector('[data-testid="graph-search"]');
    if (!trigger) throw new Error("搜索入口缺失");
    trigger.click();
    return true;
  })()`);
  if (!(await cdp.waitFor(`!!document.querySelector('[data-testid="graph-search-input"]')`, 4000))) {
    throw new Error("搜索框没有打开");
  }
};

// Opens the app-level clear through the route a user takes: any page but the
// dashboard shows the footer, and the footer holds the Settings entry.
const OPEN_CLEAR_DIALOG = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // The footer entry is labelled 设置与数据; the old English label has been gone long
    // enough that a /Settings/ matcher made this throw on every run for five checks.
    const settings = [...document.querySelectorAll("footer button")].find((button) => /设置与数据|Settings/.test(button.textContent));
    if (!settings) throw new Error("footer settings button missing");
    settings.click();
    await sleep(400);
    const clear = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "清空本地数据");
    if (!clear) throw new Error("clear button missing");
    clear.click();
    await sleep(300);
    return true;
  })()
`;

const CONFIRM_CLEAR = `
  (async () => {
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "确认清空");
    if (!confirm) throw new Error("confirm button missing");
    confirm.click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    return true;
  })()
`;

// Filling the quota for real was tried first and is a poor test: the last chunk that
// fails leaves nearly a chunk of room, and a two-character snapshot fits easily, so
// the write succeeds and the check passes for the wrong reason. Making the browser
// refuse exactly this one write is deterministic, targets the write the decision
// depends on, and exercises the same branch a full quota reaches.
const REFUSE_SNAPSHOT_WRITES = `
  (() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key) === "character-studio.backup") {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      return original.call(this, key, value);
    };
    return true;
  })()
`;

const READ_CLEAR_OUTCOME = `
  ({
    characters: JSON.parse(localStorage.getItem("character-studio.characters") || "[]").length,
    snapshot: JSON.parse(localStorage.getItem("character-studio.backup") || "null"),
    message: (document.querySelector(".form-error") || {}).textContent || "",
  })
`;


// A workspace at the size the pickers have to cope with: a hundred characters, with
// two of them distinctive enough to search for by name.
const SEED_MANY = `
  (() => {
    const now = new Date().toISOString();
    const jobs = ["调查员", "魔法师", "工匠"];
    const worlds = ["北境", "云海", "雾隐"];
    const characters = Array.from({ length: 100 }, (_, index) => ({
      id: "bulk-" + (index + 1),
      name: "角色" + String(index + 1).padStart(3, "0"),
      occupation: jobs[index % 3],
      worldview: worlds[index % 3],
      avatarEmoji: "🙂",
      createdAt: now,
      updatedAt: now,
    }));
    characters[0] = { ...characters[0], name: "陆停云", occupation: "魔法师", worldview: "云海" };
    characters[87] = { ...characters[87], name: "沈青梧", occupation: "调查员", worldview: "北境" };
    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.relationships", JSON.stringify([]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.world", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    return true;
  })()
`;

// Drives the two pickers in 新建关系 the way a writer would: open, type, take the
// match with the keyboard, then read what actually landed in storage.
const CREATE_RELATION_BY_SEARCH = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const pressEnter = (element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const open = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建关系");
    if (!open) throw new Error("新建关系 missing");
    open.click();
    await sleep(400);

    const nativeSelects = [...document.querySelectorAll(".confirm-dialog select")].map((node) => node.getAttribute("aria-label") || node.previousSibling?.textContent || "?");
    const steps = [];

    for (const [index, needle] of [[0, "沈青梧"], [1, "陆停云"]]) {
      const trigger = document.querySelectorAll(".character-select-trigger")[index];
      if (!trigger) throw new Error("picker " + index + " missing");
      trigger.click();
      await sleep(250);

      const input = document.querySelector(".character-select-panel input");
      setValue(input, needle);
      await sleep(250);
      const matched = document.querySelectorAll(".character-select-panel .character-picker-option").length;
      pressEnter(input);
      await sleep(250);

      const chosen = (document.querySelectorAll(".character-select-trigger")[index] || {}).textContent || "";
      steps.push({ needle, matched, chosen: chosen.trim(), stillOpen: Boolean(document.querySelector(".character-select-panel")) });
    }

    const save = [...document.querySelectorAll(".confirm-dialog button")].find((button) => button.textContent.trim() === "保存关系");
    const saveDisabled = save ? save.disabled : true;
    if (save && !save.disabled) { save.click(); await sleep(400); }

    const stored = JSON.parse(localStorage.getItem("character-studio.relationships") || "[]");
    return {
      nativeSelects,
      steps,
      saveDisabled,
      stored: stored.map((item) => item.fromId + "->" + item.toId),
      dialogStillOpen: Boolean(document.querySelector(".confirm-dialog")),
    };
  })()
`;

// A graph with something in it: six characters — one with a real picture avatar, one
// emoji, one outside the graph entirely — and four edges. 沈青梧 and 陆停云 are the two
// ends a search has to tell apart; 文森特·梵高 is the character who is not on the canvas.
const SEED_GRAPH = `
  (async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const make = (id, name, occupation, worldview, avatarAssetId) => ({
      id,
      name,
      occupation,
      worldview,
      avatarEmoji: "🙂",
      createdAt: now,
      updatedAt: now,
      ...(avatarAssetId ? { avatarAssetId } : {}),
    });
    localStorage.setItem("character-studio.characters", JSON.stringify([
      make("g-1", "沈青梧", "调查员", "北境", "asset-red"),
      make("g-2", "陆停云", "魔法师", "云海"),
      make("g-3", "顾行之", "工匠", "雾隐"),
      make("g-4", "文森特·梵高", "画家", "阿尔勒"),
      make("g-5", "白露", "医者", "北境"),
      make("g-6", "青芜", "记录官", "云海"),
    ]));
    localStorage.setItem("character-studio.relationships", JSON.stringify([
      { id: "gr-1", fromId: "g-1", toId: "g-2", kind: "friend", createdAt: now, updatedAt: now },
      { id: "gr-2", fromId: "g-2", toId: "g-3", kind: "mentor", createdAt: now, updatedAt: now },
      { id: "gr-3", fromId: "g-1", toId: "g-5", kind: "family", createdAt: now, updatedAt: now },
      { id: "gr-4", fromId: "g-3", toId: "g-6", kind: "colleague", createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.world", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    localStorage.removeItem("character-studio.graph-prefs");
    // Membership lives in the layout file, so a seed that describes "this graph" has to
    // clear it: otherwise the previous check's roster decides what is drawn, and a
    // twelve-character seed can end up with an empty canvas.
    localStorage.removeItem("character-studio.relationship-layout");
    // The graph remembers whether it was last left on 图谱 or 管理. A seed that
    // describes a graph has to start on the graph, or the check measures the
    // previous check's mode instead of its own data.
    localStorage.removeItem("character-studio.relationship-view");

    // A picture where the app keeps its avatars, so "does a picture avatar draw on the
    // canvas" is answered with a real asset rather than with the emoji that used to be
    // the only thing a node ever drew.
    const source = document.createElement("canvas");
    source.width = 64;
    source.height = 64;
    source.getContext("2d").fillStyle = "#ff0000";
    source.getContext("2d").fillRect(0, 0, 64, 64);
    const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));

    await new Promise((resolve, reject) => {
      const request = indexedDB.open("character-studio-assets", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("avatar-assets")) {
          request.result.createObjectStore("avatar-assets", { keyPath: "id" });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("avatar-assets", "readwrite");
        transaction.objectStore("avatar-assets").put({
          id: "asset-red",
          type: "avatar",
          name: "red.png",
          mimeType: "image/png",
          blob,
          size: blob.size,
          width: 64,
          height: 64,
          createdAt: now,
          updatedAt: now,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve(true);
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    return true;
  })()
`;

// A graph too dense to label at fit: four hundred characters in one chain, so all four
// hundred are drawn and none of their names is legible at any zoom the focus uses. This
// is where "the focused character and its direct connections label themselves" is worth
// asserting — at this size those three names are the only ones on the canvas.
const SEED_GRAPH_LARGE = `
  (() => {
    const now = "2026-01-01T00:00:00.000Z";
    const jobs = ["调查员", "魔法师", "工匠"];
    const worlds = ["北境", "云海", "雾隐"];
    const characters = Array.from({ length: 400 }, (_, index) => ({
      id: "bulk-" + (index + 1),
      name: "角色" + String(index + 1).padStart(3, "0"),
      occupation: jobs[index % 3],
      worldview: worlds[index % 3],
      avatarEmoji: "🙂",
      createdAt: now,
      updatedAt: now,
    }));
    // bulk-87 and bulk-89 are the two ends of bulk-88 in the chain.
    characters[86] = { ...characters[86], name: "陆停云", occupation: "魔法师", worldview: "云海" };
    characters[87] = { ...characters[87], name: "沈青梧", occupation: "调查员", worldview: "北境" };
    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.relationships", JSON.stringify(
      Array.from({ length: 399 }, (_, index) => ({
        id: "gr-" + (index + 1),
        fromId: "bulk-" + (index + 1),
        toId: "bulk-" + (index + 2),
        kind: "colleague",
        createdAt: now,
        updatedAt: now,
      })),
    ));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.world", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    localStorage.removeItem("character-studio.graph-prefs");
    // Membership lives in the layout file, so a seed that describes "this graph" has to
    // clear it: otherwise the previous check's roster decides what is drawn, and a
    // twelve-character seed can end up with an empty canvas.
    localStorage.removeItem("character-studio.relationship-layout");
    // The graph remembers whether it was last left on 图谱 or 管理. A seed that
    // describes a graph has to start on the graph, or the check measures the
    // previous check's mode instead of its own data.
    localStorage.removeItem("character-studio.relationship-view");
    return true;
  })()
`;

// Two uploaded avatars and one emoji: a wide 1200x400 picture (the shape that used to
// paint over the form), a square one at the size avatars are stored at, and a character
// with no picture at all.
const SEED_AVATAR_SIZES = `
  (async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const store = async (id, width, height) => {
      const source = document.createElement("canvas");
      source.width = width;
      source.height = height;
      const context = source.getContext("2d");
      context.fillStyle = "#ff0000";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#0000ff";
      context.fillRect(0, 0, width, 8);
      const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("character-studio-assets", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("avatar-assets")) {
            request.result.createObjectStore("avatar-assets", { keyPath: "id" });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("avatar-assets", "readwrite");
          transaction.objectStore("avatar-assets").put({
            id, type: "avatar", name: id + ".png", mimeType: "image/png", blob, size: blob.size,
            width, height, createdAt: now, updatedAt: now,
          });
          transaction.oncomplete = () => { db.close(); resolve(true); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    };
    await store("asset-wide", 1200, 400);
    await store("asset-square", 512, 512);
    localStorage.setItem("character-studio.characters", JSON.stringify([
      { id: "av-1", name: "沈青梧", occupation: "调查员", worldview: "北境", avatarAssetId: "asset-wide", createdAt: now, updatedAt: now },
      { id: "av-2", name: "陆停云", occupation: "魔法师", worldview: "云海", avatarAssetId: "asset-square", createdAt: now, updatedAt: now },
      { id: "av-3", name: "白露", occupation: "医者", worldview: "北境", avatarEmoji: "🌙", createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem("character-studio.relationships", JSON.stringify([]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.world", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    return true;
  })()
`;

// Every row avatar in whatever dialog is open, measured against its own box. `escaped`
// is how far the picture paints outside the circle, which is the whole complaint: an
// image at its natural size inside a 26px container.
const READ_ROW_AVATARS = `
  (() => {
    const rows = [...document.querySelectorAll(".character-row-avatar")];
    const dialog = document.querySelector(".confirm-dialog");
    const save = dialog
      ? [...dialog.querySelectorAll("button")].find((button) => /^保存/.test(button.textContent.trim()))
      : null;
    const saveRect = save ? save.getBoundingClientRect() : null;
    const hit = saveRect
      ? document.elementFromPoint(saveRect.left + saveRect.width / 2, saveRect.top + saveRect.height / 2)
      : null;

    const measured = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      const image = row.querySelector("img");
      const imageRect = image ? image.getBoundingClientRect() : null;
      return {
        box: [Math.round(rect.width), Math.round(rect.height)],
        image: imageRect ? [Math.round(imageRect.width), Math.round(imageRect.height)] : null,
        natural: image ? [image.naturalWidth, image.naturalHeight] : null,
        escaped: imageRect
          ? Math.round(
              Math.max(0, rect.left - imageRect.left) + Math.max(0, imageRect.right - rect.right) +
              Math.max(0, rect.top - imageRect.top) + Math.max(0, imageRect.bottom - rect.bottom),
            )
          : 0,
        emoji: image ? "" : row.textContent.trim(),
        clipped: getComputedStyle(row).overflow,
      };
    });

    return {
      count: rows.length,
      rows: measured,
      escaped: measured.reduce((total, row) => total + row.escaped, 0),
      clippedEverywhere: measured.every((row) => row.clipped === "hidden"),
      pictures: measured.filter((row) => row.image).length,
      widest: measured.reduce((widest, row) => Math.max(widest, row.natural ? row.natural[0] : 0), 0),
      saveHit: hit ? (hit.closest("button") ? "button" : hit.tagName + "." + (hit.getAttribute("class") || "")) : "(no save button)",
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()
`;

// A hundred events across three years, with long titles, long descriptions, locations
// and kind-typed entries: the size the toolbar has to stay usable at.
const SEED_TIMELINE = `
  (() => {
    const now = "2026-01-01T00:00:00.000Z";
    const characters = [
      { id: "tl-c1", name: "沈青梧", occupation: "调查员", worldview: "北境", avatarEmoji: "🙂", createdAt: now, updatedAt: now },
      { id: "tl-c2", name: "陆停云", occupation: "魔法师", worldview: "云海", avatarEmoji: "🌙", createdAt: now, updatedAt: now },
      { id: "tl-c3", name: "白露", occupation: "医者", worldview: "北境", avatarEmoji: "🜂", createdAt: now, updatedAt: now },
    ];
    const kinds = ["origin", "turning", "bond", "conflict", "loss", "other"];
    const long = "雾海纪的冬天很长，长到人们用第几场雪来记日子。她出生在第七场雪之后，父亲是守塔人。".repeat(6);
    const events = Array.from({ length: 100 }, (_, index) => {
      const year = 2023 + (index % 3);
      return {
        id: "ev-" + index,
        title: index % 10 === 0 ? "长标题事件：" + "会在会上被反复提起的一段往事".repeat(2) : "事件 " + String(index + 1).padStart(3, "0"),
        date: year + "-" + String((index % 12) + 1).padStart(2, "0") + "-" + String((index % 27) + 1).padStart(2, "0"),
        era: index % 7 === 0 ? "光历 " + (310 + index) + " 年" : "",
        kind: kinds[index % kinds.length],
        location: index % 5 === 0 ? "北境" : index % 5 === 1 ? "雾隐" : "",
        description: index % 4 === 0 ? long : index % 3 === 0 ? "会呼吸的红藻第一次被记录。" : "简短记录。",
        characterIds: index % 2 === 0 ? ["tl-c1", "tl-c2"] : ["tl-c3"],
        createdAt: now,
        updatedAt: now,
      };
    });
    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.timeline", JSON.stringify(events));
    localStorage.setItem("character-studio.relationships", JSON.stringify([]));
    localStorage.setItem("character-studio.world", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    localStorage.removeItem("character-studio.graph-prefs");
    // Membership lives in the layout file, so a seed that describes "this graph" has to
    // clear it: otherwise the previous check's roster decides what is drawn, and a
    // twelve-character seed can end up with an empty canvas.
    localStorage.removeItem("character-studio.relationship-layout");
    // The graph remembers whether it was last left on 图谱 or 管理. A seed that
    // describes a graph has to start on the graph, or the check measures the
    // previous check's mode instead of its own data.
    localStorage.removeItem("character-studio.relationship-view");
    return events.length;
  })()
`;

const READ_TIMELINE = `
  (() => ({
    items: document.querySelectorAll(".timeline-item").length,
    years: [...document.querySelectorAll(".timeline-year")].map((node) => node.textContent.trim()).slice(0, 6),
    nav: [...document.querySelectorAll(".timeline-year-nav button")].map((button) => button.textContent.trim()),
    count: (document.querySelector(".timeline-count")?.textContent || "").trim(),
    empty: (document.querySelector(".empty-state")?.textContent || "").replace(/\s+/g, " ").trim(),
    firstTitle: (document.querySelector(".timeline-card-title")?.textContent || "").trim(),
    hasFilterToolbar: Boolean(document.querySelector(".timeline-toolbar")),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))()
`;

const TIMELINE_SET_VALUE = `
    const setInput = (selector, value) => {
      const input = document.querySelector(selector);
      if (!input) throw new Error("找不到输入框：" + selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setArea = (selector, value) => {
      const area = document.querySelector(selector);
      if (!area) throw new Error("找不到文本域：" + selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(area, value);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setSelect = (selector, value) => {
      const select = document.querySelector(selector);
      if (!select) throw new Error("找不到下拉：" + selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
`;

// Filtering: every combination against the count the stored data implies, not against a
// number typed into the test.
const TIMELINE_FILTERS = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${TIMELINE_SET_VALUE}
    const rows = () => document.querySelectorAll(".timeline-item").length;
    const countText = () => (document.querySelector(".timeline-count")?.textContent || "").trim();
    const stored = () => JSON.parse(localStorage.getItem("character-studio.timeline") || "[]");
    const expected = (predicate) => stored().filter(predicate).length;
    const has = (event) => (event.description || "").includes("红藻");

    // The search field is collapsed behind its trigger until it is opened, so every use
    // goes through the entry point instead of assuming an always-present input.
    const openSearch = async () => {
      if (document.querySelector('[data-testid="timeline-search-input"]')) return;
      const trigger = document.querySelector('[data-testid="timeline-search"]');
      if (!trigger) throw new Error("找不到搜索入口：" + '[data-testid="timeline-search"]');
      trigger.click();
      await sleep(350);
      if (!document.querySelector('[data-testid="timeline-search-input"]')) throw new Error("搜索框没有展开");
    };
    const setSearch = async (value) => {
      await openSearch();
      setInput('[data-testid="timeline-search-input"]', value);
    };

    const start = { rows: rows(), count: countText(), toolbar: Boolean(document.querySelector(".timeline-toolbar")) };
    await setSearch("  红藻  ");
    await sleep(400);
    const search = { rows: rows(), count: countText(), expected: expected(has) };
    // The year and the kind are taken from an event the search actually matches. With a
    // fixed 2024 / 起源 pair the seed produced 0, and "0 === 0" would have let a toolbar
    // that ignored both filters pass this step.
    const match = stored().find(has) || {};
    const matchYear = (match.date || "").slice(0, 4);
    const matchKind = match.kind || "origin";
    setSelect('[aria-label="按年份筛选"]', matchYear);
    await sleep(400);
    const withYear = { rows: rows(), count: countText(), year: matchYear, expected: expected((event) => has(event) && event.date.startsWith(matchYear)) };
    setSelect('[aria-label="按类型筛选"]', matchKind);
    await sleep(400);
    const withKind = { rows: rows(), count: countText(), kind: matchKind, expected: expected((event) => has(event) && event.date.startsWith(matchYear) && event.kind === matchKind) };
    document.querySelector(".timeline-clear").click();
    await sleep(400);
    // The button that is pressed is unmounted by the state change it causes, so where
    // focus lands is part of what "cleared" means: it must not be the document.
    const focusAfterClear = document.activeElement;
    const cleared = { rows: rows(), count: countText(), clear: Boolean(document.querySelector(".timeline-clear")), year: document.querySelector('[aria-label="按年份筛选"]').value, kind: document.querySelector('[aria-label="按类型筛选"]').value, focusTag: focusAfterClear ? focusAfterClear.tagName : null, focusAria: focusAfterClear ? focusAfterClear.getAttribute("aria-label") : null, focusIsBody: focusAfterClear === document.body };

    await setSearch("不存在的关键词");
    await sleep(400);
    const none = { rows: rows(), count: countText(), empty: (document.querySelector(".empty-state")?.textContent || "").replace(/\s+/g, " ").trim(), clear: Boolean(document.querySelector(".timeline-clear")) };
    document.querySelector(".timeline-clear").click();
    await sleep(400);

    // A character name is a search term, and it must not be the id.
    await setSearch("白露");
    await sleep(400);
    const byCharacter = { rows: rows(), expected: expected((event) => event.characterIds.includes("tl-c3")) };
    await setSearch("tl-c3");
    await sleep(400);
    const byId = { rows: rows() };
    document.querySelector(".timeline-clear").click();
    await sleep(400);
    return { start, search, withYear, withKind, cleared, none, byCharacter, byId };
  })()
`;

// The year navigation: where it lands, what it highlights, and that it only offers what
// is on screen.
const TIMELINE_YEAR_NAV = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${TIMELINE_SET_VALUE}
    const buttons = () => [...document.querySelectorAll(".timeline-year-nav button")];
    const labels = buttons().map((button) => button.textContent.trim());
    const target = buttons()[1];
    const year = target.textContent.trim().slice(0, 4);
    target.click();
    await sleep(1400);

    const group = [...document.querySelectorAll(".timeline-year-group")].find(
      (node) => (node.querySelector(".timeline-year")?.textContent || "").includes(year),
    );
    const groupRect = group.getBoundingClientRect();
    const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
    const current = buttons().find((button) => button.getAttribute("aria-current") === "true");
    const rail = document.querySelector(".timeline-rail");
    const line = getComputedStyle(rail, "::before");
    const node = getComputedStyle(document.querySelector(".timeline-item"), "::before");
    const yearNode = getComputedStyle(document.querySelector(".timeline-year-node"));
    const before = { ...{}, groupTop: Math.round(groupRect.top), topbarBottom: Math.round(topbar.bottom), viewportHeight: window.innerHeight, current: current ? current.textContent.trim() : "" };
    const railLine = { width: parseFloat(line.width) || 0, height: parseFloat(line.height) || 0, left: line.left, nodeRadius: node.borderRadius, nodeSize: parseFloat(node.width) || 0, yearNodeSize: parseFloat(yearNode.width) || 0 };

    // Filter to a year: the navigation must follow what is drawn.
    setSelect('[aria-label="按年份筛选"]', year);
    await sleep(500);
    const afterFilter = { nav: buttons().map((button) => button.textContent.trim()), years: document.querySelectorAll(".timeline-year-group").length };
    document.querySelector(".timeline-clear").click();
    await sleep(400);
    return { labels, year, before, railLine, afterFilter, groups: document.querySelectorAll(".timeline-year-group").length };
  })()
`;

// Reading a long card, then creating, editing and deleting through the dialog.
const TIMELINE_CARD_AND_CRUD = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${TIMELINE_SET_VALUE}
    const stored = () => JSON.parse(localStorage.getItem("character-studio.timeline") || "[]");

    const longEvent = stored().find((event) => (event.description || "").length > 200);
    const card = [...document.querySelectorAll(".timeline-item")].find(
      (node) => (node.querySelector(".timeline-card-title")?.textContent || "").trim() === longEvent.title,
    );
    if (!card) throw new Error("找不到长描述卡片");
    card.scrollIntoView({ block: "center" });
    await sleep(300);

    const toggle = card.querySelector(".timeline-description-toggle");
    const collapsed = {
      length: card.querySelector(".timeline-description").textContent.length,
      full: longEvent.description.length,
      toggle: toggle ? toggle.textContent.trim() : "",
      expanded: toggle ? toggle.getAttribute("aria-expanded") : "",
    };
    toggle.click();
    await sleep(300);
    const expanded = {
      length: card.querySelector(".timeline-description").textContent.length,
      toggle: card.querySelector(".timeline-description-toggle").textContent.trim(),
      expanded: card.querySelector(".timeline-description-toggle").getAttribute("aria-expanded"),
    };
    card.querySelector(".timeline-description-toggle").click();
    await sleep(300);
    const collapsedAgain = card.querySelector(".timeline-description").textContent.length;

    // Create. The action row is pinned, so it is on screen without scrolling the form.
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建事件").click();
    await sleep(600);
    const dialog = document.querySelector(".timeline-dialog");
    const actions = document.querySelector(".timeline-dialog-actions");
    const dialogRect = dialog.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const pinned = actionsRect.bottom <= dialogRect.bottom + 1 && actionsRect.top >= dialogRect.top - 1;
    const sections = [...document.querySelectorAll(".timeline-dialog legend")].map((node) => node.textContent.trim());
    const pickerOptions = document.querySelectorAll(".character-picker-option").length;
    const pickerBoxes = document.querySelectorAll(".character-picker input[type=checkbox]").length;

    setInput('.timeline-dialog input[type="text"]', "新建的事件标题");
    setInput('.timeline-dialog input[type="date"]', "2025-08-08");
    setArea(".timeline-dialog textarea", "这是一段新建事件的描述。");
    // The picker's rows are labels around a checkbox; the checkbox is what a click has
    // to reach for the choice to register.
    const pickerBox = document.querySelector(".character-picker input[type=checkbox]");
    if (!pickerBox) throw new Error("角色选择器没有可勾选项");
    pickerBox.click();
    await sleep(250);
    [...document.querySelectorAll(".timeline-dialog button")].find((button) => button.textContent.trim() === "保存事件").click();
    await sleep(700);
    const createdEvent = stored().find((event) => event.title === "新建的事件标题");
    const afterCreate = {
      count: stored().length,
      date: createdEvent?.date ?? "",
      characters: createdEvent?.characterIds.length ?? 0,
      drawn: [...document.querySelectorAll(".timeline-card-title")].some((node) => node.textContent.trim() === "新建的事件标题"),
      dialogClosed: !document.querySelector(".timeline-dialog"),
      sections,
      pinned,
      pickerOptions,
      pickerBoxes,
    };

    // Edit.
    const created = [...document.querySelectorAll(".timeline-item")].find(
      (node) => (node.querySelector(".timeline-card-title")?.textContent || "").trim() === "新建的事件标题",
    );
    [...created.querySelectorAll(".timeline-action")].find((button) => button.textContent.trim() === "编辑").click();
    await sleep(600);
    setInput('.timeline-dialog input[type="text"]', "改过标题的事件");
    [...document.querySelectorAll(".timeline-dialog button")].find((button) => button.textContent.trim() === "保存事件").click();
    await sleep(700);
    const afterEdit = { count: stored().length, saved: stored().some((event) => event.title === "改过标题的事件"), keptId: stored().find((event) => event.title === "改过标题的事件")?.date ?? "" };

    // Delete.
    const edited = [...document.querySelectorAll(".timeline-item")].find(
      (node) => (node.querySelector(".timeline-card-title")?.textContent || "").trim() === "改过标题的事件",
    );
    [...edited.querySelectorAll(".timeline-action")].find((button) => button.textContent.trim() === "删除").click();
    await sleep(500);
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "确认删除").click();
    await sleep(600);
    const afterDelete = { count: stored().length, drawn: [...document.querySelectorAll(".timeline-card-title")].some((node) => node.textContent.trim() === "改过标题的事件") };

    return { collapsed, expanded, collapsedAgain, afterCreate, afterEdit, afterDelete, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()
`;

// The app's own theme menu, usable from any page: the settings dialog is not always
// open, and the OS preference must not be what decides.
const SET_THEME_BY_MENU = (label) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector(".theme-combo-arrow").click();
    await sleep(250);
    const item = [...document.querySelectorAll(".theme-menu button")].find((button) => button.textContent.trim() === ${JSON.stringify(label)});
    if (!item) throw new Error("找不到主题项：" + ${JSON.stringify(label)});
    item.click();
    await sleep(400);
    return document.documentElement.dataset.theme || "";
  })()
`;

// A hundred world entries: a five-level chain under 雾海纪 (the branch whose parent can
// be collapsed), one child under it from the flat set, six categories, tags and
// characters at every other entry.
const SEED_WORLD = `
  (() => {
    const now = "2026-01-01T00:00:00.000Z";
    const characters = [
      { id: "wc-1", name: "沈青梧", occupation: "调查员", worldview: "北境", avatarEmoji: "🙂", createdAt: now, updatedAt: now },
      { id: "wc-2", name: "陆停云", occupation: "魔法师", worldview: "云海", avatarEmoji: "🌙", createdAt: now, updatedAt: now },
      { id: "wc-3", name: "白露", occupation: "医者", worldview: "北境", avatarEmoji: "🜂", createdAt: now, updatedAt: now },
    ];
    const entries = [];
    const chain = ["雾海纪", "北境城", "白塔区", "旧灯塔", "灯室"];
    chain.forEach((name, index) => entries.push({
      id: "deep-" + index,
      name,
      category: "location",
      parentId: index ? "deep-" + (index - 1) : undefined,
      summary: name + "的简介",
      details: name + "的详细设定。".repeat(8),
      tags: ["深度" + index],
      characterIds: index % 2 ? ["wc-1"] : [],
      createdAt: now,
      updatedAt: now,
    }));
    const categories = ["location", "faction", "species", "item", "concept", "other"];
    const labels = { location: "地点", faction: "势力", species: "种族", item: "物品", concept: "概念", other: "其他" };
    for (let index = 0; index < 95; index += 1) {
      const category = categories[index % categories.length];
      entries.push({
        id: "w-" + index,
        name: labels[category] + String(index).padStart(3, "0"),
        category,
        parentId: index % 7 === 0 ? "deep-0" : undefined,
        summary: index % 3 === 0 ? "简述 " + index : "",
        details: index % 4 === 0 ? "详细设定。".repeat(20) : "",
        tags: index % 5 === 0 ? ["标签" + index] : [],
        characterIds: index % 6 === 0 ? ["wc-1", "wc-2"] : index % 6 === 3 ? ["wc-3"] : [],
        createdAt: now,
        updatedAt: now,
      });
    }
    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.world", JSON.stringify(entries));
    localStorage.setItem("character-studio.relationships", JSON.stringify([]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    return entries.length;
  })()
`;

// One entry and nothing else: the only case where an entry may take no parent at all.
const SEED_WORLD_SINGLE = `
  (() => {
    const now = "2026-01-01T00:00:00.000Z";
    localStorage.setItem("character-studio.characters", JSON.stringify([
      { id: "wc-1", name: "沈青梧", occupation: "调查员", worldview: "北境", avatarEmoji: "🙂", createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem("character-studio.world", JSON.stringify([
      { id: "only", name: "唯一的条目", category: "location", tags: [], characterIds: [], createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.relationships", JSON.stringify([]));
    localStorage.setItem("character-studio.about-seen", "true");
    return true;
  })()
`;

const READ_WORLD = `
  (() => {
    const rows = [...document.querySelectorAll(".world-row")];
    return {
      rows: rows.length,
      names: rows.map((row) => (row.querySelector(".world-row-name")?.textContent || "").trim()),
      viaPath: rows.filter((row) => row.classList.contains("via-path")).length,
      selected: [...document.querySelectorAll(".world-row.selected .world-row-name")].map((node) => node.textContent.trim()),
      nav: [...document.querySelectorAll(".world-category")].map((button) => ({
        label: button.textContent.trim(),
        current: button.getAttribute("aria-current") === "true",
        disabled: button.disabled,
      })),
      count: (document.querySelector(".world-count")?.textContent || "").trim(),
      empty: (document.querySelector(".empty-state")?.textContent || "").replace(/\s+/g, " ").trim(),
      detail: (document.querySelector(".world-detail")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400),
      detailSections: [...document.querySelectorAll(".world-detail-section h4")].map((node) => node.textContent.trim()),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()
`;

const WORLD_SET_VALUE = `
    const setInput = (selector, value) => {
      const input = document.querySelector(selector);
      if (!input) throw new Error("找不到输入框：" + selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setSelect = (selector, value) => {
      const select = document.querySelector(selector);
      if (!select) throw new Error("找不到下拉：" + selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const stored = () => JSON.parse(localStorage.getItem("character-studio.world") || "[]");
`;

// Category navigation and its counts, against the stored entries.
const WORLD_CATEGORY_NAV = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${WORLD_SET_VALUE}
    const rows = () => [...document.querySelectorAll(".world-row")];
    const chip = (label) => [...document.querySelectorAll(".world-category")].find((button) => button.textContent.trim().startsWith(label));

    const before = { rows: rows().length, stored: stored().length, storage: JSON.stringify(stored()) };
    const expected = (category) => stored().filter((entry) => entry.category === category).length;

    const location = { live: stored().filter((entry) => entry.category === "location").length, fromStorage: expected("location") };
    chip("地点").click();
    await sleep(400);
    const afterLocation = {
      rows: rows().length,
      results: rows().filter((row) => !row.classList.contains("via-path")).length,
      expected: expected("location"),
      current: [...document.querySelectorAll(".world-category")].find((button) => button.getAttribute("aria-current") === "true")?.textContent.trim() || "",
      count: (document.querySelector(".world-count")?.textContent || "").trim(),
      storage: JSON.stringify(stored()),
    };

    chip("物品").click();
    await sleep(400);
    const afterItem = { results: rows().filter((row) => !row.classList.contains("via-path")).length, expected: expected("item") };

    chip("全部分类").click();
    await sleep(400);
    const afterAll = { results: rows().filter((row) => !row.classList.contains("via-path")).length, expected: stored().length, nav: [...document.querySelectorAll(".world-category")].map((button) => button.textContent.trim()) };

    return { before, afterLocation, afterItem, afterAll, location };
  })()
`;

// Search, its combination with the structural filters, and a match that sits under a
// collapsed parent.
const WORLD_SEARCH = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${WORLD_SET_VALUE}
    const rows = () => [...document.querySelectorAll(".world-row")];
    const names = () => rows().map((row) => (row.querySelector(".world-row-name")?.textContent || "").trim());
    const results = () => rows().filter((row) => !row.classList.contains("via-path")).length;

    // The search field is folded behind its trigger, and the old class-based locator no
    // longer exists after that refactor, so every use goes through the entry point.
    const openWorldSearch = async () => {
      if (document.querySelector('[data-testid="world-search-input"]')) return;
      const trigger = document.querySelector('[data-testid="world-search"]');
      if (!trigger) throw new Error("找不到搜索入口：" + '[data-testid="world-search"]');
      trigger.click();
      await sleep(350);
      if (!document.querySelector('[data-testid="world-search-input"]')) throw new Error("搜索框没有展开");
    };
    const setWorldSearch = async (value) => {
      await openWorldSearch();
      setInput('[data-testid="world-search-input"]', value);
    };

    // Shut every branch first: the point of the next assertion is that a match two
    // levels down is still reachable.
    [...document.querySelectorAll(".world-row-toggle")].forEach((button) => {
      if (button.getAttribute("aria-expanded") === "true") button.click();
    });
    await sleep(400);
    const collapsedRows = rows().length;
    const deepHidden = !names().includes("白塔区");

    await setWorldSearch("白塔区");
    await sleep(400);
    const searched = {
      names: names(),
      results: results(),
      hasMatch: names().includes("白塔区"),
      pathRows: rows().filter((row) => row.classList.contains("via-path")).length,
      count: (document.querySelector(".world-count")?.textContent || "").trim(),
    };
    document.querySelector(".world-toolbar .ghost-button").click();
    await sleep(400);
    const cleared = { rows: rows().length, hasDeep: names().includes("白塔区"), matchesCollapsed: rows().length === collapsedRows };

    // Combinations: category + level + characters, each against the stored data.
    const expected = (predicate) => stored().filter(predicate).length;
    setSelect('[aria-label="按层级筛选"]', "child");
    await sleep(400);
    const childOnly = { results: results(), expected: expected((entry) => entry.parentId) };
    setSelect('[aria-label="按关联角色筛选"]', "with");
    await sleep(400);
    const childWithCharacters = { results: results(), expected: expected((entry) => entry.parentId && entry.characterIds.length > 0) };
    setSelect('[aria-label="按层级筛选"]', "any");
    await sleep(400);
    const withCharacters = { results: results(), expected: expected((entry) => entry.characterIds.length > 0) };

    await setWorldSearch("沈青梧");
    await sleep(400);
    const byCharacter = { results: results(), expected: expected((entry) => entry.characterIds.includes("wc-1")) };
    await setWorldSearch("wc-1");
    await sleep(400);
    const byId = { results: results() };

    await setWorldSearch("不存在的条目");
    await sleep(400);
    const none = { rows: rows().length, empty: (document.querySelector(".world-empty, .empty-state")?.textContent || "").replace(/\s+/g, " ").trim() };

    return { collapsedRows, deepHidden, searched, cleared, childOnly, childWithCharacters, withCharacters, byCharacter, byId, none };
  })()
`;

// Hierarchy, the detail pane, and the size the screen is meant to hold.
const WORLD_HIERARCHY = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rows = () => [...document.querySelectorAll(".world-row")];
    const rowFor = (name) => rows().find((row) => (row.querySelector(".world-row-name")?.textContent || "").trim() === name);
    const names = () => rows().map((row) => (row.querySelector(".world-row-name")?.textContent || "").trim());

    const withToggle = rows().filter((row) => row.querySelector(".world-row-toggle")).length;
    const withoutToggle = rows().filter((row) => !row.querySelector(".world-row-toggle")).length;
    const leafHasToggle = Boolean(rowFor("灯室")?.querySelector(".world-row-toggle"));
    const indents = ["雾海纪", "北境城", "白塔区", "旧灯塔", "灯室"].map((name) => {
      const row = rowFor(name);
      return row ? Math.round(parseFloat(getComputedStyle(row).paddingLeft)) : -1;
    });

    rowFor("北境城").querySelector(".world-row-toggle").click();
    await sleep(400);
    const collapsed = { hasChild: names().includes("白塔区"), names: names().slice(0, 5) };
    rowFor("北境城").querySelector(".world-row-toggle").click();
    await sleep(400);
    const expanded = { hasChild: names().includes("白塔区") };

    // Selecting an entry reads it in the second pane.
    rowFor("旧灯塔").querySelector(".world-row-main").click();
    await sleep(400);
    const detail = {
      text: (document.querySelector(".world-detail")?.textContent || "").replace(/\s+/g, " ").trim(),
      sections: [...document.querySelectorAll(".world-detail-section h4")].map((node) => node.textContent.trim()),
      path: (document.querySelector(".world-detail-path")?.textContent || "").trim(),
      characters: document.querySelectorAll(".world-detail .related-chip, .world-detail .character-row").length,
      childButtons: [...document.querySelectorAll(".world-detail-children button")].map((button) => button.textContent.trim()),
      actions: [...document.querySelectorAll(".world-detail-actions button")].map((button) => button.textContent.trim()),
      selected: [...document.querySelectorAll(".world-row.selected .world-row-name")].map((node) => node.textContent.trim()),
      listStillDrawn: rows().length > 0,
    };
    // A child listed in the detail pane is a way in, not a decoration.
    document.querySelector(".world-detail-children button").click();
    await sleep(400);
    const afterChildClick = (document.querySelector(".world-detail-path")?.textContent || "").trim();

    return {
      withToggle,
      withoutToggle,
      leafHasToggle,
      indents,
      collapsed,
      expanded,
      detail,
      afterChildClick,
      rows: rows().length,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      widest: (() => {
        const limit = document.documentElement.clientWidth;
        let worst = null;
        document.querySelectorAll('*').forEach((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.right > limit + 1 && (!worst || rect.right > worst.right)) {
            worst = { right: Math.round(rect.right), tag: node.tagName + '.' + (node.className || '') };
          }
        });
        return worst;
      })(),
    };
  })()
`;

// Links that cross all three workspaces: one character connected to four others (one of
// them an uneven 师承 pointing the other way), four events, a world entry three levels
// down, a same-name pair that must not be confused, and a character with no links.
const SEED_LINKS = `
  (() => {
    const now = (day) => new Date(Date.UTC(2026, 0, 1) - day * 86400000).toISOString();
    const character = (id, name, day, extra = {}) => ({
      id, name, occupation: "调查员", worldview: "北境", avatarEmoji: "🙂",
      createdAt: now(day), updatedAt: now(day), ...extra,
    });
    const characters = [
      character("c-rich", "沈青梧", 0),
      character("c-peer1", "陆停云", 1, { avatarEmoji: "🌙" }),
      character("c-peer2", "顾行之", 2, { avatarEmoji: "🜂" }),
      character("c-peer3", "白露", 3, { avatarEmoji: "🦊" }),
      character("c-peer4", "青芜", 4, { avatarEmoji: "🐉" }),
      character("same-a", "同名角色", 5),
      character("same-b", "同名角色", 6),
      character("c-lonely", "孤立角色", 7),
    ];
    const edge = (id, fromId, toId, kind, note = "") => ({
      id, fromId, toId, kind, note, createdAt: now(8), updatedAt: now(8),
    });
    const relationships = [
      edge("rel-1", "c-rich", "c-peer1", "friend", "同门，在第七场雪之后重逢"),
      edge("rel-2", "c-peer2", "c-rich", "mentor"),
      edge("rel-3", "c-rich", "c-peer3", "family"),
      edge("rel-4", "c-rich", "c-peer4", "rival"),
      edge("rel-5", "c-peer1", "c-peer3", "friend"),
    ];
    const event = (id, title, date, kind, characterIds) => ({
      id, title, date, kind, description: title + "的经过", location: "北境",
      era: "", characterIds, createdAt: now(9), updatedAt: now(9),
    });
    const events = [
      event("ev-1", "灯塔的第一夜", "2024-03-01", "origin", ["c-rich"]),
      event("ev-2", "红藻记录", "2024-11-19", "turning", ["c-rich", "c-peer1"]),
      event("ev-3", "四十人会盟", "2025-06-14", "bond", ["c-rich", "c-peer2", "c-peer3"]),
      event("ev-4", "旧灯塔熄灯", "2026-02-27", "loss", ["c-rich"]),
      event("ev-5", "别人的事", "2025-01-05", "other", ["c-peer4"]),
      event("ev-6", "同名角色的事件", "2025-02-06", "turning", ["same-a"]),
    ];
    const entry = (id, name, category, extra = {}) => ({
      id, name, category, tags: [], characterIds: [],
      createdAt: now(10), updatedAt: now(10), ...extra,
    });
    const world = [
      entry("w-a", "雾海纪", "location", { summary: "年代与海域" }),
      entry("w-b", "北境城", "location", { parentId: "w-a", summary: "最北的聚居地" }),
      entry("w-c", "白塔区", "location", { parentId: "w-b", summary: "旧灯塔所在的一区", characterIds: ["c-rich"] }),
      entry("w-d", "星轨会", "faction", { summary: "以观测为名的组织", characterIds: ["c-rich", "c-peer2"] }),
      entry("w-e", "无关条目", "concept"),
    ];
    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.relationships", JSON.stringify(relationships));
    localStorage.setItem("character-studio.timeline", JSON.stringify(events));
    localStorage.setItem("character-studio.world", JSON.stringify(world));
    localStorage.setItem("character-studio.about-seen", "true");
    localStorage.removeItem("character-studio.graph-prefs");
    // Membership lives in the layout file, so a seed that describes "this graph" has to
    // clear it: otherwise the previous check's roster decides what is drawn, and a
    // twelve-character seed can end up with an empty canvas.
    localStorage.removeItem("character-studio.relationship-layout");
    // The graph remembers whether it was last left on 图谱 or 管理. A seed that
    // describes a graph has to start on the graph, or the check measures the
    // previous check's mode instead of its own data.
    localStorage.removeItem("character-studio.relationship-view");
    return true;
  })()
`;

// Opens the preview of a named character through its own card menu.
const OPEN_PREVIEW = (name, index = 0) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const card = [...document.querySelectorAll(".character-card")].filter(
      (node) => node.textContent.includes(${JSON.stringify(name)}),
    )[${index}];
    if (!card) throw new Error("找不到卡片：" + ${JSON.stringify(name)});
    card.querySelector('button[aria-label="更多"]').click();
    await sleep(300);
    const preview = [...document.querySelectorAll(".card-menu button")].find(
      (button) => button.textContent.trim() === "预览",
    );
    if (!preview) throw new Error("菜单里没有预览");
    preview.click();
    await sleep(900);
    return true;
  })()
`;

const READ_RELATED = `
  (() => {
    const groups = [...document.querySelectorAll(".related-group")].map((group) => ({
      title: group.querySelector("h4")?.textContent.replace(/\\s+/g, " ").trim() || "",
      count: group.querySelector(".related-count")?.textContent.trim() || "",
      rows: group.querySelectorAll(".related-row").length,
      empty: group.querySelector(".related-empty")?.textContent.trim() || "",
      more: group.querySelector(".related-more")?.textContent.trim() || "",
      peers: [...group.querySelectorAll(".related-peer-name")].map((node) => node.textContent.trim()),
      avatars: group.querySelectorAll(".related-peer-avatar").length,
      kinds: [...group.querySelectorAll(".related-kind")].map((node) => node.textContent.trim()),
      notes: [...group.querySelectorAll(".related-note")].map((node) => node.textContent.trim()),
      titles: [...group.querySelectorAll(".related-item-title")].map((node) => node.textContent.trim()),
      paths: [...group.querySelectorAll(".related-item-path")].map((node) => node.textContent.trim()),
      chrome: [...group.querySelectorAll(".related-group-action")].map((node) => node.textContent.trim()),
    }));
    return {
      present: Boolean(document.querySelector(".preview-related")),
      head: (document.querySelector(".preview-related-head")?.textContent || "").replace(/\s+/g, " ").trim(),
      groups,
      // What matters is that the reading material never reaches an export, and that the
      // page keeps one footer at the end. It used to sit outside the capture root; it now
      // sits inside it, ahead of the export footer, and is excluded by the capture's own
      // contract: data-pdf-hidden is set to display:none in the cloned document.
      excludedFromExport: Boolean(
        document.querySelector('[data-pdf-hidden="true"] .preview-related') ||
          document.querySelector('.preview-related[data-pdf-hidden="true"]'),
      ),
      relatedBeforeExportFooter: (() => {
        const related = document.querySelector(".preview-related");
        const footer = document.querySelector(".preview-export-footer");
        if (!related || !footer) return false;
        return Boolean(related.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
      exportFooterHiddenOnScreen: (() => {
        const footer = document.querySelector(".preview-export-footer");
        return footer ? getComputedStyle(footer).display === "none" : false;
      })(),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      characterName: (document.querySelector(".preview-card-title, .preview-identity")?.textContent || "").trim().slice(0, 30),
    };
  })()
`;

const READ_GRAPH_CANVAS = `
  (() => {
    const nodes = [...document.querySelectorAll(".relationship-node")];
    // A node's <text> holds a <title> and the visible tspans, so its textContent is the
    // name twice over. The title is the single copy of it.
    const labelOf = (node) => {
      const label = node.querySelector(".relationship-node-name");
      if (!label) return "";
      const title = label.querySelector("title")?.textContent;
      return (title || [...label.querySelectorAll("tspan")].map((line) => line.textContent).join("")).trim();
    };
    const names = nodes.map(labelOf);
    const images = [...document.querySelectorAll(".relationship-node-image")];
    const canvas = document.querySelector(".relationship-canvas");
    const rect = canvas?.getBoundingClientRect();
    const named = nodes.find((node) => node.querySelector(".relationship-node-name"));

    return {
      nodeCount: nodes.length,
      names: names.filter(Boolean),
      imageCount: images.length,
      emojiCount: document.querySelectorAll(".relationship-node-emoji").length,
      clipCount: document.querySelectorAll("defs clipPath").length,
      imageHref: images.length ? (images[0].getAttribute("href") || "").slice(0, 22) : "",
      zoom: (document.querySelector(".graph-zoom-readout")?.textContent || "").trim(),
      transform: document.querySelector(".relationship-canvas > g")?.getAttribute("transform") || "",
      // What the fit had to work with: the box the drawing was given, and the frame it
      // has to fit into. Both are what decides whether the drawing uses the canvas.
      viewBox: canvas?.getAttribute("viewBox") || "",
      frameWidth: (() => {
        const frame = document.querySelector(".graph-canvas-frame")?.getBoundingClientRect();
        return frame ? Math.round(frame.width) : 0;
      })(),
      canvasWidth: rect ? Math.round(rect.width) : 0,
       nameFontPx: named ? getComputedStyle(named.querySelector(".relationship-node-name")).fontSize : "",
       viewportWidth: window.innerWidth,
       // What the core view says it left out: the count has to be on screen, not only
       // in the data.
       scopeNote: (document.querySelector(".graph-scope-note")?.textContent || "").replace(/\s+/g, " ").trim(),
       toggleLabel: (document.querySelector(".graph-toggle")?.textContent || "").replace(/\s+/g, " ").trim(),
       pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()
`;

// The node's own screen centre, so a hover can be sent where the circle actually is.
const graphNodeCentre = (name) => `
  (() => {
    const labelOf = (candidate) => {
      const label = candidate.querySelector(".relationship-node-name");
      if (!label) return "";
      const title = label.querySelector("title")?.textContent;
      return (title || [...label.querySelectorAll("tspan")].map((line) => line.textContent).join("")).trim();
    };
    const node = [...document.querySelectorAll(".relationship-node")].find(
      (candidate) => labelOf(candidate) === ${JSON.stringify(name)},
    );
    if (!node) return null;
    const rect = node.querySelector("circle").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()
`;

const READ_NODE_CARD = `
  (() => {
    const card = document.querySelector(".graph-node-card");
    const holder = document.querySelector(".graph-canvas-holder");
    if (!card || !holder) return { present: false };
    const cardRect = card.getBoundingClientRect();
    const holderRect = holder.getBoundingClientRect();
    return {
      present: true,
      text: card.textContent.replace(/\\s+/g, " ").trim(),
      fields: [...card.querySelectorAll(".graph-node-card-field")].map((field) => field.textContent.replace(/\\s+/g, "")),
      overflowsLeft: cardRect.left < holderRect.left - 1,
      overflowsRight: cardRect.right > holderRect.right + 1,
      outsideFrame: !document.querySelector(".graph-canvas-frame")?.contains(card),
    };
  })()
`;

// Searching, choosing, focusing and leaving the focus — driven through the search field
// the way a writer would, and read back from the drawing.
const GRAPH_SEARCH_AND_FOCUS = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // A node label is <text><title>name</title><tspan>name</tspan></text>, so its
    // textContent reads the name twice. The title is the copy to compare.
    const labelOf = (node) => {
      const label = node?.querySelector?.(".relationship-node-name");
      if (!label) return "";
      const title = label.querySelector("title")?.textContent;
      return (title || [...label.querySelectorAll("tspan")].map((line) => line.textContent).join("")).trim();
    };
    const results = () =>
      [...document.querySelectorAll(".graph-search-panel .character-picker-option")].map((option) => ({
        name: option.querySelector(".character-row-name")?.textContent || "",
        avatar: Boolean(option.querySelector(".character-row-avatar")?.getAttribute("data-avatar-image") === "true" || option.querySelector(".character-row-avatar")),
        state: (option.querySelector(".graph-search-state")?.textContent || "").trim(),
      }));

    // Search is a compact control until it is opened, so a probe that expects the
    // field has to take the same first step a reader takes. Both halves are addressed
    // by the handles WorkspaceSearch publishes, not by the class names it used to have.
    if (!document.querySelector('[data-testid="graph-search-input"]')) {
      const trigger = document.querySelector('[data-testid="graph-search"]');
      if (!trigger) throw new Error("搜索入口缺失");
      trigger.click();
      for (let waited = 0; waited < 2000 && !document.querySelector('[data-testid="graph-search-input"]'); waited += 50) {
        await sleep(50);
      }
    }

    const field = document.querySelector('[data-testid="graph-search-input"]');
    if (!field) throw new Error("搜索框没有打开");

    const read = async (needle) => {
      setValue(field, needle);
      await sleep(300);
      return results();
    };

    const byName = await read("沈青梧");
    const byJob = await read("工匠");
    const byWorld = await read("云海");
    const namesBefore = [...document.querySelectorAll(".relationship-node")].map(labelOf);
    const before = {
      transform: document.querySelector(".relationship-canvas > g")?.getAttribute("transform") || "",
      zoom: (document.querySelector(".graph-zoom-readout")?.textContent || "").trim(),
    };

    // Search the name once more before choosing, so the option taken is the one this
    // check is about rather than whatever the last search left in the panel.
    await read("沈青梧");
    const chosen = [...document.querySelectorAll(".graph-search-panel .character-picker-option")][0];
    chosen.click();
    // Selecting somebody the core view left out adds them and their direct connections
    // to the drawing first, so the focus has to be waited for rather than sampled.
    for (let waited = 0; waited < 2500 && !document.querySelector(".relationship-node.focused"); waited += 100) {
      await sleep(100);
    }
    await sleep(300);

    const focused = {
      name: labelOf(document.querySelector(".relationship-node.focused")),
      nodeCount: document.querySelectorAll(".relationship-node").length,
      focusedCount: document.querySelectorAll(".relationship-node.focused").length,
      names: [...document.querySelectorAll(".relationship-node")].map(labelOf).filter(Boolean),
      // Names are suppressed below the legibility floor, so "who is lit" is read from
      // the node itself: every node carries its character's name as data.
      litNames: [...document.querySelectorAll(".relationship-node")]
        .filter((node) => !node.classList.contains("dimmed"))
        .map((node) => node.getAttribute("data-character-name") || ""),
      dimmedNames: [...document.querySelectorAll(".relationship-node")].filter((node) => node.classList.contains("dimmed")).map((node) => labelOf(node) || "（无名称）"),
      activeEdges: document.querySelectorAll(".relationship-edge.active").length,
      panelClosed: !document.querySelector(".graph-search-panel"),
      chip: (document.querySelector(".graph-focus-chip")?.textContent || "").trim(),
      transform: document.querySelector(".relationship-canvas > g")?.getAttribute("transform") || "",
      zoom: (document.querySelector(".graph-zoom-readout")?.textContent || "").trim(),
    };

    // Escape is the keyboard way out; the chip is the visible one.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(300);
    await sleep(200);
    const afterEscape = {
      nodeCount: document.querySelectorAll(".relationship-node").length,
      focusedCount: document.querySelectorAll(".relationship-node.focused").length,
      dimmedCount: document.querySelectorAll(".relationship-node.dimmed").length,
      activeEdges: document.querySelectorAll(".relationship-edge.active").length,
      chip: Boolean(document.querySelector(".graph-focus-chip")),
    };

    return { byName, byJob, byWorld, namesBefore, before, focused, afterEscape };
  })()
`;

// Somebody the canvas does not draw: the search has to say so, say why, and offer the
// one way to go and look.
const GRAPH_SEARCH_OFF_CANVAS = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    // Search is a compact control until it is opened, so a probe that expects the
    // field has to take the same first step a reader takes.
    if (!document.querySelector('[data-testid="graph-search-input"]')) {
      const trigger = document.querySelector('[data-testid="graph-search"]');
      if (!trigger) throw new Error("搜索入口缺失");
      trigger.click();
      for (let waited = 0; waited < 2000 && !document.querySelector('[data-testid="graph-search-input"]'); waited += 50) {
        await sleep(50);
      }
    }

    const field = document.querySelector('[data-testid="graph-search-input"]');
    // Setter on null is how this check used to fail with a bare "Illegal invocation":
    // the field it needed was never opened, and the error said nothing about that.
    if (!field) throw new Error("搜索框没有打开");
    setValue(field, "梵高");
    await sleep(300);
    const option = document.querySelector(".graph-search-panel .character-picker-option");
    const state = (option.querySelector(".graph-search-state")?.textContent || "").trim();
    option.click();
    await sleep(400);

    const notice = document.querySelector(".graph-notice");
    const before = {
      nodes: document.querySelectorAll(".relationship-node").length,
      notice: notice ? notice.textContent.replace(/\\s+/g, " ").trim() : "",
    };

    if (!notice) throw new Error("notice missing");
    notice.querySelector("button").click();
    await sleep(600);

    return {
      state,
      before,
      after: {
        nodes: document.querySelectorAll(".relationship-node").length,
        // <text> carries its own <title> as well as the tspans, so textContent would
        // read the name twice; the title is one copy of it.
        focused: (() => {
          const label = document.querySelector(".relationship-node.focused .relationship-node-name");
          if (!label) return "";
          const title = label.querySelector("title")?.textContent;
          return (title || [...label.querySelectorAll("tspan")].map((line) => line.textContent).join("")).trim();
        })(),
        notice: Boolean(document.querySelector(".graph-notice")),
        storedRelationships: JSON.parse(localStorage.getItem("character-studio.relationships") || "[]").length,
        storedCharacters: JSON.parse(localStorage.getItem("character-studio.characters") || "[]").length,
      },
    };
  })()
`;

// The display switches and the export buttons, driven and read back. Every switch
// is addressed by its row label and its own text: when this panel was reorganised
// (the 名称 row grew a third option and 头像 became 本机头像) an index-based probe
// kept clicking "the second 隐藏" and crashed on a button that no longer existed.
// A switch that cannot be found by name is a switch this check cannot vouch for,
// so it throws instead of guessing a position.
// The filter actually in force, for the summary line: ONLY can arrive as an argument
// or as the environment, and the summary is printed outside the scope that reads it.
let activeOnly = "";

const GRAPH_DISPLAY_AND_EXPORT = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const counts = () => ({
      names: document.querySelectorAll(".relationship-node-name").length,
      images: document.querySelectorAll(".relationship-node-image").length,
      emojis: document.querySelectorAll(".relationship-node-emoji").length,
    });
    const panel = () => document.querySelector(".graph-style-view");
    const rows = () => [...(panel() ? panel().querySelectorAll(".graph-panel-row") : [])];
    const rowOf = (label) =>
      rows().find(
        (candidate) => (candidate.querySelector(".graph-control-label") || {}).textContent?.trim() === label,
      );
    const optionsOf = (label) => [...((rowOf(label) || {}).querySelectorAll?.("button") || [])];
    const labelsOf = (label) => optionsOf(label).map((button) => button.textContent.trim());
    const pressedOf = (label) =>
      optionsOf(label)
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.textContent.trim());
    const choose = (label, text) => {
      const button = optionsOf(label).find((candidate) => candidate.textContent.trim() === text);
      if (!button) throw new Error("缺少开关：" + label + " / " + text);
      button.click();
    };
    const prefs = () => JSON.parse(localStorage.getItem("character-studio.graph-prefs") || "{}");
    const policyHint = () => ((document.querySelector('[data-testid="name-policy"]') || {}).textContent || "").trim();
    // The two stores a display switch has no business touching.
    const stored = () => ({
      characters: localStorage.getItem("character-studio.characters"),
      relationships: localStorage.getItem("character-studio.relationships"),
    });

    const storedBefore = stored();
    const entry = document.querySelector('button[aria-label="外观设置"]');
    if (!entry) throw new Error("外观入口缺失");
    entry.click();
    await sleep(450);

    const openedPanel = panel();
    if (!openedPanel) throw new Error("显示设置没有打开");
    const panelRect = openedPanel.getBoundingClientRect();
    const opened = {
      present: true,
      labels: rows().map((row) => (row.querySelector(".graph-control-label") || {}).textContent?.trim() || ""),
      insideViewport:
        panelRect.left >= -1 && panelRect.right <= window.innerWidth + 1 && panelRect.top >= -1,
      namesBefore: counts().names,
      nameOptions: labelsOf("名称"),
      avatarOptions: labelsOf("本机头像"),
    };

    // 名称: three readings of one preference, so each has to be told apart.
    choose("名称", "隐藏");
    await sleep(300);
    const namesHidden = { ...counts(), pressed: pressedOf("名称"), hint: policyHint(), prefs: prefs() };

    choose("名称", "自动");
    await sleep(300);
    const namesAuto = { ...counts(), pressed: pressedOf("名称"), hint: policyHint(), prefs: prefs() };

    choose("名称", "全部");
    await sleep(300);
    const namesAll = { ...counts(), pressed: pressedOf("名称"), hint: policyHint(), prefs: prefs() };
    choose("名称", "自动");
    await sleep(200);

    // 本机头像: pictures and emoji are the two things a node can draw.
    choose("本机头像", "隐藏");
    await sleep(300);
    const avatarsHidden = { ...counts(), pressed: pressedOf("本机头像"), prefs: prefs() };

    choose("本机头像", "显示");
    await sleep(300);
    const avatarsBack = { ...counts(), pressed: pressedOf("本机头像"), prefs: prefs() };

    entry.click();
    await sleep(350);
    const closed = !document.querySelector(".graph-page-drawer");

    // Output sits behind its own toggle, and each format carries its own test id:
    // the labels around it have been rewritten twice, the ids have not.
    const exportToggle = [...document.querySelectorAll(".graph-display-wrap > button")].find(
      (button) => button.textContent.trim() === "导出",
    );
    if (!exportToggle) throw new Error("导出入口缺失");
    exportToggle.click();
    await sleep(350);
    const exportPanel = document.querySelector('[aria-label="导出关系网"]');
    if (!exportPanel) throw new Error("导出面板没有打开");
    const exportRect = exportPanel.getBoundingClientRect();

    const formats = [...exportPanel.querySelectorAll('[aria-label="导出格式"] [data-testid^="export-"]')].map(
      (button) => ({
        id: (button.getAttribute("data-testid") || "").replace("export-", ""),
        label: button.textContent.replace(/\\s+/g, " ").trim(),
      }),
    );

    // The outcome message is transient, so it is waited for rather than sampled once:
    // sleeping a fixed few seconds reads an empty node whether the export succeeded or
    // the whole thing is still running.
    const message = () => (document.querySelector(".graph-message")?.textContent || "").trim();
    const waitForMessage = async (timeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (message()) return message();
        await sleep(200);
      }
      return "";
    };
    const waitForClear = async (timeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline && message()) {
        await sleep(200);
      }
    };

    const messages = [];
    for (const format of ["png", "svg", "jpg", "pdf"]) {
      const button = exportPanel.querySelector('[data-testid="export-' + format + '"]');
      // Reported rather than thrown, so one missing format still shows the other three.
      if (!button) {
        messages.push("缺少导出按钮：" + format);
        continue;
      }
      // Each format starts from an empty node, so a message can only be its own.
      await waitForClear(6000);
      button.click();
      messages.push((await waitForMessage(30000)) || "（没有结果提示）");
    }

    return {
      opened,
      namesHidden,
      namesAuto,
      namesAll,
      avatarsHidden,
      avatarsBack,
      closed,
      exportOpen: {
        present: true,
        formats,
        insideViewport:
          exportRect.right <= window.innerWidth + 1 && exportRect.left >= -1 && exportRect.bottom >= 0,
      },
      messages,
      storedUntouched:
        stored().characters === storedBefore.characters &&
        stored().relationships === storedBefore.relationships,
    };
  })()
`;

// Forty-five edges over twelve characters: three pages of twenty, five kinds, and one
// note that can only be found by its words rather than by either character's name.
const SEED_MANAGE = `(() => {
  const now = "2026-01-01T00:00:00.000Z";
  const names = ["沈砚", "林雾生", "顾长庚", "白露", "苏荇", "谢云归", "程五", "阿禾", "洛澄", "江照", "岑野", "陆停云"];
  const ids = names.map((_, index) => "m-" + (index + 1));
  const characters = names.map((name, index) => ({
    id: ids[index], name, occupation: "记录官", worldview: "雾海", avatarEmoji: "🙂", createdAt: now, updatedAt: now,
  }));
  const kinds = ["friend", "mentor", "family", "colleague", "rival"];
  const relationships = Array.from({ length: 45 }, (_, index) => ({
    id: "mr-" + (index + 1),
    fromId: ids[index % 12],
    toId: ids[(index * 5 + 3) % 12],
    kind: kinds[index % 5],
    note: index === 7 ? "同门，雪夜之后重逢" : "第" + (index + 1) + "条备注",
    createdAt: now,
    updatedAt: now,
  }));
  localStorage.setItem("character-studio.characters", JSON.stringify(characters));
  localStorage.setItem("character-studio.relationships", JSON.stringify(relationships));
  localStorage.setItem("character-studio.timeline", JSON.stringify([]));
  localStorage.setItem("character-studio.world", JSON.stringify([]));
  localStorage.setItem("character-studio.about-seen", "true");
  localStorage.removeItem("character-studio.graph-prefs");
    // Membership lives in the layout file, so a seed that describes "this graph" has to
    // clear it: otherwise the previous check's roster decides what is drawn, and a
    // twelve-character seed can end up with an empty canvas.
    localStorage.removeItem("character-studio.relationship-layout");
  // The graph remembers whether it was last left on 图谱 or 管理. A seed that
  // describes a graph has to start on the graph, or the check measures the
  // previous check's mode instead of its own data.
  localStorage.removeItem("character-studio.relationship-view");
  return relationships.length;
})()`;

const GRAPH_MANAGE = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rows = () => [...document.querySelectorAll(".manage-table tbody tr")];
    const rowText = (row) => row.textContent.replace(/\\s+/g, " ").trim();
    const pager = () => (document.querySelector(".relationship-pager")?.textContent || "").replace(/\\s+/g, " ").trim();
    const total = () => (document.querySelector(".manage-toolbar .timeline-count")?.textContent || "").trim();
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setSelect = (select, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    // Row actions live behind one menu per row; opening it is what a reader does
    // before editing, locating or deleting.
    const openRowMenu = async (row) => {
      row.querySelector(".manage-row-more").click();
      await sleep(140);
    };
    const menuItem = (label) =>
      [...document.querySelectorAll(".manage-row-menu button")].find(
        (button) => button.textContent.trim() === label,
      );
    const initial = { rows: rows().length, pager: pager(), total: total() };

    const next = () => [...document.querySelectorAll(".relationship-pager button")].find((button) => button.textContent.trim() === "下一页");
    next().click();
    await sleep(250);
    const page2 = { rows: rows().length, pager: pager() };
    [...document.querySelectorAll(".relationship-pager button")].find((button) => button.textContent.trim() === "上一页").click();
    await sleep(250);

    const search = document.querySelector(".manage-search input");
    setValue(search, "同门");
    await sleep(300);
    const byNote = { rows: rows().length, texts: rows().map(rowText), total: total(), pager: pager() };
    setValue(search, "林雾生");
    await sleep(300);
    const byName = { rows: rows().length, texts: rows().map(rowText) };
    setValue(search, "");
    await sleep(300);

    const kindSelect = document.querySelector('select[aria-label="按关系类型筛选"]');
    setSelect(kindSelect, "mentor");
    await sleep(300);
    const mentors = rows().map((row) => ({
      chip: row.querySelector(".relationship-kind-chip")?.textContent.trim() || "",
      arrow: row.querySelector(".manage-direction")?.textContent.trim() || "",
      from: row.children[0]?.textContent.trim() || "",
      to: row.children[2]?.textContent.trim() || "",
    }));
    setSelect(kindSelect, "all");
    await sleep(250);

    const sortSelect = document.querySelector('select[aria-label="关系排序"]');
    setSelect(sortSelect, "kind");
    await sleep(300);
    const kindOrder = rows().map((row) => row.querySelector(".relationship-kind-chip")?.textContent.trim() || "");
    setSelect(sortSelect, "person");
    await sleep(250);

    const characterSelect = document.querySelector('select[aria-label="按关联角色筛选"]');
    const picked = characterSelect.options[1];
    setSelect(characterSelect, picked.value);
    await sleep(300);
    const byCharacter = { name: picked.textContent.trim(), rows: rows().length, texts: rows().map(rowText) };
    setSelect(characterSelect, "all");
    await sleep(250);

    const stored = () => JSON.parse(localStorage.getItem("character-studio.relationships") || "[]");
    const beforeEdit = stored().length;
    await openRowMenu(rows()[0]);
    menuItem("编辑").click();
    await sleep(300);
    const editDialog = document.querySelector('.confirm-dialog[aria-label="编辑关系"]');
    const editTitle = editDialog?.querySelector("h2")?.textContent.trim() || "";
    const noteInput = editDialog?.querySelector('input[type="text"]');
    setValue(noteInput, "改过的备注");
    [...editDialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "保存修改").click();
    await sleep(450);
    const afterEdit = {
      rowsWithNote: rows().filter((row) => rowText(row).includes("改过的备注")).length,
      storedWithNote: stored().filter((edge) => edge.note === "改过的备注").length,
      count: stored().length,
      dialogClosed: !document.querySelector('.confirm-dialog[aria-label="编辑关系"]'),
    };

    // Deleting has to name the two characters — including when the canvas is not drawing
    // them, which is the case for most of a large roster.
    const targetRow = rows()[0];
    const targetText = rowText(targetRow);
    await openRowMenu(targetRow);
    menuItem("删除").click();
    await sleep(300);
    const deleteText = (document.querySelector('.confirm-dialog[aria-label="删除关系"] p')?.textContent || "").replace(/\\s+/g, " ").trim();
    [...document.querySelectorAll('.confirm-dialog[aria-label="删除关系"] button')].find((button) => button.textContent.trim() === "确认删除").click();
    await sleep(450);
    const afterDelete = { count: stored().length, total: total(), pager: pager(), rows: rows().length };

    // 定位 leaves the table for the drawing, focused on the edge's first character.
    await openRowMenu(rows()[0]);
    menuItem("定位").click();
    await sleep(600);
    const located = {
      page: Boolean(document.querySelector(".relationship-canvas")),
      chip: (document.querySelector(".graph-focus-chip")?.textContent || "").replace(/\\s+/g, " ").trim(),
      focused: document.querySelectorAll(".relationship-node.focused").length,
      edges: document.querySelectorAll(".relationship-edge").length,
    };

    return { initial, page2, byNote, byName, mentors, kindOrder, byCharacter, beforeEdit, editTitle, afterEdit, targetText, deleteText, afterDelete, located };
  })()
`;

const GRAPH_MANAGE_NARROW = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rows = () => [...document.querySelectorAll(".manage-table tbody tr")];
    const first = rows()[0];
    const box = first?.getBoundingClientRect();
    // The row's three commands live in one menu now; opening it is the step a
    // thumb takes before any of them.
    first?.querySelector(".manage-row-more")?.click();
    await sleep(160);
    const actions = [...document.querySelectorAll(".manage-row-menu button")].map((button) => ({
      text: button.textContent.trim(),
      visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
    }));
    const state = {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: rows().length,
      rowDisplay: first ? getComputedStyle(first).display : "",
      rowWidth: box ? Math.round(box.width) : 0,
      viewport: window.innerWidth,
      actions,
      // No row is wider than the column it sits in: the five columns are stacked into
      // an entry rather than squeezed.
      rowsWider: rows().filter((row) => row.scrollWidth > row.clientWidth + 1).length,
      toolbarInside: (() => {
        const toolbar = document.querySelector(".manage-toolbar");
        return toolbar ? toolbar.getBoundingClientRect().right <= window.innerWidth + 1 : false;
      })(),
    };

    [...document.querySelectorAll(".manage-row-menu button")]
      .find((button) => button.textContent.trim() === "编辑")
      .click();
    await sleep(300);
    const dialog = document.querySelector('.confirm-dialog[aria-label="编辑关系"]');
    const dialogBox = dialog?.getBoundingClientRect();
    state.dialog = {
      open: Boolean(dialog),
      inside: dialogBox ? dialogBox.left >= -1 && dialogBox.right <= window.innerWidth + 1 : false,
    };
    [...(dialog?.querySelectorAll("button") || [])].find((button) => button.textContent.trim() === "取消")?.click();
    await sleep(200);
    state.dialogClosed = !document.querySelector('.confirm-dialog[aria-label="编辑关系"]');

    return state;
  })()
`;

// What a phone actually sees: how many node centres are inside the canvas box, which is
// the difference between "a wheel" and "edges crossing an empty screen".
const GRAPH_MOBILE_VIEW = `
  (() => {
    const svg = document.querySelector(".relationship-canvas");
    const box = svg?.getBoundingClientRect();
    const centres = [...document.querySelectorAll(".relationship-node")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, lit: !node.classList.contains("dimmed") };
    });
    const inside = (point) => Boolean(box) && point.x >= box.left - 1 && point.x <= box.right + 1 && point.y >= box.top - 1 && point.y <= box.bottom + 1;
    return {
      mode: (document.querySelector(".graph-segment-button.selected")?.textContent || "").trim(),
      nodes: centres.length,
      inside: centres.filter(inside).length,
      lit: centres.filter((point) => point.lit).length,
      litInside: centres.filter((point) => point.lit && inside(point)).length,
      focused: document.querySelectorAll(".relationship-node.focused").length,
      zoom: (document.querySelector(".graph-zoom-readout")?.textContent || "").trim(),
      fitButton: Boolean(document.querySelector('button[aria-label="适应画布"]')),
      chip: (document.querySelector(".graph-focus-chip")?.textContent || "").replace(/\\s+/g, " ").trim(),
      frame: box ? [Math.round(box.width), Math.round(box.height)] : null,
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scopeNote: (document.querySelector(".graph-scope-note")?.textContent || "").replace(/\\s+/g, " ").trim(),
    };
  })()
`;

// The mechanism behind "a picture avatar survives the export": html2canvas serialises
// the canvas SVG and loads it back as an image, where a blob: URL cannot resolve and a
// data URL can. Asserted with a pixel rather than with "the image loaded".
const IMAGE_IN_SVG_PROBE = `
  (async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 8;
    source.getContext("2d").fillStyle = "#ff0000";
    source.getContext("2d").fillRect(0, 0, 8, 8);
    const dataUrl = source.toDataURL("image/png");
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="' + dataUrl + '" width="16" height="16"/></svg>';
    const image = new Image();
    const loaded = await new Promise((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    });
    if (!loaded) return { loaded: false };
    const surface = document.createElement("canvas");
    surface.width = 16;
    surface.height = 16;
    const context = surface.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(8, 8, 1, 1).data;
    return { loaded: true, pixel: [pixel[0], pixel[1], pixel[2], pixel[3]] };
  })()
`;

// The multi-select on a hundred characters: search narrows, the count follows the
// choices, and the search term survives choosing.
const READ_WORLD_MULTI_PICKER = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const click = (node) => node && node.click();

    click([...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建条目"));
    await sleep(400);

    const named = [...document.querySelectorAll(".confirm-dialog label.field")].find((label) =>
      label.textContent.trim().startsWith("名称"),
    );
    const nameInput = named && named.querySelector("input");
    if (!nameInput) throw new Error("name field missing");
    setValue(nameInput, "雾海纪");
    await sleep(150);

    const names = () => [...document.querySelectorAll(".character-picker-list .character-row-name")].map((node) => node.textContent);
    const input = document.querySelector(".character-picker-search input");

    setValue(input, "工匠");
    await sleep(250);
    const matched = names().length;
    const orderBefore = names();

    const boxes = [...document.querySelectorAll(".character-picker-list input[type='checkbox']")];
    click(boxes[0]);
    await sleep(200);
    click(document.querySelectorAll(".character-picker-list input[type='checkbox']")[1]);
    await sleep(200);
    const afterTwo = document.querySelector(".character-picker-count").textContent.replace(/\s+/g, " ").trim();
    // The order the list had before anything was ticked, read after two ticks.
    const orderAfterChoosing = names();
    const checkedCount = document.querySelectorAll(".character-picker-list input[type='checkbox']:checked").length;
    const keptQuery = input.value;

    setValue(input, "陆停云");
    await sleep(250);
    const narrowed = names().length;

    const save = [...document.querySelectorAll(".confirm-dialog button")].find((button) => button.textContent.trim() === "保存条目");
    const saveDisabled = save ? save.disabled : true;
    if (save && !save.disabled) { save.click(); await sleep(400); }
    const world = JSON.parse(localStorage.getItem("character-studio.world") || "[]");

    return {
      matched,
      orderBefore,
      orderAfterChoosing,
      checkedCount,
      afterTwo,
      narrowed,
      keptQuery,
      saveDisabled,
      saved: world.map((entry) => (entry.characterIds || []).length),
    };
  })()
`;


// Requirement: the opened list must not cover the dialog's own buttons on a phone.
// The panel opens in the flow instead of on top of it, so this measures the two
// rectangles rather than trusting the intent.
const READ_PICKER_OVERLAP = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const open = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建关系");
    open.click();
    await sleep(400);
    document.querySelectorAll(".character-select-trigger")[0].click();
    await sleep(400);

    const panel = document.querySelector(".character-select-panel");
    const save = [...document.querySelectorAll(".confirm-dialog button")].find((button) => button.textContent.trim() === "保存关系");
    const dialog = document.querySelector(".confirm-dialog");
    const panelRect = panel.getBoundingClientRect();
    const saveRect = save.getBoundingClientRect();

    return {
      panelBottom: Math.round(panelRect.bottom),
      saveTop: Math.round(saveRect.top),
      overlaps: panelRect.bottom > saveRect.top && panelRect.top < saveRect.bottom,
      saveVisibleInDialog: Math.round(saveRect.top) < Math.round(dialog.getBoundingClientRect().bottom),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      panelWidth: Math.round(panelRect.width),
      viewportWidth: window.innerWidth,
    };
  })()
`;


// A workspace where one event and one entry each carry forty characters - the case
// that used to fill a card with chips.
const SEED_CROWDED = `
  (() => {
    const now = new Date().toISOString();
    const characters = Array.from({ length: 40 }, (_, index) => ({
      id: "crowd-" + (index + 1),
      name: "角色" + String(index + 1).padStart(2, "0"),
      occupation: ["调查员", "魔法师", "工匠"][index % 3],
      worldview: "北境",
      avatarEmoji: "🙂",
      createdAt: now,
      updatedAt: now,
    }));
    const ids = characters.map((character) => character.id);
    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.timeline", JSON.stringify([{
      id: "tl-crowd",
      title: "四十人会盟",
      date: "2026-03-03",
      era: "",
      kind: "origin",
      characterIds: ids,
      description: "一次性到场的四十人。",
      location: "北境",
      createdAt: now,
      updatedAt: now,
    }]));
    localStorage.setItem("character-studio.world", JSON.stringify([{
      id: "w-crowd",
      name: "雾海纪",
      category: "location",
      parentId: "",
      summary: "关联角色很多的地点。",
      details: "",
      tags: [],
      characterIds: ids,
      createdAt: now,
      updatedAt: now,
    }]));
    localStorage.setItem("character-studio.about-seen", "true");
    return true;
  })()
`;

// What the event card shows before and after asking for the full list.
const READ_CROWDED_CARD = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const names = (scope) => [...scope.querySelectorAll(".character-row-name")].map((node) => node.textContent);
    const chips = [...document.querySelectorAll(".related-characters .related-chip")];
    const before = chips.map((chip) => chip.querySelector(".character-row-name")?.textContent || chip.textContent.trim());

    chips[chips.length - 1].click();
    await sleep(350);

    const list = document.querySelector(".related-characters-list");
    const opened = { rows: list ? list.querySelectorAll(".character-picker-option").length : 0, first: list ? names(list)[0] : "", last: list ? names(list).at(-1) : "" };
    const header = (document.querySelector(".related-characters-head .character-picker-count") || {}).textContent || "";

    const input = document.querySelector(".character-picker-search input");
    setValue(input, "角色1");
    await sleep(250);
    const filtered = document.querySelectorAll(".related-characters-list .character-picker-option").length;
    setValue(input, "");
    await sleep(250);
    const restored = document.querySelectorAll(".related-characters-list .character-picker-option").length;

    // An eighth row: 角色08. This is the existing detail entry point.
    document.querySelectorAll(".related-characters-list .character-picker-option")[7].click();
    await sleep(500);

    return {
      before,
      opened,
      header: header.replace(/\s+/g, " ").trim(),
      filtered,
      restored,
      previewOpen: Boolean(document.querySelector("section.preview-page")),
      previewText: (document.querySelector("section.preview-page") || document.body).textContent.includes("角色08"),
    };
  })()
`;

// The same display on a world entry, and what it does on a phone.
const READ_WORLD_CROWDED = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // The related characters of an entry now live in the reading pane, so the row has
    // to be selected first: the list itself shows a count.
    const row = [...document.querySelectorAll(".world-row")].find(
      (candidate) => (candidate.querySelector(".world-row-stats")?.textContent || "").includes("位角色"),
    );
    if (row) {
      row.querySelector(".world-row-main").click();
      await sleep(400);
    }
    const pane = document.querySelector(".world-detail");
    const chips = pane ? [...pane.querySelectorAll(".related-chip")] : [];
    return {
      chips: chips.map((chip) => chip.querySelector(".character-row-name")?.textContent || chip.textContent.trim()),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()
`;


// The list view's first column: the avatar and the name have to sit on the row's
// centre line, and on each other's. Measured because "looks slightly off" is not a
// thing a screenshot settles.
const READ_LIST_ALIGNMENT = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let toggle = document.querySelector('button[aria-label="切换列表视图"]');
    if (!toggle) {
      // Phones keep the view switch in the 更多 sheet.
      document.querySelector('button[aria-label="更多操作"]')?.click();
      await sleep(350);
      toggle = [...document.querySelectorAll('[data-testid="more-sheet"] .sheet-menu button')]
        .find((button) => button.textContent.includes("切换为列表视图"));
    }
    if (toggle) { toggle.click(); await sleep(400); }
    // Bulk mode adds a select circle to the same cell, so it is a second layout to
    // measure rather than a second thing to assume.
    const bulk = document.querySelector('button[aria-label="批量选择"]');
    if (bulk && !document.querySelector(".character-table .select-circle")) {
      bulk.click();
      await sleep(400);
    }
    const rows = [...document.querySelectorAll(".character-table-row")];
    const centre = (node) => {
      const rect = node.getBoundingClientRect();
      return (rect.top + rect.bottom) / 2;
    };
    const round = (value) => Math.round(value * 10) / 10;
    return {
      rows: rows.length,
      cells: rows.slice(0, 6).map((row) => {
        const circle = row.querySelector(".select-circle");
        const avatar = row.querySelector(".table-avatar");
        const name = row.querySelector(".table-main strong");
        const second = row.children[1];
        const rowCentre = centre(row);
        return {
          avatar: round(centre(avatar) - rowCentre),
          name: round(centre(name) - rowCentre),
          between: round(centre(avatar) - centre(name)),
          circle: circle ? round(centre(circle) - rowCentre) : null,
          second: second ? round(centre(second) - rowCentre) : null,
        };
      }),
    };
  })()
`;

// The band between the sticky top bar and the sticky group head: if there is one,
// the page behind scrolls through it.
const READ_STICKY_GAP = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // Group heads exist only in the card view with a large roster, and the view mode
    // is a persisted preference - so it has to be read, not assumed.
    const toCards = document.querySelector('button[aria-label="切换卡片视图"]');
    if (toCards) { toCards.click(); await sleep(400); }
    window.scrollTo(0, 0);
    await sleep(200);
    window.scrollTo(0, 1200);
    await sleep(500);
    const topbar = document.querySelector(".topbar");
    const topbarRect = topbar.getBoundingClientRect();
    const hex = (node) => getComputedStyle(node).backgroundColor;
    const stuck = [...document.querySelectorAll(".character-group-head")].find((head) => {
      const rect = head.getBoundingClientRect();
      return rect.top >= 0 && rect.top < topbarRect.bottom + 40;
    });
    const round = (value) => Math.round(value * 10) / 10;
    return {
      scrollY: Math.round(window.scrollY),
      topbarBottom: round(topbarRect.bottom),
      topbarHeight: round(topbarRect.height),
      cssVar: getComputedStyle(document.documentElement).getPropertyValue("--topbar-height").trim(),
      topbarBackground: hex(topbar),
      heads: document.querySelectorAll(".character-group-head").length,
      stuckTop: stuck ? round(stuck.getBoundingClientRect().top) : null,
      gap: stuck ? round(stuck.getBoundingClientRect().top - topbarRect.bottom) : null,
      headBackground: stuck ? hex(stuck) : "",
      toggleBackground: stuck ? hex(stuck.querySelector("button")) : "",
    };
  })()
`;

// Installed before any app script runs, so a runtime error during boot is recorded
// rather than lost: the page it would be reported on is the one being reloaded.
const ERROR_COLLECTOR = `
  window.__csErrors = [];
  window.addEventListener("error", (event) => {
    window.__csErrors.push(String(event.message || event.error || "error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.__csErrors.push("rejection: " + String(event.reason));
  });
`;

// A roster built for the dashboard's own cards: 36 characters in three worldviews
// (18 / 12 / 6), so the grouping view is on and its counts differ from each other.
// One name is long enough to need a second line, one sits in the biggest group so a
// search can be aimed at a group that is collapsed, and the flags name one pinned and
// one favourite character so a card's state can be read from the card.
const dashboardSeed = ({ flags = true, dropPrefs = true } = {}) => `
  (() => {
    const now = (day) => new Date(Date.UTC(2026, 0, 1) - day * 86400000).toISOString();
    const worlds = [["北境", 18], ["云海", 12], ["雾隐", 6]];
    const characters = [];
    let index = 0;

    for (const [worldview, count] of worlds) {
      for (let i = 0; i < count; i += 1) {
        index += 1;
        characters.push({
          id: "dash-" + index,
          name: "第" + String(index).padStart(2, "0") + "位" + worldview + "人",
          occupation: ["调查员", "魔法师", "工匠"][index % 3],
          worldview,
          age: String(20 + (index % 30)),
          avatarEmoji: "🙂",
          personalityTags: ["冷静", "寡言", "夜行", "记仇", "爱笑", "怕黑"],
          createdAt: now(index),
          updatedAt: now(index),
        });
      }
    }

    // The search target: the first card of the biggest group.
    characters[0] = {
      ...characters[0],
      id: "dash-target",
      name: "沈青梧",
      occupation: "调查员",
      updatedAt: now(0),
      createdAt: now(400),
    };
    // A name that cannot fit on one line of a card.
    characters[1] = { ...characters[1], id: "dash-long", name: "名字很长的守夜人第二席代理记录官" };

    localStorage.setItem("character-studio.characters", JSON.stringify(characters));
    localStorage.setItem("character-studio.relationships", JSON.stringify([]));
    localStorage.setItem("character-studio.timeline", JSON.stringify([]));
    localStorage.setItem("character-studio.world", JSON.stringify([]));
    ${flags ? `localStorage.setItem(
      "character-studio.dashboard-flags",
      JSON.stringify({ favoriteIds: ["dash-4"], pinnedIds: ["dash-3"] }),
    );` : ""}
    ${dropPrefs ? `localStorage.removeItem("character-studio.dashboard-prefs");` : ""}
    localStorage.setItem("character-studio.about-seen", "true");
    return true;
  })()
`;

const SEED_DASHBOARD = dashboardSeed();

// What a card actually says and how it says it: the name as the focal point, 职业 and
// 世界观 together, 年龄 lighter, the state badges, the tag remainder, and the two
// timestamps at two different weights.
const READ_DASHBOARD_CARDS = `
  (() => {
    const cards = [...document.querySelectorAll(".character-card")];
    const byName = (name) =>
      cards.find((card) => (card.querySelector(".card-title-button") || {}).textContent === name);
    const fontSize = (node) => (node ? parseFloat(getComputedStyle(node).fontSize) : null);
    const weight = (node) => (node ? getComputedStyle(node).fontWeight : "");
    const lines = (node) => {
      if (!node) return null;
      return Math.round(node.getBoundingClientRect().height / (parseFloat(getComputedStyle(node).lineHeight) || 1));
    };

    const target = byName("沈青梧");
    const longName = byName("名字很长的守夜人第二席代理记录官");
    // The flags name ids, and the migration moves them onto the records, so the card
    // that carries 收藏 is the one whose id was listed: dash-4, 第04位北境人.
    const favourite = cards.find((card) => card.querySelector(".card-title-button")?.textContent === "第04位北境人");
    const pinned = cards.find((card) => card.querySelector(".card-title-button")?.textContent === "第03位北境人");
    const first = cards[0];

    return {
      count: cards.length,
      groupIndex: [...document.querySelectorAll(".card-group-chip")].map((chip) => ({
        name: chip.querySelector("span")?.textContent.trim() || "",
        count: chip.querySelector("em")?.textContent.trim() || "",
      })),
      heads: [...document.querySelectorAll(".character-group-toggle")].map((head) => ({
        name: head.querySelector("span")?.textContent.trim() || "",
        count: head.querySelector("em")?.textContent.trim() || "",
        expanded: head.getAttribute("aria-expanded"),
        disabled: head.disabled,
      })),
      // Name vs the two secondary lines vs the age fragment.
      nameSize: fontSize(first?.querySelector(".card-title-button")),
      nameWeight: weight(first?.querySelector(".card-title-button")),
      subtitleSize: fontSize(first?.querySelector(".card-subtitle-primary")),
      subtitleWeight: weight(first?.querySelector(".card-subtitle-primary")),
      ageSize: fontSize(first?.querySelector(".card-age-fragment")),
      ageWeight: weight(first?.querySelector(".card-age-fragment")),
      longNameLines: lines(longName?.querySelector(".card-title-button")),
      // The name is deliberately allowed two lines, so what the check can ask is that
      // it uses the second one rather than being cut to a single line, and that the
      // whole name is still readable without leaving the card.
      longNameTitle: longName?.querySelector(".card-title-button")?.title || "",
      subtitle: (first?.querySelector(".card-subtitle-button")?.textContent || "").replace(/\\s+/g, " ").trim(),
      chips: [...(target?.querySelectorAll(".card-tags > *") || [])].map((chip) => chip.textContent.trim()),
      moreTitle: (target?.querySelector(".card-tag-more") || {}).title || "",
      favouriteBadge: Boolean(favourite?.querySelector(".status-badge.favorite")),
      pinnedBadge: Boolean(pinned?.querySelector(".status-badge.pinned")),
      editedSize: fontSize(first?.querySelector(".card-time-edited")),
      createdSize: fontSize(first?.querySelector(".card-time-created")),
      editedWeight: weight(first?.querySelector(".card-time-edited")),
      createdWeight: weight(first?.querySelector(".card-time-created")),
      timeTitle: (first?.querySelector(".card-time-button") || {}).title || "",
      cardHeights: [...new Set(cards.slice(0, 8).map((card) => Math.round(card.getBoundingClientRect().height)))],
      // The same eight cards, grouped by the row they sit in, so "the row agrees with
      // itself" can be asked separately from "every row is the same height".
      cardRowHeights: (() => {
        const rows = new Map();
        cards.slice(0, 8).forEach((card) => {
          const rect = card.getBoundingClientRect();
          const key = Math.round(rect.top);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push(Math.round(rect.height));
        });
        return [...rows.values()].map((heights) => [...new Set(heights)]);
      })(),
    };
  })()
`;

// Jump-to-group: the chip has to expand its group, land the head clear of the top bar
// and mark it, and the counts on the chip and on the head have to agree.
const LOCATE_DASHBOARD_GROUP = (group) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const chip = [...document.querySelectorAll(".card-group-chip")].find(
      (node) => (node.querySelector("span") || {}).textContent.trim() === ${JSON.stringify(group)},
    );
    if (!chip) throw new Error("找不到分组按钮：" + ${JSON.stringify(group)});
    const chipCount = (chip.querySelector("em") || {}).textContent.trim();
    chip.click();
    await sleep(1400);

    const head = [...document.querySelectorAll(".character-group-head")].find(
      (node) => (node.querySelector(".character-group-toggle span") || {}).textContent.trim() === ${JSON.stringify(group)},
    );
    const rect = head ? head.getBoundingClientRect() : null;
    const topbarBottom = document.querySelector(".topbar").getBoundingClientRect().bottom;
    return {
      chipCount,
      marked: Boolean(head && head.className.includes("located")),
      headCount: (head?.querySelector(".character-group-toggle em") || {}).textContent.trim() || "",
      expanded: head?.querySelector(".character-group-toggle").getAttribute("aria-expanded") || "",
      headTop: rect ? Math.round(rect.top) : null,
      topbarBottom: Math.round(topbarBottom),
      belowTopbar: Boolean(rect && rect.top >= topbarBottom - 2),
      inViewport: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0),
    };
  })()
`;

// Collapse a group, then search for a character that lives in it: a match must not be
// hidden by a group the reader collapsed while browsing, and clearing the search has to
// give them back the state they left.
const SEARCH_INSIDE_COLLAPSED_GROUP = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // The dashboard search is a collapsible WorkspaceSearch: the field only exists after
    // its trigger is pressed, so every read/write goes through this.
    const openDashboardSearch = () => {
      if (document.querySelector('[data-testid="dashboard-search-input"]')) return;
      const trigger = document.querySelector('[data-testid="dashboard-search"]');
      if (!trigger) throw new Error("找不到搜索入口：" + '[data-testid="dashboard-search"]');
      trigger.click();
    };
    const toCards = document.querySelector('button[aria-label="切换卡片视图"]');
    if (toCards) { toCards.click(); await sleep(500); }
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const cards = () => [...document.querySelectorAll(".character-card")];
    const has = (name) => cards().some((card) => card.querySelector(".card-title-button")?.textContent === name);
    // How many characters the search found, as the list itself reports it — the count
    // drawn has to agree with the count claimed, not with a number written here.
    const matches = () =>
      Number((document.querySelector(".list-section-title span")?.textContent || "").replace(/[^0-9]/g, "")) || 0;
    const headOf = (group) =>
      [...document.querySelectorAll(".character-group-head")].find(
        (node) => (node.querySelector(".character-group-toggle span") || {}).textContent.trim() === group,
      );
    const headState = (group) => {
      const head = headOf(group);
      const toggle = head ? head.querySelector(".character-group-toggle") : null;
      const count = toggle ? toggle.querySelector("em") : null;
      return {
        found: Boolean(toggle),
        expanded: toggle ? toggle.getAttribute("aria-expanded") || "" : "missing",
        disabled: Boolean(toggle && toggle.disabled),
        count: count ? count.textContent.trim() : "",
      };
    };

    const toggle = headOf("北境").querySelector(".character-group-toggle");
    if (!toggle) throw new Error("北境分组头没有渲染出来");
    const beforeCards = cards().length;
    toggle.click();
    await sleep(400);
    const collapsed = { ...headState("北境"), cards: cards().length, targetVisible: has("第05位北境人") };

    openDashboardSearch();
    await sleep(400);
    // A needle every character matches: it keeps the list over the grouping threshold,
    // which is what makes the question meaningful — a group narrowed to a handful of
    // characters stops being grouped at all, and then nothing could hide the match.
    setValue(document.querySelector('[data-testid="dashboard-search-input"]'), "人");
    await sleep(700);
    const searching = { ...headState("北境"), cards: cards().length, matches: matches(), targetVisible: has("第05位北境人"), groups: document.querySelectorAll(".character-group-head").length };

    setValue(document.querySelector('[data-testid="dashboard-search-input"]'), "");
    await sleep(700);
    const cleared = { ...headState("北境"), cards: cards().length, targetVisible: has("第05位北境人") };
    return { beforeCards, collapsed, searching, cleared };
  })()
`;

// The selection bar: what it says, which of the crowded controls stand down while it is
// showing, and that leaving the mode really ends it.
const READ_BULK_BAR = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const byLabel = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    const byText = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.includes(label));

    byLabel("批量选择").click();
    await sleep(400);
    const entered = {
      count: (document.querySelector(".bulk-selection-count") || {}).textContent.replace(/\\s+/g, " ").trim() || "",
      controls: [...document.querySelectorAll(".bulk-actions-desktop button")].map((button) => button.textContent.trim()),
      moreDialog: false,
      danger: Boolean(document.querySelector(".bulk-delete-button")),
      createButton: Boolean(document.querySelector(".list-create-button")),
      moreMenu: Boolean(document.querySelector(".dashboard-actions")),
      circles: document.querySelectorAll(".character-card .select-circle").length,
    };

    document.querySelector('button[aria-label="选择 沈青梧"]').click();
    await sleep(400);
    const one = {
      count: (document.querySelector(".bulk-selection-count") || {}).textContent.replace(/\\s+/g, " ").trim() || "",
      selectedCards: document.querySelectorAll(".character-card.selected").length,
      deleteDisabled: document.querySelector(".bulk-delete-button").disabled,
    };

    byLabel("更多").click();
    await sleep(400);
    const moreDialog = [...document.querySelectorAll(".export-dialog-list button")].map((button) => button.textContent.trim());
    byLabel("关闭").click();
    await sleep(300);

    byLabel("取消选择").click();
    await sleep(400);
    const exited = {
      bulkBar: Boolean(document.querySelector(".bulk-selection-count")),
      bulkButton: Boolean(byLabel("批量选择")),
      createButton: Boolean(document.querySelector(".list-create-button")),
      selectedCards: document.querySelectorAll(".character-card.selected").length,
      circles: document.querySelectorAll(".character-card .select-circle").length,
    };
    return { entered, one, moreDialog, exited };
  })()
`;

// The same filters, read in both views: the set of characters, the order, and the state
// badges may not disagree just because the layout changed.
const READ_TWO_VIEWS = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // The dashboard search is a collapsible WorkspaceSearch: the field only exists after
    // its trigger is pressed, so every read/write goes through this.
    const openDashboardSearch = () => {
      if (document.querySelector('[data-testid="dashboard-search-input"]')) return;
      const trigger = document.querySelector('[data-testid="dashboard-search"]');
      if (!trigger) throw new Error("找不到搜索入口：" + '[data-testid="dashboard-search"]');
      trigger.click();
    };
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const listNames = () => [...document.querySelectorAll(".character-table-row strong")].map((node) => node.textContent);
    const cardNames = () => [...document.querySelectorAll(".character-card .card-title-button")].map((node) => node.textContent);
    // Only the states both views claim to show are compared: 正式 is the list's way of
    // saying "not a draft" and the card says nothing, while "+N" is a tag count rather
    // than a state. Comparing raw badge lists would compare two different vocabularies.
    const sharedStates = new Set(["草稿", "置顶", "收藏"]);
    const shared = (labels) => labels.filter((label) => sharedStates.has(label)).sort().join("/");
    const tableStatus = (name) => {
      const row = [...document.querySelectorAll(".character-table-row")].find(
        (node) => node.querySelector("strong")?.textContent === name,
      );
      return row ? shared([...row.querySelectorAll(".table-status .status-badge")].map((badge) => badge.textContent.trim())) : "";
    };
    const cardStatus = (name) => {
      const card = [...document.querySelectorAll(".character-card")].find(
        (node) => node.querySelector(".card-title-button")?.textContent === name,
      );
      return card
        ? shared(
            [...card.querySelectorAll(".card-tags > *")]
              .filter((chip) => !chip.classList.contains("card-tag-more"))
              .filter((chip) => chip.classList.contains("status-badge"))
              .map((chip) => chip.textContent.trim()),
          )
        : "";
    };

    openDashboardSearch();
    await sleep(300);
    setValue(document.querySelector('[data-testid="dashboard-search-input"]'), "北境");
    await sleep(600);

    const cardsOrder = cardNames();
    const cardsCount = (document.querySelector(".section-title.list-section-title span") || {}).textContent.trim() || "";
    const cardsStates = { pinned: cardStatus("第03位北境人"), favourite: cardStatus("第04位北境人") };

    const directToggle = document.querySelector('button[aria-label="切换列表视图"]');
    if (directToggle) {
      directToggle.click();
    } else {
      document.querySelector('button[aria-label="更多操作"]')?.click();
      await sleep(350);
      [...document.querySelectorAll('[data-testid="more-sheet"] .sheet-menu button')]
        .find((button) => button.textContent.includes("切换为列表视图"))?.click();
    }
    await sleep(600);
    const listOrder = listNames();
    const listCount = (document.querySelector(".section-title.list-section-title span") || {}).textContent.trim() || "";
    const listStates = { pinned: tableStatus("第03位北境人"), favourite: tableStatus("第04位北境人") };
    const keptQuery = document.querySelector('[data-testid="dashboard-search-input"]')?.value ?? "";

    document.querySelector('button[aria-label="切换卡片视图"]').click();
    await sleep(500);
    return {
      cardsOrder,
      listOrder,
      cardsCount,
      listCount,
      cardsStates,
      listStates,
      keptQuery,
      cardsAfterRoundTrip: cardNames().length,
    };
  })()
`;

// Forward after Back has to rebuild the screen the entry describes, not just the page:
// the same character focused in the graph, the same event located in the timeline.
const FORWARD_RESTORES_TARGET = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const relatedGroup = (index) => document.querySelectorAll(".related-group")[index];
    // The preview reads its related lists in an effect when it opens, so a fixed sleep
    // after Back is a race. Wait for the screen the check is about to use.
    const waitFor = async (predicate, label, timeout = 8000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (predicate()) return true;
        await sleep(100);
      }
      throw new Error("等不到：" + label);
    };
    const previewSettled = () =>
      document.querySelectorAll(".related-group").length === 3 &&
      document.querySelectorAll(".related-group")[1].querySelectorAll(".related-item").length > 0;
    const graphSettled = () => document.querySelectorAll(".relationship-node").length > 0;
    const readGraph = () => ({
      page: ${PAGE_IDS},
      chip: (document.querySelector(".graph-focus-chip") || {}).textContent.replace(/\\s+/g, " ").trim() || "",
      focused: document.querySelectorAll(".relationship-node.focused").length,
    });
    const readTimeline = () => ({
      page: ${PAGE_IDS},
      highlighted: (document.querySelector(".timeline-item.highlighted .timeline-card-title") || {}).textContent || "",
      highlightedCount: document.querySelectorAll(".timeline-item.highlighted").length,
    });

    // Preview → graph, focused on the character whose preview this is.
    await waitFor(previewSettled, "预览页关联信息");
    relatedGroup(0).querySelector(".related-group-action").click();
    await waitFor(graphSettled, "关系网画布");
    await sleep(900);
    const graphArrived = readGraph();
    window.history.back();
    await waitFor(() => document.querySelectorAll(".related-group").length === 3, "预览页");
    await sleep(600);
    const backToPreview = { page: ${PAGE_IDS}, related: document.querySelectorAll(".related-group").length };
    window.history.forward();
    await waitFor(graphSettled, "关系网画布");
    await sleep(1200);
    const graphForward = readGraph();

    // Preview → timeline event. The title is read from the row that was clicked, so
    // the expectation comes from the fixture rather than from a name typed here.
    window.history.back();
    await waitFor(previewSettled, "预览页");
    const eventItem = relatedGroup(1).querySelectorAll(".related-item")[0];
    const clickedTitle = (eventItem.querySelector(".related-item-title") || {}).textContent || "";
    eventItem.click();
    await waitFor(() => document.querySelectorAll(".timeline-item").length > 0, "时间线事件");
    await sleep(600);
    const timelineArrived = readTimeline();
    window.history.back();
    await waitFor(previewSettled, "预览页");
    window.history.forward();
    await waitFor(() => document.querySelectorAll(".timeline-item").length > 0, "时间线事件");
    await sleep(800);
    const timelineForward = readTimeline();

    return { graphArrived, backToPreview, graphForward, clickedTitle, timelineArrived, timelineForward };
  })()
`;

// Expand whatever the collapse memory left closed, so all six sections can be read
// at once. Only heads whose body is missing are clicked, so nothing is collapsed.
const EXPAND_EDITOR_SECTIONS = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const card of document.querySelectorAll("section.workspace-card")) {
      const head = card.querySelector(".workspace-card-head");
      if (head && head.tagName === "BUTTON" && !card.querySelector(".workspace-card-body")) {
        head.click();
        await sleep(150);
      }
    }
    return true;
  })()
`;

// Measures the six sections instead of describing them: if the design language is
// shared, the numbers that carry it are the same in all six.
const READ_EDITOR_SECTIONS = `
  (() => {
    const cards = [...document.querySelectorAll("section.workspace-card")].filter((card) => card.id !== "workspace-preferences");
    const rows = cards.map((card) => {
      const head = card.querySelector(".workspace-card-head");
      const title = head && head.querySelector("strong");
      const body = card.querySelector(".workspace-card-body");
      const label = body && (body.querySelector("label") || body.querySelector(".tag-fieldset"));
      const actionRow = body && body.querySelector(".helper-row, .inline-actions");
      const bodyLeft = body
        ? Math.round(body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft))
        : null;
      return {
        id: card.id,
        titleSize: title ? getComputedStyle(title).fontSize : "",
        headPadding: head ? getComputedStyle(head).padding : "",
        bodyGap: body ? getComputedStyle(body).rowGap : "",
        labelGap: label ? getComputedStyle(label).gap : "",
        hasActionRow: Boolean(actionRow),
        rowAligned: actionRow && bodyLeft !== null
          ? Math.abs(Math.round(actionRow.getBoundingClientRect().left) - bodyLeft) <= 1
          : null,
      };
    });
    const same = (key) => {
      const values = [...new Set(rows.map((row) => row[key]))];
      return { value: values.length === 1 ? values[0] : values.join(" | "), uniform: values.length === 1 };
    };
    const rowsWithActions = rows.filter((row) => row.hasActionRow);
    return {
      count: rows.length,
      expanded: rows.filter((row) => row.bodyGap).length,
      titleSize: same("titleSize"),
      headPadding: same("headPadding"),
      bodyGap: same("bodyGap"),
      labelGap: same("labelGap"),
      actionRows: rowsWithActions.length,
      actionRowsAligned: rowsWithActions.filter((row) => row.rowAligned).length,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ids: rows.map((row) => row.id.replace("workspace-", "")).join("/"),
    };
  })()
`;

// The settings dialog is opened the way a reader opens it: from the footer, which
// only the non-dashboard screens show.
const OPEN_SETTINGS_DIALOG = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const settings = [...document.querySelectorAll("footer button")].find((button) => /设置与数据|Settings/.test(button.textContent));
    if (!settings) throw new Error("footer settings button missing");
    settings.click();
    await sleep(400);
    return true;
  })()
`;

// Reads the dialog rather than trusting it: which groups exist, which cards sit in
// each, whether any English heading survived, and whether anything overflows the
// dialog or the page.
const READ_SETTINGS_DIALOG = `
  (() => {
    const dialog = document.querySelector(".settings-dialog:not(.asset-library-dialog)");
    if (!dialog) return { open: false };
    const texts = (scope) => [...scope.querySelectorAll(".settings-grid h3")].map((node) => node.textContent.trim());
    // The unreleased settings are a disclosure now: a named row that is closed by
    // default, so the dialog leads with what works. Its fields are still in the
    // document — nothing about the feature changed — but they are not on screen.
    const pending = dialog.querySelector(".settings-pending");
    const live = dialog.querySelector(".settings-group:not(.settings-pending)");
    const liveCard = live && live.querySelector(".settings-grid article");
    const background = (node) => (node ? getComputedStyle(node).backgroundColor : "");
    const border = (node) => (node ? parseFloat(getComputedStyle(node).borderTopWidth) : null);
    const visible = (scope) =>
      scope
        ? [...scope.querySelectorAll("input, select, textarea")].filter(
            (field) => field.getBoundingClientRect().height > 0,
          ).length
        : 0;
    return {
      open: true,
      labels: [...dialog.querySelectorAll(".settings-group-label")].map((node) => node.textContent.trim()),
      liveCards: live ? texts(live) : [],
      pendingCards: pending ? texts(pending) : [],
      pendingSummary: pending ? (pending.querySelector("summary") || {}).textContent || "" : "",
      pendingOpen: pending ? Boolean(pending.open) : null,
      pendingVisibleFields: visible(pending),
      // A closed disclosure is one row tall; the fields are in the document but not
      // rendered, which is what this height tells apart.
      pendingHeight: pending ? Math.round(pending.getBoundingClientRect().height) : null,
      englishLeft: /Appearance|About Data|Coming Soon|Connection Test|Follow System/.test(dialog.textContent),
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogWidth: Math.round(dialog.getBoundingClientRect().width),
      viewportWidth: window.innerWidth,
      liveCardBackground: background(liveCard),
      liveCardBorder: border(liveCard),
      pendingBorder: border(pending),
      dialogBackground: background(dialog),
      scrollBody: (() => {
        const body = dialog.querySelector(".settings-body");
        if (!body) return null;
        const style = getComputedStyle(body);
        return { overflowY: style.overflowY, scrolls: body.scrollHeight - body.clientHeight > 1 };
      })(),
      theme: document.documentElement.dataset.theme || "",
    };
  })()
`;

const PICK_THEME = (label) => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const button = [...document.querySelectorAll('.settings-dialog .segmented-row button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error("theme button missing: " + ${JSON.stringify(label)});
    button.click();
    await sleep(300);
    return true;
  })()
`;

// For captures only: sets the theme attribute the app's own switcher sets. PICK_THEME
// needs the settings dialog open, which a page shot does not.
const FORCE_THEME = (theme) => `
  (() => {
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    return document.documentElement.dataset.theme;
  })()
`;

const goBack = (expected) => `
  (async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const page = ${PAGE_IDS};
    return { page, expected: ${JSON.stringify(expected)}, pass: page === ${JSON.stringify(expected)} };
  })()
`;

async function main() {
  if (process.argv.includes("--list")) {
    const body = { ...describe(plan.entries, plan.shardTotal), entries: plan.entries };
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  if (!existsSync(DIST)) {
    console.error("没有 dist/。先跑 npm run build:pages —— 这个脚本要验证的是真实构建产物。");
    process.exit(2);
  }

  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), "cs-verify-"));
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}${BASE_PATH}/`;
  const debugPort = 9000 + Math.floor(Math.random() * 900);
  const results = [];
  const seenNames = new Map();
  const rangeArg = argOf("range");
  const range = rangeArg ? rangeArg.split("-").map(Number) : null;
  // How many checks an ONLY= run left out. Declared here so the summary can report it.
  const skipped = [];

  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,900",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      base,
    ],
    { stdio: "ignore", env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" } },
  );

  // Nothing in here may throw: it runs in a finally block, and a tidy-up failure must
  // not turn a passing run into an error. Chrome carries on writing to its profile for
  // a moment after SIGTERM, so the directory removal is best-effort and the OS gets to
  // reclaim it otherwise.
  const cleanup = () => {
    try {
      browser.kill("SIGTERM");
    } catch {
      // already gone
    }
    try {
      server.close();
    } catch {
      // already closed
    }
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // left for the OS temp cleaner
    }
  };

  const outDir = join(root, argOf("out") ?? "tmp/verify-browser");
  mkdirSync(outDir, { recursive: true });
  const shardFile =
    plan.shardTotal > 0
      ? join(outDir, `shard-${plan.shardIndex}-of-${plan.shardTotal}.json`)
      : join(outDir, "run-all.json");
  const distEntry = (() => {
    try {
      return readdirSync(join(DIST, "assets"))
        .filter((name) => /^index-.*\.js$/.test(name))
        .sort()
        .join(",");
    } catch {
      return "(no dist)";
    }
  })();
  const runRecord = {
    shard: { index: plan.shardIndex, total: plan.shardTotal },
    build: { distEntry, builtCommit: process.env.VITE_BUILD_COMMIT ?? null },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finished: false,
    counts: { total: plan.entries.filter((entry) => plan.shardTotal === 0 || entry.shard === plan.shardIndex).length },
    checks: [],
    notAssigned: [],
  };
  const flush = () => writeFileSync(shardFile, JSON.stringify(runRecord, null, 2));

  try {
    let targets = null;
    for (let attempt = 0; attempt < 40 && !targets; attempt++) {
      await sleep(250);
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const list = await response.json();
        targets = list.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      } catch {
        // browser not up yet
      }
    }
    if (!targets) {
      throw new Error("连不上 Chrome 的调试端口");
    }

    const cdp = await Cdp.connect(targets.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // ONLY=<substring> runs just the checks whose name contains it: the full suite
    // drives a browser through every screen and takes minutes, and while one group of
    // checks is being diagnosed the other forty prove nothing new. A skipped check is
    // never counted as a pass — the summary says how many were left out, so a filtered
    // run cannot be mistaken for a green one.
    // `--only=<substring>` is the same filter as ONLY, carried as an argument: a harness
    // that re-launches a long run in the background does not always keep its environment,
    // and a filtered run that silently becomes a full one is worse than no filter.
    const onlyArg = process.argv.find((argument) => argument.startsWith("--only="));
    const only = (onlyArg ? onlyArg.slice("--only=".length) : (process.env.ONLY ?? "")).trim();
    activeOnly = only;

    // Section tokens ("04") select whole blocks and are read by `wanted`; anything else
    // is matched against the check's name, which is what a single failing check needs.
    const onlyTokens = only ? only.split(",").map((token) => token.trim()).filter(Boolean) : [];
    const nameOnly = onlyTokens.length > 0 && onlyTokens.every((token) => !/^\d/.test(token));

    // ---- result file -------------------------------------------------------------
    //
    // Written after every check rather than once at the end: a shard that is killed at
    // the platform cap leaves a file that stops halfway, and "halfway" is a fact the
    // summariser has to be able to see instead of inferring a pass from a missing file.

    const check = async (name, run) => {
      const occurrence = seenNames.get(name) ?? 0;
      seenNames.set(name, occurrence + 1);
      const entry = plan.entries.find(
        (candidate) => candidate.name === name && candidate.occurrence === occurrence + 1,
      );

      // A check the plan does not know about means the file changed without the plan
      // being rebuilt -- a silent "ran but not counted" is exactly what this prevents.
      if (!entry) {
        throw new Error(`计划里没有这项检查（新增后未重新生成计划）：${name}`);
      }

      if (plan.shardTotal > 0 && entry.shard !== plan.shardIndex) {
        runRecord.notAssigned.push(entry.id);
        return;
      }

      if (range && (entry.position < range[0] || entry.position > range[1])) {
        skipped.push(name);
        return;
      }

      if (nameOnly && !onlyTokens.some((token) => name.includes(token))) {
        skipped.push(name);
        return;
      }

      // Printed before the check runs: a check that never returns used to leave the
      // whole suite silent until the end, so a hang could not be told apart from a
      // slow run. The name is the progress bar.
      console.log(`RUN   ${name}`);

      // A hung check used to stop the suite with no verdict at all, and the results
      // were only printed after the last one — so a stall threw away every check that
      // had already passed. Two changes: each check is bounded, and its verdict is
      // printed as it lands. A timeout is a failure, never a skip.
      const timeoutMs = Number(process.env.CHECK_TIMEOUT_MS ?? 90000);
      let timer = null;

      // Every check starts from the same browser facts. A mobile check leaves touch
      // emulation and a 375px viewport behind; the next desktop check then dispatches
      // mouse drags into a touch-emulated page and fails for reasons that have nothing
      // to do with the product. Checks that want a phone set it themselves.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });

      const startedAt = new Date().toISOString();
      const record = (entry, status, detail, startedISO) => {
        runRecord.checks.push({
          id: entry.id,
          name,
          occurrence: entry.occurrence,
          position: entry.position,
          shard: entry.shard,
          status,
          pass: status === "PASS",
          detail,
          startedAt: startedISO,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(startedISO),
        });
        flush();
      };

      try {
        const detail = await Promise.race([
          run(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`检查超时（${timeoutMs}ms）：${name}`)),
              timeoutMs,
            );
          }),
        ]);
        const result = { name, pass: detail.pass, detail: detail.detail };
        results.push(result);
        console.log(`${result.pass ? "PASS" : "FAIL"}  ${name}`);
        record(entry, result.pass ? "PASS" : "FAIL", result.detail, startedAt);
      } catch (error) {
        const message = String(error.message ?? error);
        // A timeout is not the same failure as a wrong assertion: the check never got to
        // compare anything, and the run left a still-running body behind. Kept separate
        // so a report cannot average them into "N failures" and let the difference go.
        const timedOut = /^检查超时/.test(message) || /^CDP 命令超时/.test(message);
        // A timeout says a check stopped; it does not say whether the page stopped with
        // it. Ask the renderer one trivial question with its own short deadline: if that
        // hangs too, the main thread is blocked and no amount of waiting in the check
        // would have helped. If it answers, only the input pipeline stalled.
        let postMortem = "";
        if (timedOut) {
          // A drag that was interrupted leaves the left button down, and every later
          // dispatch queues behind that press -- which is how one slow check turns into
          // four 90s holes. Release it, and dismiss a dialog if one is up, before the next
          // check starts. Both are best-effort: no dialog is an error we ignore.
          try {
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1,
            });
          } catch {
            // the browser may already be gone
          }
          try {
            await cdp.send("Page.handleJavaScriptDialog", { accept: true });
          } catch {
            // no dialog open: expected
          }
          try {
            const answer = await Promise.race([
              cdp.value("1+1"),
              new Promise((_, reject) => setTimeout(() => reject(new Error("3s 无响应")), 3000)),
            ]);
            postMortem = answer === 2 ? "；超时后 renderer 仍响应" : `；超时后 renderer 返回 ${answer}`;
          } catch (probeError) {
            postMortem = `；超时后 renderer 也不响应（${String(probeError.message ?? probeError)}）`;
          }
        }
        const result = { name, pass: false, detail: message + postMortem };
        results.push(result);
        console.log(`FAIL  ${name}\n      ${result.detail}`);
        record(entry, timedOut ? "TIMEOUT" : "FAIL", result.detail, startedAt);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };

    await check("历史：后退恢复工作区页面（KI-15）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(clickWorkspace("世界观时间线"));

      const first = await cdp.value(goBack("relationships"));
      const second = await cdp.value(goBack("dashboard"));
      await cdp.value(`(async () => { history.forward(); await new Promise((r) => setTimeout(r, 600)); return true; })()`);
      const third = await cdp.value(`${PAGE_IDS}`);

      return {
        pass: first.pass && second.pass && third === "relationships",
        detail: `back→${first.page}（期望 relationships）、back→${second.page}（期望 dashboard）、forward→${third}（期望 relationships）`,
      };
    });

    await check("历史：连续四次后退依次回到四个工作区", async () => {
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.value(clickWorkspace("角色创作工作台"));

      const seen = [];
      for (const expected of ["world", "timeline", "relationships", "dashboard"]) {
        const step = await cdp.value(goBack(expected));
        seen.push(`${step.page}${step.pass ? "" : `≠${expected}`}`);
      }

      return { pass: seen.every((entry) => !entry.includes("≠")), detail: seen.join(" ← ") };
    });

    await check("深链接：/developer 直接打开开发者中心", async () => {
      await cdp.goto(`${base}developer`);
      const page = await cdp.value(PAGE_IDS);
      return { pass: page === "developer", detail: `直接打开 /developer → ${page}` };
    });

    await check("删除：主页单删后撤销，角色与被清理的关联一起恢复（KI-17）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(CARD_MENU_ACTION("删除"));
      await cdp.value(CONFIRM_DIALOG("确认删除"));

      const deleted = await cdp.value(READ_DELETE_STATE);
      await cdp.value(UNDO_DELETE);
      const restored = await cdp.value(READ_DELETE_STATE);

      return {
        pass: deleted.deletedOk && restored.restoredOk,
        detail: `删除后 ${deleted.detail}；撤销后 ${restored.detail}；提示「${restored.toast.trim()}」`,
      };
    });

    await check("删除：恢复记录写不进去时拒绝删除，数据一点没动（KI-17）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(REFUSE_RECOVERY_WRITES);
      await cdp.value(CARD_MENU_ACTION("删除"));
      await cdp.value(CONFIRM_DIALOG("确认删除"));

      const state = await cdp.value(READ_DELETE_STATE);
      const told = state.toast.includes("删除已取消");

      return {
        pass: state.characters.length === 2 && state.relationships.length === 1 && !state.undo && told,
        detail: `角色 ${state.characters.length} 个（期望 2）、关系 ${state.relationships.length} 条（期望 1）、撤销入口 ${state.undo ? "有" : "无"}、提示「${state.toast.trim()}」`,
      };
    });

    await check("删除：编辑器里删除后回到主页，撤销同样恢复关联（KI-17）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(CARD_MENU_ACTION("编辑"));
      const editorOpen = await cdp.waitFor(`!!document.querySelector(".editor-more-wrap")`, 8000);
      await cdp.value(EDITOR_MORE_DELETE);
      await cdp.value(CONFIRM_DIALOG("确认删除"));
      const backOnDashboard = await cdp.waitFor(`${PAGE_IDS} === "dashboard"`, 8000);

      const deleted = await cdp.value(READ_DELETE_STATE);
      await cdp.value(UNDO_DELETE);
      const restored = await cdp.value(READ_DELETE_STATE);

      return {
        pass: editorOpen && backOnDashboard && deleted.deletedOk && restored.restoredOk,
        detail: `编辑器${editorOpen ? "已打开" : "没打开"}、删除后回到${backOnDashboard ? "主页" : "别处"}；删除后 ${deleted.detail}；撤销后 ${restored.detail}`,
      };
    });

    await check("删除：批量删除后撤销，全部选中角色与关联一起恢复（KI-17）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(BULK_DELETE);
      await cdp.value(CONFIRM_DIALOG("确认删除"));

      const deleted = await cdp.value(READ_DELETE_STATE);
      const bothGone =
        deleted.characters.length === 0 &&
        deleted.relationships.length === 0 &&
        deleted.timelineParticipants.length === 0 &&
        deleted.worldParticipants.length === 0 &&
        deleted.recovery !== null &&
        deleted.undo;

      await cdp.value(UNDO_DELETE);
      const restored = await cdp.value(READ_DELETE_STATE);

      return {
        pass: bothGone && restored.restoredOk,
        detail: `删除后 ${deleted.characters.length} 个角色 / ${deleted.relationships.length} 条关系 / 时间线 ${deleted.timelineParticipants.length} 人 / 撤销入口 ${deleted.undo ? "有" : "无"}；撤销后 ${restored.detail}`,
      };
    });

    await check("清空：快照写入失败时不清空数据并要求用户处理（DEC-38-01）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(OPEN_CLEAR_DIALOG);
      await cdp.value(REFUSE_SNAPSHOT_WRITES);
      await cdp.value(CONFIRM_CLEAR);

      const outcome = await cdp.value(READ_CLEAR_OUTCOME);

      const cleared = outcome.characters === 0;
      const told = outcome.message.includes("自动备份失败");
      return {
        pass: !cleared && told,
        detail: `角色仍为 ${outcome.characters} 个（期望 2）、对话框提示「自动备份失败」${told ? "有" : "没有"}`,
      };
    });

    await check("清空：写入恢复正常后可以完成，并留下角色快照", async () => {
      // The reload drops the patched setItem with the page context, so this is the
      // ordinary path again - the blocked attempt must not have left anything broken.
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(OPEN_CLEAR_DIALOG);
      await cdp.value(CONFIRM_CLEAR);

      const outcome = await cdp.value(READ_CLEAR_OUTCOME);

      return {
        pass: outcome.characters === 0 && outcome.snapshot?.characterCount === 2,
        detail: `角色清空后 ${outcome.characters} 个、快照保留 ${outcome.snapshot?.characterCount ?? 0} 个角色`,
      };
    });

    await check("新建关系：在 100 个角色里搜到并保存（KI / 任务 A）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_MANY);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      const state = await cdp.value(CREATE_RELATION_BY_SEARCH);

      const searched = state.steps.every((step) => step.matched === 1);
      const showed = state.steps[0].chosen.includes("沈青梧") && state.steps[1].chosen.includes("陆停云");
      const collapsed = state.steps.every((step) => !step.stillOpen);
      const saved = state.stored.length === 1 && state.stored[0] === "bulk-88->bulk-1";
      const nativeGone = state.nativeSelects.length === 1;

      return {
        pass: Boolean(searched && showed && collapsed && saved && nativeGone && !state.saveDisabled),
        detail: state.steps.map((step) => `搜「${step.needle}」命中 ${step.matched} → 选中「${step.chosen}」${step.stillOpen ? "（列表仍开着）" : ""}`).join("；")
          + `；原生下拉剩 ${state.nativeSelects.length} 个（应为 1，仅关系类型）`
          + `；保存后存储 ${JSON.stringify(state.stored)}（应为 bulk-88->bulk-1）`,
      };
    });

    await check("世界观：100 个角色下多选搜索、计数与顺序稳定（任务 A）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_MANY);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      const state = await cdp.value(READ_WORLD_MULTI_PICKER);

      // 33 matches, two of them ticked: the list must read exactly as it did before.
      const orderStable = state.orderAfterChoosing.length > 1
        && state.orderAfterChoosing.join("/") === state.orderBefore.join("/");
      const countOk = /已选 2 \/ 100/.test(state.afterTwo);
      const narrowedExact = state.narrowed === 1;
      const savedTwo = state.saved.length === 1 && state.saved[0] === 2;

      return {
        pass: Boolean(state.matched > 10 && countOk && orderStable && narrowedExact
          && state.keptQuery === "工匠" && !state.saveDisabled && savedTwo),
        detail: `搜「工匠」命中 ${state.matched}；勾选两个后「${state.afterTwo}」（勾选态 ${state.checkedCount}）`
          + `；勾选前后列表顺序${orderStable ? "一致" : `不一致（前 ${state.orderBefore[0]} / 后 ${state.orderAfterChoosing[0]}）`}`
          + `；勾选后搜索词仍为「${state.keptQuery}」；改搜「陆停云」命中 ${state.narrowed}`
          + `；保存按钮${state.saveDisabled ? "仍禁用" : "可用"}，保存条目关联数 ${JSON.stringify(state.saved)}（应为 [2]）`,
      };
    });

    await check("窄屏（375）：角色选择列表不遮挡对话框操作按钮（任务 A）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_MANY);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      const state = await cdp.value(READ_PICKER_OVERLAP);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const clear = !state.overlaps && state.saveVisibleInDialog;
      const fits = state.pageOverflow <= 1 && state.dialogOverflow <= 1 && state.panelWidth <= state.viewportWidth;

      return {
        pass: Boolean(clear && fits),
        detail: `375px 下列表底边 ${state.panelBottom}px、保存按钮顶边 ${state.saveTop}px → ${state.overlaps ? "遮挡" : "不遮挡"}；保存按钮在对话框可视区内${state.saveVisibleInDialog ? "" : "（否）"}；列表宽 ${state.panelWidth}px（视口 ${state.viewportWidth}px）；页面溢出 ${state.pageOverflow}px、对话框溢出 ${state.dialogOverflow}px`,
      };
    });

    await check("时间线事件：四十个关联角色折成四个 + 计数，展开可搜索（任务 B）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_CROWDED);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观时间线"));
      const state = await cdp.value(READ_CROWDED_CARD);

      const folded = state.before.length === 5 && state.before[4] === "+36 位角色";
      const firstFour = state.before.slice(0, 4).join("/") === "角色01/角色02/角色03/角色04";
      const expanded = state.opened.rows === 40 && state.opened.first === "角色01" && state.opened.last === "角色40";
      const searched = state.filtered === 10 && state.restored === 40;
      const openedDetail = state.previewOpen && state.previewText;

      return {
        pass: Boolean(folded && firstFour && expanded && searched && openedDetail),
        detail: `折叠时 ${state.before.join(" / ")}；展开后 ${state.opened.rows} 行（${state.opened.first}…${state.opened.last}）、表头「${state.header}」`
          + `；搜「角色1」${state.filtered} 行、清空后 ${state.restored} 行`
          + `；点第 8 行 → 预览页${state.previewOpen ? "已打开" : "未打开"}${state.previewText ? "且显示角色08" : "但未见角色08"}`,
      };
    });

    await check("世界观条目：同一套折叠展示，375px 无横向溢出（任务 B）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_CROWDED);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      const desktop = await cdp.value(READ_WORLD_CROWDED);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      const mobile = await cdp.value(READ_WORLD_CROWDED);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const folded = (state) => state.chips.length === 5 && state.chips[4] === "+36 位角色";
      const fits = desktop.pageOverflow <= 1 && mobile.pageOverflow <= 1;

      return {
        pass: Boolean(folded(desktop) && folded(mobile) && fits),
        detail: `条目卡片：1440px ${desktop.chips.join(" / ")}（溢出 ${desktop.pageOverflow}px）；375px ${mobile.chips.join(" / ")}（溢出 ${mobile.pageOverflow}px）`,
      };
    });

    await check("列表视图：第一列头像与名称在行的中线上（C1）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_MANY);
      await cdp.goto(base);
      const state = await cdp.value(READ_LIST_ALIGNMENT);

      const within = (value) => Math.abs(value) <= 1;
      const aligned = state.cells.length > 0 && state.cells.every(
        (cell) => within(cell.avatar) && within(cell.name) && within(cell.between)
          && (cell.circle === null || within(cell.circle)),
      );

      return {
        pass: Boolean(aligned),
        detail: `${state.rows} 行；前 ${state.cells.length} 行偏差（头像/名称相对行中线，正值偏下）：`
          + state.cells.map((cell, index) => `#${index + 1} 头像 ${cell.avatar}、名称 ${cell.name}、互相差 ${cell.between}${cell.circle === null ? "" : `、勾选圈 ${cell.circle}`}`).join("  "),
      };
    });

    await check("吸顶：顶栏与吸顶分组头之间不应有可透视的缝隙（C2）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_CROWDED);
      await cdp.goto(base);
      const state = await cdp.value(READ_STICKY_GAP);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      // A gap of a pixel is rounding; anything more is a window for the content behind.
      const noGap = state.gap !== null && Math.abs(state.gap) <= 1;

      return {
        pass: Boolean(noGap && state.heads > 0),
        detail: `滚动到 ${state.scrollY}px；顶栏底边 ${state.topbarBottom}px（实际高 ${state.topbarHeight}px，CSS 变量 ${state.cssVar}）`
          + `；分组头 ${state.heads} 个，吸顶者顶边 ${state.stuckTop}px → 缝隙 ${state.gap}px`
          + `；底色 顶栏 ${state.topbarBackground} / 分组头 ${state.headBackground} / 组内按钮 ${state.toggleBackground}`,
      };
    });

    await check("编辑器：六节共用一套节头、间距与动作行（KI-02）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(CARD_MENU_ACTION("编辑"));
      await cdp.waitFor(`!!document.querySelector(".editor-more-wrap")`, 8000);
      await cdp.value(EXPAND_EDITOR_SECTIONS);
      const state = await cdp.value(READ_EDITOR_SECTIONS);

      const uniform =
        state.count === 6 &&
        state.expanded === 6 &&
        state.titleSize.uniform &&
        state.headPadding.uniform &&
        state.bodyGap.uniform &&
        state.labelGap.uniform;
      // Every section that has an action row has it on the field's left edge.
      const aligned = state.actionRows >= 4 && state.actionRows === state.actionRowsAligned;

      return {
        pass: Boolean(uniform && aligned && state.pageOverflow <= 1),
        detail: `六节 ${state.ids}；节头字号 ${state.titleSize.value}（${state.titleSize.uniform ? "一致" : "不一致"}）、节头内距 ${state.headPadding.value}、块间距 ${state.bodyGap.value}、标签间距 ${state.labelGap.value}；动作行 ${state.actionRowsAligned}/${state.actionRows} 与字段左缘对齐；页面溢出 ${state.pageOverflow}px`,
      };
    });

    await check("编辑器：900px 与 375px 下六节仍一致且无横向溢出（KI-02）", async () => {
      const readAt = async (width, height) => {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 720 });
        await cdp.goto(base);
        await cdp.value(CARD_MENU_ACTION("编辑"));
        await cdp.waitFor(`!!document.querySelector(".editor-more-wrap")`, 8000);
        await cdp.value(EXPAND_EDITOR_SECTIONS);
        return cdp.value(READ_EDITOR_SECTIONS);
      };

      const narrow = await readAt(900, 900);
      const mobile = await readAt(375, 812);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const ok = (state) =>
        state.count === 6 &&
        state.titleSize.uniform &&
        state.bodyGap.uniform &&
        state.pageOverflow <= 1;

      return {
        pass: Boolean(ok(narrow) && ok(mobile)),
        detail: `900px：六节 ${narrow.count}、节头字号 ${narrow.titleSize.value}、块间距 ${narrow.bodyGap.value}、溢出 ${narrow.pageOverflow}px；375px：六节 ${mobile.count}、节头字号 ${mobile.titleSize.value}、块间距 ${mobile.bodyGap.value}、溢出 ${mobile.pageOverflow}px`,
      };
    });

    await check("设置弹窗：分组、中文标题、未发布功能不与可用设置同级（KI-01）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(OPEN_SETTINGS_DIALOG);
      const state = await cdp.value(READ_SETTINGS_DIALOG);
      // Collapsed is not the same as removed: opening the disclosure has to bring the
      // fields and their values back.
      const opened = await cdp.value(`(() => {
        const pending = document.querySelector(".settings-dialog .settings-pending");
        if (!pending) return { open: false, fields: 0, values: 0, before: 0, after: 0 };
        const summary = pending.querySelector("summary");
        const before = Math.round(pending.getBoundingClientRect().height);
        if (summary) summary.click();
        const fields = [...pending.querySelectorAll("input, select, textarea")].filter(
          (field) => field.getBoundingClientRect().height > 0,
        );
        return {
          open: pending.open,
          before,
          after: Math.round(pending.getBoundingClientRect().height),
          fields: fields.length,
          values: fields.filter((field) => String(field.value || "").length > 0).length,
        };
      })()`);

      const liveOk =
        state.open &&
        state.labels.includes("可用设置") &&
        state.liveCards.includes("主题外观") &&
        state.liveCards.includes("数据与存储") &&
        !state.englishLeft;
      // The unreleased block is named, closed on arrival, and contributes nothing to
      // the visible surface — which is a stronger statement than "kept apart in the
      // markup", and it still holds the fields and their values for when it opens.
      const pendingOk =
        state.pendingSummary.includes("未发布功能") &&
        state.pendingCards.includes("AI 设置") &&
        !state.liveCards.includes("AI 设置") &&
        state.pendingOpen === false &&
        // One row tall while closed: the fields are in the document but not rendered.
        state.pendingHeight !== null &&
        state.pendingHeight <= 72;
      // Live settings are groups inside one dialog, told apart by rules rather than by
      // a second border inside the first; the pending block owns its own rule.
      const layered = state.liveCardBorder === 0 && state.pendingBorder > 0;
      // One scrolling region, and it is the body: the head with 关闭 stays put.
      const scrollsInOnePlace = Boolean(state.scrollBody) && state.scrollBody.overflowY === "auto";

      return {
        pass: Boolean(
          liveOk &&
            pendingOk &&
            layered &&
            opened.open &&
            opened.fields > 0 &&
            opened.after > opened.before &&
            scrollsInOnePlace &&
            state.dialogOverflow <= 1 &&
            state.pageOverflow <= 1,
        ),
        detail: `分组 ${state.labels.join(" / ")}；可用卡片 ${state.liveCards.join(" / ")}；未发布 ${state.pendingSummary.trim() || "（开关关闭）"}（展开 ${state.pendingOpen}、可见字段 ${state.pendingVisibleFields}、卡片 ${state.pendingCards.join("/") || "无"}）；英文残留 ${state.englishLeft ? "有" : "无"}；弹窗 ${state.dialogWidth}px（视口 ${state.viewportWidth}px）溢出 ${state.dialogOverflow}px，页面溢出 ${state.pageOverflow}px；未发布块高 ${state.pendingHeight}px → 展开后 ${opened.after}px、字段 ${opened.fields} 个（有值 ${opened.values}）；可用卡描边 ${state.liveCardBorder}px vs 未发布分隔 ${state.pendingBorder}px；滚动区 ${state.scrollBody ? state.scrollBody.overflowY : "无"}；弹窗底色 ${state.dialogBackground}，可用卡底 ${state.liveCardBackground}`,
      };
    });

    await check("设置弹窗：375px 无横向溢出，深色主题生效（KI-01）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 800,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(OPEN_SETTINGS_DIALOG);
      await cdp.value(PICK_THEME("深色"));
      const state = await cdp.value(READ_SETTINGS_DIALOG);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const fits =
        state.open &&
        state.dialogOverflow <= 1 &&
        state.pageOverflow <= 1 &&
        state.dialogWidth <= state.viewportWidth;
      // #171a21 is the dark surface token; the light one is #ffffff.
      const dark = state.theme === "dark" && state.dialogBackground === "rgb(23, 26, 33)";

      return {
        pass: Boolean(fits && dark),
        detail: `主题 ${state.theme || "(未设置)"}、弹窗底色 ${state.dialogBackground}；375px 下弹窗 ${state.dialogWidth}px、弹窗溢出 ${state.dialogOverflow}px、页面溢出 ${state.pageOverflow}px`,
      };
    });

    await check("移动端：主导航是底部抽屉，四项齐全、选中明确、遮罩与 Escape 都能关", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      await cdp.waitFor(`!!document.querySelector(".workspace-switch")`, 8000);

      const opened = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector(".workspace-switch").click();
        await sleep(400);
        const sheet = document.querySelector('[data-testid="workspace-sheet"]');
        const panel = sheet?.querySelector(".sheet-panel");
        const box = panel?.getBoundingClientRect();
        const rows = sheet ? [...sheet.querySelectorAll(".sheet-row")] : [];
        return {
          present: Boolean(sheet),
          labels: rows.map((row) => row.textContent.replace(/\\s+/g, " ").trim()),
          selected: rows.filter((row) => row.classList.contains("selected")).length,
          selectedLabel: (rows.find((row) => row.classList.contains("selected"))?.textContent || "").replace(/\\s+/g, " ").trim(),
          inViewport: box ? box.top >= -1 && box.bottom <= window.innerHeight + 1 && box.left >= -1 && box.right <= window.innerWidth + 1 : false,
          reachesBottom: box ? Math.abs(box.bottom - window.innerHeight) <= 1 : false,
          focusInside: sheet ? sheet.contains(document.activeElement) : false,
          bodyLocked: document.documentElement.style.overflow === "hidden",
          scrollable: sheet ? getComputedStyle(sheet.querySelector(".sheet-body")).overflowY === "auto" : false,
          rowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0,
        };
      })()`);

      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const closed = await cdp.value(`(() => ({
        gone: !document.querySelector('[data-testid="workspace-sheet"]'),
        focus: (document.activeElement?.className || "").toString(),
        bodyUnlocked: document.documentElement.style.overflow !== "hidden",
      }))()`);

      // The same sheet switches: pick the third entry and the app lands there.
      const switched = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector(".workspace-switch").click();
        await sleep(350);
        const row = [...document.querySelectorAll('[data-testid="workspace-sheet"] .sheet-row')]
          .find((button) => button.textContent.includes("世界观管理"));
        row?.click();
        await sleep(700);
        return {
          sheetGone: !document.querySelector('[data-testid="workspace-sheet"]'),
          label: (document.querySelector(".workspace-switch-label")?.textContent || "").trim(),
          world: Boolean(document.querySelector("#workspace-world, .world-page")),
        };
      })()`);

      const sheetOk =
        opened.present &&
        opened.labels.length === 4 &&
        opened.labels.some((label) => label.includes("角色关系网")) &&
        opened.labels.some((label) => label.includes("世界观时间线")) &&
        opened.labels.some((label) => label.includes("世界观管理")) &&
        opened.selected === 1 &&
        opened.selectedLabel.includes("角色创作工作台") &&
        opened.inViewport &&
        opened.reachesBottom &&
        opened.focusInside &&
        opened.bodyLocked &&
        opened.scrollable &&
        opened.rowHeight >= 44;

      const closeOk = closed.gone && closed.focus.includes("workspace-switch") && closed.bodyUnlocked;
      const switchOk = switched.sheetGone && switched.label === "世界观管理" && switched.world;

      return {
        pass: sheetOk && closeOk && switchOk,
        detail: `抽屉 ${opened.present ? "打开" : "未打开"}：${opened.labels.join(" / ")}；选中 ${opened.selected}（${opened.selectedLabel}）；在视口内 ${opened.inViewport}、贴底 ${opened.reachesBottom}、行高 ${opened.rowHeight}px、内部可滚动 ${opened.scrollable}、焦点在内 ${opened.focusInside}、页面锁定 ${opened.bodyLocked}；Escape 关闭 ${closed.gone}、焦点回到 ${closed.focus || "无"}、解锁 ${closed.bodyUnlocked}；切换后 ${switched.label}（抽屉关闭 ${switched.sheetGone}、页面就位 ${switched.world}）`,
      };
    });

    await check("移动端：更多操作走抽屉不裁切，视图切换进抽屉，首屏更快看到角色", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      await cdp.waitFor(`!!document.querySelector(".list-toolbar")`, 8000);

      const state = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const firstCard = document.querySelector(".character-card");
        const toolbar = document.querySelector(".list-toolbar").getBoundingClientRect();
        const more = document.querySelector('button[aria-label="更多操作"]');
        const moreBox = more ? more.getBoundingClientRect() : null;
        const view = document.querySelector('button[aria-label="切换列表视图"], button[aria-label="切换卡片视图"]');
        more?.click();
        await sleep(400);
        const sheet = document.querySelector('[data-testid="more-sheet"]');
        const box = sheet?.querySelector(".sheet-panel")?.getBoundingClientRect();
        return {
          firstCardTop: firstCard ? Math.round(firstCard.getBoundingClientRect().top) : null,
          toolbarWidth: Math.round(toolbar.width),
          moreWidth: moreBox ? Math.round(moreBox.width) : null,
          viewInToolbar: Boolean(view),
          sheet: Boolean(sheet),
          rows: sheet ? [...sheet.querySelectorAll(".sheet-menu button")].map((button) => button.textContent.replace(/\\s+/g, " ").trim()) : [],
          inViewport: box ? box.top >= -1 && box.bottom <= window.innerHeight + 1 : false,
          scrollable: sheet ? getComputedStyle(sheet.querySelector(".sheet-body")).overflowY === "auto" : false,
          title: sheet?.querySelector(".sheet-head h2")?.textContent || "",
          panel: box ? [Math.round(box.top), Math.round(box.bottom), Math.round(box.left), Math.round(box.right)] : null,
          head: (() => {
            const head = sheet?.querySelector(".sheet-head");
            const rect = head?.getBoundingClientRect();
            return rect ? [Math.round(rect.top), Math.round(rect.bottom)] : null;
          })(),
          body: (() => {
            const body = sheet?.querySelector(".sheet-body");
            const rect = body?.getBoundingClientRect();
            return rect ? [Math.round(rect.top), Math.round(rect.bottom), body.scrollHeight] : null;
          })(),
          panelStyle: sheet ? (() => {
            const style = getComputedStyle(sheet.querySelector(".sheet-panel"));
            return [style.height, style.maxHeight, style.display];
          })() : null,
        };
      })()`);

      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const closed = await cdp.value(`!document.querySelector('[data-testid="more-sheet"]')`);

      const firstScreenOk = state.firstCardTop !== null && state.firstCardTop <= 430;
      // One ellipsis icon, not a 300px grey bar: the wrapper used to stretch to the
      // toolbar's width and the button with it.
      const toolbarOk = state.moreWidth !== null && state.moreWidth <= 64 && !state.viewInToolbar;
      const sheetOk =
        state.sheet &&
        state.rows.length >= 6 &&
        state.rows.some((row) => row.includes("批量管理")) &&
        state.rows.some((row) => row.includes("列表视图") || row.includes("卡片视图")) &&
        state.inViewport &&
        state.scrollable &&
        closed;

      return {
        pass: firstScreenOk && toolbarOk && sheetOk,
        detail: `首个角色卡片 y=${state.firstCardTop}px（阈值 ≤430）；工具栏宽 ${state.toolbarWidth}、更多按钮宽 ${state.moreWidth}px、视图切换仍在工具栏 ${state.viewInToolbar}；抽屉 ${state.sheet ? "打开" : "未打开"}「${state.title}」面板 ${state.panel?.join(",")} 头部 ${state.head?.join(",")} 正文 ${state.body?.join(",")} 样式 ${state.panelStyle?.join("/")}，${state.rows.length} 行（${state.rows.join(" / ")}），在视口内 ${state.inViewport}、可滚动 ${state.scrollable}、Escape 关闭 ${closed}`,
      };
    });

    await check("移动端 320：工具栏一行四项、时间线操作不落单、分组导航有边缘提示", async () => {
      // Nine groups make the jump row wider than a 320px card, and the long event
      // titles are here so the header fix is measured against text that really wraps.
      const seed = `(() => {
        const now = new Date().toISOString();
        const worlds = ["白塔城", "盐脊", "塔群", "雾海", "锈湾", "潮下城", "雾外", "北境", "云港"];
        const characters = [];
        worlds.forEach((worldview, group) => {
          for (let index = 0; index < 4; index += 1) {
            characters.push({
              id: "polish-" + group + "-" + index,
              name: "角色" + group + "-" + index,
              occupation: "调查员",
              worldview,
              avatarEmoji: "🙂",
              createdAt: now,
              updatedAt: now,
            });
          }
        });
        const event = (id, title, date, kind, era) => ({
          id, title, date, kind, era, description: title + "的经过与影响。",
          location: "白塔城", characterIds: [], createdAt: now, updatedAt: now,
        });
        const timeline = [
          event("polish-ev-1", "北境第一座潮汐站并网与旧时代研究塔扩建的联合记录", "2001-03-01", "origin", "雾海历 812 年"),
          event("polish-ev-2", "盐脊商道首次贯通", "2002-05-06", "turning", "雾海历 813 年"),
          event("polish-ev-3", "四十人会盟", "2003-07-08", "bond", "雾海历 814 年"),
          event("polish-ev-4", "旧灯塔熄灯", "2004-09-10", "loss", "雾海历 815 年"),
          event("polish-ev-5", "潮汐纹成为工程标准", "2005-11-12", "conflict", "雾海历 816 年"),
          event("polish-ev-6", "云港船坞落成", "2006-01-14", "other", "雾海历 817 年"),
        ];
        localStorage.setItem("character-studio.characters", JSON.stringify(characters));
        localStorage.setItem("character-studio.relationships", JSON.stringify([]));
        localStorage.setItem("character-studio.timeline", JSON.stringify(timeline));
        localStorage.setItem("character-studio.world", JSON.stringify([]));
        localStorage.removeItem("character-studio.dashboard-prefs");
        localStorage.setItem("character-studio.about-seen", "true");
        return true;
      })()`;

      const widths = [320, 375, 390, 430];
      const toolbar = {};
      let timeline = null;
      let chips = null;
      let sheet = null;

      for (const width of widths) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 812,
          deviceScaleFactor: 2,
          mobile: true,
        });
        await cdp.goto(base);
        if (width === widths[0]) {
          await cdp.value(seed);
          await cdp.goto(base);
        }
        await cdp.waitFor(`!!document.querySelector(".list-toolbar")`, 8000);
        await new Promise((resolve) => setTimeout(resolve, 250));

        toolbar[width] = await cdp.value(`(() => {
          const box = (node) => node.getBoundingClientRect();
          const bar = document.querySelector(".list-toolbar");
          const barBox = box(bar);
          const kids = [...bar.children].filter((node) => getComputedStyle(node).display !== "none");
          // The collapsed search is a button labelled 搜索角色, not 搜索: an exact match
          // for 搜索 found nothing and was recorded as "0x0", which reads like a control
          // that disappeared rather than like a label that changed.
          const SEARCH_LABELS = { "搜索": ['button[aria-label="搜索"]', 'button[aria-label="搜索角色"]'], "筛选": ['button[aria-label="筛选"]'], "更多操作": ['button[aria-label="更多操作"]'] };
          const controls = ["搜索", "筛选", "更多操作"].map((label) => {
            const node = SEARCH_LABELS[label].map((selector) => bar.querySelector(selector)).find(Boolean) ?? null;
            const rect = node ? box(node) : null;
            return {
              label,
              found: node ? node.getAttribute("aria-label") : null,
              w: rect ? Math.round(rect.width) : 0,
              h: rect ? Math.round(rect.height) : 0,
              inside: rect ? rect.right <= barBox.right + 1 : false,
            };
          });
          const create = [...bar.querySelectorAll("button")].find((node) => node.textContent.includes("新建角色"));
          const createBox = create ? box(create) : null;
          controls.push({
            label: "新建角色",
            w: createBox ? Math.round(createBox.width) : 0,
            h: createBox ? Math.round(createBox.height) : 0,
            inside: createBox ? createBox.right <= barBox.right + 1 : false,
            labelFits: create ? create.scrollWidth <= create.clientWidth + 1 : false,
            // scrollWidth on the button does not see a label clipped by the button's
            // own overflow, so ask the label element directly.
            labelClipped: (() => {
              const label = create?.querySelector(".mantine-Button-label");
              return label ? label.scrollWidth > label.clientWidth + 1 : false;
            })(),
          });
          return {
            width: Math.round(barBox.width),
            height: Math.round(barBox.height),
            // Children on one line do not share a top: a 44px icon button and a 36px
            // primary button centred in the same row differ by 4px. Counting distinct
            // tops reported three rows for a row that is visually one, so cluster the
            // vertical centres instead -- anything within half a control height is the
            // same line.
            rows: (() => {
              const centres = kids.map((node) => {
                const rect = box(node);
                return rect.top + rect.height / 2;
              }).sort((a, b) => a - b);
              let lines = 0;
              let last = -Infinity;
              for (const centre of centres) {
                if (centre - last > 12) lines += 1;
                last = centre;
              }
              return lines;
            })(),
            controls,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);

        if (width === 320) {
          await cdp.value(clickWorkspace("世界观时间线"));
          await cdp.waitFor(`!!document.querySelector(".timeline-card")`, 8000);
          await new Promise((resolve) => setTimeout(resolve, 400));
          timeline = await cdp.value(`(() => {
            const box = (node) => node.getBoundingClientRect();
            return [...document.querySelectorAll(".timeline-card")].slice(0, 8).map((card) => {
              const head = card.querySelector(".timeline-card-head");
              const meta = card.querySelector(".timeline-card-meta");
              const actions = card.querySelector(".timeline-actions");
              const title = card.querySelector(".timeline-card-title");
              const line = parseFloat(getComputedStyle(title).lineHeight) || 20;
              return {
                headTop: Math.round(box(head).top),
                actionTop: Math.round(box(actions).top),
                actionLeft: Math.round(box(actions).left),
                metaRight: Math.round(box(meta).right),
                cardRight: Math.round(box(card).right),
                titleLength: title.textContent.length,
                titleLines: Math.round(box(title).height / line),
                titleClipped: title.scrollWidth > title.clientWidth + 1,
              };
            });
          })()`);

          await cdp.value(clickWorkspace("角色创作工作台"));
          await cdp.waitFor(`!!document.querySelector(".card-group-index-chips")`, 8000);
          await new Promise((resolve) => setTimeout(resolve, 350));
          chips = await cdp.value(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const node = document.querySelector(".card-group-index-chips");
            const mask = () => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage;
            const start = { cls: node.className, mask: mask(), left: node.scrollLeft, max: node.scrollWidth - node.clientWidth };
            node.scrollLeft = node.scrollWidth;
            await sleep(300);
            const box = node.getBoundingClientRect();
            const last = node.querySelector(".card-group-chip:last-child").getBoundingClientRect();
            return {
              start,
              end: { cls: node.className, mask: mask(), left: Math.round(node.scrollLeft) },
              inside: box.left >= -1 && box.right <= window.innerWidth + 1,
              lastFullyVisible: last.right <= box.right + 1,
            };
          })()`);

          // The nav sheet is the smallest-width regression to watch: the toolbar and
          // the cards changed, the navigation did not.
          await cdp.value(`document.querySelector(".workspace-switch").click()`);
          await new Promise((resolve) => setTimeout(resolve, 400));
          sheet = await cdp.value(`(() => {
            const root = document.querySelector('[data-testid="workspace-sheet"]');
            const panel = root?.querySelector(".sheet-panel");
            const box = panel?.getBoundingClientRect();
            return {
              present: Boolean(root),
              rows: root ? root.querySelectorAll(".sheet-row").length : 0,
              inViewport: box ? box.top >= -1 && box.bottom <= window.innerHeight + 1 : false,
            };
          })()`);
          await cdp.value(`document.querySelector('[data-testid="workspace-sheet"] .sheet-scrim').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          sheet.closed = await cdp.value(`!document.querySelector('[data-testid="workspace-sheet"]')`);
        }
      }

      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const rowCounts = widths.map((width) => toolbar[width].rows);
      const toolbarOk = widths.every((width) => {
        const state = toolbar[width];
        const four = state.controls.length === 4 && state.controls.every((control) => control.w > 0 && control.h >= 40 && control.inside);
        const create = state.controls.find((control) => control.label === "新建角色");
        const fits = create?.labelFits !== false && create?.labelClipped !== true;
        return state.rows === 1 && four && fits && state.overflow <= 1;
      });
      const timelineOk =
        timeline !== null &&
        timeline.length >= 5 &&
        timeline.every((card) => Math.abs(card.actionTop - card.headTop) <= 1 && card.actionLeft > card.metaRight && card.cardRight >= card.actionLeft) &&
        timeline
          .filter((card) => card.titleLength > 16)
          .every((card) => card.titleLines >= 2 && !card.titleClipped);
      const chipsOk =
        chips !== null &&
        chips.start.max > 1 &&
        chips.start.mask.includes("gradient") &&
        chips.start.cls.includes("has-overflow-end") &&
        chips.end.mask !== chips.start.mask &&
        Math.abs(chips.end.left - chips.start.max) <= 1 &&
        chips.inside &&
        chips.lastFullyVisible;
      const sheetOk = sheet !== null && sheet.present && sheet.rows === 4 && sheet.inViewport && sheet.closed;

      const failing = Object.entries({ toolbarOk, timelineOk, chipsOk, sheetOk })
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `${widths.map((width) => `${width}px 工具栏 ${toolbar[width].rows} 行/高 ${toolbar[width].height}px/溢出 ${toolbar[width].overflow}px`).join("；")}`
          + `；320 控件 ${toolbar[320].controls.map((control) => `${control.label} ${control.w}×${control.h}`).join("、")}`
          + `；320 时间线 ${timeline ? timeline.length : 0} 张，操作与头部同排 ${timeline ? timeline.filter((card) => Math.abs(card.actionTop - card.headTop) <= 1).length : 0}、长标题换行 ${timeline ? timeline.filter((card) => card.titleLength > 16 && card.titleLines >= 2 && !card.titleClipped).length : 0}`
          + `；分组导航可滚 ${chips ? chips.start.max : 0}px、起始提示 ${chips?.start.cls || "无"}、滚到末端提示 ${chips?.end.cls || "无"}、末端完整可见 ${chips?.lastFullyVisible || false}`
          + `；320 抽屉 ${sheet?.present ? "打开" : "未打开"}、${sheet?.rows ?? 0} 项、视口内 ${sheet?.inViewport}、遮罩关闭 ${sheet?.closed}`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("浮动栏：手机端不显示，桌面端让位且不压住控件", async () => {
      // A 56px floating control cannot be given a seat on a 375px column of text: every
      // seat it found was over a row it could not see (buttons were avoided, prose was
      // not). On phones it is not drawn. The desktop bar keeps its old behaviour.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 800,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.goto(base);
      await cdp.value(SEED_CROWDED);
      await cdp.value(`localStorage.setItem("character-studio.about-seen", "true")`);
      await cdp.goto(base);

      const phone = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const bar = () => document.querySelector(".floating-actions");
        const drawn = () => {
          const node = bar();
          if (!node) return false;
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        };
        window.scrollTo(0, 640);
        await sleep(500);
        const mid = drawn();
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(500);
        const bottom = drawn();
        return {
          present: Boolean(bar()),
          display: bar() ? getComputedStyle(bar()).display : "none",
          mid,
          bottom,
          scrolled: Math.round(window.scrollY),
          pageHeight: document.documentElement.scrollHeight,
        };
      })()`);

      // Hiding the bar must not take the page's scrolling or its dialogs with it.
      const dialog = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        window.scrollTo(0, 400);
        await sleep(200);
        const trigger = [...document.querySelectorAll("footer button")].find((button) => /设置与数据|Settings/.test(button.textContent));
        if (trigger) trigger.click();
        await sleep(400);
        const open = Boolean(document.querySelector(".settings-dialog"));
        const close = [...document.querySelectorAll(".settings-dialog button")].find((button) => button.textContent.trim() === "关闭");
        if (close) close.click();
        await sleep(250);
        return { open, closed: !document.querySelector(".settings-dialog") };
      })()`);

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.goto(base);
      await cdp.value(SEED_CROWDED);
      await cdp.goto(base);
      const desktop = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        window.scrollTo(0, 900);
        await sleep(520);
        const node = document.querySelector(".floating-actions");
        if (!node) return { present: false };
        const rect = node.getBoundingClientRect();
        const covered = [...document.querySelectorAll("button, a, summary")]
          .filter((element) => !element.closest(".floating-actions"))
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              box.left < rect.right &&
              box.right > rect.left &&
              box.top < rect.bottom &&
              box.bottom > rect.top
            );
          })
          .map((element) => element.tagName + "." + String(element.className || "").split(" ")[0]);
        const buttons = [...node.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
        const trigger = [...document.querySelectorAll("footer button")].find((button) => /设置与数据|Settings/.test(button.textContent));
        if (trigger) trigger.click();
        await sleep(400);
        const modalBar = document.querySelector(".floating-actions");
        const hiddenInDialog = !modalBar || getComputedStyle(modalBar).display === "none";
        const close = [...document.querySelectorAll(".settings-dialog button")].find((button) => button.textContent.trim() === "关闭");
        if (close) close.click();
        await sleep(250);
        return { present: true, buttons, covered: [...new Set(covered)], hiddenInDialog };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const phoneOk =
        phone.display === "none" &&
        !phone.mid &&
        !phone.bottom &&
        phone.scrolled > 0 &&
        dialog.open &&
        dialog.closed;
      const desktopOk =
        desktop.present &&
        desktop.buttons.includes("回到顶部") &&
        desktop.buttons.includes("滑到底部") &&
        desktop.covered.length === 0 &&
        desktop.hiddenInDialog === true;

      return {
        pass: Boolean(phoneOk && desktopOk),
        detail: `375：节点${phone.present ? "仍在 DOM" : "已移除"}、display ${phone.display}、滚动中 ${phone.mid ? "可见" : "不可见"}、到底 ${phone.bottom ? "可见" : "不可见"}、可滚动 ${phone.scrolled}px / 页高 ${phone.pageHeight}；设置弹窗 打开 ${dialog.open} / 关闭 ${dialog.closed}。1440：${desktop.present ? `存在（${desktop.buttons.join("/")}）、压住控件 ${desktop.covered.join("/") || "无"}、弹窗时 ${desktop.hiddenInDialog ? "隐藏" : "仍在"}` : "不存在"}`,
      };
    });

    await check("设置弹窗：Escape 关闭、焦点回到触发处、展开后内容可达（键盘）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.value(`localStorage.setItem("character-studio.about-seen", "true")`);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观时间线"));

      const opened = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const trigger = [...document.querySelectorAll("footer button")].find((button) => /设置与数据|Settings/.test(button.textContent));
        if (!trigger) throw new Error("footer settings button missing");
        trigger.focus();
        trigger.click();
        await sleep(400);
        const dialog = document.querySelector(".settings-dialog");
        return {
          open: Boolean(dialog),
          activeInside: Boolean(dialog && dialog.contains(document.activeElement)),
          activeText: document.activeElement ? document.activeElement.textContent.trim() : "",
          triggerText: trigger.textContent.trim(),
        };
      })()`);

      const focusables = await cdp.value(`(() => {
        const dialog = document.querySelector(".settings-dialog");
        if (!dialog) return { total: 0, unreachable: [], hasSummary: false };
        const nodes = [...dialog.querySelectorAll("button, input, select, textarea, summary")].filter((node) => {
          if (node.disabled) return false;
          if (node.tagName === "INPUT" && node.type === "hidden") return false;
          // A closed disclosure still reports a box in Chrome (content-visibility),
          // so "has height" is not the same as "can take focus". Those fields are
          // checked after the disclosure opens, below.
          if (node.tagName !== "SUMMARY" && node.closest("details:not([open])")) return false;
          return node.getBoundingClientRect().height > 0;
        });
        const unreachable = [];
        for (const node of nodes) {
          node.focus();
          if (document.activeElement !== node) {
            unreachable.push(node.tagName + "." + String(node.className || "").split(" ")[0]);
          }
        }
        return {
          total: nodes.length,
          unreachable,
          hasSummary: nodes.some((node) => node.tagName === "SUMMARY"),
        };
      })()`);

      // The disclosure opens to fields that are taller than the body, so the last one
      // has to be reachable by scrolling the body — with the head still in place.
      const pending = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const dialog = document.querySelector(".settings-dialog");
        const pending = dialog && dialog.querySelector(".settings-pending");
        if (!pending) return { open: false };
        pending.querySelector("summary").click();
        await sleep(250);
        const fields = [...pending.querySelectorAll("input, select, textarea, button")].filter(
          (field) => field.getBoundingClientRect().height > 0,
        );
        const enabled = fields.filter((field) => !field.disabled);
        const last = enabled[enabled.length - 1];
        const body = dialog.querySelector(".settings-body");
        last.scrollIntoView({ block: "nearest" });
        await sleep(150);
        const lastRect = last.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const head = dialog.querySelector(".preview-card-title").getBoundingClientRect();
        const unreachable = enabled.filter((field) => {
          field.focus();
          return document.activeElement !== field;
        });
        return {
          open: pending.open,
          fields: fields.length,
          unreachable: unreachable.length,
          lastVisible: lastRect.top >= bodyRect.top - 1 && lastRect.bottom <= bodyRect.bottom + 1,
          headVisible: head.height > 0 && head.top >= dialog.getBoundingClientRect().top - 1,
          lastFocusable: (() => {
            last.focus();
            return document.activeElement === last;
          })(),
        };
      })()`);

      const esc = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(300);
        return {
          dialog: Boolean(document.querySelector(".settings-dialog")),
          focusText: document.activeElement ? document.activeElement.textContent.trim() : "",
          focusTag: document.activeElement ? document.activeElement.tagName : "",
        };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const pass =
        opened.open &&
        opened.activeInside &&
        focusables.unreachable.length === 0 &&
        focusables.hasSummary &&
        pending.open &&
        pending.fields > 0 &&
        pending.unreachable === 0 &&
        pending.lastVisible &&
        pending.headVisible &&
        pending.lastFocusable &&
        !esc.dialog &&
        esc.focusText === opened.triggerText;

      return {
        pass: Boolean(pass),
        detail: `打开后焦点在弹窗内 ${opened.activeInside ? "是" : "否"}（${opened.activeText || "无"}）；可聚焦控件 ${focusables.total} 个、不可达 ${focusables.unreachable.join("/") || "无"}、含未发布摘要 ${focusables.hasSummary ? "是" : "否"}；展开后字段 ${pending.fields} 个（不可聚焦 ${pending.unreachable}）、末项可见 ${pending.lastVisible ? "是" : "否"}、页头仍在 ${pending.headVisible ? "是" : "否"}、末项可聚焦 ${pending.lastFocusable ? "是" : "否"}；Escape 后弹窗 ${esc.dialog ? "仍在" : "已关"}，焦点 ${esc.focusTag}「${esc.focusText}」（触发处「${opened.triggerText}」）`,
      };
    });

    await check("导入预览：真实导入态宽度、滚动、底部操作与 375px 换行", async () => {
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.value(`localStorage.setItem("character-studio.about-seen", "true")`);
      await cdp.goto(base);

      const before = await cdp.value(`(() => {
        try { return JSON.parse(localStorage.getItem("character-studio.characters") || "[]").length; } catch { return -1; }
      })()`);

      const payload = {
        version: 1,
        exportedAt: "2026-03-01T00:00:00.000Z",
        characters: [
          {
            id: "rc-import-1",
            name: "导入预览·甲",
            occupation: "占星师",
            worldview: "阿尔勒",
            avatarEmoji: "🜂",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
          {
            id: "rc-import-1",
            name: "导入预览·同名 ID 冲突记录",
            occupation: "工匠",
            worldview: "北境",
            avatarEmoji: "🦊",
            createdAt: "2026-02-03T00:00:00.000Z",
            updatedAt: "2026-02-03T00:00:00.000Z",
          },
          {
            id: "rc-import-2",
            name: "名字很长很长的守夜人第二席代理记录官·导入预览换行验证",
            occupation: "记录官",
            worldview: "雾海纪",
            avatarEmoji: "🌙",
            createdAt: "2026-02-04T00:00:00.000Z",
            updatedAt: "2026-02-04T00:00:00.000Z",
          },
        ],
      };

      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const input = document.querySelector('input[type="file"][accept*="json"]');
        if (!input) throw new Error("import input missing");
        const file = new File([${JSON.stringify(JSON.stringify(payload))}], "rc-import.json", { type: "application/json" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        for (let attempt = 0; attempt < 25 && !document.querySelector(".settings-dialog.compact-dialog"); attempt++) {
          await sleep(200);
        }
        return Boolean(document.querySelector(".settings-dialog.compact-dialog"));
      })()`);

      const readPreview = `(() => {
        const dialog = document.querySelector(".settings-dialog.compact-dialog");
        if (!dialog) return { open: false };
        const grid = dialog.querySelector(".settings-grid");
        const footer = dialog.querySelector(".dialog-actions");
        const buttons = footer ? [...footer.querySelectorAll("button")] : [];
        const rect = dialog.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const covered = [];
        for (const button of buttons) {
          const buttonRect = button.getBoundingClientRect();
          const top = document.elementsFromPoint(
            buttonRect.left + buttonRect.width / 2,
            buttonRect.top + buttonRect.height / 2,
          )[0];
          if (!top || !(top === button || button.contains(top))) {
            covered.push(top ? top.tagName + "." + String(top.className || "").split(" ")[0] : "none");
          }
        }
        const overflowing = [...grid.querySelectorAll("article, p, span, h3")].filter(
          (node) => node.scrollWidth - node.clientWidth > 1,
        ).length;
        return {
          open: true,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          gridOverflowY: getComputedStyle(grid).overflowY,
          gridScrolls: grid.scrollHeight - grid.clientHeight,
          footerTop: Math.round(footerRect.top - rect.top),
          footerBottom: Math.round(rect.bottom - footerRect.bottom),
          footerPadTop: parseFloat(getComputedStyle(footer).paddingTop),
          footerPadBottom: parseFloat(getComputedStyle(footer).paddingBottom),
          footerRule: parseFloat(getComputedStyle(footer).borderTopWidth),
          footerInViewport: footerRect.bottom <= window.innerHeight + 1 && footerRect.top >= 0,
          buttons: buttons.map((button) => button.textContent.trim()),
          buttonsInDialog: buttons.every((button) => {
            const r = button.getBoundingClientRect();
            return r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1 && r.left >= rect.left - 1;
          }),
          covered,
          overflowing,
          stats: [...dialog.querySelectorAll(".import-preview-stats span")].slice(0, 6).map((node) => node.textContent.trim()),
        };
      })()`;

      const desktop = await cdp.value(readPreview);

      // The same open dialog at 375: it has to reflow, not scroll sideways.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 350))`);
      const mobile = await cdp.value(readPreview);

      await cdp.value(`(async () => {
        const cancel = [...document.querySelectorAll(".settings-dialog.compact-dialog .dialog-actions button")].find(
          (button) => button.textContent.trim() === "取消",
        );
        if (cancel) cancel.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return true;
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const after = await cdp.value(`(() => {
        try { return JSON.parse(localStorage.getItem("character-studio.characters") || "[]").length; } catch { return -1; }
      })()`);

      const desktopOk =
        desktop.open &&
        desktop.width >= 520 &&
        desktop.width <= 640 &&
        desktop.dialogOverflow <= 1 &&
        desktop.pageOverflow <= 1 &&
        desktop.gridOverflowY === "auto" &&
        desktop.footerInViewport &&
        desktop.footerPadTop >= 10 &&
        desktop.footerPadBottom >= 10 &&
        desktop.footerRule > 0 &&
        desktop.buttonsInDialog &&
        desktop.covered.length === 0 &&
        desktop.overflowing === 0;
      const mobileOk =
        mobile.open &&
        mobile.width <= 355 &&
        mobile.dialogOverflow <= 1 &&
        mobile.pageOverflow <= 1 &&
        mobile.footerInViewport &&
        mobile.buttonsInDialog &&
        mobile.covered.length === 0 &&
        mobile.overflowing === 0;
      const readOnly = before === after;

      return {
        pass: Boolean(desktopOk && mobileOk && readOnly),
        detail: `桌面 ${desktop.width}×${desktop.height}（视口 ${desktop.viewportWidth}）、滚动区 ${desktop.gridOverflowY}（可滚动 ${desktop.gridScrolls}px）、页脚距底 ${desktop.footerBottom}px/内边距 ${desktop.footerPadTop}|${desktop.footerPadBottom}/分隔 ${desktop.footerRule}px、按钮 ${desktop.buttons.join("+")}、遮挡 ${desktop.covered.join("/") || "无"}、溢出元素 ${desktop.overflowing}；375px 宽 ${mobile.width}、页面溢出 ${mobile.pageOverflow}px、页脚在视口内 ${mobile.footerInViewport ? "是" : "否"}、遮挡 ${mobile.covered.join("/") || "无"}、溢出元素 ${mobile.overflowing}；预览前后角色数 ${before}→${after}`,
      };
    });

await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // ---- Import: the plan, the write, and what the two agree on -----------------
    //
    // These are the checks that a unit test cannot make: the plan is correct in
    // isolation, but what matters is which ids end up in localStorage after the
    // dialog is confirmed, and whether the recovery point can actually put them back.

    const FEED_IMPORT = (payload, name) => `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const input = document.querySelector('input[type="file"][accept*="json"]');
      if (!input) throw new Error("import input missing");
      const file = new File([${JSON.stringify(JSON.stringify(payload))}], ${JSON.stringify(name)}, { type: "application/json" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 40 && !document.querySelector(".import-dialog"); attempt++) {
        await sleep(150);
      }
      return Boolean(document.querySelector(".import-dialog"));
    })()`;

    const CONFIRM_IMPORT = (label) => `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const dialog = document.querySelector(".import-dialog");
      if (!dialog) throw new Error("import dialog missing");
      const button = [...dialog.querySelectorAll(".dialog-actions button")].find(
        (item) => item.textContent.trim() === ${JSON.stringify(label)},
      );
      if (!button) throw new Error("confirm button missing: " + ${JSON.stringify(label)});
      button.click();
      for (let attempt = 0; attempt < 80 && document.querySelector(".import-dialog"); attempt++) {
        await sleep(150);
      }
      await sleep(300);
      return !document.querySelector(".import-dialog");
    })()`;

    const READ_STORES = `(() => {
      const read = (key) => {
        try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
      };
      return {
        characters: read("character-studio.characters"),
        relationships: read("character-studio.relationships"),
        timeline: read("character-studio.timeline"),
        world: read("character-studio.world"),
        point: (() => {
          try { return JSON.parse(localStorage.getItem("character-studio.backup") || "null"); } catch { return null; }
        })(),
      };
    })()`;

    await check("导入：合并时引用跟随新 ID，缺失引用被暂缓而预览一致", async () => {
      const now = "2026-01-01T00:00:00.000Z";

      await cdp.goto(base);
      await cdp.value(`localStorage.setItem("character-studio.characters", JSON.stringify([
        { id: "dup-1", name: "已存在的甲", createdAt: ${JSON.stringify(now)}, updatedAt: ${JSON.stringify(now)} }
      ]));
      localStorage.setItem("character-studio.relationships", "[]");
      localStorage.setItem("character-studio.timeline", "[]");
      localStorage.setItem("character-studio.world", "[]");`);
      await cdp.goto(base);

      const payload = {
        exportType: "character-studio-full-backup",
        exportedAt: now,
        characters: [
          { id: "dup-1", name: "包里的甲", createdAt: now, updatedAt: now },
          { id: "new-2", name: "包里的乙", createdAt: now, updatedAt: now },
        ],
        relationships: [
          // Both ends are in the package, but 包里的甲 has to move to a new id.
          { id: "rel-keep", fromId: "dup-1", toId: "new-2", kind: "friend", createdAt: now, updatedAt: now },
          // One end is nobody: this edge must be set aside, not attached to a guess.
          { id: "rel-ghost", fromId: "dup-1", toId: "ghost", kind: "family", createdAt: now, updatedAt: now },
        ],
        timeline: [
          { id: "evt-1", title: "初遇", date: "2040-01-01", kind: "origin", characterIds: ["dup-1", "ghost"], createdAt: now, updatedAt: now },
        ],
        world: [
          { id: "w-1", name: "白塔城", category: "location", tags: [], characterIds: ["ghost"], createdAt: now, updatedAt: now },
        ],
      };

      const opened = await cdp.value(FEED_IMPORT(payload, "mapping.json"));
      const preview = await cdp.value(`(() => {
        const dialog = document.querySelector(".import-dialog");
        if (!dialog) return { stats: [], target: [] };
        const groups = [...dialog.querySelectorAll("article")];
        const statsOf = (heading) => {
          const article = groups.find((item) => item.querySelector("h3")?.textContent.trim() === heading);
          return article ? [...article.querySelectorAll(".import-preview-stats span")].map((node) => node.textContent.trim()) : [];
        };
        return { stats: statsOf("数据包内容"), deps: statsOf("依赖检查"), target: statsOf("导入后") };
      })()`);

      const confirmed = await cdp.value(CONFIRM_IMPORT("确认导入"));
      const stores = await cdp.value(READ_STORES);

      const byName = (name) => stores.characters.find((item) => item.name === name);
      const importedA = byName("包里的甲");
      const importedB = byName("包里的乙");
      const edge = stores.relationships[0];

      const conditions = {
        opened,
        confirmed,
        keptExisting: Boolean(byName("已存在的甲")),
        copiedToNewId: Boolean(importedA) && importedA.id !== "dup-1",
        threeCharacters: stores.characters.length === 3,
        oneEdge: stores.relationships.length === 1,
        edgeFromCopy: Boolean(edge && importedA) && edge.fromId === importedA.id,
        edgeToPackageCharacter: Boolean(edge && importedB) && edge.toId === importedB.id,
        ghostNotLinked: stores.relationships.every((item) => item.toId !== "ghost"),
        timelineKeptPruned: stores.timeline.length === 1 && stores.timeline[0].characterIds.length === 1,
        worldKeptEmpty: stores.world.length === 1 && stores.world[0].characterIds.length === 0,
        previewSaidDeferred: preview.deps.some((line) => line.includes("暂缓的关系：1")),
        targetMatches: preview.target.some((line) => line === "角色 3 个"),
      };
      const failing = Object.entries(conditions).filter(([, value]) => !value).map(([key]) => key);

      return {
        pass: failing.length === 0,
        detail: `失败项 ${failing.join("/") || "无"}；角色 ${stores.characters.length}（${stores.characters.map((item) => item.name + ":" + item.id).join("、")}）；关系 ${stores.relationships.length} 条（${stores.relationships.map((item) => item.id + " " + item.fromId + "→" + item.toId).join("、")}）；事件关联 ${stores.timeline[0] ? stores.timeline[0].characterIds.length : "-"}；世界观关联 ${stores.world[0] ? stores.world[0].characterIds.length : "-"}；预览「${preview.stats.join(" / ")}」依赖「${preview.deps.join(" / ")}」→ 结果「${preview.target.join(" / ")}」`,
      };
    });

    await check("导入：完整恢复覆盖全部数据域，恢复点能真正回滚", async () => {
      const now = "2026-01-01T00:00:00.000Z";

      await cdp.goto(base);
      await cdp.value(`(() => {
        const character = (id, name) => ({ id, name, createdAt: ${JSON.stringify(now)}, updatedAt: ${JSON.stringify(now)} });
        localStorage.setItem("character-studio.characters", JSON.stringify([character("old-1", "旧的甲"), character("old-2", "旧的乙")]));
        localStorage.setItem("character-studio.relationships", JSON.stringify([{ id: "old-rel", fromId: "old-1", toId: "old-2", kind: "friend", createdAt: ${JSON.stringify(now)}, updatedAt: ${JSON.stringify(now)} }]));
        localStorage.setItem("character-studio.timeline", JSON.stringify([{ id: "old-evt", title: "旧事件", date: "2040-01-01", kind: "origin", characterIds: ["old-1"], createdAt: ${JSON.stringify(now)}, updatedAt: ${JSON.stringify(now)} }]));
        localStorage.setItem("character-studio.world", JSON.stringify([{ id: "old-world", name: "旧条目", category: "location", tags: [], characterIds: ["old-1"], createdAt: ${JSON.stringify(now)}, updatedAt: ${JSON.stringify(now)} }]));
        localStorage.removeItem("character-studio.backup");
        return true;
      })()`);
      await cdp.goto(base);

      const payload = {
        exportType: "character-studio-full-backup",
        exportedAt: now,
        characters: [{ id: "restore-1", name: "恢复进来的角色", createdAt: now, updatedAt: now }],
        relationships: [],
        timeline: [],
        world: [],
      };

      const opened = await cdp.value(FEED_IMPORT(payload, "restore.json"));
      // Switch mode inside the dialog: the same dialog, a different promise.
      const switched = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const dialog = document.querySelector(".import-dialog");
        const button = dialog ? [...dialog.querySelectorAll(".segmented-row button")].find((item) => item.textContent.trim() === "完整恢复") : null;
        if (!button) return { ok: false };
        button.click();
        await sleep(300);
        const warning = dialog.querySelector(".import-warning");
        const title = dialog.querySelector("h2")?.textContent.trim();
        const target = [...dialog.querySelectorAll("article")]
          .find((item) => item.querySelector("h3")?.textContent.trim() === "导入后");
        return {
          ok: true,
          warning: warning ? warning.textContent.trim().slice(0, 20) : "",
          title,
          target: target ? [...target.querySelectorAll(".import-preview-stats span")].map((node) => node.textContent.trim()) : [],
        };
      })()`);

      const confirmed = await cdp.value(CONFIRM_IMPORT("确认恢复"));
      const restored = await cdp.value(READ_STORES);

      // Put it back from the recovery point, through the button the author would use.
      const rollback = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        // The footer entry is labelled 设置与数据 (it was "Settings" once). Exact-match against
        // the old label returned undefined, so rollback.confirmed was undefined and the
        // whole rollback half of this check never ran -- the data looked unrestored because
        // nothing had asked it to restore. No backticks in here: this is inside a template
        // literal.
        const trigger = [...document.querySelectorAll("footer button, button")]
          .find((item) => /^(设置与数据|Settings)$/.test(item.textContent.trim()));
        if (!trigger) return { opened: false };
        trigger.click();
        await sleep(400);
        const restoreButton = [...document.querySelectorAll(".settings-data button")].find((item) => item.textContent.includes("恢复上次自动备份"));
        if (!restoreButton) return { opened: true, found: false };
        restoreButton.click();
        await sleep(400);
        const confirm = [...document.querySelectorAll(".confirm-dialog button, .form-actions button")].find((item) => item.textContent.trim() === "确认恢复");
        if (!confirm) return { opened: true, found: true, confirmed: false };
        confirm.click();
        await sleep(600);
        return { opened: true, found: true, confirmed: true };
      })()`);
      const afterRollback = await cdp.value(READ_STORES);

      const conditions = {
        opened,
        switched: switched.ok,
        warningShown: Boolean(switched.warning),
        titleSaysRestore: switched.title === "完整恢复",
        previewTargetsZero: switched.target.some((line) => line === "关系 0 条"),
        confirmed,
        oneCharacter: restored.characters.length === 1 && restored.characters[0].name === "恢复进来的角色",
        domainsCleared:
          restored.relationships.length === 0 &&
          restored.timeline.length === 0 &&
          restored.world.length === 0,
        pointWritten: Boolean(restored.point) && restored.point.relationships.length === 1,
        rollbackRan: rollback.confirmed === true,
        charactersBack: afterRollback.characters.length === 2,
        edgeBack: afterRollback.relationships.length === 1,
        timelineBack: afterRollback.timeline.length === 1,
        worldBack: afterRollback.world.length === 1,
      };
      const failing = Object.entries(conditions).filter(([, value]) => !value).map(([key]) => key);

      return {
        pass: failing.length === 0,
        detail: `失败项 ${failing.join("/") || "无"}；恢复后 角色 ${restored.characters.length}·关系 ${restored.relationships.length}·事件 ${restored.timeline.length}·世界观 ${restored.world.length}；恢复点 角色 ${restored.point ? restored.point.characters.length : "-"}·关系 ${restored.point ? restored.point.relationships.length : "-"}；回滚后 角色 ${afterRollback.characters.length}·关系 ${afterRollback.relationships.length}·事件 ${afterRollback.timeline.length}·世界观 ${afterRollback.world.length}；弹窗标题「${switched.title}」提示「${switched.warning}」→「${switched.target.join(" / ")}」`,
      };
    });

    await check("导出：PDF 分页不再重复嵌入整幅图，体积与页数在预算内", async () => {
      const now = "2026-01-01T00:00:00.000Z";
      const longText = "第一次潮汐失衡时他十九岁，站在白塔的第三层，看着海水从下城的排水口倒灌进来。".repeat(70);

      await cdp.goto(base);
      await cdp.value(`localStorage.setItem("character-studio.characters", JSON.stringify([{
        id: "pdf-1",
        name: "顾长庚",
        createdAt: ${JSON.stringify(now)},
        updatedAt: ${JSON.stringify(now)},
        gender: "男",
        age: "62",
        species: "人类",
        occupation: "自治议会议长",
        worldview: "白塔城",
        personalityTags: ["长于权衡", "记仇", "极少承诺"],
        appearanceDescription: "银灰短发，左眼下方有一道旧灼痕。" + "穿深灰长袍，袖口永远磨得发亮。".repeat(6),
        abilityDescription: "能在四小时的争吵里记住每一方的底线。" + "也因此在每一次让步之后都清楚地知道自己失去了什么。".repeat(10),
        backstory: ${JSON.stringify(longText)},
        likes: "黑咖啡、旧档案纸的味道",
        importantItems: "一枚磨平了字的私章",
      }]))`);
      await cdp.goto(base);

      const opened = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        window.__pdf = null;
        if (!window.__origCreateObjectUrl) window.__origCreateObjectUrl = URL.createObjectURL;
        URL.createObjectURL = function (blob) { window.__pdf = blob; return window.__origCreateObjectUrl.call(URL, blob); };
        const more = document.querySelector('button[aria-label="更多"]');
        if (!more) return "no-menu";
        more.click();
        await sleep(300);
        const item = [...document.querySelectorAll(".card-menu button")].find((node) => node.textContent.trim() === "导出");
        if (!item) return "no-export";
        item.click();
        await sleep(400);
        const pdf = [...document.querySelectorAll(".export-dialog-list button")].find((node) => node.textContent.trim() === "PDF");
        if (!pdf) return "no-pdf";
        window.__pdfStart = performance.now();
        pdf.click();
        return "ok";
      })()`);

      const ready = opened === "ok" ? await cdp.waitFor("!!window.__pdf", 60000) : false;
      const measured = ready
        ? await cdp.value(`(async () => {
            const blob = window.__pdf;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let text = "";
            for (let index = 0; index < bytes.length; index += 65536) {
              text += String.fromCharCode.apply(null, bytes.subarray(index, index + 65536));
            }
            return {
              size: blob.size,
              pages: (text.match(/\\/Type\\s*\\/Page[^s]/g) || []).length,
              ms: Math.round(performance.now() - window.__pdfStart),
            };
          })()`)
        : null;

      const conditions = {
        clicked: opened === "ok",
        produced: Boolean(measured),
        multiPage: Boolean(measured) && measured.pages >= 2,
        // The old path embedded the whole capture once per page and produced 25 MB
        // for this character; the budget below is an order of magnitude under it.
        withinBudget: Boolean(measured) && measured.size > 0 && measured.size < 4_000_000,
      };
      const failing = Object.entries(conditions).filter(([, value]) => !value).map(([key]) => key);

      return {
        pass: failing.length === 0,
        detail: `失败项 ${failing.join("/") || "无"}；${measured ? `${(measured.size / 1024).toFixed(0)} KB / ${measured.pages} 页 / ${measured.ms}ms` : opened}`,
      };
    });

      await check("关联信息：三类关联、计数、方向与空状态（任务 A/B/C/D）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_LINKS);
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("沈青梧"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const state = await cdp.value(READ_RELATED);

      // Expanding is a request for the rest, and collapsing puts the short list back.
      const expanded = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const group = document.querySelectorAll(".related-group")[0];
        group.querySelector(".related-more").click();
        await sleep(300);
        const open = { rows: group.querySelectorAll(".related-row").length, more: group.querySelector(".related-more").textContent.trim(), peers: [...group.querySelectorAll(".related-peer-name")].map((node) => node.textContent.trim()) };
        group.querySelector(".related-more").click();
        await sleep(300);
        return { open, collapsed: { rows: group.querySelectorAll(".related-row").length, more: group.querySelector(".related-more").textContent.trim() } };
      })()`);

      // A character with nothing attached says so instead of showing empty frames.
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("孤立角色"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const lonely = await cdp.value(READ_RELATED);

      // Two characters share a name. Each preview must show that character's own
      // records: match on the id, never on the name.
      // The same section on a phone and in dark: one column, inside the width, and
      // painted with the dark surface rather than the light one.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("沈青梧"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const narrowRelated = await cdp.value(`(() => {
        const section = document.querySelector(".preview-related");
        const groups = [...document.querySelectorAll(".related-group")];
        const rects = groups.map((group) => group.getBoundingClientRect());
        const row = document.querySelector(".related-row").getBoundingClientRect();
        return {
          columns: new Set(rects.map((rect) => Math.round(rect.top))).size,
          inside: rects.every((rect) => rect.left >= -1 && rect.right <= window.innerWidth + 1),
          rowInside: row.left >= -1 && row.right <= window.innerWidth + 1,
          sectionInside: section.getBoundingClientRect().right <= window.innerWidth + 1,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          page: ${PAGE_IDS},
        };
      })()`);
      const darkTheme = await cdp.value(SET_THEME_BY_MENU("深色"));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const darkRelated = await cdp.value(`(() => {
        const group = document.querySelector(".related-group");
        return { theme: document.documentElement.dataset.theme || "", background: getComputedStyle(group).backgroundColor, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.goto(base);

      const sameNamePair = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const cardsOf = () => [...document.querySelectorAll(".character-card")].filter(
          (card) => card.textContent.includes("同名角色"),
        );
        try {
        const read = () => {
          const group = document.querySelectorAll(".related-group")[1];
          return {
            head: (document.querySelector(".preview-related-head")?.textContent || "").replace(/\s+/g, " ").trim(),
            events: [...group.querySelectorAll(".related-item-title")].map((node) => node.textContent.trim()),
            rows: group.querySelectorAll(".related-row").length,
          };
        };
        const open = async (index) => {
          // Re-queried every time: going Back rebuilds the dashboard's DOM, and a node
          // captured before that is detached — clicking it navigates nowhere.
          cardsOf()[index].querySelector('button[aria-label="更多"]').click();
          await sleep(300);
          [...document.querySelectorAll(".card-menu button")].find((button) => button.textContent.trim() === "预览").click();
          await sleep(900);
          return read();
        };
        // Counted before opening: the preview has no cards to count.
        const total = cardsOf().length;
        const first = await open(0);
        return { cards: total, first };
        } catch (error) {
          return { error: String(error && error.message || error), cards: cardsOf().length, page: ${PAGE_IDS}, names: [...document.querySelectorAll(".character-card .character-row-name, .character-card h3")].map((node) => node.textContent.trim()).slice(0, 10) };
        }
      })()`);

      // The other same-name character, opened from a fresh dashboard: it must show its
      // own (empty) records rather than its namesake's event.
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("同名角色", 1));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const sameNameSecond = await cdp.value(`(() => {
        const group = document.querySelectorAll(".related-group")[1];
        return {
          head: (document.querySelector(".preview-related-head")?.textContent || "").replace(/\s+/g, " ").trim(),
          events: [...group.querySelectorAll(".related-item-title")].map((node) => node.textContent.trim()),
        };
      })()`);

      const relations = state.groups[0] || { rows: 0 };
      const events = state.groups[1] || { rows: 0 };
      const entries = state.groups[2] || { rows: 0 };
      const conditions = {
        present: state.present,
        exportUnchanged:
          state.excludedFromExport && state.relatedBeforeExportFooter && state.exportFooterHiddenOnScreen,
        headCounts:
          state.head.includes("4 条关系") &&
          state.head.includes("4 个事件") &&
          state.head.includes("2 个条目"),
        relationRows: relations.count === "4" && relations.rows === 3 && relations.avatars === 3,
        relationPeers: relations.peers.includes("陆停云") && relations.peers.includes("顾行之"),
        relationKinds:
          relations.kinds.includes("亲属") && relations.kinds.includes("师承 · 对方为师承方"),
        relationNote: relations.notes.some((note) => note.includes("同门")),
        graphEntry: relations.chrome.some((label) => label.includes("在关系网中查看")),
        relationMore: relations.more === "查看全部 4 条关系",
        eventRows: events.count === "4" && events.rows === 3 && events.more === "查看全部 4 个事件",
        eventFields: events.titles.includes("灯塔的第一夜") && events.kinds.includes("起源"),
        entryRows:
          entries.count === "2" &&
          entries.rows === 2 &&
          entries.more === "" &&
          entries.titles.includes("白塔区") &&
          entries.paths.includes("雾海纪 › 北境城"),
        expanded:
          expanded.open.rows === 4 &&
          expanded.open.more === "收起" &&
          expanded.open.peers.includes("青芜") &&
          expanded.collapsed.rows === 3 &&
          expanded.collapsed.more === "查看全部 4 条关系",
        lonely:
          lonely.head.includes("0 条关系") &&
          lonely.groups.every((group) => group.empty !== "" && group.rows === 0) &&
          lonely.groups[0].empty.includes("还没有与其他角色的关系"),
        sameName:
          !sameNamePair.error &&
          sameNamePair.cards === 2 &&
          sameNamePair.first.events.join("/") === "同名角色的事件" &&
          sameNameSecond.events.length === 0 &&
          sameNameSecond.head.includes("0 个事件"),
        noOverflow: state.pageOverflow <= 1,
        narrow:
          narrowRelated.page === "preview" &&
          narrowRelated.columns === 3 &&
          narrowRelated.inside &&
          narrowRelated.rowInside &&
          narrowRelated.sectionInside &&
          narrowRelated.overflow <= 1,
        dark:
          darkTheme === "dark" &&
          darkRelated.theme === "dark" &&
          darkRelated.background !== "rgb(255, 255, 255)" &&
          darkRelated.pageOverflow <= 1,
      };
      const failing = Object.entries(conditions).filter(([, ok]) => !ok).map(([name]) => name);
      const pass = failing.length === 0;
      const legacyPass =
        state.present &&
        // the reading material is excluded from what an export captures, and the page
        // keeps a single footer after it
        state.excludedFromExport &&
        state.relatedBeforeExportFooter &&
        state.head.includes("4 条关系") &&
        state.head.includes("4 个事件") &&
        state.head.includes("2 个条目") &&
        relations.count === "4" &&
        relations.rows === 3 &&
        relations.more === "查看全部 4 条关系" &&
        relations.avatars === 3 &&
        relations.peers.includes("陆停云") &&
        relations.peers.includes("顾行之") &&
        relations.kinds.includes("亲属") &&
        relations.kinds.includes("师承 · 对方为师承方") &&
        relations.kinds.includes("对手") &&
        relations.notes.some((note) => note.includes("同门")) &&
        relations.chrome.some((label) => label.includes("在关系网中查看")) &&
        events.count === "4" &&
        events.rows === 3 &&
        events.more === "查看全部 4 个事件" &&
        events.titles.includes("灯塔的第一夜") &&
        events.kinds.includes("起源") &&
        entries.count === "2" &&
        entries.rows === 2 &&
        entries.more === "" &&
        entries.titles.includes("白塔区") &&
        entries.paths.includes("雾海纪 › 北境城") &&
        expanded.open.rows === 4 &&
        expanded.open.more === "收起" &&
        expanded.open.peers.includes("青芜") &&
        expanded.collapsed.rows === 3 &&
        expanded.collapsed.more === "查看全部 4 条关系" &&
        lonely.head.includes("0 条关系") &&
        lonely.groups.every((group) => group.empty !== "" && group.rows === 0) &&
        lonely.groups[0].empty.includes("还没有与其他角色的关系") &&
        // Neither same-name character sees the other's event, and one of them has none.
        !sameNamePair.error &&
        sameNamePair.cards === 2 &&
        sameNamePair.first.events.join("/") === "同名角色的事件" &&
        sameNameSecond.events.length === 0 &&
        sameNameSecond.head.includes("0 个事件") &&
        state.pageOverflow <= 1;

      return {
        pass,
        detail: `失败项 ${failing.join("/") || "无"}；沈青梧：${state.head}；关系组 ${relations.count} 条 → 显示 ${relations.rows} 行（${relations.peers.join("/")}，头像 ${relations.avatars}）方向 ${relations.kinds.join("/")} 备注「${relations.notes.join("/")}」入口「${relations.chrome.join("/")}」；展开后 ${expanded.open.rows} 行「${expanded.open.more}」→ 收起 ${expanded.collapsed.rows} 行；事件组 ${events.count} 个 → ${events.rows} 行「${events.more}」${events.titles.join("/")}；条目组 ${entries.count} 个 → ${entries.rows} 行 ${entries.titles.join("/")} 路径「${entries.paths.join("/")}」；孤立角色 ${lonely.head}；同名角色（两张卡片）第一张事件「${sameNamePair.first ? sameNamePair.first.events.join("/") : ""}」第二张「${sameNamePair.second ? sameNamePair.second.events.join("/") || "无" : ""}」${sameNamePair.error ? "错误：" + sameNamePair.error + " 卡片：" + (sameNamePair.names || []).join("/") + " 页面：" + sameNamePair.page : sameNameSecond.head}；关联区不进导出 ${state.excludedFromExport}、位于导出页脚之前 ${state.relatedBeforeExportFooter}、导出页脚屏幕隐藏 ${state.exportFooterHiddenOnScreen}；溢出 ${state.pageOverflow}px；375px 三组各自成行 ${narrowRelated.columns === 3}、在视口内 ${narrowRelated.inside}、行不溢出 ${narrowRelated.rowInside}、页面溢出 ${narrowRelated.overflow}px；深色 data-theme=${darkRelated.theme}（组底色 ${darkRelated.background}）、溢出 ${darkRelated.pageOverflow}px`,
      };
    });

    await check("关联信息：跳转关系网并聚焦当前角色（任务 B/E）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_LINKS);
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("沈青梧"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const state = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const before = window.history.length;
        [...document.querySelectorAll(".related-group-action")][0].click();
        await sleep(1200);
        return {
          page: ${PAGE_IDS},
          focusChip: (document.querySelector(".graph-focus-chip")?.textContent || "").replace(/\s+/g, " ").trim(),
          // <text> carries its own <title> as well as the tspans, so textContent would
        // read the name twice; the title is one copy of it.
        focused: (() => {
          const label = document.querySelector(".relationship-node.focused .relationship-node-name");
          if (!label) return "";
          const title = label.querySelector("title")?.textContent;
          return (title || [...label.querySelectorAll("tspan")].map((line) => line.textContent).join("")).trim();
        })(),
          focusedCount: document.querySelectorAll(".relationship-node.focused").length,
          activeEdges: document.querySelectorAll(".relationship-edge.active").length,
          dimmed: document.querySelectorAll(".relationship-node.dimmed").length,
          nodes: document.querySelectorAll(".relationship-node").length,
          // WorkspaceSearch keeps the query when it collapses and shows a chip that
          // names it. So: an open field reports its value, a closed one reports the
          // chip, and no chip means no query — one fact, three shapes.
          searchEmpty: (() => {
            const field = document.querySelector('[data-testid="graph-search-input"]');
            if (field) return field.value;
            if (document.querySelector('[data-testid="graph-search-active"]')) {
              return (document.querySelector('[data-testid="graph-search-active"] .ws-search-active-text')?.textContent || "").trim();
            }
            return document.querySelector('[data-testid="graph-search"]') ? "" : "n/a";
          })(),
          historyGrowth: window.history.length - before,
        };
      })()`);

      const pass =
        state.page === "relationships" &&
        state.focused.trim() === "沈青梧" &&
        state.focusedCount === 1 &&
        state.focusChip.includes("沈青梧") &&
        state.activeEdges === 4 &&
        // Only the connected characters are drawn, and all five of them are this
        // character's connections, so there is nothing left to dim.
        state.nodes === 5 &&
        state.dimmed === 0 &&
        state.searchEmpty === "" &&
        state.historyGrowth <= 1;

      return {
        pass,
        detail: `进入 ${state.page}；聚焦节点「${state.focused.trim()}」（${state.focusedCount} 个）、聚焦标「${state.focusChip}」、高亮关系线 ${state.activeEdges} 条、变暗 ${state.dimmed} 个 / 画布节点 ${state.nodes}；搜索框已清空「${state.searchEmpty}」；history 增长 ${state.historyGrowth}`,
      };
    });

    await check("关联信息：跳转时间线事件并定位（任务 C/E）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_LINKS);
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("沈青梧"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const direct = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const row = document.querySelectorAll(".related-group")[1].querySelector(".related-item");
        row.click();
        await sleep(1600);
        const card = document.querySelector('[data-event-id="ev-1"]');
        const rect = card ? card.getBoundingClientRect() : null;
        return {
          page: ${PAGE_IDS},
          title: (card?.querySelector(".timeline-card-title")?.textContent || "").trim(),
          highlighted: Boolean(card?.classList.contains("highlighted")),
          inViewport: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0),
          filter: (document.querySelector('[aria-label="按年份筛选"]') || {}).value ?? "",
          items: document.querySelectorAll(".timeline-item").length,
        };
      })()`);

      // And when a filter would have hidden it: the jump clears what stands in the way.
      const filtered = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const select = document.querySelector('[aria-label="按年份筛选"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, "2026");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(500);
        const before = { items: document.querySelectorAll(".timeline-item").length, hasTarget: Boolean(document.querySelector('[data-event-id="ev-1"]')) };
        window.history.back();
        await sleep(900);
        const onPreview = document.querySelectorAll(".related-group").length;
        document.querySelectorAll(".related-group")[1].querySelector(".related-item").click();
        await sleep(1600);
        const card = document.querySelector('[data-event-id="ev-1"]');
        const rect = card ? card.getBoundingClientRect() : null;
        // A fresh query: the select captured before the round trip is a detached node.
        const currentSelect = document.querySelector('[aria-label="按年份筛选"]');
        return {
          before,
          onPreview,
          filter: currentSelect ? currentSelect.value : "(missing)",
          hasTarget: Boolean(card),
          inViewport: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0),
          items: document.querySelectorAll(".timeline-item").length,
        };
      })()`);

      const pass =
        direct.page === "timeline" &&
        direct.title === "灯塔的第一夜" &&
        direct.highlighted &&
        direct.inViewport &&
        direct.filter === "全部年份" &&
        filtered.before.items === 1 &&
        !filtered.before.hasTarget &&
        filtered.onPreview === 3 &&
        filtered.hasTarget &&
        filtered.inViewport &&
        filtered.filter === "全部年份" &&
        filtered.items === 6;

      return {
        pass,
        detail: `直接跳转：${direct.page}、定位「${direct.title}」在高亮 ${direct.highlighted} 且可见 ${direct.inViewport}、筛选 ${direct.filter}、列表 ${direct.items} 条；先筛到 2026（${filtered.before.items} 条、目标不在列表 ${!filtered.before.hasTarget}）→ 返回预览（关联组 ${filtered.onPreview}）→ 再跳转 → 目标可见 ${filtered.hasTarget}/${filtered.inViewport}、筛选被清空为 ${filtered.filter}、列表回到 ${filtered.items} 条`,
      };
    });

    await check("关联信息：跳转世界观深层条目并定位，返回与前进正常（任务 D/E）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_LINKS);
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("沈青梧"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const state = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const entriesGroup = document.querySelectorAll(".related-group")[2];
        entriesGroup.querySelectorAll(".related-item")[0].click();
        await sleep(1600);
        const row = document.querySelector('[data-entry-id="w-c"]');
        const rect = row ? row.getBoundingClientRect() : null;
        const read = () => ({
          page: ${PAGE_IDS},
          selected: (document.querySelector(".world-row.selected .world-row-name") || {}).textContent || "",
          detailName: (document.querySelector(".world-detail h3") || {}).textContent || "",
          path: (document.querySelector(".world-detail-path") || {}).textContent || "",
          ancestorsDrawn: ["雾海纪", "北境城"].every((name) => [...document.querySelectorAll(".world-row-name")].some((node) => node.textContent.trim() === name)),
          inViewport: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0),
          rows: document.querySelectorAll(".world-row").length,
        });
        const jumped = read();
        window.history.back();
        await sleep(900);
        const back = { page: ${PAGE_IDS}, relatedGroups: document.querySelectorAll(".related-group").length, character: document.body.textContent.includes("沈青梧") };
        window.history.forward();
        await sleep(1200);
        const forward = { page: ${PAGE_IDS} };
        window.history.back();
        await sleep(900);
        const backAgain = { page: ${PAGE_IDS} };
        return { jumped, back, forward, backAgain };
      })()`);

      const pass =
        state.jumped.page === "world" &&
        state.jumped.selected === "白塔区" &&
        state.jumped.detailName === "白塔区" &&
        state.jumped.path.includes("雾海纪 › 北境城 › 白塔区") &&
        state.jumped.ancestorsDrawn &&
        state.jumped.inViewport &&
        state.jumped.rows === 5 &&
        state.back.page === "preview" &&
        state.back.relatedGroups === 3 &&
        state.back.character === true &&
        // Back and Forward land on the right screen every time, with no extra entries.
        state.forward.page === "world" &&
        state.backAgain.page === "preview";

      return {
        pass,
        detail: `跳转：${state.jumped.page}、选中「${state.jumped.selected}」详情「${state.jumped.detailName}」路径「${state.jumped.path}」祖先已展开 ${state.jumped.ancestorsDrawn}（${state.jumped.rows} 行）在视口内 ${state.jumped.inViewport}；Back → ${state.back.page}（关联组 ${state.back.relatedGroups}、显示当前角色 ${state.back.character}）；Forward → ${state.forward.page}；再 Back → ${state.backAgain.page}`,
      };
    });

    // The legacy favourites migration, on the boot path it actually runs on: the flags
    // arrive from storage before the library does, and the screen used to write that
    // empty list straight back — measured wiping all 36 characters.
    await check("遗留收藏：启动时的迁移不清空角色库，并落到角色上（数据保护）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: ERROR_COLLECTOR });

      const read = () =>
        cdp.value(`(() => {
          const characters = JSON.parse(localStorage.getItem("character-studio.characters") || "[]");
          const flags = JSON.parse(localStorage.getItem("character-studio.dashboard-flags") || "null");
          const marked = characters.filter((character) => character.favorite === true).map((character) => character.id);
          return {
            stored: characters.length,
            marked,
            legacyIds: Array.isArray(flags?.favoriteIds) ? flags.favoriteIds : null,
            pinned: Array.isArray(flags?.pinnedIds) ? flags.pinnedIds : null,
            cards: document.querySelectorAll(".character-card").length,
            empty: document.querySelector(".empty-state") ? "空状态" : "有列表",
            errors: window.__csErrors || null,
          };
        })()`);

      // A live id: the migration has something real to move.
      await cdp.goto(base);
      await cdp.value(dashboardSeed({ dropPrefs: false }));
      await cdp.goto(base);
      const live = await read();

      // A stale id, which is what the dashboard used to turn into an empty roster.
      await cdp.value(dashboardSeed({ dropPrefs: false }).replace('["dash-4"]', '["dash-2"]'));
      await cdp.goto(base);
      const stale = await read();

      const conditions = {
        liveKept: live.stored === 36 && live.cards === 36,
        liveMigrated: live.marked.join("/") === "dash-4" && live.legacyIds !== null && live.legacyIds.length === 0,
        pinnedKept: live.pinned.join("/") === "dash-3",
        staleKept: stale.stored === 36 && stale.cards === 36 && stale.empty === "有列表",
        staleCleared: stale.marked.length === 0 && stale.legacyIds !== null && stale.legacyIds.length === 0,
        noErrors: [live, stale].every((state) => (state.errors || []).length === 0),
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `可用 id「dash-4」：存储 ${live.stored} 个角色、卡片 ${live.cards}、标记收藏 ${JSON.stringify(live.marked)}、遗留 id 清除后 ${JSON.stringify(live.legacyIds)}、置顶保留 ${JSON.stringify(live.pinned)}`
          + `；失效 id「dash-2」：存储 ${stale.stored} 个角色、卡片 ${stale.cards}（${stale.empty}）、标记收藏 ${JSON.stringify(stale.marked)}`
          + `；页面错误 ${JSON.stringify([...(live.errors || []), ...(stale.errors || [])])}`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("主页卡片：名称是主焦点、状态与标签剩余数量可读（任务 A）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      // The roster loads in an effect, so the panel is on screen with "0 个角色" before
      // the characters arrive. Reading then would measure the loading state, not the
      // cards — the view mode is a persisted preference, so it is set, not assumed.
      await cdp.waitFor(`!!document.querySelector(".list-section-title")`, 10000);
      await cdp.waitFor(
        `document.querySelectorAll(".character-card").length > 0 || !!document.querySelector(".character-table-row")`,
        10000,
      );
      await cdp.value(`(async () => {
        const toCards = document.querySelector('button[aria-label="切换卡片视图"]');
        if (toCards) { toCards.click(); await new Promise((r) => setTimeout(r, 600)); }
        return true;
      })()`);
      if (!(await cdp.waitFor(`document.querySelectorAll(".character-card").length === 36`, 10000))) {
        throw new Error("角色库没有渲染出来：期望 36 张卡片（waitFor 返回 false 不再被忽略）");
      }
      const state = await cdp.value(READ_DASHBOARD_CARDS);

      const chips = state.chips;
      const visibleTags = chips.filter((chip) => !chip.startsWith("+")).length;
      const hiddenTags = Number((chips.find((chip) => chip.startsWith("+")) || "+0").slice(1));
      const totalTags = 6;
      const heightSpread = state.cardHeights.length
        ? Math.max(...state.cardHeights) - Math.min(...state.cardHeights)
        : null;
      // Cards in one grid row fill that row together; a row is a set of cards sharing
      // a top edge, and each such set must have exactly one height.
      const rowsShareHeight = state.cardRowHeights.length > 0 &&
        state.cardRowHeights.every((row) => row.length === 1);

      const conditions = {
        cards: state.count === 36,
        nameIsFocal:
          state.nameSize > state.subtitleSize &&
          state.nameSize > state.ageSize &&
          Number(state.nameWeight) > Number(state.subtitleWeight),
        // 职业 and 世界观 share a weight; 年龄 is one step lighter than both.
        ageIsLighter:
          Number(state.ageWeight) < Number(state.subtitleWeight) && state.ageSize <= state.subtitleSize,
        subtitle: state.subtitle.includes("调查员") && state.subtitle.includes("北境"),
        // A long name gets its second line instead of being cut to one, and the whole
        // name stays readable from the card.
        longNameTwoLines: state.longNameLines >= 2 && state.longNameTitle === "名字很长的守夜人第二席代理记录官",
        tagsCounted: visibleTags >= 1 && visibleTags + hiddenTags === totalTags && state.moreTitle.split("、").length === totalTags,
        favourites: state.favouriteBadge && state.pinnedBadge,
        editedLeads:
          state.editedSize > state.createdSize &&
          Number(state.editedWeight) > Number(state.createdWeight) &&
          state.timeTitle.includes("创建") &&
          state.timeTitle.includes("最后编辑"),
        // A card's height comes from its content now, so two rows may differ. What the
        // card must not do is disagree with its neighbours: within a row every card is
        // the same height, and across rows the difference stays inside the one line a
        // longer name or a second tag row takes.
        sameHeight:
          rowsShareHeight && heightSpread !== null && heightSpread <= 24,
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `${state.count} 张卡片；名称 ${state.nameSize}px/${state.nameWeight}、职业世界观 ${state.subtitleSize}px/${state.subtitleWeight}、年龄 ${state.ageSize}px/${state.ageWeight}`
          + `；长名称占 ${state.longNameLines} 行、完整名称可读 ${state.longNameTitle.length > 0}；标签显示 ${visibleTags} 个 + 剩余 ${hiddenTags}（悬停列出 ${state.moreTitle.split("、").length} 个）`
          + `；收藏徽章 ${state.favouriteBadge}、置顶徽章 ${state.pinnedBadge}；编辑 ${state.editedSize}px/${state.editedWeight} > 创建 ${state.createdSize}px/${state.createdWeight}`
          + `；卡片高度差 ${heightSpread}px（各行 ${state.cardRowHeights.map((row) => row.join("=")).join(" / ")}）`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("主页分组：跳转定位、展开与计数一致（任务 C）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      if (!(await cdp.waitFor(`document.querySelectorAll(".card-group-chip").length === 3`, 10000))) {
        throw new Error("分组定位没有出现：期望 3 个分组按钮");
      }
      const index = await cdp.value(READ_DASHBOARD_CARDS);
      const state = await cdp.value(LOCATE_DASHBOARD_GROUP("雾隐"));

      const indexCounts = index.groupIndex.map((entry) => `${entry.name}:${entry.count}`).join("/");
      const conditions = {
        index: indexCounts === "北境:18/云海:12/雾隐:6",
        // The chip and the head must not be able to disagree about the group's size.
        countsAgree: state.chipCount === state.headCount && state.headCount === "6",
        expanded: state.expanded === "true",
        marked: state.marked,
        // The top bar floats over the list, so "into view" means below it.
        clearOfTopbar: state.belowTopbar && state.inViewport,
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `分组索引 ${indexCounts}；跳到「雾隐」：chip ${state.chipCount} / 组头 ${state.headCount}、展开 ${state.expanded}、标记 ${state.marked}`
          + `、组头 top ${state.headTop}px / 顶栏 bottom ${state.topbarBottom}px（未被遮挡 ${state.belowTopbar}）`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("主页分组：搜索命中不被折叠隐藏，清空后恢复（任务 C）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      if (!(await cdp.waitFor(`document.querySelectorAll(".character-group-head").length === 3`, 10000))) {
        throw new Error("分组浏览没有出现：期望 3 个分组头");
      }
      const state = await cdp.value(SEARCH_INSIDE_COLLAPSED_GROUP);

      const collapsedCards = Number(state.collapsed.count);
      const conditions = {
        collapsedHidesWhileBrowsing:
          state.collapsed.expanded === "false" &&
          state.collapsed.targetVisible === false &&
          state.collapsed.cards === state.beforeCards - collapsedCards,
        // The search is a request to see the match: the group is drawn open by rule, so
        // the finding cannot be hidden behind a collapse the reader set earlier. All 36
        // cards are drawn again, which is the difference the override makes.
        searchShowsMatch:
          state.searching.targetVisible === true &&
          state.searching.matches > 0 &&
          state.searching.cards === state.searching.matches &&
          state.searching.groups === 3,
        searchToggleInert: state.searching.disabled === true && state.searching.expanded === "true",
        // The override is derived, not written: clearing the search gives back exactly
        // the collapsed state the reader left behind.
        clearedRestores:
          state.cleared.expanded === "false" &&
          state.cleared.targetVisible === false &&
          state.cleared.cards === state.beforeCards - collapsedCards,
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `浏览时 ${state.beforeCards} 张卡片；折叠「北境」后 ${state.collapsed.cards} 张、命中角色可见 ${state.collapsed.targetVisible}`
          + `；搜「人」→ 展开 ${state.searching.expanded}、按钮停用 ${state.searching.disabled}、命中 ${state.searching.matches} 个/画出 ${state.searching.cards} 张、命中可见 ${state.searching.targetVisible}`
          + `；清空搜索后 ${state.cleared.cards} 张卡片、展开 ${state.cleared.expanded}、命中可见 ${state.cleared.targetVisible}`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("主页批量：选择状态、控件让位与安全退出（任务 B）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      const bulkReady = await cdp.waitFor(
        `[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "批量选择")`,
        10000,
      );
      if (!bulkReady) {
        throw new Error("批量选择入口没有出现：角色列表可能为空");
      }
      const state = await cdp.value(READ_BULK_BAR);

      const wanted = ["全选", "批量编辑", "加入收藏", "更多", "取消选择", "批量删除"];
      const conditions = {
        enteredCount: /已选 0 \/ 36/.test(state.entered.count),
        // What the mode is, said before the buttons that act on it.
        controls: wanted.every((label) => state.entered.controls.includes(label)),
        // The two controls that leave the list behind stand down while selecting.
        stoodDown: state.entered.createButton === false && state.entered.moreMenu === false,
        circles: state.entered.circles === 36,
        oneSelected:
          /已选 1 \/ 36/.test(state.one.count) &&
          state.one.selectedCards === 1 &&
          state.one.deleteDisabled === false,
        // Occasional actions live one level down; the destructive one is named there too.
        moreDialog:
          state.moreDialog.includes("导出所选（1 个）") &&
          state.moreDialog.includes("批量复制") &&
          state.moreDialog.includes("批量删除"),
        exited:
          state.exited.bulkBar === false &&
          state.exited.bulkButton === true &&
          state.exited.createButton === true &&
          state.exited.selectedCards === 0 &&
          state.exited.circles === 0,
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `进入：${state.entered.count}、控件 ${state.entered.controls.join("/")}、新建按钮 ${state.entered.createButton}、更多菜单 ${state.entered.moreMenu}、选择圈 ${state.entered.circles}`
          + `；选中一个：${state.one.count}、选中卡片 ${state.one.selectedCards}`
          + `；更多菜单 ${state.moreDialog.join("/")}`
          + `；退出：选择栏 ${state.exited.bulkBar}、批量选择按钮 ${state.exited.bulkButton}、新建按钮 ${state.exited.createButton}、选中卡片 ${state.exited.selectedCards}`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("主页双视图：同一筛选得到同一集合、顺序与状态（任务 D）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_DASHBOARD);
      await cdp.goto(base);
      const toolbarReady =
        (await cdp.waitFor(`!!document.querySelector('[data-testid="dashboard-search"]')`, 10000)) &&
        (await cdp.waitFor(`document.querySelectorAll(".character-card").length === 36`, 10000));
      if (!toolbarReady) {
        throw new Error("工具栏或卡片没有渲染出来");
      }
      const state = await cdp.value(READ_TWO_VIEWS);

      const derived = /^(\d+) 个角色$/.exec(state.cardsCount.trim());
      const derivedList = /^(\d+) 个角色$/.exec(state.listCount.trim());
      const conditions = {
        sameSet: state.cardsOrder.length > 0 && state.cardsOrder.length === state.listOrder.length,
        // Order, not just membership: the two views read one ordering rule.
        sameOrder: state.cardsOrder.join("/") === state.listOrder.join("/"),
        countMatchesRows:
          derived !== null &&
          derivedList !== null &&
          Number(derived[1]) === state.cardsOrder.length &&
          Number(derivedList[1]) === state.listOrder.length,
        noCollapsedCard: state.cardsAfterRoundTrip === state.cardsOrder.length,
        statusesAgree:
          state.cardsStates.pinned === state.listStates.pinned &&
          state.cardsStates.favourite === state.listStates.favourite &&
          state.listStates.pinned === "置顶" &&
          state.listStates.favourite === "收藏",
        keptQuery: state.keptQuery === "北境",
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `搜「北境」：卡片 ${state.cardsOrder.length} 个（标题「${state.cardsCount}」）/ 列表 ${state.listOrder.length} 个（标题「${state.listCount}」）`
          + `；顺序一致 ${state.cardsOrder.join("/") === state.listOrder.join("/")}；切换回卡片仍为同一搜索词「${state.keptQuery}」`
          + `；置顶徽章 卡片 ${JSON.stringify(state.cardsStates.pinned)} / 列表 ${JSON.stringify(state.listStates.pinned)}`
          + `；收藏徽章 卡片 ${JSON.stringify(state.cardsStates.favourite)} / 列表 ${JSON.stringify(state.listStates.favourite)}`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

    await check("跨工作区：Back 后 Forward 恢复原目标并重新聚焦（任务 E）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_LINKS);
      await cdp.goto(base);
      await cdp.value(OPEN_PREVIEW("沈青梧"));
      await cdp.waitFor(`!!document.querySelector(".preview-related")`, 8000);
      const state = await cdp.value(FORWARD_RESTORES_TARGET);

      const conditions = {
        graphArrived: state.graphArrived.page === "relationships" && state.graphArrived.focused === 1 && state.graphArrived.chip.includes("沈青梧"),
        backToPreview: state.backToPreview.page === "preview" && state.backToPreview.related === 3,
        // The one the fix is for: the entry names the target, so Forward rebuilds the
        // focused screen instead of an unfocused workspace.
        graphForward:
          state.graphForward.page === "relationships" &&
          state.graphForward.focused === 1 &&
          state.graphForward.chip.includes("沈青梧"),
        timelineArrived:
          state.timelineArrived.page === "timeline" &&
          state.timelineArrived.highlighted === state.clickedTitle &&
          state.clickedTitle.length > 0,
        timelineForward:
          state.timelineForward.page === "timeline" &&
          state.timelineForward.highlighted === state.clickedTitle &&
          state.timelineForward.highlightedCount === 1,
      };
      const failing = Object.entries(conditions)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `关系网：到达 ${state.graphArrived.page}（聚焦 ${state.graphArrived.chip.replace(/\s+/g, " ")}、节点 ${state.graphArrived.focused} 个）`
          + `；Back → ${state.backToPreview.page}（关联组 ${state.backToPreview.related}）`
          + `；Forward → ${state.graphForward.page}（聚焦 ${state.graphForward.chip.replace(/\s+/g, " ")}、节点 ${state.graphForward.focused} 个）`
          + `；时间线：到达 ${state.timelineArrived.page}（定位「${state.timelineArrived.highlighted}」，点击的是「${state.clickedTitle}」）`
          + `；Forward → ${state.timelineForward.page}（定位「${state.timelineForward.highlighted}」、高亮 ${state.timelineForward.highlightedCount} 个）`
          + (failing.length ? `；未通过：${failing.join("/")}` : ""),
      };
    });

        await check("世界观：分类导航的计数、切换与选中状态（任务 A）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_WORLD);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-category")`, 8000);
      const shell = await cdp.value(READ_WORLD);
      const state = await cdp.value(WORLD_CATEGORY_NAV);

      const pass =
        shell.rows === 100 &&
        // 全部 + six categories, each with the count the stored entries imply
        shell.nav.length === 7 &&
        shell.nav[0].label.startsWith("全部分类") &&
        state.afterLocation.results === state.afterLocation.expected &&
        state.afterLocation.expected > 0 &&
        state.afterLocation.current.startsWith("地点") &&
        state.afterLocation.count.includes(`匹配 ${state.afterLocation.expected} / 100`) &&
        state.afterItem.results === state.afterItem.expected &&
        state.afterItem.expected > 0 &&
        state.afterAll.results === state.afterAll.expected &&
        state.afterAll.expected === 100 &&
        // switching a category is a view change: nothing in storage moves
        state.afterLocation.storage === state.before.storage;

      return {
        pass,
        detail: `导航 ${state.afterAll.nav.join(" / ")}；点「地点」后结果 ${state.afterLocation.results} 条（数据 ${state.afterLocation.expected}）当前项「${state.afterLocation.current}」「${state.afterLocation.count}」；点「物品」${state.afterItem.results}（${state.afterItem.expected}）；回到全部 ${state.afterAll.results}（${state.afterAll.expected}）；切换前后存储一致 ${state.afterLocation.storage === state.before.storage}`,
      };
    });

    await check("世界观：搜索与组合筛选，子条目在父级折叠下仍可找到（任务 C）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_WORLD);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-category")`, 8000);
      const state = await cdp.value(WORLD_SEARCH);

      const pass =
        // folded away first, so the search result is what proves reachability
        state.deepHidden &&
        state.searched.hasMatch &&
        state.searched.results === 1 &&
        state.searched.pathRows === 2 &&
        state.searched.names.join("/") === "雾海纪/北境城/白塔区" &&
        // clearing restores the collapsed browsing state rather than forcing it open
        state.cleared.matchesCollapsed &&
        !state.cleared.hasDeep &&
        state.childOnly.results === state.childOnly.expected &&
        state.childWithCharacters.results === state.childWithCharacters.expected &&
        state.childWithCharacters.expected > 0 &&
        state.withCharacters.results === state.withCharacters.expected &&
        state.byCharacter.results === state.byCharacter.expected &&
        state.byCharacter.expected > 0 &&
        state.byId.results === 0 &&
        state.none.rows === 0 &&
        state.none.empty.includes("没有匹配的条目");

      return {
        pass,
        detail: `折叠后可见 ${state.collapsedRows} 行、白塔区隐藏 ${state.deepHidden}；搜索「白塔区」→ ${state.searched.results} 条结果 + ${state.searched.pathRows} 行上级路径（${state.searched.names.join(" / ")}）「${state.searched.count}」；清空后 ${state.cleared.rows} 行、恢复折叠 ${state.cleared.matchesCollapsed}；仅有上级 ${state.childOnly.results}（${state.childOnly.expected}）、再加有关联角色 ${state.childWithCharacters.results}（${state.childWithCharacters.expected}）、仅有关联角色 ${state.withCharacters.results}（${state.withCharacters.expected}）；按角色名 ${state.byCharacter.results}（${state.byCharacter.expected}）、按 id ${state.byId.results}；无结果 ${state.none.rows} 行「${state.none.empty.slice(0, 30)}」`,
      };
    });

    // 清空筛选会卸载按钮本身，所以"清空之后焦点在哪"是这次修复的核心，单列一项来盯。
    const WORLD_CLEAR_FOCUS = `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const pick = (aria) => document.querySelector('select[aria-label="' + aria + '"]');
      const setSelect = (aria, value) => {
        const el = pick(aria);
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const rows = () => document.querySelectorAll(".world-row").length;
      const count = () => (document.querySelector(".world-count") || {}).textContent || "";
      const clearButton = () => [...document.querySelectorAll(".world-filter-row .ghost-button")]
        .find((button) => button.textContent.trim() === "清空筛选");

      const total = rows();
      setSelect("按层级筛选", "child");
      await sleep(400);
      const filtered = { rows: rows(), layer: pick("按层级筛选").value };

      const button = clearButton();
      if (!button) throw new Error("筛选后没有出现清空筛选按钮");
      button.focus();
      const focusedBefore = document.activeElement === button;

      button.click();
      await sleep(450);
      const active = document.activeElement;
      return {
        total,
        filtered,
        focusedBefore,
        cleared: {
          rows: rows(),
          count: count().trim(),
          layer: pick("按层级筛选").value,
          characters: pick("按关联角色筛选").value,
          clearGone: !clearButton(),
          focusTag: active ? active.tagName : null,
          focusAria: active ? active.getAttribute("aria-label") : null,
          focusIsBody: active === document.body,
          focusOnScreen: active ? active.getBoundingClientRect().height > 0 : false,
        },
      };
    })()`;

    await check("世界观：清空筛选后焦点回到层级筛选，键盘可继续（任务 D2）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_WORLD);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-row")`, 8000);
      const state = await cdp.value(WORLD_CLEAR_FOCUS);

      // Focus has to leave the control it landed on with a plain Tab.
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await sleep(250);
      const afterTab = await cdp.value(`(() => { const a = document.activeElement; return { tag: a ? a.tagName : null, aria: a ? a.getAttribute("aria-label") : null, isBody: a === document.body }; })()`);

      const pass =
        state.total > 0 &&
        // a filter that changed nothing would make the rest of this check vacuous
        state.filtered.rows > 0 &&
        state.filtered.rows < state.total &&
        state.filtered.layer === "child" &&
        state.focusedBefore &&
        state.cleared.rows === state.total &&
        state.cleared.count.startsWith("共 ") &&
        state.cleared.layer === "any" &&
        state.cleared.characters === "any" &&
        state.cleared.clearGone &&
        state.cleared.focusTag === "SELECT" &&
        state.cleared.focusAria === "按层级筛选" &&
        !state.cleared.focusIsBody &&
        state.cleared.focusOnScreen &&
        // ...and the next Tab continues inside the filter row instead of restarting
        afterTab.tag !== "BODY" &&
        afterTab.aria === "按关联角色筛选";

      return {
        pass,
        detail: `共 ${state.total} 行；仅有上级 → ${state.filtered.rows} 行；清空后 ${state.cleared.rows} 行「${state.cleared.count}」，层级=${state.cleared.layer}/角色=${state.cleared.characters}，按钮已消失 ${state.cleared.clearGone}，焦点 ${state.cleared.focusAria || state.cleared.focusTag}（在视口内 ${state.cleared.focusOnScreen}）；再 Tab → ${afterTab.aria || afterTab.tag}`,
      };
    });

    await check("世界观：层级展开折叠、条目详情与 100 个条目（任务 B/D）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_WORLD);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-row")`, 8000);
      const state = await cdp.value(WORLD_HIERARCHY);

      const pass =
        state.rows === 100 &&
        state.withToggle > 0 &&
        state.withoutToggle > 0 &&
        // a leaf gets no disclosure control at all
        !state.leafHasToggle &&
        // indentation grows per level and then stops, so a deep branch keeps its width
        state.indents.join(",") === "0,16,32,48,64" &&
        state.collapsed.hasChild === false &&
        state.expanded.hasChild === true &&
        state.detail.path === "层级：雾海纪 › 北境城 › 白塔区 › 旧灯塔" &&
        state.detail.sections.join("/") === "简介/详细设定/标签/关联角色/子条目 · 1" &&
        state.detail.actions.join("/") === "编辑/删除" &&
        // The button carries the child's name and its category chip.
        state.detail.childButtons.length === 1 &&
        state.detail.childButtons[0].startsWith("灯室") &&
        state.detail.selected.join("/") === "旧灯塔" &&
        state.detail.listStillDrawn &&
        state.afterChildClick === "层级：雾海纪 › 北境城 › 白塔区 › 旧灯塔 › 灯室" &&
        state.pageOverflow <= 1;

      return {
        pass,
        detail: `溢出 ${state.pageOverflow}px（最宽 ${state.widest ? state.widest.tag + " → " + state.widest.right : "无"}）；100 行；有下级 ${state.withToggle} 行 / 无下级 ${state.withoutToggle} 行；叶子「灯室」有展开按钮 ${state.leafHasToggle}；缩进 ${state.indents.join("px / ")}px；折叠后白塔区可见 ${state.collapsed.hasChild} → 展开后 ${state.expanded.hasChild}；详情路径「${state.detail.path}」、分节 ${state.detail.sections.join(" / ")}、操作 ${state.detail.actions.join(" / ")}、选中「${state.detail.selected.join("/")}」、子条目按钮「${state.detail.childButtons.join("/")}」、列表仍在 ${state.detail.listStillDrawn}；点子条目后路径「${state.afterChildClick}」`,
      };
    });

    await check("世界观：弹窗分组、上级排除自身与后代、375px 与深色（任务 E/F）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_WORLD);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-row")`, 8000);
      const dialog = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const stored = () => JSON.parse(localStorage.getItem("character-studio.world") || "[]");
        const rowFor = (name) => [...document.querySelectorAll(".world-row")].find(
          (row) => (row.querySelector(".world-row-name")?.textContent || "").trim() === name,
        );
        rowFor("北境城").querySelector(".world-row-main").click();
        await sleep(300);
        [...document.querySelectorAll(".world-detail-actions button")].find((button) => button.textContent.trim() === "编辑").click();
        await sleep(600);

        const node = document.querySelector(".world-dialog");
        const rect = node.getBoundingClientRect();
        const actions = document.querySelector(".world-dialog-actions").getBoundingClientRect();
        const parent = document.querySelector('[aria-label="上级条目"]');
        const options = [...parent.options].map((option) => option.value);
        const descendants = stored().filter((entry) => entry.id === "deep-2" || entry.id === "deep-3" || entry.id === "deep-4").map((entry) => entry.id);
        const sections = [...document.querySelectorAll(".world-dialog legend")].map((item) => item.textContent.trim());
        const hint = (document.querySelector(".world-dialog .field-hint")?.textContent || "").replace(/\s+/g, " ").trim();
        const inside = rect.left >= -1 && rect.right <= window.innerWidth + 1;
        const pinned = actions.bottom <= rect.bottom + 1 && actions.top >= rect.top - 1;
        const selectedParent = parent.value;

        [...document.querySelectorAll(".world-dialog button")].find((button) => button.textContent.trim() === "取消").click();
        await sleep(300);
        return {
          sections, hint, inside, pinned,
          selfExcluded: !options.includes("deep-1"),
          descendantsExcluded: descendants.every((id) => !options.includes(id)),
          ancestorOffered: options.includes("deep-0"),
          optionCount: options.length,
          storedCount: stored().length,
          selectedParent,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);

      // The one case where an entry may take no parent at all: it is the only entry.
      await cdp.goto(base);
      await cdp.value(SEED_WORLD_SINGLE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-row")`, 8000);
      const single = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        [...document.querySelectorAll(".world-detail-actions button")].find((button) => button.textContent.trim() === "编辑").click();
        await sleep(600);
        const parent = document.querySelector('[aria-label="上级条目"]');
        const state = {
          disabled: parent.disabled,
          options: [...parent.options].map((option) => option.value),
          hint: (document.querySelector(".world-dialog .field-hint")?.textContent || "").replace(/\s+/g, " ").trim(),
        };
        [...document.querySelectorAll(".world-dialog button")].find((button) => button.textContent.trim() === "取消").click();
        await sleep(300);
        return state;
      })()`);

      // On a phone the dialog must fit, and the panes must become one at a time.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_WORLD);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观管理"));
      await cdp.waitFor(`!!document.querySelector(".world-row")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const narrowList = await cdp.value(READ_WORLD);
      const phone = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const nav = document.querySelector(".world-category-nav");
        const rows = new Set([...nav.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().top)));
        const detailHiddenOnList = getComputedStyle(document.querySelector(".world-detail")).display === "none";
        const rowFor = (name) => [...document.querySelectorAll(".world-row")].find(
          (row) => (row.querySelector(".world-row-name")?.textContent || "").trim() === name,
        );
        const row = rowFor("北境城");
        row.querySelector(".world-row-main").click();
        await sleep(500);
        const afterSelect = {
          sidebarHidden: getComputedStyle(document.querySelector(".world-sidebar")).display === "none",
          detailShown: getComputedStyle(document.querySelector(".world-detail")).display !== "none",
          backVisible: Boolean(document.querySelector(".world-detail-back")),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
        document.querySelector(".world-detail-back").click();
        await sleep(400);
        const afterBack = {
          sidebarShown: getComputedStyle(document.querySelector(".world-sidebar")).display !== "none",
          detailHidden: getComputedStyle(document.querySelector(".world-detail")).display === "none",
        };
        [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建条目").click();
        await sleep(600);
        const node = document.querySelector(".world-dialog");
        const rect = node.getBoundingClientRect();
        const actions = document.querySelector(".world-dialog-actions").getBoundingClientRect();
        const dialog = {
          inside: rect.left >= -1 && rect.right <= window.innerWidth + 1,
          // The dialog itself no longer scrolls; its body does, so head and foot stay
          // put. Same promise — a long entry is reachable — checked at the right node.
          scrollable: (() => {
            const body = node.querySelector(".world-dialog-body");
            return body ? body.scrollHeight > body.clientHeight : node.scrollHeight > node.clientHeight;
          })(),
          actionsInside: actions.right <= window.innerWidth + 1 && actions.left >= -1,
          sections: [...document.querySelectorAll(".world-dialog legend")].map((item) => item.textContent.trim()),
        };
        [...document.querySelectorAll(".world-dialog button")].find((button) => button.textContent.trim() === "取消").click();
        await sleep(400);
        return { navRows: rows.size, navInside: nav.getBoundingClientRect().right <= window.innerWidth + 1, detailHiddenOnList, afterSelect, afterBack, dialog };
      })()`);

      const theme = await cdp.value(SET_THEME_BY_MENU("深色"));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const dark = await cdp.value(READ_WORLD);
      const darkStyle = await cdp.value(`(() => {
        const tree = document.querySelector(".world-tree");
        const detail = document.querySelector(".world-detail");
        return { theme: document.documentElement.dataset.theme || "", tree: getComputedStyle(tree).backgroundColor, detail: getComputedStyle(detail).backgroundColor };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const pass =
        dialog.sections.join("/") === "条目/层级/内容/关联角色" &&
        dialog.inside &&
        dialog.pinned &&
        dialog.selfExcluded &&
        dialog.descendantsExcluded &&
        dialog.ancestorOffered &&
        dialog.hint.includes("不会形成循环层级") &&
        single.disabled &&
        single.options.length === 1 &&
        single.hint.includes("当前没有可选的上级条目") &&
        narrowList.rows === 100 &&
        narrowList.pageOverflow <= 1 &&
        phone.navRows === 1 &&
        phone.navInside &&
        phone.detailHiddenOnList &&
        phone.afterSelect.sidebarHidden &&
        phone.afterSelect.detailShown &&
        phone.afterSelect.backVisible &&
        phone.afterSelect.overflow <= 1 &&
        phone.afterBack.sidebarShown &&
        phone.afterBack.detailHidden &&
        phone.dialog.inside &&
        phone.dialog.scrollable &&
        phone.dialog.actionsInside &&
        phone.dialog.sections.join("/") === "条目/层级/内容/关联角色" &&
        theme === "dark" &&
        darkStyle.theme === "dark" &&
        dark.rows === 100;

      return {
        pass,
        detail: `弹窗分节 ${dialog.sections.join("/")}、在视口内 ${dialog.inside}、操作栏固定 ${dialog.pinned}；上级选项 ${dialog.optionCount} 个（自身排除 ${dialog.selfExcluded}、后代排除 ${dialog.descendantsExcluded}、祖先可选 ${dialog.ancestorOffered}）；单条目时下拉禁用 ${single.disabled}（选项 ${single.options.join("/")}）提示「${single.hint.slice(0, 20)}…」；375px 列表 ${narrowList.rows} 行、导航单行 ${phone.navRows === 1}、选中后列表隐藏 ${phone.afterSelect.sidebarHidden} 详情显示 ${phone.afterSelect.detailShown}、返回后恢复 ${phone.afterBack.sidebarShown}/${phone.afterBack.detailHidden}、弹窗在视口内 ${phone.dialog.inside} 可滚动 ${phone.dialog.scrollable} 操作栏在视口内 ${phone.dialog.actionsInside}、页面溢出 ${phone.afterSelect.overflow}px；深色 data-theme=${darkStyle.theme}`,
      };
    });

    await check("时间线：搜索、年份、类型筛选可组合，清空与空状态（任务 C）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_TIMELINE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.waitFor(`!!document.querySelector(".timeline-toolbar")`, 8000);
      const start = await cdp.value(READ_TIMELINE);
      const state = await cdp.value(TIMELINE_FILTERS);

      // Every count is compared with the number the stored events imply, so a toolbar
      // that reports a plausible number it did not compute cannot pass.
      const pass =
        start.items === 100 &&
        state.start.toolbar &&
        state.search.rows === state.search.expected &&
        state.search.rows > 0 &&
        state.search.count.includes(`匹配 ${state.search.expected} / 100`) &&
        state.withYear.rows === state.withYear.expected &&
        state.withYear.expected > 0 &&
        state.withYear.rows === state.withYear.expected &&
        state.withKind.expected > 0 &&
        state.withKind.rows === state.withKind.expected &&
        state.withKind.rows <= state.withYear.rows &&
        state.cleared.rows === 100 &&
        !state.cleared.clear &&
        state.cleared.year === "全部年份" &&
        state.cleared.kind === "全部类型" &&
        state.cleared.focusTag === "SELECT" &&
        state.cleared.focusAria === "按年份筛选" &&
        state.none.rows === 0 &&
        state.none.empty.includes("没有匹配的事件") &&
        state.none.clear &&
        state.byCharacter.rows === state.byCharacter.expected &&
        state.byCharacter.rows > 0 &&
        state.byId.rows === 0;

      return {
        pass,
        detail: `100 个事件；搜索「红藻」→ ${state.search.rows} 条（数据应为 ${state.search.expected}）「${state.search.count}」；加 ${state.withYear.year} → ${state.withYear.rows}（${state.withYear.expected}）；再加 ${state.withKind.kind} → ${state.withKind.rows}（${state.withKind.expected}）；清空 → ${state.cleared.rows} 条且筛选归零（${state.cleared.year}/${state.cleared.kind}）、焦点落在 ${state.cleared.focusAria || state.cleared.focusTag}；无结果 → ${state.none.rows} 条「${state.none.empty.slice(0, 40)}」；按角色名 白露 → ${state.byCharacter.rows}（${state.byCharacter.expected}）、按 id → ${state.byId.rows}`,
      };
    });

    await check("时间线：年份导航定位到年份且不被吸顶栏遮挡（任务 D）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_TIMELINE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.waitFor(`!!document.querySelector(".timeline-year-nav")`, 8000);
      const state = await cdp.value(TIMELINE_YEAR_NAV);

      const pass =
        state.labels.length === 3 &&
        state.labels.every((label) => /^\d{4}/.test(label)) &&
        state.groups === 3 &&
        state.before.current.includes(state.year) &&
        state.before.groupTop >= state.before.topbarBottom - 2 &&
        state.before.groupTop < state.before.viewportHeight &&
        // one continuous line, and a node per event and per year, drawn on it
        state.railLine.width === 2 &&
        state.railLine.height > 200 &&
        state.railLine.nodeRadius.includes("50%") &&
        state.railLine.yearNodeSize === 10 &&
        // the navigation follows the filter rather than the stored years
        // The navigation never offers a year that is not drawn: after filtering to one
        // year it either lists only that year or steps out of the way.
        state.afterFilter.nav.every((label) => label.startsWith(state.year)) &&
        state.afterFilter.years === 1;

      return {
        pass,
        detail: `导航 ${state.labels.join("/")}；点击 ${state.year} 后该年份组 top ${state.before.groupTop}px / 顶栏 bottom ${state.before.topbarBottom}px（未被遮挡 ${state.before.groupTop >= state.before.topbarBottom - 2}）、当前年标记「${state.before.current}」；轴线 ${state.railLine.width}×${Math.round(state.railLine.height)}px、事件节点 ${state.railLine.nodeSize}px ${state.railLine.nodeRadius}、年份节点 ${state.railLine.yearNodeSize}px；筛选 ${state.year} 后导航变为 ${state.afterFilter.nav.join("/")}、年份组 ${state.afterFilter.years} 个`,
      };
    });

    await check("时间线：长描述展开收起，新建/编辑/删除与固定操作栏（任务 B/E）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_TIMELINE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.waitFor(`!!document.querySelector(".timeline-item")`, 8000);
      const state = await cdp.value(TIMELINE_CARD_AND_CRUD);

      const pass =
        // reading: summary by default, the whole text on request, and back
        state.collapsed.length <= 121 &&
        state.collapsed.toggle === "展开完整描述" &&
        state.collapsed.expanded === "false" &&
        state.expanded.length === state.collapsed.full &&
        state.expanded.toggle === "收起描述" &&
        state.expanded.expanded === "true" &&
        state.collapsedAgain <= 121 &&
        // the dialog groups the fields and keeps saving on screen
        state.afterCreate.sections.slice(0, 3).join("/") === "事件/时间/描述" &&
        state.afterCreate.sections.includes("涉及角色") &&
        state.afterCreate.pinned &&
        // create, edit, delete — through the real dialog, against storage
        state.afterCreate.count === 101 &&
        state.afterCreate.date === "2025-08-08" &&
        state.afterCreate.characters >= 1 &&
        state.afterCreate.drawn &&
        state.afterCreate.dialogClosed &&
        state.afterEdit.count === 101 &&
        state.afterEdit.saved &&
        state.afterEdit.keptId === "2025-08-08" &&
        state.afterDelete.count === 100 &&
        !state.afterDelete.drawn;

      return {
        pass,
        detail: `长描述 ${state.collapsed.full} 字 → 折叠 ${state.collapsed.length} 字「${state.collapsed.toggle}」→ 展开 ${state.expanded.length} 字「${state.expanded.toggle}」→ 收起 ${state.collapsedAgain} 字；弹窗分节 ${state.afterCreate.sections.join("/")}（可选角色 ${state.afterCreate.pickerOptions} / 勾选框 ${state.afterCreate.pickerBoxes}）、操作栏固定在弹窗内 ${state.afterCreate.pinned}；新建后 ${state.afterCreate.count} 条（日期 ${state.afterCreate.date}、关联 ${state.afterCreate.characters} 人、已出现在列表 ${state.afterCreate.drawn}、弹窗已关 ${state.afterCreate.dialogClosed}）→ 编辑后 ${state.afterEdit.count} 条（标题已改 ${state.afterEdit.saved}、日期保留 ${state.afterEdit.keptId}）→ 删除后 ${state.afterDelete.count} 条（列表中已消失 ${!state.afterDelete.drawn}）`,
      };
    });

    await check("时间线：375px 与深色主题下工具栏、年份导航与弹窗不溢出（任务 F）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_TIMELINE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.waitFor(`!!document.querySelector(".timeline-toolbar")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const narrow = await cdp.value(READ_TIMELINE);
      const layout = await cdp.value(`(() => {
        const nav = document.querySelector(".timeline-year-nav");
        const navRect = nav.getBoundingClientRect();
        const buttons = [...nav.querySelectorAll("button")];
        const rows = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
        const search = document.querySelector('[data-testid="timeline-search-wrap"]').getBoundingClientRect();
        const item = document.querySelector(".timeline-item").getBoundingClientRect();
        const card = document.querySelector(".timeline-card").getBoundingClientRect();
        return {
          navScrolls: nav.scrollWidth > nav.clientWidth,
          navInside: navRect.left >= -1 && navRect.right <= window.innerWidth + 1,
          navRows: rows.size,
          searchFullWidth: search.width > 300,
          cardInside: card.right <= window.innerWidth + 1 && card.left >= -1,
          itemInside: item.left >= -1,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);

      // The event dialog on a phone, with the keyboard-driven fields and a long
      // description inside it.
      await cdp.value(`(() => { [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建事件").click(); return true; })()`);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const dialog = await cdp.value(`(() => {
        const node = document.querySelector(".timeline-dialog");
        const rect = node.getBoundingClientRect();
        const actions = document.querySelector(".timeline-dialog-actions").getBoundingClientRect();
        const area = document.querySelector(".timeline-dialog textarea");
        const body = document.querySelector(".timeline-dialog-body") || node;
        return {
          inside: rect.left >= -1 && rect.right <= window.innerWidth + 1,
          // The dialog no longer scrolls as one box: the body inside it does, so the
          // footer can stay put. Same question — can the content scroll? — asked of the
          // element that now owns the scrolling.
          scrollable: body.scrollHeight > body.clientHeight,
          footerOutsideBody: !body.contains(document.querySelector(".timeline-dialog-actions")),
          actionsInside: actions.right <= window.innerWidth + 1 && actions.left >= -1,
          descriptionRows: area ? area.rows : 0,
          textareaInside: area ? area.getBoundingClientRect().right <= window.innerWidth + 1 : false,
        };
      })()`);
      await cdp.value(`(() => { const button = [...document.querySelectorAll(".timeline-dialog button")].find((item) => item.textContent.trim() === "取消"); if (button) button.click(); return true; })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Dark, switched through the app's own theme menu.
      const theme = await cdp.value(SET_THEME_BY_MENU("深色"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const dark = await cdp.value(READ_TIMELINE);
      const darkStyle = await cdp.value(`(() => {
        const card = document.querySelector(".timeline-card");
        const node = document.querySelector(".timeline-item");
        return {
          theme: document.documentElement.dataset.theme || "",
          cardBackground: getComputedStyle(card).backgroundColor,
          nodeBorder: getComputedStyle(node, "::before").borderColor,
        };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const pass =
        narrow.items === 100 &&
        // One row inside the viewport; it scrolls sideways when a timeline has more
        // years than fit, and never widens the page.
        layout.navRows === 1 &&
        layout.navInside &&
        layout.cardInside &&
        layout.itemInside &&
        layout.overflow <= 1 &&
        dialog.inside &&
        dialog.scrollable &&
        dialog.actionsInside &&
        dialog.descriptionRows === 6 &&
        dialog.textareaInside &&
        theme === "dark" &&
        darkStyle.theme === "dark" &&
        dark.items === 100 &&
        dark.pageOverflow <= 1;

      return {
        pass,
        detail: `375px：事件 ${narrow.items} 个、页面溢出 ${layout.overflow}px；年份导航单行 ${layout.navRows === 1}、在视口内 ${layout.navInside}（横向可滚动 ${layout.navScrolls}）；搜索框占满一行 ${layout.searchFullWidth}；卡片在视口内 ${layout.cardInside}；弹窗在视口内 ${dialog.inside}、可滚动 ${dialog.scrollable}、操作栏在视口内 ${dialog.actionsInside}、描述 ${dialog.descriptionRows} 行；深色切换「${theme}」→ data-theme=${darkStyle.theme}、卡片底色 ${darkStyle.cardBackground}、事件节点边框 ${darkStyle.nodeBorder}、深色下溢出 ${dark.pageOverflow}px`,
      };
    });

    await check("头像：图片不溢出容器，三个入口都不遮挡表单（P1）", async () => {
      const openDialog = async (workspace, openLabel) => {
        await cdp.goto(base);
        await cdp.value(clickWorkspace(workspace));
        await cdp.value(`(() => {
          const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify("PLACEHOLDER")});
          button.click();
          return true;
        })()`.replace(JSON.stringify("PLACEHOLDER"), JSON.stringify(openLabel)));
        await new Promise((resolve) => setTimeout(resolve, 400));
      };
      const read = () => cdp.value(READ_ROW_AVATARS);

      await cdp.goto(base);
      await cdp.value(SEED_AVATAR_SIZES);
      await cdp.goto(base);

      // 新建关系: the two single-select pickers, opened one at a time.
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(`(() => { [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "新建关系").click(); return true; })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await cdp.value(`(() => { document.querySelector(".character-select-trigger").click(); return true; })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const relation = await read();

      // 新建事件 and 新建条目: the multi-select list, rendered in the dialog.
      await openDialog("世界观时间线", "新建事件");
      const timeline = await read();
      await openDialog("世界观管理", "新建条目");
      const world = await read();

      // The same dialog on a phone, where a picture painting outside its circle would
      // reach past the card.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(`(() => { [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "新建关系").click(); return true; })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await cdp.value(`(() => { document.querySelector(".character-select-trigger").click(); return true; })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const narrow = await read();
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const contained = (state) =>
        state.count > 0 &&
        state.escaped === 0 &&
        state.clippedEverywhere &&
        state.rows.every((row) => !row.image || (Math.abs(row.image[0] - row.box[0]) <= 1 && Math.abs(row.image[1] - row.box[1]) <= 1)) &&
        state.saveHit === "button" &&
        state.pageOverflow <= 1;
      // A wide picture was actually loaded, so "contained" is not the trivial case of
      // no picture being drawn at all.
      const loaded = [relation, timeline, world, narrow].every((state) => state.pictures > 0 && state.widest === 1200);
      const emojiKept = [relation, timeline, world].some((state) => state.rows.some((row) => row.emoji === "🌙"));

      return {
        pass: Boolean([relation, timeline, world, narrow].every(contained) && loaded && emojiKept),
        detail: `新建关系 ${relation.count} 行 / 溢出 ${relation.escaped}px / 图片 ${relation.pictures} 个（最宽源 ${relation.widest}px）/ 保存按钮命中 ${relation.saveHit}；时间线 ${timeline.count} 行 / 溢出 ${timeline.escaped}px / 命中 ${timeline.saveHit}；世界观 ${world.count} 行 / 溢出 ${world.escaped}px / 命中 ${world.saveHit}；375px ${narrow.count} 行 / 溢出 ${narrow.escaped}px / 页面溢出 ${narrow.pageOverflow}px；头像框 ${relation.rows[0] && relation.rows[0].box.join("x")}、图片 ${relation.rows[0] && (relation.rows[0].image || []).join("x")}（源 ${relation.rows[0] && relation.rows[0].natural && relation.rows[0].natural.join("x")}）、clip ${relation.rows[0] && relation.rows[0].clipped}；emoji 行 ${emojiKept ? "保留" : "丢失"}；逐行 ${timeline.rows.map((row) => row.box.join("x") + (row.image ? "/" + row.image.join("x") : "") + "/" + row.escaped).join(" ")}`,
      };
    });

    await check("关系网：节点默认显示名称，悬停给出职业/世界观/关系数（任务 A）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      // A saved canvas is a legitimate starting point, but these checks are about
      // what a gesture writes; mix in a leftover layout and "unchanged during drag"
      // would only prove the old file is still there.
      await cdp.value(`localStorage.removeItem("character-studio.relationship-layout")`);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      // The frame is measured after the first paint, so names appear one render later.
      // Waiting for them is the difference between reading the drawing and reading the
      // frame before the drawing exists.
      await cdp.waitFor(`document.querySelectorAll(".relationship-node-name").length > 0`, 4000);
      const state = await cdp.value(READ_GRAPH_CANVAS);

      const centre = await cdp.value(graphNodeCentre("沈青梧"));
      if (!centre) throw new Error("沈青梧 node missing");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const card = await cdp.value(READ_NODE_CARD);

      // A node is still the way into the character's own page, and a hover that came
      // and went is not a tap. The click target is recorded as well: the pan captures
      // the pointer on the <svg>, and a captured pointer retargets the compatibility
      // mouse events to the capturing element — which is why the node's own click
      // handler is not what opens it.
      await cdp.value(`(() => {
        window.__tapTarget = "";
        document.addEventListener("click", (event) => {
          window.__tapTarget = event.target.tagName + "." + (event.target.getAttribute?.("class") || "");
        }, { capture: true, once: true });
        return true;
      })()`);
      // Sprint 49 changed what one tap means: it selects a node (which is what
      // makes multi-select and grouping possible), and a second tap inside the
      // double-tap window opens the character. Both halves are asserted, because
      // "selection works" is not a reason for the way in to have stopped working.
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const selected = await cdp.value(
        `({ page: ${PAGE_IDS}, selected: document.querySelectorAll('.relationship-node[data-selected="true"]').length })`,
      );
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", clickCount: 2 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", clickCount: 2 });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const opened = await cdp.value(
        `({ page: ${PAGE_IDS}, showsName: document.body.textContent.includes("沈青梧"), tapTarget: window.__tapTarget || "(没有 click 事件)", backButtons: [...document.querySelectorAll('button[aria-label="返回"]')].length })`,
      );

      // Every character on the canvas is named at fit view, and the four fields the card
      // promises are all there. 5 nodes: the sixth character has no relationships.
      const named = state.nodeCount === 5 && state.names.length === state.nodeCount;
      const pictureDrawn = state.imageCount === 1 && state.clipCount === 1 && state.imageHref.startsWith("data:image/");
      const emojiDrawn = state.emojiCount === 4;
      const cardOk =
        card.present &&
        card.text.includes("沈青梧") &&
        card.fields.join("|").includes("职业调查员") &&
        card.fields.join("|").includes("世界观北境") &&
        card.fields.join("|").includes("关系2条") &&
        !card.overflowsLeft &&
        !card.overflowsRight &&
        card.outsideFrame;

      return {
        pass: Boolean(
          named && pictureDrawn && emojiDrawn && cardOk &&
          selected.page === "relationships" && selected.selected === 1 &&
          opened.page === "preview" && opened.showsName && opened.backButtons === 1 && state.pageOverflow <= 1
        ),
        detail: `节点 ${state.nodeCount} 个、显示名称 ${state.names.join("/")}；图片头像 ${state.imageCount} 个（clipPath ${state.clipCount}、href ${state.imageHref}…）、Emoji 头像 ${state.emojiCount} 个；字号 ${state.nameFontPx}、适配 ${state.zoom}（视框 ${state.viewBox}、画布宽 ${state.frameWidth}px）、横向溢出 ${state.pageOverflow}px；悬停卡片 ${card.present ? "有" : "无"}：${card.text}（框内 ${!card.overflowsLeft && !card.overflowsRight}、不在截图内 ${card.outsideFrame}）；单击 → ${selected.page}（选中 ${selected.selected}）；双击 → ${opened.page}、返回按钮 ${opened.backButtons} 个（显示角色名 ${opened.showsName}、click 目标 ${opened.tapTarget}）`,
      };
    });

    await cdp.send("Emulation.clearDeviceMetricsOverride");

    // 2.48.6 removed the forty-node cap: every connected character is drawn, and a large
    // network is navigated by search and zoom instead of by hiding people. The promise
    // this check defends is that replacement one — nothing silently left out, any
    // character reachable by name, and the focus a way in and out.
    await check("关系网：大网络全部画上，搜索任何角色都能定位并聚焦，退出恢复概览（任务 B）", async () => {
      // Its own viewport and its own seed: a check that readers of the previous one
      // decide its starting point is not measuring what it says it measures.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH_LARGE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await openGraphSearch(cdp);
      const sketch = await cdp.value(READ_GRAPH_CANVAS);
      const state = await cdp.value(GRAPH_SEARCH_AND_FOCUS);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      // Four hundred connected characters, four hundred drawn. The scope line only
      // appears when something is left out, so an empty one is the statement that
      // nothing is.
      const startingPoint = sketch.nodeCount === 400 && sketch.scopeNote === "";

      const searchOk =
        state.byName.length === 1 &&
        state.byName[0].name === "沈青梧" &&
        state.byName[0].state === "在画布中" &&
        state.byJob.length > 1 &&
        state.byWorld.length > 1 &&
        state.byWorld.every((entry) => entry.name);
      // 沈青梧 sits between 陆停云 and 角色089 in the chain. Focusing brings those two
      // names up with it, lights the two edges that meet there, dims the other 397, and
      // reframes the view — the drawing was at 5% before, which is what "定位" has to
      // undo.
      // At 400 nodes the focus frames at 24%, below the 4px floor a neighbour's name
      // needs, so only the focused name is drawn — the neighbourhood is what has to be
      // right, and each node carries its identity whether or not its name is painted.
      const focusOk =
        state.focused.name === "沈青梧" &&
        state.focused.nodeCount === 400 &&
        state.focused.focusedCount === 1 &&
        state.focused.activeEdges === 2 &&
        state.focused.names.includes("沈青梧") &&
        state.focused.litNames.length === 3 &&
        ["沈青梧", "陆停云", "角色089"].every((name) => state.focused.litNames.includes(name)) &&
        state.focused.dimmedNames.length === 397 &&
        state.focused.panelClosed &&
        state.focused.chip.includes("沈青梧") &&
        state.focused.transform !== state.before.transform;
      // Leaving the focus puts the whole drawing back: no dimming, no chip, no edges
      // held open.
      const escapeOk =
        state.afterEscape.nodeCount === 400 &&
        state.afterEscape.focusedCount === 0 &&
        state.afterEscape.dimmedCount === 0 &&
        state.afterEscape.activeEdges === 0 &&
        !state.afterEscape.chip;

      const conditions = {
        全部画上: startingPoint,
        搜索: searchOk,
        聚焦: focusOk,
        退出恢复: escapeOk,
      };
      const failing = Object.keys(conditions).filter((name) => !conditions[name]);

      return {
        pass: failing.length === 0,
        detail: `画布 ${sketch.nodeCount} 个节点、名称 ${sketch.names.length} 个、说明「${sketch.scopeNote}」；按名 命中 ${state.byName.length}（${state.byName.slice(0, 3).map((entry) => entry.name + "/" + entry.state).join(" ")}${state.byName.length > 3 ? " …" : ""}）、按职业 命中 ${state.byJob.length}、按世界观 命中 ${state.byWorld.length}；聚焦 ${state.focused.name}（节点 ${state.focused.nodeCount}、聚焦 ${state.focused.focusedCount}、高亮线 ${state.focused.activeEdges}、亮起 ${state.focused.litNames.join("/")}、画出名称 ${state.focused.names.join("/")}、变暗 ${state.focused.dimmedNames.length}、面板已关 ${state.focused.panelClosed}、聚焦标「${state.focused.chip}」）、变换 ${state.before.transform} → ${state.focused.transform}、缩放 ${state.before.zoom} → ${state.focused.zoom}；退出聚焦后 节点 ${state.afterEscape.nodeCount} / 聚焦 ${state.afterEscape.focusedCount} / 变暗 ${state.afterEscape.dimmedCount} / 高亮线 ${state.afterEscape.activeEdges}；未满足 ${failing.join("、") || "无"}`,
      };
    });

    await check("关系网：没有任何关系的角色有明确提示与查看方式，不静默失败（任务 B）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await openGraphSearch(cdp);
      const state = await cdp.value(GRAPH_SEARCH_OFF_CANVAS);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      // Three states in the result list: on the canvas, connected but not on it, and
      // having no edge at all — the last one is the case this check is about. Since the
      // canvas became an explicit roster, the notice says which of the two problems the
      // reader is looking at (not on this canvas) and offers the one way forward; the
      // 「无关联」 tag in the result row is what names the missing relationships.
      const told =
        state.state === "无关联" &&
        state.before.notice.includes("文森特·梵高") &&
        state.before.notice.includes("尚未加入当前画布") &&
        state.before.notice.includes("加入画布并定位") &&
        state.before.nodes === 5;
      const reachable =
        state.after.nodes === 6 &&
        state.after.focused === "文森特·梵高" &&
        !state.after.notice;
      // Looking at somebody is not editing anybody: no write to either store.
      const untouched = state.after.storedRelationships === 4 && state.after.storedCharacters === 6;

      return {
        pass: Boolean(told && reachable && untouched),
        detail: `结果标记「${state.state}」；提示「${state.before.notice}」；定位后节点 ${state.before.nodes} → ${state.after.nodes}、聚焦 ${state.after.focused}、提示 ${state.after.notice ? "仍在" : "已收起"}；存储 角色 ${state.after.storedCharacters} / 关系 ${state.after.storedRelationships} 条未变`,
      };
    });

    // Every switch under 视图与显示 has to do something: this panel once carried
    // switches wired to nothing. Rows and options are matched by their own labels, and
    // a row this check does not know fails it rather than passing unexamined — a new
    // switch needs its own reading here instead of a green tick beside it.
    await check("关系网：显示设置只含生效开关，导出四种格式无报错（任务 D）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`[...document.querySelectorAll(".workspace-header button")].some((b) => b.textContent.trim() === "导出")`, 8000);
      await cdp.waitFor(`document.querySelectorAll(".relationship-node-name").length > 0`, 4000);
      const state = await cdp.value(GRAPH_DISPLAY_AND_EXPORT);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const panelOk =
        state.opened.present &&
        state.opened.insideViewport &&
        state.opened.labels.join("|") === "名称|本机头像" &&
        state.opened.nameOptions.join("|") === "隐藏|自动|全部" &&
        state.opened.avatarOptions.join("|") === "显示|隐藏";
      // 自动 and 全部 draw the same five names at this size, so the preference and the
      // sentence that explains it are what tell them apart; the count only proves that
      // 隐藏 really hides and 自动 really brings the names back.
      const namesOk =
        state.opened.namesBefore === 5 &&
        state.namesHidden.names === 0 &&
        state.namesHidden.pressed.join("|") === "隐藏" &&
        state.namesAuto.names === 5 &&
        state.namesAuto.pressed.join("|") === "自动" &&
        state.namesAuto.prefs.forceNames === false &&
        state.namesAuto.hint.includes("自动") &&
        state.namesAll.names === 5 &&
        state.namesAll.pressed.join("|") === "全部" &&
        state.namesAll.prefs.forceNames === true &&
        state.namesAll.hint.includes("全部");
      const avatarsOk =
        state.avatarsHidden.images === 0 &&
        state.avatarsHidden.emojis === 0 &&
        state.avatarsHidden.pressed.join("|") === "隐藏" &&
        state.avatarsBack.images === 1 &&
        state.avatarsBack.emojis === 4 &&
        state.avatarsBack.pressed.join("|") === "显示";
      // The output panel is one entry on the bar, and it has to open to every format
      // it offers — read by test id, because the wording around them keeps changing.
      const formatsOk = state.exportOpen.formats.map((format) => format.id).join("|") === "png|svg|jpg|pdf";
      const exported =
        state.messages.length === 4 &&
        state.messages.every((text, index) => text.startsWith(["PNG", "SVG", "JPG", "PDF"][index] + " 已导出"));
      const conditions = {
        面板: panelOk,
        名称: namesOk,
        头像: avatarsOk,
        导出面板: state.exportOpen.present && state.exportOpen.insideViewport,
        导出格式: formatsOk,
        导出结果: exported,
        抽屉关闭: state.closed,
        存储未变: state.storedUntouched,
      };
      const failing = Object.keys(conditions).filter((name) => !conditions[name]);

      return {
        pass: failing.length === 0,
        detail: `开关 ${state.opened.labels.join(" / ")}（在视口内 ${state.opened.insideViewport}）；名称 隐藏 ${state.namesHidden.names} → 自动 ${state.namesAuto.names}（forceNames ${state.namesAuto.prefs.forceNames}）→ 全部 ${state.namesAll.names}（forceNames ${state.namesAll.prefs.forceNames}）；头像 隐藏 ${state.avatarsHidden.images} 图 / ${state.avatarsHidden.emojis} Emoji → 显示 ${state.avatarsBack.images} / ${state.avatarsBack.emojis}；导出入口 ${state.exportOpen.formats.map((format) => format.id).join("/")}（在视口内 ${state.exportOpen.insideViewport}）；结果「${state.messages.join("」「")}」；存储未变 ${state.storedUntouched}；未满足 ${failing.join("、") || "无"}`,
      };
    });

    await check("关系网管理：45 条关系可分页、按姓名与备注搜索、筛选排序与编辑删除同步", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      const seeded = await cdp.value(SEED_MANAGE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-mode")`, 8000);
      await cdp.value(`(() => {
        [...document.querySelectorAll(".graph-segment-button")].find((button) => button.textContent.trim().startsWith("管理")).click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".manage-table")`, 8000);
      const state = await cdp.value(GRAPH_MANAGE);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const paged =
        state.initial.rows === 20 &&
        state.initial.total === "45 / 45 条" &&
        state.initial.pager.includes("第 1 / 3 页") &&
        state.page2.rows === 20 &&
        state.page2.pager.includes("第 2 / 3 页");
      const searched =
        state.byNote.rows === 1 &&
        state.byNote.texts.join("").includes("同门，雪夜之后重逢") &&
        state.byNote.total === "1 / 45 条" &&
        state.byNote.pager.includes("第 1 / 1 页") &&
        state.byName.rows === 8 &&
        state.byName.texts.every((text) => text.includes("林雾生"));
      // 师承 keeps its direction: nine mentors, every one drawn left to right, and the
      // first cell is the mentor rather than a sorted name.
      const mentored =
        state.mentors.length === 9 &&
        state.mentors.every((row) => row.chip === "师承" && row.arrow === "→" && row.from && row.to && row.from !== row.to);
      const sortedKinds = state.kindOrder.every(
        (label, index) => index === 0 || state.kindOrder[index - 1].localeCompare(label, "zh") <= 0,
      );
      const filtered =
        sortedKinds &&
        state.kindOrder.length === 20 &&
        state.byCharacter.rows > 0 &&
        state.byCharacter.texts.every((text) => text.includes(state.byCharacter.name));
      const edited =
        state.editTitle === "编辑关系" &&
        state.afterEdit.rowsWithNote === 1 &&
        state.afterEdit.storedWithNote === 1 &&
        state.afterEdit.count === seeded &&
        state.afterEdit.dialogClosed;
      // The dialog names both ends. It may not print "undefined" for an edge whose
      // characters the canvas is not drawing.
      const deleted =
        state.deleteText.includes("将删除") &&
        !state.deleteText.includes("undefined") &&
        state.afterDelete.count === seeded - 1 &&
        state.afterDelete.total === `${seeded - 1} / ${seeded - 1} 条` &&
        state.afterDelete.rows === 20 &&
        state.located.page &&
        state.located.focused === 1 &&
        state.located.edges === seeded - 1 &&
        state.located.chip.startsWith("聚焦：");

      return {
        pass: Boolean(paged && searched && mentored && filtered && edited && deleted),
        detail: `首页 ${state.initial.rows} 行 / ${state.initial.total} / ${state.initial.pager}；第二页 ${state.page2.rows} 行 / ${state.page2.pager}；搜「同门」${state.byNote.rows} 行（${state.byNote.total} / ${state.byNote.pager}）、搜「林雾生」${state.byName.rows} 行且每行含该名字 ${state.byName.texts.every((text) => text.includes("林雾生"))}；筛「师承」${state.mentors.length} 行、全部 → ${state.mentors.every((row) => row.arrow === "→")}、${state.mentors.map((row) => row.from + "→" + row.to).slice(0, 3).join("、")}…；按类型排序 顺序正确 ${sortedKinds}；按角色「${state.byCharacter.name}」${state.byCharacter.rows} 行；编辑「${state.editTitle}」→ 备注行 ${state.afterEdit.rowsWithNote}、存储 ${state.afterEdit.storedWithNote}、共 ${state.afterEdit.count} 条；删除确认「${state.deleteText}」→ 剩 ${state.afterDelete.count} 条 / ${state.afterDelete.total}；定位后 图谱 ${state.located.page}、聚焦节点 ${state.located.focused}、关系线 ${state.located.edges}、「${state.located.chip}」`,
      };
    });

    await check("关系网管理：375px 行变成条目，操作可用且不溢出", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_MANAGE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-mode")`, 8000);
      await cdp.value(`(() => {
        [...document.querySelectorAll(".graph-segment-button")].find((button) => button.textContent.trim().startsWith("管理")).click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".manage-table tbody tr")`, 8000);
      const state = await cdp.value(GRAPH_MANAGE_NARROW);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const pass =
        state.overflow <= 1 &&
        state.rows === 20 &&
        state.rowDisplay === "grid" &&
        state.rowWidth <= state.viewport &&
        state.rowsWider === 0 &&
        state.toolbarInside &&
        state.actions.length === 3 &&
        state.actions.every((action) => action.visible) &&
        state.actions.map((action) => action.text).join("/") === "编辑/定位/删除" &&
        state.dialog.open &&
        state.dialog.inside &&
        state.dialogClosed;

      return {
        pass: Boolean(pass),
        detail: `375px：${state.rows} 行、行高布局 ${state.rowDisplay}、行宽 ${state.rowWidth} / 视口 ${state.viewport}、横向溢出 ${state.overflow}px、超宽行 ${state.rowsWider}、工具栏在视口内 ${state.toolbarInside}；行内操作 ${state.actions.map((action) => action.text + (action.visible ? "✓" : "✗")).join("/")}；编辑弹窗 打开 ${state.dialog.open} / 在视口内 ${state.dialog.inside} / 取消后关闭 ${state.dialogClosed}`,
      };
    });

    await check("关系网：导出机制中 data URL 头像在序列化 SVG 内可绘制", async () => {
      await cdp.goto(base);
      const state = await cdp.value(IMAGE_IN_SVG_PROBE);

      // html2canvas hands the canvas SVG to an <img>, and a blob: URL inside an SVG
      // loaded that way resolves to nothing at all — which is why the graph asks for a
      // data URL. Red in the middle is the nested picture having been painted.
      return {
        pass: Boolean(state.loaded && state.pixel[0] > 200 && state.pixel[1] < 60 && state.pixel[3] === 255),
        detail: state.loaded
          ? `序列化 SVG 内嵌 data URL 图片已解析并绘制，中心像素 rgba(${state.pixel.join(",")})`
          : "序列化 SVG 内嵌 data URL 图片未能解析",
      };
    });

    await check("关系网：375px 首次落在图谱，管理视图仍可切换，图谱一屏能看全", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.goto(base);
      await cdp.value(SEED_MANAGE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-mode")`, 8000);
      const first = await cdp.value(`(() => ({
        mode: (document.querySelector(".graph-segment-button.selected")?.textContent || "").trim(),
        canvas: Boolean(document.querySelector(".relationship-canvas")),
        table: Boolean(document.querySelector(".manage-table")),
      }))()`);

      // The other half of the rule: management is still one tap away.
      await cdp.value(`(() => {
        [...document.querySelectorAll(".graph-segment-button")].find((button) => button.textContent.trim().startsWith("管理")).click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".manage-table")`, 8000);
      const manageVisible = await cdp.value(`Boolean(document.querySelector(".manage-table"))`);

      await cdp.value(`(() => {
        [...document.querySelectorAll(".graph-segment-button")].find((button) => button.textContent.trim() === "图谱").click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const fitted = await cdp.value(GRAPH_MOBILE_VIEW);

      // Zooming in is allowed; the named control has to bring the whole drawing back.
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const plus = document.querySelector('button[aria-label="放大画布"]');
        plus.click();
        plus.click();
        await sleep(350);
        return true;
      })()`);
      const zoomed = await cdp.value(GRAPH_MOBILE_VIEW);
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector('button[aria-label="适应画布"]').click();
        await sleep(450);
        return true;
      })()`);
      const refitted = await cdp.value(GRAPH_MOBILE_VIEW);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      // No saved preference: the drawing opens, on a phone as well. The list is still a
      // tap away and remembers the choice. Once in the drawing, every node is inside the
      // canvas — not just the middle.
      const entered = first.mode.includes("图谱") && first.canvas && !first.table;
      // A small drawing fits at natural size, so "fitted" means 100% or less, never more:
      // the opening view may not be a close-up.
      const fits =
        fitted.nodes === 12 &&
        fitted.inside === 12 &&
        Number(fitted.zoom.replace("%", "")) <= 100 &&
        refitted.inside === refitted.nodes;
      const zoomsBack =
        Number(zoomed.zoom.replace("%", "")) > Number(fitted.zoom.replace("%", "")) &&
        refitted.inside === refitted.nodes &&
        fitted.fitButton;

      return {
        pass: Boolean(entered && manageVisible && fits && zoomsBack && fitted.overflow <= 1),
        detail: `首次进入 模式「${first.mode}」（画布 ${first.canvas} / 表格 ${first.table}）、可切到管理 ${manageVisible}；切到图谱 节点 ${fitted.nodes}、在画布内 ${fitted.inside}、缩放 ${fitted.zoom}、画布 ${fitted.frame?.join("x")} / 视口 ${fitted.viewport}、溢出 ${fitted.overflow}px、说明「${fitted.scopeNote}」；放大两档 → ${zoomed.zoom}（在画布内 ${zoomed.inside}/${zoomed.nodes}）；按「适应画布」→ ${refitted.zoom}（在画布内 ${refitted.inside}/${refitted.nodes}）`,
      };
    });

    await check("关系网：375px 聚焦后角色与直接关系都在视野内，退出恢复概览", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.goto(base);
      await cdp.value(SEED_MANAGE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-mode")`, 8000);
      await cdp.value(`(() => {
        [...document.querySelectorAll(".graph-segment-button")].find((button) => button.textContent.trim() === "图谱").click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const before = await cdp.value(GRAPH_MOBILE_VIEW);

      // Start zoomed in, so a framing that never runs is visible: the focus has to bring
      // the view back to something that contains the neighbourhood.
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const plus = document.querySelector('button[aria-label="放大画布"]');
        plus.click();
        plus.click();
        await sleep(350);
        return true;
      })()`);
      const zoomedBefore = await cdp.value(GRAPH_MOBILE_VIEW);

      const focused = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        if (!document.querySelector('[data-testid="graph-search-input"]')) {
          const trigger = document.querySelector('[data-testid="graph-search"]');
          if (!trigger) return { found: false, reason: "搜索入口缺失" };
          trigger.click();
          await sleep(250);
        }
        const input = document.querySelector('[data-testid="graph-search-input"]');
        if (!input) return { found: false, reason: "搜索框没有打开" };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "沈砚");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(320);
        const option = document.querySelector(".graph-search-panel .character-picker-option");
        if (!option) return { found: false };
        option.click();
        for (let waited = 0; waited < 2500 && !document.querySelector(".relationship-node.focused"); waited += 100) {
          await sleep(100);
        }
        await sleep(350);
        return { found: true };
      })()`);
      const afterFocus = await cdp.value(GRAPH_MOBILE_VIEW);

      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(650);
        return true;
      })()`);
      const afterEscape = await cdp.value(GRAPH_MOBILE_VIEW);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      // The focused character and every direct connection are in the viewport, not only
      // the character; leaving the focus puts the whole drawing back.
      const framed =
        focused.found &&
        afterFocus.focused === 1 &&
        afterFocus.lit >= 2 &&
        afterFocus.litInside === afterFocus.lit &&
        afterFocus.chip.includes("聚焦") &&
        Number(afterFocus.zoom.replace("%", "")) < Number(zoomedBefore.zoom.replace("%", ""));
      const overview =
        afterEscape.focused === 0 &&
        afterEscape.inside === afterEscape.nodes &&
        !afterEscape.chip;

      return {
        pass: Boolean(framed && overview && before.inside === before.nodes),
        detail: `视口 ${before.viewport}px（画布 ${before.frame ? before.frame.join("×") : "?"}）、聚焦前 节点 ${before.nodes}、在画布内 ${before.inside}、缩放 ${before.zoom}（放大两档后 ${zoomedBefore.zoom}）；搜索「沈砚」${focused.found ? "命中并聚焦" : "未命中"} → 聚焦 ${afterFocus.focused}、未变暗 ${afterFocus.lit} 个、其中在画布内 ${afterFocus.litInside}、缩放 ${afterFocus.zoom}、「${afterFocus.chip}」；退出后 聚焦 ${afterEscape.focused}、在画布内 ${afterEscape.inside}/${afterEscape.nodes}、缩放 ${afterEscape.zoom}`,
      };
    });


    /* ---------------------------------------------------------------------
       Sprint 49 — the free relationship canvas.

       One setup helper and one reader, so each check states its own starting
       point rather than inheriting the previous one's viewport or data.
       ------------------------------------------------------------------- */

    const OPEN_GRAPH = async (width = 1440, height = 900, mobile = false) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
      });
      // Without this Chrome injects the touch points but never turns them into the
      // pointer events the canvas listens to, so a "drag" would look like a tap.
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 5 });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await cdp.waitFor(`document.querySelectorAll(".relationship-node").length >= 5`, 5000);
      await cdp.waitFor(`document.querySelectorAll(".relationship-node-name").length > 0`, 4000);
      return true;
    };

    /**
     * A real refresh: navigate again and come back to the graph, with no seeding.
     *
     * OPEN_GRAPH() is a *start* -- it wipes the layout file on purpose, because a seed
     * that describes "this graph" cannot inherit the previous check's roster. Using it
     * as the refresh step is how the appearance check spent months reporting that a
     * preset came back as null: it had just deleted the record it was about to read.
     * Anything that wants to know what survived a reload has to come through here.
     */
    const RELOAD_GRAPH = async () => {
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await cdp.waitFor(`document.querySelectorAll(".relationship-node").length > 0`, 5000);
      return true;
    };

      // The export panel is measured, not assumed: at every width its four edges have
      // to sit inside the window, and when the content is taller than the window it
      // has to scroll inside itself rather than run off the top.
      // The guide is one flat band under the drawing: a titled section, one tip at a
      // time, and a pager that loops. It is not part of the canvas' box, it does not
      // collapse, and it reads arrow keys only while it holds focus. Its state is a
      // reading preference, never data.
      await check("使用指南：四张循环翻页、聚焦后方向键生效、画布下方独立区块、数据不变", async () => {
        await OPEN_GRAPH(1440, 900, false);
        const before = await cdp.value(`JSON.stringify({
          chars: document.querySelectorAll(".relationship-node").length,
          stored: Object.keys(localStorage).filter((k) => k.startsWith("character-studio.")).sort().join(","),
        })`);

        const read = () => cdp.value(`(() => {
          const guide = document.querySelector(".graph-guide");
          if (!guide) return null;
          const r = guide.getBoundingClientRect();
          const frame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
          const footerEl = document.querySelector(".app-footer");
          const footer = footerEl?.getBoundingClientRect() ?? null;
          const page = document.querySelector(".relationship-page");
          const pageStyle = getComputedStyle(page);
          const guideStyle = getComputedStyle(guide);
          return {
            section: guide.querySelector("h2")?.textContent.trim() ?? "",
            title: guide.querySelector("h3")?.textContent.trim() ?? "",
            count: guide.querySelector(".graph-guide-count")?.textContent.trim() ?? "",
            below: r.top >= frame.bottom + 20,
            overlap: r.top < frame.bottom,
            gapCanvas: Math.round(r.top - frame.bottom),
            // The guide carries no bottom margin of its own; the breathing room below it
            // comes from the footer's padding. Measuring to the footer's border box read as
            // "0px gap" while the page looked fine, so the gap is taken to the content edge.
            gapFooter: footer && footerEl
              ? Math.round(footer.top - r.bottom + (Number.parseFloat(getComputedStyle(footerEl).paddingTop) || 0))
              : null,
            aligned: Math.abs(r.left - frame.left) <= 2 && Math.abs(r.right - frame.right) <= 2,
            border: guideStyle.borderTopWidth,
            shadow: guideStyle.boxShadow,
            bg: guideStyle.backgroundColor,
            // The guide used to be a stack of edges with a collapse control. Those class
            // names are gone from the codebase, so counting them always returned 0 and the
            // "no stack / no collapse" assertions could never fail. What is observable now
            // is the shape that replaced them: two cards, both laid out, and no control
            // inside the guide that could fold it away.
            guideCards: guide.querySelectorAll(".graph-guide-card").length,
            guideCardsCollapsed: [...guide.querySelectorAll(".graph-guide-card")]
              .filter((card) => card.getBoundingClientRect().height === 0).length,
            guideToggles: guide.querySelectorAll("[aria-expanded], [aria-controls]").length,
            pageBorder: pageStyle.borderTopWidth,
            pageBg: pageStyle.backgroundColor,
            sharesCanvas: Boolean(guide.closest(".graph-canvas-frame, .graph-canvas-row")),
            parentIsPage: guide.parentElement === page,

            disabledSteps: [...guide.querySelectorAll(".graph-guide-step")].filter((button) => button.disabled).length,
            overflow: document.documentElement.scrollWidth - innerWidth,
          };
        })()`);

        const click = async (label) => {
          await cdp.value(`document.querySelector('.graph-guide [aria-label=${JSON.stringify(label)}]').click()`);
          await new Promise((resolve) => setTimeout(resolve, 200));
        };
        const arrow = async (key) => {
          const code = key === "ArrowRight" ? 39 : 37;
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
          await new Promise((resolve) => setTimeout(resolve, 200));
        };

        const first = await read();
        await click("下一张提示");
        const second = await read();
        await click("下一张提示");
        await click("下一张提示");
        const fourth = await read();
        await click("下一张提示");
        const wrapped = await read();
        await click("上一张提示");
        const backWrapped = await read();

        // Arrows belong to the guide only while it holds focus: with focus on the page
        // body the same key must not page it, or the canvas would lose its arrows.
        await cdp.value(`document.activeElement instanceof HTMLElement && document.activeElement.blur(), true`);
        await arrow("ArrowRight");
        const unfocused = await read();
        await cdp.value(`document.querySelector(".graph-guide").focus(), true`);
        const focused = await cdp.value(`document.activeElement === document.querySelector(".graph-guide")`);
        await arrow("ArrowRight");
        const keyedForward = await read();
        await arrow("ArrowLeft");
        const keyedBack = await read();

        await cdp.value(`[...document.querySelectorAll(".graph-toolbar button")].find((b) => b.getAttribute("aria-label") === "全屏编辑").click()`);
        await new Promise((resolve) => setTimeout(resolve, 700));
        const inStudio = await cdp.value(`document.querySelectorAll(".graph-guide").length`);
        const studioFrame = await cdp.value(`Math.round(document.querySelector(".graph-canvas-frame").getBoundingClientRect().height)`);

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await cdp.value(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "退出全屏编辑")?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 700));
        const narrow = await read();
        const after = await cdp.value(`JSON.stringify({
          chars: document.querySelectorAll(".relationship-node").length,
          stored: Object.keys(localStorage).filter((k) => k.startsWith("character-studio.")).sort().join(","),
        })`);

        return {
          pass:
            Boolean(first) &&
            first.section === "使用指南" &&
            first.count === "1 / 4" &&
            Boolean(first.title) &&
            first.disabledSteps === 0 &&
            second.count === "2 / 4" &&
            fourth.count === "4 / 4" &&
            wrapped.count === "1 / 4" &&
            backWrapped.count === "4 / 4" &&
            unfocused.count === "4 / 4" &&
            focused &&
            keyedForward.count === "1 / 4" &&
            keyedBack.count === "4 / 4" &&
            first.below &&
            !first.overlap &&
            first.gapCanvas >= 20 &&
            first.gapFooter !== null &&
            first.gapFooter >= 20 &&
            first.aligned &&
            first.border === "0px" &&
            first.shadow === "none" &&
            first.bg === "rgba(0, 0, 0, 0)" &&
            first.guideCards >= 1 &&
            first.guideCardsCollapsed === 0 &&
            first.pageBorder === "0px" &&
            first.pageBg === "rgba(0, 0, 0, 0)" &&
            !first.sharesCanvas &&
            first.parentIsPage &&
            first.guideToggles === 0 &&
            inStudio === 0 &&
            studioFrame > 400 &&
            Boolean(narrow) &&
            narrow.overflow <= 0 &&
            narrow.gapCanvas >= 20 &&
            before === after,
          detail: `区标题「${first?.section}」${first?.count}；次张 ${second?.count}、末张 ${fourth?.count} → 下一张回到 ${wrapped?.count} → 上一张到 ${backWrapped?.count}；未聚焦时方向键 ${unfocused?.count}、聚焦 ${focused} 后 → ${keyedForward?.count} / ${keyedBack?.count}；画布下方 ${first?.gapCanvas}px、页脚上方 ${first?.gapFooter}px、左右对齐 ${first?.aligned}、边框 ${first?.border}、阴影 ${first?.shadow}、底色 ${first?.bg}；页面边框 ${first?.pageBorder}、底色 ${first?.pageBg}；与画布同容器 ${first?.sharesCanvas}；指南卡片 ${first?.guideCards}（折叠 ${first?.guideCardsCollapsed}）、折叠入口 ${first?.guideToggles}；全屏内 ${inStudio} 个（画布 ${studioFrame}px）；375 间距 ${narrow?.gapCanvas}px、溢出 ${narrow?.overflow}；数据不变 ${before === after}`,
        };
      });

      await check("导出面板：1440/1024/375/320 四边都在视口内且可滚动", async () => {
        const rows = [];
        for (const [w, h, m] of [[1440, 900, false], [1024, 768, false], [375, 812, true], [320, 640, true]]) {
          await OPEN_GRAPH(w, h, m);
          await cdp.waitFor(
            `[...document.querySelectorAll(".workspace-header button")].some((b) => b.textContent.trim() === "导出")`,
            6000,
          );
          await cdp.value(
            `[...document.querySelectorAll(".workspace-header button")].find((b) => b.textContent.trim() === "导出").click()`,
          );
          await new Promise((resolve) => setTimeout(resolve, 420));
          const rect = await cdp.value(`(() => {
            const panel = document.querySelector(".graph-export-panel");
            if (!panel) return null;
            const r = panel.getBoundingClientRect();
            return {
              top: r.top, bottom: r.bottom, left: r.left, right: r.right,
              scrollH: panel.scrollHeight, clientH: panel.clientHeight,
            };
          })()`);
          rows.push({ w, h, rect });
        }
        const bad = rows.filter(
          ({ w, h, rect }) =>
            !rect || rect.top < -0.5 || rect.bottom > h + 0.5 || rect.left < -0.5 || rect.right > w + 0.5,
        );
        return {
          pass: bad.length === 0,
          detail: rows
            .map(({ w, h, rect }) =>
              rect
                ? `${w}×${h}: ${Math.round(rect.top)}–${Math.round(rect.bottom)}, 可滚动 ${rect.scrollH > rect.clientH}`
                : `${w}×${h}: 面板未出现`,
            )
            .join("; "),
        };
      });

    const NODE_CENTRE = (id) => `(() => {
      const node = document.querySelector('.relationship-node[data-character-id="${id}"]');
      if (!node) return null;
      const rect = node.querySelector("circle").getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`;

    
// Opening the group form, as the product does it now: the selection bar offers 排列,
// and 创建分组 lives one press inside it. The old path -- a 创建分组 button directly in
// the selection bar -- has been gone long enough that this check failed with
// "Cannot read properties of undefined (reading 'click')" on every run: find() returned
// undefined and .click() was called on it. Each step reports what it did see, so a
// future rename fails with the element's name and the surrounding controls instead of a
// type error forty lines later.
const OPEN_GROUP_DRAFT = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (node) => (node.textContent || "").trim();
  const fail = (step, seen) => ({ ok: false, step, seen });

  const bar = document.querySelector(".graph-context.selection");
  if (!bar) return fail("selection-bar", document.querySelector(".graph-context")?.className ?? "missing");
  const arrange = [...bar.querySelectorAll("button")].find((button) => text(button) === "排列");
  if (!arrange) return fail("arrange-button", [...bar.querySelectorAll("button")].map(text).join(" / "));
  arrange.click();
  await sleep(250);

  const create = document.querySelector('[data-testid="align-create-group"]');
  if (!create) {
    return fail("align-create-group", [...document.querySelectorAll("[data-testid]")]
      .map((node) => node.getAttribute("data-testid"))
      .filter((id) => id.startsWith("align-"))
      .join(" / ") || "no align-* control");
  }
  create.click();
  await sleep(250);

  const input = document.querySelector('input[aria-label="分组名称"]');
  if (!input) return fail("group-name-input", (document.querySelector(".graph-group-panel")?.textContent ?? "no panel").trim().slice(0, 80));
  return { ok: true, controls: [...bar.querySelectorAll("button")].map(text).join(" / ") };
})()`;

const CANVAS_STATE = `(() => {
      const svg = document.querySelector(".relationship-canvas");
      const transform = svg?.querySelector(":scope > g")?.getAttribute("transform") || "";
      const match = /translate\\(([-0-9.]+) ([-0-9.]+)\\) scale\\(([-0-9.]+)\\)/.exec(transform);
      const read = (key) => JSON.parse(localStorage.getItem(key) || "null");
      return {
        page: Boolean(document.querySelector(".relationship-page")),
        layout: read("character-studio.relationship-layout"),
        relationships: localStorage.getItem("character-studio.relationships"),
        characters: localStorage.getItem("character-studio.characters"),
        selected: document.querySelectorAll('.relationship-node[data-selected="true"]').length,
        groups: document.querySelectorAll(".graph-group-rect").length,
        preview: (document.querySelector(".graph-context.preview")?.textContent || "").replace(/\\s+/g, " ").trim(),
        undo: Boolean([...document.querySelectorAll(".graph-context button")].find((b) => b.textContent.trim() === "撤销")),
        zoom: match ? Number(match[3]) : null,
        pan: match ? { x: Number(match[1]), y: Number(match[2]) } : null,
        nodes: [...document.querySelectorAll(".relationship-node")].map((node) => ({
          id: node.getAttribute("data-character-id"),
          cx: Number(node.querySelector("circle").getAttribute("cx")),
          cy: Number(node.querySelector("circle").getAttribute("cy")),
        })),
        edge: document.querySelector(".relationship-edge.kind-friend path")?.getAttribute("d") || "",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`;

    const DRAG = async (from, dx, dy, options = {}) => {
      const steps = options.steps ?? 8;
      const hold = options.hold ?? null;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(from.x), y: Math.round(from.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(from.x), y: Math.round(from.y), button: "left", buttons: 1, clickCount: 1 });
      for (let step = 1; step <= steps; step += 1) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(from.x + (dx * step) / steps),
          y: Math.round(from.y + (dy * step) / steps),
          button: "left",
          buttons: 1,
        });
      }
      if (hold) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return hold();
      }
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(from.x + dx), y: Math.round(from.y + dy), button: "left", buttons: 0, clickCount: 1 });
      return null;
    };

    await check("自由画布：拖动时节点与连线实时跟随，松手才写入，刷新后位置不变（Sprint 49）", async () => {
      await OPEN_GRAPH();
      const before = await cdp.value(CANVAS_STATE);
      const centre = await cdp.value(NODE_CENTRE("g-1"));
      if (!centre) throw new Error("沈青梧 节点缺失");

      // What is actually under the press: a miss here explains a drag that pans the
      // canvas instead of moving the node, without blaming the product.
      const hit = await cdp.value(`(() => {
        const node = document.elementFromPoint(${Math.round(centre.x)}, ${Math.round(centre.y)});
        if (!node) return "none";
        const owner = node.closest("[data-character-id]");
        return (node.tagName + "." + String(node.getAttribute("class") || "")).slice(0, 60) +
          (owner ? " → " + owner.getAttribute("data-character-id") : " → no node");
      })()`);
      // Count the writes, do not just look at the value: "written once" is the claim,
      // and a value check cannot tell one write from five identical ones.
      await cdp.value(`(() => {
        window.__layoutWrites = 0;
        const original = localStorage.setItem.bind(localStorage);
        localStorage.setItem = (key, value) => {
          if (key === "character-studio.relationship-layout") window.__layoutWrites += 1;
          return original(key, value);
        };
        return true;
      })()`);
      const mid = await DRAG(centre, 150, 80, {
        hold: async () => ({ ...(await cdp.value(CANVAS_STATE)), writes: await cdp.value("window.__layoutWrites") }),
      });
      const storedDuringDrag = mid.layout;
      const writesDuringDrag = mid.writes;
      const liveNode = mid.nodes.find((node) => node.id === "g-1");
      const startNode = before.nodes.find((node) => node.id === "g-1");
      const edgeFollowed = mid.edge !== before.edge;

      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x + 150), y: Math.round(centre.y + 80), button: "left", buttons: 0, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await cdp.value(CANVAS_STATE);
      const writesAfterRelease = await cdp.value("window.__layoutWrites");
      const moved = after.layout?.positions?.["g-1"];
      const othersUnchanged = before.nodes
        .filter((node) => node.id !== "g-1")
        .every((node) => {
          const now = after.layout?.positions?.[node.id];
          return now && Math.abs(now.x - node.cx) < 0.5 && Math.abs(now.y - node.cy) < 0.5;
        });

      // Reload: what is drawn must be what was stored.
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await cdp.waitFor(`document.querySelectorAll(".relationship-node").length >= 5`, 5000);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const reloaded = await cdp.value(CANVAS_STATE);
      const reloadedNode = reloaded.nodes.find((node) => node.id === "g-1");
      const stored = reloaded.layout?.positions?.["g-1"];

      const pass =
        storedDuringDrag === null &&
        writesDuringDrag === 0 &&
        writesAfterRelease === 1 &&
        liveNode && startNode && Math.abs(liveNode.cx - startNode.cx) > 20 &&
        edgeFollowed &&
        Boolean(moved) &&
        othersUnchanged &&
        reloadedNode && stored &&
        Math.abs(reloadedNode.cx - stored.x) < 0.5 &&
        Math.abs(reloadedNode.cy - stored.y) < 0.5 &&
        after.relationships === before.relationships &&
        after.characters === before.characters;

      return {
        pass: Boolean(pass),
        detail: `按下处 ${hit}；坐标 ${Math.round(centre.x)},${Math.round(centre.y)}；拖动中 存储 ${storedDuringDrag === null ? "未写入" : "已写入"}（${writesDuringDrag} 次写）、松手后写入 ${writesAfterRelease} 次、节点 cx ${startNode?.cx}→${liveNode?.cx}、连线 ${edgeFollowed ? "跟随" : "未变"}；松手后 g-1 ${JSON.stringify(moved)}、其余 ${before.nodes.length - 1} 个未变 ${othersUnchanged}；刷新后 cx ${reloadedNode?.cx} / 存储 ${stored?.x}；关系与角色存储未变 ${after.relationships === before.relationships && after.characters === before.characters}`,
      };
    });

    await check("自由画布：单击选中、双击进档案，平移缩放后重置视角不动坐标（Sprint 49）", async () => {
      await OPEN_GRAPH();
      const selectCentre = await cdp.value(NODE_CENTRE("g-3"));
      const centre = await cdp.value(NODE_CENTRE("g-2"));
      if (!centre || !selectCentre) throw new Error("节点缺失");

      // One tap selects. Read after the double-tap window has closed, so this tap
      // cannot be mistaken for the first half of an opening gesture.
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(selectCentre.x), y: Math.round(selectCentre.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(selectCentre.x), y: Math.round(selectCentre.y), button: "left", buttons: 1, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(selectCentre.x), y: Math.round(selectCentre.y), button: "left", buttons: 0, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 420));
      const selected = await cdp.value(CANVAS_STATE);

      // Two taps inside 350ms open the character. Sent back to back: an evaluate
      // round trip between them is enough to fall outside the window.
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 1, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 0, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 1, clickCount: 2 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 0, clickCount: 2 });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const opened = await cdp.value(`({ graph: Boolean(document.querySelector(".relationship-page")), name: document.body.textContent.includes("陆停云") })`);

      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const beforeView = await cdp.value(CANVAS_STATE);
      const frame = await cdp.value(`(() => { const r = document.querySelector(".graph-canvas-frame").getBoundingClientRect(); return { x: r.x + 30, y: r.y + 30, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);

      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(frame.cx), y: Math.round(frame.cy), deltaX: 0, deltaY: -120, modifiers: 2 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const zoomed = await cdp.value(CANVAS_STATE);

      await DRAG(frame, 70, 40);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const panned = await cdp.value(CANVAS_STATE);

      // 重置视角 lives in 更多 now that the bar is icon-first: open the menu, press the
      // item by name, and the assertion still watches the same command.
      await cdp.value(`document.querySelector('.graph-toolbar button[aria-label="更多工具"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await cdp.value(`([...document.querySelectorAll(".graph-more-item")].find((b) => b.textContent.trim() === "重置视角")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const reset = await cdp.value(CANVAS_STATE);

      const positions = (state) => JSON.stringify(state.layout?.positions ?? {});
      const pass =
        selected.page && selected.selected === 1 &&
        !opened.graph && opened.name &&
        zoomed.zoom !== beforeView.zoom &&
        panned.pan && beforeView.pan && (panned.pan.x !== zoomed.pan.x || panned.pan.y !== zoomed.pan.y) &&
        reset.zoom !== null &&
        positions(reset) === positions(beforeView) &&
        reset.relationships === beforeView.relationships;

      return {
        pass: Boolean(pass),
        detail: `单击 → 页面 ${selected.page ? "仍在图谱" : "已离开"}、选中 ${selected.selected}；双击 → ${opened.graph ? "仍在图谱" : "进入角色页"}（含姓名 ${opened.name}）；缩放 ${beforeView.zoom}→${zoomed.zoom}；平移 ${JSON.stringify(zoomed.pan)}→${JSON.stringify(panned.pan)}；重置后 ${reset.zoom}，坐标 ${positions(reset) === positions(beforeView) ? "未变" : "被改"}`,
      };
    });

    await check("自动整理：预览不落盘、可取消、确认后写入并可撤销，只动所选范围（Sprint 49）", async () => {
      await OPEN_GRAPH();
      const before = await cdp.value(CANVAS_STATE);
      const beforePreview = JSON.stringify(before.layout);

      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label="整理画布"]')).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-arrange-panel")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-arrange-panel button")].find((b) => b.textContent.trim() === "关系聚类")).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-context.preview")`, 3000);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const previewing = await cdp.value(CANVAS_STATE);
      const previewWroteNothing = JSON.stringify(previewing.layout) === beforePreview;
      const previewMoved = previewing.nodes.some((node) => {
        const start = before.nodes.find((item) => item.id === node.id);
        return start && (Math.abs(start.cx - node.cx) > 1 || Math.abs(start.cy - node.cy) > 1);
      });

      await cdp.value(`([...document.querySelectorAll(".graph-context.preview button")].find((b) => b.textContent.trim() === "取消")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const cancelled = await cdp.value(CANVAS_STATE);
      const cancelledNodes = cancelled.nodes.every((node) => {
        const start = before.nodes.find((item) => item.id === node.id);
        return start && Math.abs(start.cx - node.cx) < 0.5 && Math.abs(start.cy - node.cy) < 0.5;
      });

      // 取消 keeps the panel open now (a preview is compared inside it), so 整理 is
      // pressed only when the panel is actually closed.
      await cdp.value(`(() => {
        if (!document.querySelector(".graph-arrange-panel")) {
          document.querySelector('.graph-toolbar button[aria-label="整理画布"]').click();
        }
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".graph-arrange-panel")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-arrange-panel button")].find((b) => b.textContent.trim() === "环形布局")).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-context.preview")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-context.preview button")].find((b) => b.textContent.trim() === "确认应用")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const applied = await cdp.value(CANVAS_STATE);

      await cdp.value(`([...document.querySelectorAll(".graph-context button")].find((b) => b.textContent.trim() === "撤销")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const undone = await cdp.value(CANVAS_STATE);

      const sameAs = (left, right) =>
        JSON.stringify(left.layout?.positions ?? {}) === JSON.stringify(right.layout?.positions ?? {});
      // Undo restores the drawing that was on screen, which for a never-arranged
      // canvas is the ring that was materialised on confirm — storage was empty
      // before, so comparing files would ask undo to delete coordinates it needs.
      const sameDrawing = undone.nodes.every((node) => {
        const start = before.nodes.find((item) => item.id === node.id);
        return start && Math.abs(start.cx - node.cx) < 0.5 && Math.abs(start.cy - node.cy) < 0.5;
      });
      const pass =
        previewing.preview.includes("节点") && previewMoved &&
        previewWroteNothing &&
        !cancelled.preview && cancelledNodes && JSON.stringify(cancelled.layout) === beforePreview &&
        Boolean(applied.layout) && !sameAs(applied, before) && applied.undo &&
        sameDrawing && !undone.undo &&
        applied.relationships === before.relationships &&
        applied.characters === before.characters;

      return {
        pass: Boolean(pass),
        detail: `预览「${previewing.preview}」、画布移位 ${previewMoved}、落盘 ${previewWroteNothing ? "未变" : "被改"}；取消后复原 ${cancelledNodes}；确认后落盘 ${applied.layout ? Object.keys(applied.layout.positions).length + " 个坐标" : "无"}、撤销入口 ${applied.undo}；撤销后与整理前一致 ${sameDrawing}；关系与角色未变 ${applied.relationships === before.relationships && applied.characters === before.characters}`,
      };
    });

    await check("视觉分组：多选创建、整体移动、取消分组，关系数据不变（Sprint 49）", async () => {
      await OPEN_GRAPH();
      const before = await cdp.value(CANVAS_STATE);
      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label^="选择工具"]')).click()`);
      await new Promise((resolve) => setTimeout(resolve, 150));

      for (const id of ["g-1", "g-2"]) {
        const centre = await cdp.value(NODE_CENTRE(id));
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 1, clickCount: 1 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 0, clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const selecting = await cdp.value(CANVAS_STATE);

      if (selecting.selected !== 2) {
        return {
          pass: false,
          detail: `多选后选中 ${selecting.selected}/${selecting.nodes.length}（多选按钮存在 ${await cdp.value(`Boolean(document.querySelector('.graph-toolbar button[aria-label^="选择工具"]'))`)}）`,
        };
      }

      await cdp.waitFor(`!!document.querySelector(".graph-context.selection")`, 3000);
      const opened = await cdp.value(OPEN_GROUP_DRAFT);
      if (!opened.ok) {
        throw new Error(`打不开分组表单：${opened.step}；当前可见 ${opened.seen}`);
      }
      await cdp.value(`(() => {
        const input = document.querySelector('input[aria-label="分组名称"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "北境线");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const submitted = await cdp.value(`(() => {
        const form = document.querySelector(".graph-group-form");
        if (!form) return { ok: false, seen: "no .graph-group-form" };
        const submit = form.querySelector('button[type="submit"]');
        if (!submit) return { ok: false, seen: [...form.querySelectorAll("button")].map((b) => b.textContent.trim()).join(" / ") };
        if (submit.disabled) return { ok: false, seen: "submit disabled (name empty?)" };
        submit.click();
        return { ok: true };
      })()`);
      if (!submitted.ok) throw new Error(`提交分组失败：${submitted.seen}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const grouped = await cdp.value(CANVAS_STATE);

      const label = await cdp.value(`(() => {
        const rect = document.querySelector(".graph-group-rect");
        if (!rect) return null;
        const box = rect.getBoundingClientRect();
        const frame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
        // Inside the padded bottom band: clear of every node, clear of the caption,
        // and always within the frame.
        return {
          x: box.left + box.width / 2,
          y: box.bottom - 12,
          frame: { top: frame.top, bottom: frame.bottom, left: frame.left, right: frame.right },
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        };
      })()`);
      const beforeMove = grouped.layout?.positions ?? {};
      if (label) {
        await DRAG(label, 80, 44);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const movedState = await cdp.value(CANVAS_STATE);
      const afterMove = movedState.layout?.positions ?? {};
      const memberIds = grouped.layout?.groups?.[0]?.characterIds ?? [];
      const deltas = memberIds.map((id) => ({
        x: (afterMove[id]?.x ?? 0) - (beforeMove[id]?.x ?? 0),
        y: (afterMove[id]?.y ?? 0) - (beforeMove[id]?.y ?? 0),
      }));
      const groupMoved =
        memberIds.length === 2 &&
        deltas.every((delta) => Math.abs(delta.x - deltas[0].x) < 0.5 && Math.abs(delta.y - deltas[0].y) < 0.5) &&
        Math.hypot(deltas[0].x, deltas[0].y) > 20;

      // Creating a group opens this panel; toggling blindly would close it again.
      await cdp.value(`(() => {
        if (document.querySelector(".graph-group-panel")) return true;
        [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("分组")).click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".graph-group-remove")`, 3000);
      const removed = await cdp.value(`(() => {
        const button = document.querySelector(".graph-group-remove");
        if (!button) return "missing";
        button.click();
        return "clicked";
      })()`);
      if (removed !== "clicked") {
        return { pass: false, detail: `取消分组按钮 ${removed}；分组存储 ${JSON.stringify(grouped.layout?.groups)}` };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      const ungrouped = await cdp.value(CANVAS_STATE);

      const pass =
        selecting.selected === 2 &&
        grouped.groups === 1 &&
        grouped.layout?.groups?.length === 1 &&
        grouped.layout.groups[0].name === "北境线" &&
        groupMoved &&
        ungrouped.groups === 0 &&
        (ungrouped.layout?.groups?.length ?? 0) === 0 &&
        JSON.stringify(ungrouped.layout?.positions ?? {}) === JSON.stringify(afterMove) &&
        ungrouped.relationships === before.relationships &&
        ungrouped.characters === before.characters;

      return {
        pass: Boolean(pass),
        detail: `选中 ${selecting.selected}；分组 ${grouped.groups} 个（${JSON.stringify(grouped.layout?.groups)}）；拖动点 ${JSON.stringify(label)}；整体移动 ${groupMoved}（${JSON.stringify(deltas)}）；取消分组后 ${ungrouped.groups} 个、坐标保留 ${JSON.stringify(ungrouped.layout?.positions ?? {}) === JSON.stringify(afterMove)}；关系与角色未变 ${ungrouped.relationships === before.relationships && ungrouped.characters === before.characters}`,
      };
    });

    await check("自由画布：移动端手势阈值、删除角色后布局裁剪、无横向溢出（Sprint 49）", async () => {
      await OPEN_GRAPH(375, 812, true);
      // The phone's chrome is its own: a dock at the bottom edge and one 更多 menu.
      // What matters is that the dock is reachable, holds no overflow, does not cover
      // the drawing, and that every command that left it is still named in the menu.
      const shelf = await cdp.value(`(() => {
        const bar = document.querySelector(".graph-canvas-tools");
        const r = bar.getBoundingClientRect();
        const t = document.querySelector(".graph-toolbar");
        const frame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
        return {
          dock: getComputedStyle(bar).position,
          bottomGap: Math.round(innerHeight - r.bottom),
          toolbar: Math.round(t.getBoundingClientRect().height),
          overflow: t.scrollWidth - t.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          names: document.querySelectorAll(".relationship-node-name").length,
          // A fixed dock always sits over the frame at the top of the page -- the space
          // that keeps it clear is reserved *after* the content (.app-shell padding on
          // phones), so the only place the question has an answer is the end of the
          // scroll. Comparing rects at the initial position reported an occlusion that
          // one flick of the page removed.
          coversCanvasAtBottom: (() => {
            const before = scrollY;
            scrollTo(0, document.documentElement.scrollHeight);
            const scrolledFrame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
            const scrolledBar = bar.getBoundingClientRect();
            const covered = scrolledBar.top < scrolledFrame.bottom - 1;
            scrollTo(0, before);
            return covered;
          })(),
          zIndex: getComputedStyle(bar).zIndex,
        };
      })()`);
      await cdp.value(`document.querySelector('.graph-toolbar button[aria-label="更多工具"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const menu = await cdp.value(`(() => {
        const m = document.querySelector(".graph-more-menu");
        if (!m) return { open: false, items: [], inside: false };
        const r = m.getBoundingClientRect();
        return {
          open: true,
          items: [...m.querySelectorAll(".graph-more-item")].map((b) => b.textContent.trim()),
          inside: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1,
        };
      })()`);
      await cdp.value(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const menuClosed = await cdp.value(`!document.querySelector(".graph-more-menu")`);
      const selectCentre = await cdp.value(NODE_CENTRE("g-3"));
      const centre = await cdp.value(NODE_CENTRE("g-2"));
      if (!centre || !selectCentre) throw new Error("节点缺失");

      // One tap selects. Read after the double-tap window has closed, so this tap
      // cannot be mistaken for the first half of an opening gesture.
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(selectCentre.x), y: Math.round(selectCentre.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(selectCentre.x), y: Math.round(selectCentre.y), button: "left", buttons: 1, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(selectCentre.x), y: Math.round(selectCentre.y), button: "left", buttons: 0, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 420));
      const selected = await cdp.value(CANVAS_STATE);

      // Two taps inside 350ms open the character. Sent back to back: an evaluate
      // round trip between them is enough to fall outside the window.
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 1, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 0, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 1, clickCount: 2 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 0, clickCount: 2 });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const opened = await cdp.value(`({ graph: Boolean(document.querySelector(".relationship-page")), name: document.body.textContent.includes("陆停云") })`);

      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const beforeView = await cdp.value(CANVAS_STATE);
      const frame = await cdp.value(`(() => { const r = document.querySelector(".graph-canvas-frame").getBoundingClientRect(); return { x: r.x + 30, y: r.y + 30, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);

      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(frame.cx), y: Math.round(frame.cy), deltaX: 0, deltaY: -120, modifiers: 2 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const zoomed = await cdp.value(CANVAS_STATE);

      await DRAG(frame, 70, 40);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const panned = await cdp.value(CANVAS_STATE);

      // 重置视角 lives in 更多 now that the bar is icon-first: open the menu, press the
      // item by name, and the assertion still watches the same command.
      await cdp.value(`document.querySelector('.graph-toolbar button[aria-label="更多工具"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await cdp.value(`([...document.querySelectorAll(".graph-more-item")].find((b) => b.textContent.trim() === "重置视角")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const reset = await cdp.value(CANVAS_STATE);

      const positions = (state) => JSON.stringify(state.layout?.positions ?? {});
      const pass =
        selected.page && selected.selected === 1 &&
        !opened.graph && opened.name &&
        zoomed.zoom !== beforeView.zoom &&
        panned.pan && beforeView.pan && (panned.pan.x !== zoomed.pan.x || panned.pan.y !== zoomed.pan.y) &&
        reset.zoom !== null &&
        positions(reset) === positions(beforeView) &&
        reset.relationships === beforeView.relationships;

      return {
        pass: Boolean(pass),
        detail: `单击 → 页面 ${selected.page ? "仍在图谱" : "已离开"}、选中 ${selected.selected}；双击 → ${opened.graph ? "仍在图谱" : "进入角色页"}（含姓名 ${opened.name}）；缩放 ${beforeView.zoom}→${zoomed.zoom}；平移 ${JSON.stringify(zoomed.pan)}→${JSON.stringify(panned.pan)}；重置后 ${reset.zoom}，坐标 ${positions(reset) === positions(beforeView) ? "未变" : "被改"}`,
      };
    });

    await check("自动整理：预览不落盘、可取消、确认后写入并可撤销，只动所选范围（Sprint 49）", async () => {
      await OPEN_GRAPH();
      const before = await cdp.value(CANVAS_STATE);
      const beforePreview = JSON.stringify(before.layout);

      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label="整理画布"]')).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-arrange-panel")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-arrange-panel button")].find((b) => b.textContent.trim() === "关系聚类")).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-context.preview")`, 3000);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const previewing = await cdp.value(CANVAS_STATE);
      const previewWroteNothing = JSON.stringify(previewing.layout) === beforePreview;
      const previewMoved = previewing.nodes.some((node) => {
        const start = before.nodes.find((item) => item.id === node.id);
        return start && (Math.abs(start.cx - node.cx) > 1 || Math.abs(start.cy - node.cy) > 1);
      });

      await cdp.value(`([...document.querySelectorAll(".graph-context.preview button")].find((b) => b.textContent.trim() === "取消")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const cancelled = await cdp.value(CANVAS_STATE);
      const cancelledNodes = cancelled.nodes.every((node) => {
        const start = before.nodes.find((item) => item.id === node.id);
        return start && Math.abs(start.cx - node.cx) < 0.5 && Math.abs(start.cy - node.cy) < 0.5;
      });

      // 取消 keeps the panel open now (a preview is compared inside it), so 整理 is
      // pressed only when the panel is actually closed.
      await cdp.value(`(() => {
        if (!document.querySelector(".graph-arrange-panel")) {
          document.querySelector('.graph-toolbar button[aria-label="整理画布"]').click();
        }
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".graph-arrange-panel")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-arrange-panel button")].find((b) => b.textContent.trim() === "环形布局")).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-context.preview")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-context.preview button")].find((b) => b.textContent.trim() === "确认应用")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const applied = await cdp.value(CANVAS_STATE);

      await cdp.value(`([...document.querySelectorAll(".graph-context button")].find((b) => b.textContent.trim() === "撤销")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const undone = await cdp.value(CANVAS_STATE);

      const sameAs = (left, right) =>
        JSON.stringify(left.layout?.positions ?? {}) === JSON.stringify(right.layout?.positions ?? {});
      // Undo restores the drawing that was on screen, which for a never-arranged
      // canvas is the ring that was materialised on confirm — storage was empty
      // before, so comparing files would ask undo to delete coordinates it needs.
      const sameDrawing = undone.nodes.every((node) => {
        const start = before.nodes.find((item) => item.id === node.id);
        return start && Math.abs(start.cx - node.cx) < 0.5 && Math.abs(start.cy - node.cy) < 0.5;
      });
      const pass =
        previewing.preview.includes("节点") && previewMoved &&
        previewWroteNothing &&
        !cancelled.preview && cancelledNodes && JSON.stringify(cancelled.layout) === beforePreview &&
        Boolean(applied.layout) && !sameAs(applied, before) && applied.undo &&
        sameDrawing && !undone.undo &&
        applied.relationships === before.relationships &&
        applied.characters === before.characters;

      return {
        pass: Boolean(pass),
        detail: `预览「${previewing.preview}」、画布移位 ${previewMoved}、落盘 ${previewWroteNothing ? "未变" : "被改"}；取消后复原 ${cancelledNodes}；确认后落盘 ${applied.layout ? Object.keys(applied.layout.positions).length + " 个坐标" : "无"}、撤销入口 ${applied.undo}；撤销后与整理前一致 ${sameDrawing}；关系与角色未变 ${applied.relationships === before.relationships && applied.characters === before.characters}`,
      };
    });

    await check("视觉分组：多选创建、整体移动、取消分组，关系数据不变（Sprint 49）", async () => {
      await OPEN_GRAPH();
      const before = await cdp.value(CANVAS_STATE);
      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label^="选择工具"]')).click()`);
      await new Promise((resolve) => setTimeout(resolve, 150));

      for (const id of ["g-1", "g-2"]) {
        const centre = await cdp.value(NODE_CENTRE(id));
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 1, clickCount: 1 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", buttons: 0, clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const selecting = await cdp.value(CANVAS_STATE);

      if (selecting.selected !== 2) {
        return {
          pass: false,
          detail: `多选后选中 ${selecting.selected}/${selecting.nodes.length}（多选按钮存在 ${await cdp.value(`Boolean(document.querySelector('.graph-toolbar button[aria-label^="选择工具"]'))`)}）`,
        };
      }

      await cdp.waitFor(`!!document.querySelector(".graph-context.selection")`, 3000);
      const opened = await cdp.value(OPEN_GROUP_DRAFT);
      if (!opened.ok) {
        throw new Error(`打不开分组表单：${opened.step}；当前可见 ${opened.seen}`);
      }
      await cdp.value(`(() => {
        const input = document.querySelector('input[aria-label="分组名称"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "北境线");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const submitted = await cdp.value(`(() => {
        const form = document.querySelector(".graph-group-form");
        if (!form) return { ok: false, seen: "no .graph-group-form" };
        const submit = form.querySelector('button[type="submit"]');
        if (!submit) return { ok: false, seen: [...form.querySelectorAll("button")].map((b) => b.textContent.trim()).join(" / ") };
        if (submit.disabled) return { ok: false, seen: "submit disabled (name empty?)" };
        submit.click();
        return { ok: true };
      })()`);
      if (!submitted.ok) throw new Error(`提交分组失败：${submitted.seen}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const grouped = await cdp.value(CANVAS_STATE);

      const label = await cdp.value(`(() => {
        const rect = document.querySelector(".graph-group-rect");
        if (!rect) return null;
        const box = rect.getBoundingClientRect();
        const frame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
        // Inside the padded bottom band: clear of every node, clear of the caption,
        // and always within the frame.
        return {
          x: box.left + box.width / 2,
          y: box.bottom - 12,
          frame: { top: frame.top, bottom: frame.bottom, left: frame.left, right: frame.right },
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        };
      })()`);
      const beforeMove = grouped.layout?.positions ?? {};
      if (label) {
        await DRAG(label, 80, 44);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const movedState = await cdp.value(CANVAS_STATE);
      const afterMove = movedState.layout?.positions ?? {};
      const memberIds = grouped.layout?.groups?.[0]?.characterIds ?? [];
      const deltas = memberIds.map((id) => ({
        x: (afterMove[id]?.x ?? 0) - (beforeMove[id]?.x ?? 0),
        y: (afterMove[id]?.y ?? 0) - (beforeMove[id]?.y ?? 0),
      }));
      const groupMoved =
        memberIds.length === 2 &&
        deltas.every((delta) => Math.abs(delta.x - deltas[0].x) < 0.5 && Math.abs(delta.y - deltas[0].y) < 0.5) &&
        Math.hypot(deltas[0].x, deltas[0].y) > 20;

      // Creating a group opens this panel; toggling blindly would close it again.
      await cdp.value(`(() => {
        if (document.querySelector(".graph-group-panel")) return true;
        [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("分组")).click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".graph-group-remove")`, 3000);
      const removed = await cdp.value(`(() => {
        const button = document.querySelector(".graph-group-remove");
        if (!button) return "missing";
        button.click();
        return "clicked";
      })()`);
      if (removed !== "clicked") {
        return { pass: false, detail: `取消分组按钮 ${removed}；分组存储 ${JSON.stringify(grouped.layout?.groups)}` };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      const ungrouped = await cdp.value(CANVAS_STATE);

      const pass =
        selecting.selected === 2 &&
        grouped.groups === 1 &&
        grouped.layout?.groups?.length === 1 &&
        grouped.layout.groups[0].name === "北境线" &&
        groupMoved &&
        ungrouped.groups === 0 &&
        (ungrouped.layout?.groups?.length ?? 0) === 0 &&
        JSON.stringify(ungrouped.layout?.positions ?? {}) === JSON.stringify(afterMove) &&
        ungrouped.relationships === before.relationships &&
        ungrouped.characters === before.characters;

      return {
        pass: Boolean(pass),
        detail: `选中 ${selecting.selected}；分组 ${grouped.groups} 个（${JSON.stringify(grouped.layout?.groups)}）；拖动点 ${JSON.stringify(label)}；整体移动 ${groupMoved}（${JSON.stringify(deltas)}）；取消分组后 ${ungrouped.groups} 个、坐标保留 ${JSON.stringify(ungrouped.layout?.positions ?? {}) === JSON.stringify(afterMove)}；关系与角色未变 ${ungrouped.relationships === before.relationships && ungrouped.characters === before.characters}`,
      };
    });

    await check("自由画布：移动端手势阈值、删除角色后布局裁剪、无横向溢出（Sprint 49）", async () => {
      await OPEN_GRAPH(375, 812, true);
      // The phone's chrome is its own: a dock at the bottom edge and one 更多 menu.
      const shelf = await cdp.value(`(() => {
        const bar = document.querySelector(".graph-canvas-tools");
        const r = bar.getBoundingClientRect();
        const t = document.querySelector(".graph-toolbar");
        const frame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
        return {
          dock: getComputedStyle(bar).position,
          bottomGap: Math.round(innerHeight - r.bottom),
          toolbar: Math.round(t.getBoundingClientRect().height),
          overflow: t.scrollWidth - t.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          names: document.querySelectorAll(".relationship-node-name").length,
          // A fixed dock always sits over the frame at the top of the page -- the space
          // that keeps it clear is reserved *after* the content (.app-shell padding on
          // phones), so the only place the question has an answer is the end of the
          // scroll. Comparing rects at the initial position reported an occlusion that
          // one flick of the page removed.
          coversCanvasAtBottom: (() => {
            const before = scrollY;
            scrollTo(0, document.documentElement.scrollHeight);
            const scrolledFrame = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
            const scrolledBar = bar.getBoundingClientRect();
            const covered = scrolledBar.top < scrolledFrame.bottom - 1;
            scrollTo(0, before);
            return covered;
          })(),
          zIndex: getComputedStyle(bar).zIndex,
        };
      })()`);
      await cdp.value(`document.querySelector('.graph-toolbar button[aria-label="更多工具"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const menu = await cdp.value(`(() => {
        const m = document.querySelector(".graph-more-menu");
        if (!m) return { open: false, items: [], inside: false };
        const r = m.getBoundingClientRect();
        return {
          open: true,
          items: [...m.querySelectorAll(".graph-more-item")].map((b) => b.textContent.trim()),
          inside: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1,
        };
      })()`);
      await cdp.value(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const menuClosed = await cdp.value(`!document.querySelector(".graph-more-menu")`);
      const selectCentre = await cdp.value(NODE_CENTRE("g-3"));
      const centre = await cdp.value(NODE_CENTRE("g-2"));
      if (!centre || !selectCentre) throw new Error("375px 陆停云 节点缺失");

      // A tap selects and goes nowhere.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x, y: centre.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const tapped = await cdp.value(CANVAS_STATE);

      // A 5px wobble is still a tap: below the touch threshold nothing moves.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x, y: centre.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: centre.x + 5, y: centre.y + 2 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const wobbled = await cdp.value(CANVAS_STATE);
      const nodeCx = (state) => state.nodes.find((node) => node.id === "g-2")?.cx;
      const wobbleMoved = nodeCx(wobbled) !== nodeCx(tapped);

      // A real drag moves the node and does not open the character.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x, y: centre.y }] });
      for (let step = 1; step <= 5; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: centre.x + step * 9, y: centre.y + step * 5 }],
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const dragged = await cdp.value(CANVAS_STATE);
      const draggedMoved = nodeCx(dragged) !== nodeCx(wobbled);

      // A layout that names a deleted character must be pruned, not drawn or crashed on.
      await cdp.value(`(() => {
        const layout = JSON.parse(localStorage.getItem("character-studio.relationship-layout") || "null") || { schemaVersion: 1, positions: {}, groups: [] };
        layout.positions.ghost = { x: 10, y: 10 };
        layout.groups = [{ id: "g-ghost", name: "幽灵组", characterIds: ["g-1", "ghost"] }];
        localStorage.setItem("character-studio.relationship-layout", JSON.stringify(layout));
        return true;
      })()`);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const pruned = await cdp.value(CANVAS_STATE);

      // A long name has to be shortened on the drawing but complete once selected.
      await cdp.value(`(() => {
        const stored = JSON.parse(localStorage.getItem("character-studio.characters"));
        stored.find((item) => item.id === "g-2").name = "亚历山大".repeat(6);
        localStorage.setItem("character-studio.characters", JSON.stringify(stored));
        return true;
      })()`);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 400));
      // Truncation is a fact about a name that is drawn, and at the 375px fit the label
      // floor hides small names — so the drawing has to be zoomed first. The zoom is a
      // pinch centred on the node, not the + button: a button zooms about the frame,
      // which pushed this node past the viewport edge and made the tap land on nothing.
      // A pinch keeps the node under the fingers, and it is what a phone user does.
      const start = await cdp.value(NODE_CENTRE("g-2"));
      const spread = (dx, dy) => [
        { x: Math.round(start.x - dx), y: Math.round(start.y - dy) },
        { x: Math.round(start.x + dx), y: Math.round(start.y + dy) },
      ];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: spread(18, 0) });
      for (const step of [1, 2, 3, 4]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: spread(18 * step, 0) });
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const longShown = await cdp.value(`[...document.querySelectorAll(".relationship-node-name")].some((node) => node.textContent.includes("…"))`);
      const longCentre = await cdp.value(NODE_CENTRE("g-2"));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: longCentre.x, y: longCentre.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const longFull = await cdp.value(`(() => {
        const node = document.querySelector('.relationship-node[data-character-id="g-2"]');
        return { selected: node?.getAttribute("data-selected") === "true", full: node?.querySelector(".relationship-node-name")?.textContent?.startsWith("亚历山大亚历山大") && !node?.querySelector(".relationship-node-name")?.textContent?.includes("…") };
      })()`);

      const pass =
        tapped.page && tapped.selected === 1 &&
        longShown && longFull.selected && longFull.full &&
        !wobbleMoved && wobbled.page &&
        draggedMoved && dragged.page &&
        !pruned.layout?.positions?.ghost &&
        !(pruned.layout?.groups ?? []).some((group) => group.id === "g-ghost") &&
        pruned.groups === 0 &&
        pruned.overflow <= 1 &&
        shelf.dock === "fixed" && shelf.bottomGap === 0 && shelf.toolbar <= 56 &&
        shelf.overflow <= 0 && shelf.pageOverflow <= 0 && !shelf.coversCanvasAtBottom && shelf.names >= 4 &&
        menu.open && menu.inside && menu.items.length >= 4 &&
        ["撤销", "重做", "全屏编辑", "视觉分组"].every((item) => menu.items.includes(item)) &&
        menuClosed

      return {
        pass: Boolean(pass),
        detail: `375px 底部坞 ${shelf.dock} 距底 ${shelf.bottomGap}px、高 ${shelf.toolbar}px、溢出 ${shelf.overflow}px、页面溢出 ${shelf.pageOverflow}px、未遮挡画布 ${!shelf.coversCanvasAtBottom}（滚到底判定，z=${shelf.zIndex}）、名称 ${shelf.names} 个；更多菜单 ${menu.items.length} 项（${menu.items.join("、")}）在视口内 ${menu.inside}、Escape 关闭 ${menuClosed}；` +
          `长名截断 ${longShown} / 选中显示完整 ${longFull.full}；轻点 选中 ${tapped.selected} 页面 ${tapped.page ? "图谱" : "离开"}；5px 抖动 ${wobbleMoved ? "移动了" : "未移动"}；40px 拖动 ${draggedMoved ? "已移动" : "未移动"}、页面 ${dragged.page ? "仍在图谱" : "已离开"}；幽灵坐标裁剪 ${!pruned.layout?.positions?.ghost}、幽灵分组 ${pruned.groups === 0 ? "已清除" : "仍在"}；横向溢出 ${pruned.overflow}px`,      };
    });


    /* ---------------------------------------------------------------------
       Sprint 49 supplement — shared form dialogs and the management table.
       ------------------------------------------------------------------- */

    const SEED_FORMS = `(() => {
      const now = "2026-01-01T00:00:00.000Z";
      const characters = Array.from({ length: 100 }, (_, index) => ({
        id: "c" + index,
        name: index === 3 ? "亚历山大".repeat(8) : index === 7 ? "Alexanderthegreatwithoutanyspacesatall" : "角色" + String(index).padStart(2, "0"),
        occupation: index === 3 ? "很长很长的职业名称".repeat(3) : "职业" + (index % 7),
        worldview: index % 3 === 0 ? "北境" : "云海",
        avatarEmoji: "🙂",
        createdAt: now,
        updatedAt: now,
      }));
      const relationships = Array.from({ length: 191 }, (_, index) => ({
        id: "r" + index,
        fromId: "c" + (index % 100),
        toId: "c" + ((index * 3 + 1) % 100),
        kind: ["friend", "mentor", "family", "colleague", "rival"][index % 5],
        note: index === 0 ? "在旧码头认识，后来因为一批账目各执一词，关系时好时坏。".repeat(3) : "备注 " + index,
        createdAt: now,
        updatedAt: now,
      }));
      const world = Array.from({ length: 20 }, (_, index) => ({
        id: "w" + index,
        name: "条目" + index,
        category: "region",
        parentId: "",
        summary: "简介" + index,
        details: "详细设定".repeat(40),
        tags: "",
        characterIds: ["c0", "c1", "c2"],
        createdAt: now,
        updatedAt: now,
      }));
      localStorage.setItem("character-studio.characters", JSON.stringify(characters));
      localStorage.setItem("character-studio.relationships", JSON.stringify(relationships));
      localStorage.setItem("character-studio.world", JSON.stringify(world));
      localStorage.setItem("character-studio.timeline", "[]");
      localStorage.setItem("character-studio.about-seen", "true");
      localStorage.setItem("character-studio.theme", "light");
      return true;
    })()`;

    const RECTS = `(() => {
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
      };
      return {
        dialog: box(document.querySelector(".world-dialog, .relationship-dialog")),
        body: box(document.querySelector(".world-dialog-body, .relationship-dialog-body")),
        foot: box(document.querySelector(".world-dialog-actions, .relationship-dialog-actions")),
        picker: box(document.querySelector(".character-picker-list")),
        lastOption: box(document.querySelector(".character-picker .settings-check:last-child")),
        overflow: (() => {
          const list = document.querySelector(".character-picker-list");
          return list ? list.scrollWidth - list.clientWidth : null;
        })(),
        bodyScroll: (() => {
          const body = document.querySelector(".world-dialog-body, .relationship-dialog-body");
          return body ? { top: body.scrollTop, height: body.scrollHeight, client: body.clientHeight } : null;
        })(),
      };
    })()`;

    await check("复杂表单：角色选择器不再横向滚动，世界观底栏不遮挡最后一项（Sprint 49 补充）", async () => {
      const results = [];
      for (const [width, height, mobile] of [[1440, 900, false], [1024, 800, false], [375, 812, true], [320, 720, true]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 5 });
        await cdp.goto(base);
        await cdp.value(SEED_FORMS);
        await cdp.goto(base);
        await cdp.value(clickWorkspace("世界观管理"));
        await cdp.waitFor(`Boolean([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "新建条目"))`, 6000);
        await cdp.value(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "新建条目")).click()`);
        await cdp.waitFor(`!!document.querySelector(".world-dialog")`, 4000);

        const top = await cdp.value(RECTS);
        // Two nested scrollers, both have to be at the end before "the last row is
        // reachable" means anything: the dialog body, then the picker's own list.
        await cdp.value(`(() => {
          const body = document.querySelector(".world-dialog-body");
          body.scrollTop = body.scrollHeight;
          const list = document.querySelector(".character-picker-list");
          if (list) list.scrollTop = list.scrollHeight;
          return true;
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const bottom = await cdp.value(RECTS);

        const rowHeights = await cdp.value(`[...document.querySelectorAll(".character-picker .settings-check")].slice(0, 3).map((row) => Math.round(row.getBoundingClientRect().height))`);
        const nameWraps = await cdp.value(`(() => {
          const row = [...document.querySelectorAll(".character-picker .settings-check")].find((item) => item.textContent.includes("亚历山大"));
          const name = row?.querySelector(".character-row-name");
          if (!name) return null;
          return { lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)), clipped: name.scrollWidth > name.clientWidth + 1 };
        })()`);

        const footerClear = bottom.foot && bottom.lastOption
          ? bottom.foot.top >= bottom.lastOption.bottom - 1
          : false;
        const lastReachable = bottom.body && bottom.lastOption
          ? bottom.lastOption.top >= bottom.body.top - 1 && bottom.lastOption.bottom <= bottom.body.bottom + 1
          : false;
        const scrollable = bottom.bodyScroll && bottom.bodyScroll.height > bottom.bodyScroll.client;
        const noHorizontal = top.overflow === 0 && width >= 320;
        const footerInside = bottom.foot && bottom.dialog ? bottom.foot.bottom <= bottom.dialog.bottom + 1 : false;

        results.push({ width, footerClear, lastReachable, scrollable, noHorizontal, footerInside, rowHeights, nameWraps });
      }

      const pass = results.every((item) =>
        item.footerClear &&
        item.lastReachable &&
        item.scrollable &&
        item.noHorizontal &&
        item.footerInside &&
        item.nameWraps && item.nameWraps.lines >= 2 && !item.nameWraps.clipped
      );

      return {
        pass,
        detail: results.map((item) =>
          `${item.width}px 底栏不压末项 ${item.footerClear}、末项可达 ${item.lastReachable}、正文可滚 ${item.scrollable}、横向溢出 ${item.noHorizontal ? 0 : "有"}、底栏在框内 ${item.footerInside}、行高 ${item.rowHeights.join("/")}、长名 ${item.nameWraps?.lines} 行且未裁切 ${!item.nameWraps?.clipped}`
        ).join("；"),
      };
    });

    await check("关系弹窗：未保存确认、Escape 逐层关闭、焦点返回，管理列表无横向滚动（Sprint 49 补充）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
      await cdp.goto(base);
      await cdp.value(SEED_FORMS);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await cdp.value(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("管理"))).click()`);
      await cdp.waitFor(`!!document.querySelector(".manage-table")`, 5000);

      const widths = [];
      for (const width of [1440, 1024]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await new Promise((resolve) => setTimeout(resolve, 300));
        widths.push(await cdp.value(`(() => {
          const wrap = document.querySelector(".relationship-table-wrap");
          const note = document.querySelector(".relationship-note-text");
          const toggle = document.querySelector(".relationship-note-toggle");
          return { width: innerWidth, overflow: wrap.scrollWidth - wrap.clientWidth, clamped: note ? Math.round(note.getBoundingClientRect().height) : 0, hasToggle: Boolean(toggle) };
        })()`));
      }

      const noteBefore = await cdp.value(`Math.round(document.querySelector(".relationship-note-text")?.getBoundingClientRect().height ?? 0)`);
      await cdp.value(`document.querySelector(".relationship-note-toggle").click()`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const expand = await cdp.value(`(() => {
        const toggle = document.querySelector(".relationship-note-toggle");
        const note = document.querySelector(".relationship-note-text");
        return { before: ${noteBefore}, after: note ? Math.round(note.getBoundingClientRect().height) : 0, expanded: toggle?.getAttribute("aria-expanded") };
      })()`);

      const help = await cdp.value(`(() => {
        const button = document.querySelector(".relationship-direction-button");
        return { button: Boolean(button), table: Boolean(document.querySelector(".manage-table")), mode: document.querySelector(".relationship-mode")?.textContent?.trim().slice(0, 12) };
      })()`);
      if (help.button) {
        await cdp.value(`document.querySelector(".relationship-direction-button").click()`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const helpPanel = await cdp.value(`Boolean(document.querySelector(".relationship-direction-panel"))`);

      await cdp.value(`([...document.querySelectorAll(".relationship-direction-panel button")].length ? true : true)`);
      await cdp.value(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);

      await cdp.value(`(() => {
        const trigger = document.querySelector(".manage-row-more");
        window.__relationshipTrigger = trigger;
        trigger.focus();
        trigger.click();
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 180));
      await cdp.value(`(() => {
        [...document.querySelectorAll(".manage-row-menu button")]
          .find((button) => button.textContent.trim() === "编辑")
          .click();
        return true;
      })()`);
      await cdp.waitFor(`!!document.querySelector(".relationship-dialog")`, 4000);
      const triggerLabel = await cdp.value(`(() => {
        const active = document.activeElement;
        return (active?.getAttribute("aria-label") || active?.textContent || "").trim().slice(0, 24);
      })()`);
      await cdp.value(`(() => {
        const input = [...document.querySelectorAll(".relationship-dialog input")].find((item) => item.placeholder === "可选");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "临时备注");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));

      await cdp.value(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const firstEscape = await cdp.value(`({
        discard: Boolean([...document.querySelectorAll("h2")].find((h) => h.textContent.includes("放弃未保存"))),
        draft: Boolean(document.querySelector(".relationship-dialog")),
      })`);

      await cdp.value(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const secondEscape = await cdp.value(`({
        discard: Boolean([...document.querySelectorAll("h2")].find((h) => h.textContent.includes("放弃未保存"))),
        draft: Boolean(document.querySelector(".relationship-dialog")),
      })`);

      await cdp.value(`([...document.querySelectorAll(".relationship-dialog-actions button")].find((b) => b.textContent.trim() === "取消")).click()`);
      await cdp.waitFor(`Boolean([...document.querySelectorAll("h2")].find((h) => h.textContent.includes("放弃未保存")))`, 3000);
      await cdp.value(`([...document.querySelectorAll(".confirm-dialog button")].find((b) => b.textContent.trim() === "放弃修改")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const closed = await cdp.value(`({
        draft: Boolean(document.querySelector(".relationship-dialog")),
        discard: Boolean([...document.querySelectorAll("h2")].find((h) => h.textContent.includes("放弃未保存"))),
        focusReturned: document.activeElement === window.__relationshipTrigger,
        focused: document.activeElement?.textContent?.trim().slice(0, 12),
      })`);

      const noOverflow = widths.every((item) => item.overflow <= 1);
      const pass =
        noOverflow &&
        expand && expand.after > expand.before + 5 && expand.expanded === "true" &&
        helpPanel &&
        firstEscape.discard && firstEscape.draft &&
        !secondEscape.discard && secondEscape.draft &&
        !closed.draft && !closed.discard && closed.focusReturned;

      return {
        pass: Boolean(pass),
        detail: `表格 ${widths.map((item) => `${item.width}px 溢出 ${item.overflow}`).join("、")}；备注 ${expand ? `${Math.round(expand.before)}→${Math.round(expand.after)}px` : "无"}、展开标记 ${expand?.expanded}；方向说明 按钮 ${help.button} / 可见 ${help.table} / 面板 ${helpPanel}；修改后 Escape → 确认 ${firstEscape.discard} 且弹窗保留 ${firstEscape.draft}；再次 Escape → 确认关闭 ${!secondEscape.discard}、弹窗仍在 ${secondEscape.draft}；放弃后全部关闭 ${!closed.draft && !closed.discard}、焦点回到触发按钮 ${closed.focusReturned}（${closed.focused}）`,
      };
    });


    await check("画布可靠性：异常释放不跳动、撤销重做、对齐与适应选中（Sprint 50）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await OPEN_GRAPH();
      const centre = async (id) => cdp.value(`(() => {
        const g = document.querySelector('.relationship-node[data-character-id="${id}"]');
        const c = g && g.querySelector("circle");
        if (!c) return null;
        const b = c.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      })()`);
      const cx = async (id) => cdp.value(`(() => {
        const c = document.querySelector('.relationship-node[data-character-id="${id}"] circle');
        return c ? Number(c.getAttribute("cx")) : null;
      })()`);
      const dragTo = async (from, dx, dy, releaseAt) => {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(from.x), y: Math.round(from.y) });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(from.x), y: Math.round(from.y), button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 5; i += 1) {
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: Math.round(from.x + (dx * i) / 5),
            y: Math.round(from.y + (dy * i) / 5),
            button: "left",
            buttons: 1,
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const end = releaseAt || { x: from.x + dx, y: from.y + dy };
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(end.x), y: Math.round(end.y), button: "left", buttons: 1, clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 350));
      };

      // A release reported at (0,0) — what some touch stacks send after a cancel —
      // must not teleport the node to the world origin.
      const start = await centre("g-2");
      const startWorld = await cx("g-2");
      await dragTo(start, 120, 60, { x: 0, y: 0 });
      const afterOddRelease = await cx("g-2");
      const scale = await cdp.value(`(() => {
        const c = document.querySelector('.relationship-node[data-character-id="g-2"] circle');
        return c.getScreenCTM().a;
      })()`);
      const expected = await cdp.value(`(() => {
        const raw = JSON.parse(localStorage.getItem("character-studio.relationship-layout"));
        return raw.positions["g-2"].x;
      })()`);
      const oddReleaseOk = Number.isFinite(afterOddRelease) && Math.abs(afterOddRelease - expected) < 0.5;

      const undoEnabled = await cdp.value(`!document.querySelector('button[aria-label="撤销"]').disabled`);
      await cdp.value(`document.querySelector('button[aria-label="撤销"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const afterUndo = await cx("g-2");
      await cdp.value(`document.querySelector('button[aria-label="重做"]').click()`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const afterRedo = await cx("g-2");
      const historyOk =
        undoEnabled && Math.abs(afterUndo - startWorld) < 1 && Math.abs(afterRedo - expected) < 1;

      // Align two selected nodes to the same top edge.
      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label^="选择工具"]')).click()`);
      for (const id of ["g-1", "g-2"]) {
        const point = await centre(id);
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(point.x), y: Math.round(point.y) });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(point.x), y: Math.round(point.y), button: "left", buttons: 1, clickCount: 1 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(point.x), y: Math.round(point.y), button: "left", buttons: 1, clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      await cdp.value(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "排列")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      // The align tools are icons: the label lives on aria-label, which is also what a
      // screen reader announces. Reading the accessible name rather than the text keeps
      // the check tied to what the control is called.
      await cdp.value(`(document.querySelector('.graph-align-panel button[aria-label="顶对齐"]')).click()`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const aligned = await cdp.value(`(() => {
        const y = (id) => {
          const c = document.querySelector('.relationship-node[data-character-id="' + id + '"] circle');
          return Number(c.getAttribute("cy"));
        };
        return { a: y("g-1"), b: y("g-2") };
      })()`);

      const beforeFit = await cx("g-1");
      await cdp.value(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "适应选中")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterFit = await cx("g-1");

      // The three new arrangements exist and preview without writing.
      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label="整理画布"]')).click()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const modes = await cdp.value(`[...document.querySelectorAll(".graph-arrange-actions button")].map((b) => b.textContent.trim())`);
      const beforeGrid = await cx("g-1");
      await cdp.value(`([...document.querySelectorAll(".graph-arrange-actions button")].find((b) => b.textContent.trim() === "网格布局")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const gridPreview = await cdp.value(`(document.querySelector(".graph-context.preview") || {}).textContent || ""`);
      const storedDuringPreview = await cdp.value(`localStorage.getItem("character-studio.relationship-layout")`);
      await cdp.value(`([...document.querySelectorAll(".graph-context.preview button")].find((b) => b.textContent.trim() === "取消")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const afterCancel = await cx("g-1");

      const pass =
        oddReleaseOk &&
        historyOk &&
        Math.abs(aligned.a - aligned.b) < 1 &&
        Math.abs(afterFit - beforeFit) < 0.5 &&
        modes.includes("网格布局") &&
        modes.includes("层级布局") &&
        modes.includes("按分组整理") &&
        gridPreview.includes("网格布局") &&
        Boolean(storedDuringPreview) &&
        Math.abs(afterCancel - beforeGrid) < 0.5;

      return {
        pass,
        detail: `异常释放 世界x=${afterOddRelease} 期望=${expected}（${oddReleaseOk ? "未跳" : "跳动"}）；撤销回 ${Math.round(afterUndo)} / 起始 ${Math.round(startWorld)}；重做 ${Math.round(afterRedo)} / ${Math.round(expected)}（${historyOk}）；顶对齐 cy ${aligned.a.toFixed(1)}/${aligned.b.toFixed(1)}；适应选中改坐标 ${Math.abs(afterFit - beforeFit) < 0.5 ? "否" : "是"}；布局模式 ${modes.join("、")}；网格预览 ${gridPreview.includes("网格布局")}；取消后回到 ${Math.abs(afterCancel - beforeGrid) < 0.5}`,
      };
    });


    await check("外观：八个预设真实改变节点、连线与网格，刷新后保留（Sprint 50）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await OPEN_GRAPH();
      const look = async () => cdp.value(`(() => {
        const circle = document.querySelector(".relationship-node circle");
        const path = document.querySelector(".relationship-edge path");
        const grid = document.querySelector(".graph-grid-plane");
        const raw = JSON.parse(localStorage.getItem("character-studio.relationship-layout") || "{}");
        return {
          r: circle ? Number(circle.getAttribute("r")) : null,
          width: path ? Number.parseFloat(getComputedStyle(path).strokeWidth) : null,
          grid: grid ? getComputedStyle(grid).fill : "none",
          preset: raw.style ? raw.style.preset : null,
        };
      })()`);

      const base = await look();
      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label="外观设置"]')).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-style-panel")`, 3000);
      const presetCount = await cdp.value(`document.querySelectorAll(".graph-preset").length`);
      // The shipped set, by name: a preset that disappears or arrives without a
      // thumbnail is a change in the product, not a test detail.
      const presetNames = await cdp.value(`[...document.querySelectorAll(".graph-preset")].map((b) => b.textContent.trim())`);
      await cdp.value(`([...document.querySelectorAll(".graph-preset")].find((b) => b.textContent.trim() === "档案研究")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const archive = await look();
      await cdp.value(`([...document.querySelectorAll(".graph-preset")].find((b) => b.textContent.trim() === "人物群像")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const portrait = await look();
      await cdp.value(`([...document.querySelectorAll(".graph-preset")].find((b) => b.textContent.trim() === "极简展示")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const minimal = await look();

      const storedBeforeReload = await cdp.value(`(() => {
        const raw = JSON.parse(localStorage.getItem("character-studio.relationship-layout") || "{}");
        return { preset: raw.style ? raw.style.preset : null, size: raw.style ? raw.style.node.size : null };
      })()`);
      await RELOAD_GRAPH();
      const reloaded = await look();

      // A hand-tweaked preset is a preset plus the author's own numbers. It has to come
      // back as 自己调的 with those numbers intact -- not snapped to the preset, and not
      // reset to the base look.
      const custom = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const panel = document.querySelector(".graph-style-panel");
        if (!panel) {
          const open = document.querySelector('.graph-toolbar button[aria-label="外观设置"]');
          if (!open) return { ok: false, why: "外观按钮不存在" };
          open.click();
          await sleep(300);
        }
        // 节点大小 is a numeric field showing a percentage (displayScale 100), committed
        // on Enter or blur -- writing .value alone would leave the draft uncommitted.
        const field = document.querySelector('[data-testid="node-size-field"]');
        if (!field) return { ok: false, why: "节点大小输入框不存在" };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(field, "160");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(500);
        const raw = JSON.parse(localStorage.getItem("character-studio.relationship-layout") || "{}");
        return {
          ok: true,
          preset: raw.style ? raw.style.preset : null,
          size: raw.style ? raw.style.node.size : null,
          r: Number(document.querySelector(".relationship-node circle").getAttribute("r")),
        };
      })()`);
      await RELOAD_GRAPH();
      const customAfter = await look();

      await cdp.value(`(document.querySelector('.graph-toolbar button[aria-label="外观设置"]')).click()`);
      await cdp.waitFor(`!!document.querySelector(".graph-style-panel")`, 3000);
      await cdp.value(`([...document.querySelectorAll(".graph-style-panel button")].find((b) => b.textContent.trim() === "恢复整体画布默认外观")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const restored = await look();

      const pass =
        presetCount === 8 &&
        presetNames.includes("故事脉络") &&
        presetNames.includes("关系档案") &&
        presetNames.includes("柔和展示") &&
        archive.r < base.r &&
        Math.abs(archive.width - 1) < 0.15 &&
        String(archive.grid).includes("line-grid") &&
        portrait.r > base.r &&
        String(minimal.grid) === "none" &&
        storedBeforeReload.preset === "minimal" &&
        reloaded.preset === "minimal" &&
        String(reloaded.grid) === "none" &&
        Math.abs(reloaded.r - minimal.r) < 0.5 &&
        // the override survives its own reload, and keeps the numbers the author chose
        custom.ok &&
        custom.preset === "custom" &&
        custom.size === 1.6 &&
        customAfter.preset === "custom" &&
        Math.abs(customAfter.r - custom.r) < 0.5 &&
        restored.preset === "classic" &&
        Math.abs(restored.r - base.r) < 0.5;

      return {
        pass,
        detail: `预设 ${presetCount} 个；基准 r=${base.r} 线宽=${base.width}；档案 r=${archive.r} 线宽=${archive.width} 网格线=${String(archive.grid).includes("line-grid")}；群像 r=${portrait.r}；极简网格=${minimal.grid}；刷新前存储 ${storedBeforeReload.preset}/${storedBeforeReload.size}；刷新后 ${reloaded.preset} r=${reloaded.r} 网格=${reloaded.grid}；自定义 ${custom.preset}/${custom.size} r=${custom.r} → 刷新后 ${customAfter.preset} r=${customAfter.r}；恢复后 ${restored.preset} r=${restored.r}`,
      };
    });


    // ---------------------------------------------------------------- Sprint 53.2
    // One drawer, one row shape: label on the left, one control block on the right,
    // buttons side by side. A drawer can report zero horizontal scroll and still be
    // laid out badly, so this measures the rows themselves at both desktop widths.
    await check("设计抽屉：分段不断裂、368px 统一宽度、1024 不挤走画布（Sprint 53.2）", async () => {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await OPEN_GRAPH(1440, 900);
      await cdp.value(`(async () => {
        const direct = document.querySelector('[aria-label="外观设置"]');
        if (direct) { direct.click(); return true; }
        const more = document.querySelector('[aria-label="更多工具"]');
        if (!more) return false;
        more.click();
        await new Promise((r) => setTimeout(r, 200));
        const item = [...document.querySelectorAll(".graph-more-menu button")].find((b) => b.textContent.includes("外观"));
        if (item) item.click();
        return Boolean(item);
      })()`);
      await cdp.waitFor(`!!document.querySelector(".graph-style-panel")`, 3000);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const shape = await cdp.value(`(() => {
        const panel = document.querySelector(".graph-style-panel");
        const drawer = panel.closest(".graph-page-drawer") || panel.closest(".graph-studio-drawer");
        const rows = [...panel.querySelectorAll(".graph-panel-row")].map((row) => {
          const segment = row.querySelector(".graph-segment");
          const buttons = segment ? [...segment.querySelectorAll("button")] : [];
          const tops = buttons.map((b) => Math.round(b.getBoundingClientRect().top));
          return {
            label: (row.querySelector(".graph-control-label")?.textContent || "").trim(),
            buttons: buttons.length,
            stacked: new Set(tops).size > 1,
            width: segment ? Math.round(segment.getBoundingClientRect().width) : 0,
            rowWidth: Math.round(row.getBoundingClientRect().width),
          };
        });
        return {
          drawerWidth: drawer ? Math.round(drawer.getBoundingClientRect().width) : null,
          scroll: panel.scrollWidth - panel.clientWidth,
          drawerScroll: drawer ? drawer.scrollWidth - drawer.clientWidth : null,
          rows,
        };
      })()`);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const narrow = await cdp.value(`(() => {
        const drawer = document.querySelector(".graph-page-drawer") || document.querySelector(".graph-studio-drawer");
        return {
          drawer: drawer ? Math.round(drawer.getBoundingClientRect().width) : null,
          drawerScroll: drawer ? drawer.scrollWidth - drawer.clientWidth : null,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);

      await cdp.value(`(() => {
        // The studio variant of this class no longer exists; keeping it as a silent
        // fallback meant a rename would have looked like "nothing to close".
        const b = document.querySelector(".graph-page-drawer-close");
        if (!b) throw new Error("关闭抽屉的按钮不存在：" + ".graph-page-drawer-close");
        b.click();
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const restored = await cdp.value(`(() => {
        const canvas = document.querySelector(".graph-canvas-frame");
        return {
          canvas: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
          nodes: document.querySelectorAll(".relationship-node").length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

      const wide = shape.rows.filter((row) => row.buttons >= 2);
      const broken = wide.filter((row) => row.stacked);
      const tooWide = wide.filter((row) => row.width > row.rowWidth + 1);

      // One token, one width. The 356-384 band let 372 pass below 1024 while the
      // desktop drawer was 368, so "统一宽度" was true only on one side of the
      // breakpoint.
      const pass =
        shape.drawerWidth === 368 && narrow.drawer === 368 &&
        shape.scroll <= 0 && shape.drawerScroll <= 0 &&
        wide.length >= 5 && broken.length === 0 && tooWide.length === 0 &&
        narrow.drawerScroll <= 0 && narrow.pageOverflow <= 0 &&
        restored.canvas > 600 && restored.nodes >= 5 && restored.overflow <= 0;

      return {
        pass,
        detail: `1440 抽屉 ${shape.drawerWidth}px 正文溢出 ${shape.scroll} 抽屉溢出 ${shape.drawerScroll}；多按钮行 ${wide.length} 纵向断裂 ${broken.map((r) => r.label).join("/") || "无"} 超宽 ${tooWide.map((r) => r.label).join("/") || "无"}；1024 抽屉 ${narrow.drawer}px 溢出 ${narrow.pageOverflow}；关闭后画布 ${restored.canvas}px 节点 ${restored.nodes}`,
      };
    });

    // Three phone widths, the same first screen: the dock reachable, the task sheet
    // reachable, the sheet taking over the state line while the dock steps aside.
    // Two opinions on the same question: does the document fit its scrollport, and does
    // any control the user can press sit outside it. `scrollWidth - clientWidth` alone
    // missed the case this was written for — a root with `min-width: 320px` inside a
    // 309px scrollport reported 11px of "overflow" that was really a clipped right edge.
    const PHONE_LAYOUT = `(() => {
      const de = document.documentElement;
      const vw = de.clientWidth;
      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const controls = [...document.querySelectorAll("button, a, input, select, textarea, [role=button]")].filter(visible);
      const clipped = controls.filter((el) => {
        const box = el.getBoundingClientRect();
        return box.right > vw + 0.5 || box.left < -0.5;
      });
      return {
        overflow: de.scrollWidth - vw,
        scrollBar: window.innerWidth - vw,
        documentScrolls: de.scrollHeight > de.clientHeight,
        controls: controls.length,
        clipped: clipped.length,
        clippedNames: clipped.slice(0, 3).map((el) => (el.getAttribute("aria-label") || el.textContent.trim() || el.className).toString().slice(0, 24)),
      };
    })()`;

    await check("手机 320/375/430：工具坞与任务抽屉可达、让位后仍有状态（Sprint 53.2）", async () => {
      const widths = [320, 375, 430];
      const results = [];

      for (const width of widths) {
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        await OPEN_GRAPH(width, 812);
        await cdp.waitFor(`!!document.querySelector(".relationship-node")`, 5000);
        await new Promise((resolve) => setTimeout(resolve, 250));

        const reach = await cdp.value(`(() => {
          const dock = document.querySelector(".graph-canvas-tools");
          const more = document.querySelector('[aria-label="更多工具"]');
          const multi = document.querySelector(".graph-touch-select");
          const node = document.querySelector(".relationship-node");
          const box = node ? node.getBoundingClientRect() : null;
          return {
            dockVisible: dock ? getComputedStyle(dock).visibility !== "hidden" : false,
            more: more ? more.getBoundingClientRect().width > 0 : false,
            multi: multi ? multi.getBoundingClientRect().width > 0 : false,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            point: box ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } : null,
          };
        })()`);

        if (reach.point) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [reach.point] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await new Promise((resolve) => setTimeout(resolve, 420));
        }

        const opened = await cdp.value(`(async () => {
          const direct = document.querySelector('[aria-label="外观设置"]');
          if (direct) { direct.click(); return true; }
          const more = document.querySelector('[aria-label="更多工具"]');
          if (!more) return false;
          more.click();
          await new Promise((r) => setTimeout(r, 200));
          const item = [...document.querySelectorAll(".graph-more-menu button")].find((b) => b.textContent.includes("外观"));
          if (!item) return false;
          item.click();
          return true;
        })()`);
        if (opened) {
          await cdp.waitFor(`!!document.querySelector(".graph-style-panel")`, 3000);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        const sheet = await cdp.value(`(() => {
          const dock = document.querySelector(".graph-canvas-tools");
          const slot = document.querySelector(".graph-context-slot");
          const state = document.querySelector(".graph-page-drawer-state");
          const drawer = document.querySelector(".graph-page-drawer");
          const close = document.querySelector(".graph-page-drawer-close");
          const closeBox = close ? close.getBoundingClientRect() : null;
          return {
            dockYielded: dock ? getComputedStyle(dock).visibility === "hidden" : true,
            slotYielded: slot ? getComputedStyle(slot).visibility === "hidden" : true,
            state: state ? state.textContent.replace(/\s+/g, " ").trim() : "",
            drawerOverflow: drawer ? drawer.scrollWidth - drawer.clientWidth : null,
            closeReachable: Boolean(closeBox && closeBox.top >= 0 && closeBox.top < window.innerHeight && closeBox.width > 0),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);

        await cdp.value(`(() => { const b = document.querySelector(".graph-page-drawer-close"); if (b) b.click(); })()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const after = await cdp.value(`(() => {
          const dock = document.querySelector(".graph-canvas-tools");
          return {
            selected: document.querySelectorAll('.relationship-node[data-selected="true"]').length,
            dockVisible: dock ? getComputedStyle(dock).visibility !== "hidden" : false,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);

        // A single reading only proves the state it was taken in. These are the states
        // that made this page wider than its scrollport in earlier reports: a second
        // selection, the more menu, the 管理 table, an open search field, and the sheet
        // at full height.
        const states = [];
        const readState = async (name) => {
          states.push({ name, ...(await cdp.value(PHONE_LAYOUT)) });
        };
        const tapNode = async (index) => {
          const point = await cdp.value(`(() => {
            const nodes = [...document.querySelectorAll(".relationship-node")];
            const node = nodes[${index}] || nodes[0];
            if (!node) return null;
            const box = node.getBoundingClientRect();
            return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
          })()`);
          if (!point) return false;
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await new Promise((resolve) => setTimeout(resolve, 420));
          return true;
        };

        await cdp.value(`(() => { const b = document.querySelector(".graph-touch-select"); if (b) b.click(); return !!b; })()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tapNode(1);
        await readState("多选");

        await cdp.value(`(() => { const b = document.querySelector('[aria-label="更多工具"]'); if (b) b.click(); return !!b; })()`);
        await new Promise((resolve) => setTimeout(resolve, 320));
        await readState("更多菜单");
        await cdp.value(`(() => { const b = document.querySelector('[aria-label="更多工具"]'); if (b) b.click(); return !!b; })()`);
        await new Promise((resolve) => setTimeout(resolve, 260));

        await cdp.value(`(() => {
          const group = document.querySelector('[aria-label="关系网视图"]');
          const button = group ? [...group.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("管理")) : null;
          if (button) button.click();
          return !!button;
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 520));
        await readState("管理");
        await cdp.value(`(() => {
          const group = document.querySelector('[aria-label="关系网视图"]');
          const button = group ? [...group.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("图谱")) : null;
          if (button) button.click();
          return !!button;
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 420));

        await cdp.value(`(() => { const b = document.querySelector('[aria-label="搜索角色"]'); if (b) b.click(); return !!b; })()`);
        await new Promise((resolve) => setTimeout(resolve, 360));
        await readState("搜索展开");
        await cdp.value(`(() => { const input = document.querySelector('[aria-label="搜索角色并定位"]'); if (input) input.blur(); document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
        await new Promise((resolve) => setTimeout(resolve, 300));

        const reopened = await cdp.value(`(() => { const b = document.querySelector('[aria-label="外观设置"]'); if (b) b.click(); return !!b; })()`);
        if (reopened) {
          await cdp.waitFor(`!!document.querySelector(".graph-page-drawer")`, 3000);
          await new Promise((resolve) => setTimeout(resolve, 320));
          await readState("抽屉半屏");
          await cdp.value(`(() => { const b = document.querySelector('[aria-label="展开到全屏高度"]'); if (b) b.click(); return !!b; })()`);
          await new Promise((resolve) => setTimeout(resolve, 420));
          await readState("抽屉全展开");
          await cdp.value(`(() => { const b = document.querySelector(".graph-page-drawer-close"); if (b) b.click(); return !!b; })()`);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        results.push({ width, opened, reach, sheet, after, states });
      }

      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

      // No allowance per width any more. The 11px at 320px was a real clipped edge,
      // not a rounding difference, and a tolerance is how it survived a release.
      const fits = (state) => state.overflow <= 0 && state.clipped === 0;
      const pass = results.every((r) =>
        r.opened &&
        r.reach.dockVisible && r.reach.more && r.reach.multi &&
        r.reach.overflow <= 0 &&
        r.sheet.dockYielded && r.sheet.slotYielded &&
        r.sheet.state.includes("已选") &&
        r.sheet.drawerOverflow <= 0 &&
        r.sheet.closeReachable &&
        r.sheet.overflow <= 0 &&
        r.after.dockVisible &&
        r.after.overflow <= 0 &&
        r.states.length >= 6 &&
        r.states.every(fits),
      );

      return {
        pass,
        detail: results.map((r) => {
          const failing = [
            !r.opened && "drawerUnreachable",
            !r.reach.dockVisible && "dockHidden",
            !r.reach.more && "moreMissing",
            !r.reach.multi && "multiMissing",
            r.reach.overflow > 0 && "overflow",
            !r.sheet.dockYielded && "dockNotYielded",
            !r.sheet.slotYielded && "slotNotYielded",
            !r.sheet.state.includes("已选") && "noState",
            r.sheet.drawerOverflow > 0 && "drawerOverflow",
            !r.sheet.closeReachable && "closeUnreachable",
            r.sheet.overflow > 0 && "sheetOverflow",
            !r.after.dockVisible && "dockStaysHidden",
            r.after.overflow > 0 && "afterOverflow",
            r.states.length < 6 && "statesMissing",
            !r.states.every(fits) && "stateOverflow",
          ].filter(Boolean);
          return `${r.width}px 失败=${failing.join("+") || "无"} 溢出=${r.reach.overflow} 滚动条=${r.states[0]?.scrollBar ?? "?"}px 抽屉溢出=${r.sheet.drawerOverflow} Header="${r.sheet.state}" 关后选中=${r.after.selected}`
            + `；状态 ${r.states.map((s) => `${s.name} ${s.overflow}/${s.clipped}`).join("、")}`;
        }).join(" ｜ "),
      };
    });

    // Six pages, one masthead: the drawing band is allowed to be smaller than a roster
    // hero, but every page has to come from the same scale and keep its counts on the
    // title's left edge.
    await check("全站 Hero：标题同尺度、统计副标题对齐、无横向溢出（Sprint 53.2）", async () => {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);

      const measure = async () => cdp.value(`(() => {
        const title = document.querySelector(".workspace-header-title");
        const summary = document.querySelector(".workspace-header-summary");
        if (!title) return null;
        const titleBox = title.getBoundingClientRect();
        const summaryBox = summary ? summary.getBoundingClientRect() : null;
        return {
          title: title.textContent.trim(),
          size: parseFloat(getComputedStyle(title).fontSize),
          summarySize: summary ? parseFloat(getComputedStyle(summary).fontSize) : null,
          aligned: summaryBox ? Math.abs(summaryBox.left - titleBox.left) <= 1 : true,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);

      const visit = async (label) => {
        const ok = await cdp.value(`(async () => {
          const trigger = document.querySelector(".workspace-switch");
          if (!trigger) return false;
          trigger.click();
          await new Promise((r) => setTimeout(r, 220));
          const row = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}));
          if (!row) return false;
          row.click();
          await new Promise((r) => setTimeout(r, 450));
          return true;
        })()`);
        return ok ? { label, ...(await measure()) } : { label, missing: true };
      };

      const pages = [{ label: "角色创作工作台", ...(await measure()) }];
      for (const label of ["角色关系网", "世界观时间线", "世界观管理"]) {
        pages.push(await visit(label));
      }

      const seen = pages.filter((page) => !page.missing && page.size);
      const scale = [20, 24, 26, 28];
      const offScale = seen.filter((page) => !scale.includes(page.size));
      const misaligned = seen.filter((page) => page.aligned === false);
      const overflowing = seen.filter((page) => page.overflow > 0);

      return {
        pass: seen.length >= 4 && offScale.length === 0 && misaligned.length === 0 && overflowing.length === 0,
        detail: seen.map((p) => `${p.label}:${p.size}px/副${p.summarySize ?? "-"}px`).join(" · ") +
          `；越界字号 ${offScale.map((p) => p.label).join("/") || "无"}；左缘不齐 ${misaligned.map((p) => p.label).join("/") || "无"}；溢出 ${overflowing.map((p) => `${p.label}${p.overflow}px`).join("/") || "无"}`,
      };
    });

    // Two fingers, one view update: a pure pan must not change zoom, a pure pinch must
    // not move the drawing, and neither may write a coordinate.
    await check("手机双指：中点平移只改视角、捏合以中心缩放、取消不写坐标（Sprint 53.2）", async () => {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await OPEN_GRAPH(375, 812);
      await cdp.waitFor(`!!document.querySelector(".relationship-node")`, 4000);

      const read = async () => cdp.value(`(() => {
        const stored = JSON.parse(localStorage.getItem("character-studio.relationship-layout") || "{}");
        const box = document.querySelector(".graph-canvas-frame").getBoundingClientRect();
        return {
          positions: stored.positions || {},
          readout: (document.querySelector(".graph-zoom-readout")?.textContent || "").trim(),
          centre: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) },
        };
      })()`);

      const before = await read();
      const pair = (dx, ox) => [
        { x: Math.round(before.centre.x - dx + ox), y: Math.round(before.centre.y) },
        { x: Math.round(before.centre.x + dx + ox), y: Math.round(before.centre.y) },
      ];

      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pair(40, 0) });
      for (const step of [1, 2, 3, 4]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pair(40, 10 * step) });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const panned = await read();

      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pair(30, 0) });
      for (const step of [1, 2, 3, 4]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pair(30 + 12 * step, 0) });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const pinched = await read();

      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pair(40, 0) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pair(80, 0) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const cancelled = await read();

      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const pass =
        same(before.positions, panned.positions) &&
        same(before.positions, pinched.positions) &&
        same(before.positions, cancelled.positions) &&
        panned.readout === before.readout &&
        pinched.readout !== before.readout;

      return {
        pass,
        detail: `平移 ${before.readout}→${panned.readout} 坐标未变 ${same(before.positions, panned.positions)}；捏合→${pinched.readout} 坐标未变 ${same(before.positions, pinched.positions)}；取消后坐标未变 ${same(before.positions, cancelled.positions)}`,
      };
    });

    // No modifier key on a phone, so the mode is the modifier: taps add and remove,
    // dragging one member carries the set, and leaving the mode restores replacement.
    await check("手机多选：点按增删、整组拖动写坐标、退出恢复单选（Sprint 53.2）", async () => {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await OPEN_GRAPH(375, 812);
      await cdp.waitFor(`!!document.querySelector(".relationship-node")`, 4000);

      const boxes = async () => cdp.value(`(() => [...document.querySelectorAll(".relationship-node")].slice(0, 2).map((node) => {
        const box = node.getBoundingClientRect();
        return { id: node.getAttribute("data-character-id"), x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2), left: Math.round(box.left * 10) / 10 };
      }))()`);
      const selected = async () => cdp.value(`document.querySelectorAll('.relationship-node[data-selected="true"]').length`);
      const tap = async (point) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await new Promise((resolve) => setTimeout(resolve, 520));
      };

      await cdp.value(`(document.querySelector(".graph-touch-select")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 250));

      let points = await boxes();
      await tap(points[0]);
      await tap(points[1]);
      const two = await selected();

      points = await boxes();
      await tap(points[0]);
      const one = await selected();
      points = await boxes();
      await tap(points[0]);
      const back = await selected();

      const beforeBoxes = await boxes();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: points[1].x, y: points[1].y }] });
      for (const step of [1, 2, 3, 4, 5]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: points[1].x + 10 * step, y: points[1].y }] });
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 420));

      const afterBoxes = await boxes();
      const shifts = beforeBoxes.map((node, index) => Math.round((afterBoxes[index].left - node.left) * 10) / 10);
      const stored = await cdp.value(`(() => {
        const raw = JSON.parse(localStorage.getItem("character-studio.relationship-layout") || "{}");
        return Object.keys(raw.positions || {}).length;
      })()`);

      await cdp.value(`(document.querySelector(".graph-touch-select")).click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const third = await cdp.value(`(() => {
        const node = [...document.querySelectorAll(".relationship-node")].find((el) => el.getAttribute("data-selected") !== "true");
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      })()`);
      if (third) await tap(third);
      const afterExit = await selected();

      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

      const pass =
        two === 2 && one === 1 && back === 2 &&
        shifts.every((dx) => Math.abs(dx) > 20) &&
        Math.abs(shifts[0] - shifts[1]) <= 1.5 &&
        stored >= 2 &&
        afterExit === 1;

      return {
        pass,
        detail: `选中 ${two}→点掉 ${one}→补回 ${back}；整组位移 ${JSON.stringify(shifts)}；落盘坐标 ${stored}；退出后单击选中 ${afterExit}`,
      };
    });

    // Not a check: an opt-in capture, so the result of a visual change can be looked
    // at rather than only asserted. Runs only with SHOTS=1 so CI writes no files.
    if (process.env.SHOTS) {
      await check("截图（SHOTS=<目录>）：设置弹窗 桌面浅色 / 桌面深色 / 375 深色", async () => {
        const dir = process.env.SHOTS;
        mkdirSync(dir, { recursive: true });
        const capture = async (name) => {
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = join(dir, `settings-${name}.png`);
          writeFileSync(file, Buffer.from(data, "base64"));
          return file;
        };
        const openDialog = async () => {
          await cdp.goto(base);
          await cdp.value(clickWorkspace("角色关系网"));
          await cdp.value(OPEN_SETTINGS_DIALOG);
        };

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED);
        // Forced rather than inherited: this browser's own preference is dark, so a
        // "light" shot that just opens the dialog would be a second dark one.
        await openDialog();
        await cdp.value(PICK_THEME("浅色"));
        const files = [await capture("desktop-light")];
        await cdp.value(PICK_THEME("深色"));
        files.push(await capture("desktop-dark"));

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await openDialog();
        await cdp.value(PICK_THEME("深色"));
        files.push(await capture("mobile-dark"));
        await cdp.send("Emulation.clearDeviceMetricsOverride");

        // The editor too: six sections is the other half of this change.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(CARD_MENU_ACTION("编辑"));
        await cdp.waitFor(`!!document.querySelector(".editor-more-wrap")`, 8000);
        await cdp.value(EXPAND_EDITOR_SECTIONS);
        files.push(await capture("editor-desktop"));

        // The sticky group head against the top bar, where the 4px window used to be.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 700, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED_CROWDED);
        await cdp.goto(base);
        await cdp.value(`(async () => { const s = (ms) => new Promise((r) => setTimeout(r, ms)); window.scrollTo(0, 1200); await s(500); return true; })()`);
        files.push(await capture("dashboard-sticky"));

        // The relationship graph: names on the nodes, the hover card, and the two
        // control rows around the canvas.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED_GRAPH);
        await cdp.goto(base);
        await cdp.value(clickWorkspace("角色关系网"));
        await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
        await cdp.value(FORCE_THEME("light"));
        files.push(await capture("graph-desktop-light"));
        await cdp.value(FORCE_THEME("dark"));
        files.push(await capture("graph-desktop-dark"));
        // The hover card, captured on its own: it only exists while the pointer is on a
        // node, so a shot taken with the pointer elsewhere cannot show it.
        const hovered = await cdp.value(graphNodeCentre("沈青梧"));
        if (hovered) {
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(hovered.x), y: Math.round(hovered.y), buttons: 0 });
          await new Promise((resolve) => setTimeout(resolve, 500));
          files.push(await capture("graph-hover-dark"));
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0 });
        }

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await cdp.goto(base);
        await cdp.value(SEED_GRAPH);
        await cdp.goto(base);
        await cdp.value(clickWorkspace("角色关系网"));
        await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await cdp.value(FORCE_THEME("dark"));
        files.push(await capture("graph-mobile-dark"));

        // The compact related-character display, collapsed and open.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 760, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED_CROWDED);
        await cdp.goto(base);
        await cdp.value(clickWorkspace("世界观时间线"));
        files.push(await capture("related-collapsed"));
        await cdp.value(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const chips = [...document.querySelectorAll(".related-characters .related-chip")];
            chips[chips.length - 1].click();
            await sleep(400);
            return true;
          })()
        `);
        files.push(await capture("related-expanded"));

        // The two new pickers at the size they were built for.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED_MANY);
        await cdp.goto(base);
        await cdp.value(clickWorkspace("角色关系网"));
        await cdp.value(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const open = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建关系");
            open.click();
            await sleep(400);
            document.querySelectorAll(".character-select-trigger")[0].click();
            await sleep(400);
            return true;
          })()
        `);
        files.push(await capture("relation-picker"));

        await cdp.goto(base);
        await cdp.value(clickWorkspace("世界观管理"));
        await cdp.value(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const setValue = (input, value) => {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
              setter.call(input, value);
              input.dispatchEvent(new Event("input", { bubbles: true }));
            };
            [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建条目").click();
            await sleep(400);
            setValue(document.querySelector(".character-picker-search input"), "工匠");
            await sleep(400);
            document.querySelectorAll(".character-picker-list input[type='checkbox']")[0].click();
            await sleep(250);
            document.querySelectorAll(".character-picker-list input[type='checkbox']")[1].click();
            await sleep(350);
            return true;
          })()
        `);
        files.push(await capture("world-multi-picker"));

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await cdp.goto(base);
        await cdp.value(CARD_MENU_ACTION("编辑"));
        await cdp.waitFor(`!!document.querySelector(".editor-more-wrap")`, 8000);
        await cdp.value(EXPAND_EDITOR_SECTIONS);
        files.push(await capture("editor-mobile"));
        await cdp.send("Emulation.clearDeviceMetricsOverride");

        return { pass: true, detail: files.join("  ") };
      });

      await check("截图（SHOTS=<目录>）：发布候选 — 浮动栏让位与真实导入预览", async () => {
        const dir = process.env.SHOTS;
        mkdirSync(dir, { recursive: true });
        const capture = async (name) => {
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = join(dir, `${name}.png`);
          writeFileSync(file, Buffer.from(data, "base64"));
          return file;
        };
        const files = [];

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await cdp.goto(base);
        await cdp.value(SEED_CROWDED);
        await cdp.goto(base);
        // Scrolling: the bar is gone while the gesture is in flight.
        await cdp.value(`(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          window.scrollTo(0, 900);
          await sleep(80);
          return true;
        })()`);
        files.push(await capture("floating-375-scrolling"));
        // Stopped: it is back, above the safe area, over the page's own gutter.
        await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 500))`);
        files.push(await capture("floating-375-rest"));
        // A second resting place, where the card under the corner is at a different
        // height: the bar has to find empty page again rather than keep a fixed offset.
        await cdp.value(`(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          window.scrollTo(0, 1400);
          await sleep(500);
          return true;
        })()`);
        files.push(await capture("floating-375-rest-2"));

        const payload = JSON.stringify({
          version: 1,
          exportedAt: "2026-03-01T00:00:00.000Z",
          characters: [
            { id: "rc-1", name: "导入预览·甲", occupation: "占星师", worldview: "阿尔勒", avatarEmoji: "🜂", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
            { id: "rc-1", name: "导入预览·同名 ID 冲突", occupation: "工匠", worldview: "北境", avatarEmoji: "🦊", createdAt: "2026-02-03T00:00:00.000Z", updatedAt: "2026-02-03T00:00:00.000Z" },
            { id: "rc-2", name: "名字很长很长的守夜人第二席代理记录官·导入预览换行验证", occupation: "记录官", worldview: "雾海纪", avatarEmoji: "🌙", createdAt: "2026-02-04T00:00:00.000Z", updatedAt: "2026-02-04T00:00:00.000Z" },
          ],
        });
        const openImport = `(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const input = document.querySelector('input[type="file"][accept*="json"]');
          const file = new File([${JSON.stringify(payload)}], "rc-import.json", { type: "application/json" });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          for (let attempt = 0; attempt < 25 && !document.querySelector(".settings-dialog.compact-dialog"); attempt++) {
            await sleep(200);
          }
          return true;
        })()`;

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED);
        await cdp.value(`localStorage.setItem("character-studio.about-seen", "true")`);
        await cdp.goto(base);
        await cdp.value(openImport);
        files.push(await capture("import-preview-1440"));

        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 350))`);
        files.push(await capture("import-preview-375"));
        await cdp.send("Emulation.clearDeviceMetricsOverride");

        return { pass: true, detail: files.join("  ") };
      });
    }




    await check("关系管理：超长中英文名称与备注不破坏行布局", async () => {
      const measure = `(() => {
        const rows = [...document.querySelectorAll(".manage-table tbody tr")].slice(0, 3);
        const report = rows.map((row) => {
          const cells = [...row.children].map((cell) => cell.getBoundingClientRect());
          const actions = row.querySelector(".relationship-col-actions");
          const actionsRect = actions.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          return {
            sameTop: Math.max(...cells.map((r) => r.top)) - Math.min(...cells.map((r) => r.top)) <= 1,
            inside: actionsRect.left >= rowRect.left - 1 && actionsRect.right <= rowRect.right + 1 &&
              actionsRect.top >= rowRect.top - 1 && actionsRect.bottom <= rowRect.bottom + 1,
            buttons: [...actions.querySelectorAll("button")].map((button) => {
              const rect = button.getBoundingClientRect();
              return rect.width > 10 && rect.height > 10 && rect.top >= rowRect.top - 1 && rect.bottom <= rowRect.bottom + 1;
            }),
            height: Math.round(rowRect.height),
          };
        });
        const wrap = document.querySelector(".relationship-table-wrap");
        return {
          rows: report,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          wrapOverflow: wrap ? wrap.scrollWidth - wrap.clientWidth : 0,
          sizes: wrap ? { table: document.querySelector(".manage-table").offsetWidth, wrap: wrap.clientWidth } : null,
        };
      })()`;

      const results = [];
      for (const width of [1440, 375, 320]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 812 : 900, deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
        await cdp.goto(base);
        await cdp.value(SEED);
        await cdp.value(`(() => {
          const now = "2026-01-01T00:00:00.000Z";
          localStorage.setItem("character-studio.characters", JSON.stringify([
            { id: "seed-1", name: "被潮水抹去姓氏的第七码头记账人", occupation: "记账人", createdAt: now, updatedAt: now },
            { id: "seed-2", name: "Alexanderthegreatwithoutanyspacesatall", occupation: "译者", createdAt: now, updatedAt: now },
            { id: "seed-3", name: "林雾 Lindiwe 混合名称测试", occupation: "抄写员", createdAt: now, updatedAt: now },
          ]));
          localStorage.setItem("character-studio.relationships", JSON.stringify([
            { id: "rel-1", fromId: "seed-1", toId: "seed-2", kind: "friend", note: "在旧码头认识，后来因为一批账目各执一词，关系时好时坏。".repeat(2), createdAt: now, updatedAt: now },
            { id: "rel-2", fromId: "seed-3", toId: "seed-1", kind: "mentor", note: "短备注", createdAt: now, updatedAt: now },
          ]));
        })()`);
        await cdp.goto(base);
        await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 600))`);
        await cdp.value(`(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const trigger = document.querySelector(".workspace-switch");
          trigger.click();
          await sleep(400);
          const rows = [...document.querySelectorAll('[data-testid="workspace-sheet"] .sheet-row')];
          const items = rows.length > 0 ? rows : [...document.querySelectorAll('button[role="menuitem"]')];
          items.find((button) => button.textContent.includes("角色关系网")).click();
          await sleep(800);
          const manage = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("管理"));
          if (manage) manage.click();
          await sleep(400);
          return true;
        })()`);
        results.push({ width, ...(await cdp.value(measure)) });
      }

      // Below 720px the same markup becomes a grid of stacked rows: cells no longer
      // share a top edge by design, so the table-specific check only applies to the
      // desktop layout. Both widths still have to keep every button inside its row.
      const pass = results.every((result) =>
        result.rows.length === 2 &&
        result.rows.every((row) => row.inside && row.buttons.every(Boolean)) &&
        (result.width < 720 || result.rows.every((row) => row.sameTop)) &&
        result.overflow === 0 &&
        result.wrapOverflow <= 1
      );

      return {
        pass,
        detail: results.map((result) =>
          `${result.width}px：行高 ${result.rows.map((r) => r.height).join("/")}、同名顶 ${result.rows.every((r) => r.sameTop)}、` +
          `按钮在行内 ${result.rows.every((r) => r.inside && r.buttons.every(Boolean))}、溢出 ${result.overflow}/${result.wrapOverflow}、宽 ${JSON.stringify(result.sizes)}`
        ).join("；"),
      };
    });

    await check("导航：返回来源正确、编辑取消不留在历史里、图谱默认", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.value(`localStorage.removeItem("character-studio.relationship-view")`);
      await cdp.value(`localStorage.setItem("character-studio.dashboard-prefs", JSON.stringify({ ...(JSON.parse(localStorage.getItem("character-studio.dashboard-prefs") || "{}")), viewMode: "cards" }))`);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 600))`);

      const flow = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const byLabel = (label) => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
        const byText = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
        const out = { steps: [] };

        for (let i = 0; i < 20 && !document.querySelector(".card-title-button"); i += 1) await sleep(200);
        out.titleButton = Boolean(document.querySelector(".card-title-button"));
        if (!out.titleButton) {
          out.head = document.body.innerText.slice(0, 60);
          return out;
        }

        document.querySelector(".card-title-button").click();
        await sleep(600);
        out.preview = Boolean(document.querySelector(".preview-hero"));

        const back = byLabel("返回");
        out.hasBack = Boolean(back);
        if (back) back.click();
        await sleep(600);
        out.backToDashboard = Boolean(document.querySelector(".list-toolbar")) && !document.querySelector(".preview-hero");

        const titleAgain = document.querySelector(".card-title-button");
        if (!titleAgain) return { ...out, stop: "second title missing" };
        titleAgain.click();
        await sleep(600);
        const edit = byText("编辑");
        out.hasEdit = Boolean(edit);
        if (edit) edit.click();
        await sleep(800);
        out.editor = Boolean(document.querySelector("form"));

        const cancel = byText("取消");
        out.hasCancel = Boolean(cancel);
        if (cancel) cancel.click();
        await sleep(800);
        out.cancelToPreview = Boolean(document.querySelector(".preview-hero")) && !document.querySelector("form");
        return out;
      })()`);

      // First entry with no saved preference must be the drawing. The default no longer
      // changes with width, so this covers the phone entry as well.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 700))`);
      const probe = await cdp.value(`({ path: location.pathname, hasSwitch: Boolean(document.querySelector(".workspace-switch")), head: document.body.innerText.slice(0, 40) })`);
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const trigger = document.querySelector(".workspace-switch");
        if (!trigger) return "no-switch";
        trigger.click();
        await sleep(400);
        const rows = [...document.querySelectorAll('[data-testid="workspace-sheet"] .sheet-row')];
        const items = rows.length > 0 ? rows : [...document.querySelectorAll('button[role="menuitem"]')];
        const item = items.find((button) => button.textContent.includes("角色关系网"));
        if (!item) return "no-item";
        item.click();
        await sleep(800);
        return "ok";
      })()`);

      const graph = await cdp.value(`(() => {
        const out = {};
        out.canvas = Boolean(document.querySelector(".relationship-canvas"));
        out.manage = Boolean(document.querySelector(".manage-table"));
        const manage = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("管理"));
        out.hasManage = Boolean(manage);
        return out;
      })()`);

      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const manage = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("管理"));
        if (!manage) return "no-manage";
        manage.click();
        await sleep(300);
        return true;
      })()`);
      const stored = await cdp.value(`localStorage.getItem("character-studio.relationship-view")`);

      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 700))`);
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const trigger = document.querySelector(".workspace-switch");
        if (!trigger) return "no-switch";
        trigger.click();
        await sleep(400);
        const rows = [...document.querySelectorAll('[data-testid="workspace-sheet"] .sheet-row')];
        const items = rows.length > 0 ? rows : [...document.querySelectorAll('button[role="menuitem"]')];
        const item = items.find((button) => button.textContent.includes("角色关系网"));
        if (!item) return "no-item";
        item.click();
        await sleep(800);
        return "ok";
      })()`);
      const remembered = await cdp.value(`Boolean(document.querySelector(".manage-table"))`);
      await cdp.value(`localStorage.removeItem("character-studio.relationship-view")`);

      return {
        pass:
          flow.preview &&
          flow.backToDashboard &&
          flow.editor &&
          flow.cancelToPreview &&
          graph.canvas &&
          !graph.manage &&
          graph.hasManage &&
          stored === "manage" &&
          remembered,
        detail: `预览 ${flow.preview}、返回 Dashboard ${flow.backToDashboard}、编辑 ${flow.editor}、取消回预览 ${flow.cancelToPreview}；` +
          `${JSON.stringify(flow)} 首次图谱 ${graph.canvas}/管理 ${graph.manage}；切换后存储 ${stored}、重载保留 ${remembered}；探针 ${JSON.stringify(probe)}`,
      };
    });

    await check("灵感工作室：生成、挑选、重抽、预览与安全应用", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.value(`localStorage.setItem("character-studio.dashboard-prefs", JSON.stringify({ ...(JSON.parse(localStorage.getItem("character-studio.dashboard-prefs") || "{}")), viewMode: "cards" }))`);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 500))`);

      const result = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const out = {};

        document.querySelector(".card-title-button").click();
        await sleep(500);
        [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "编辑").click();
        await sleep(700);

        const section = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("外貌设定"));
        const studioButton = [...section.querySelectorAll("button")].find((b) => b.textContent.trim() === "灵感工作室");
        out.button = Boolean(studioButton);
        studioButton.click();
        await sleep(500);

        const panel = document.querySelector(".inspiration-panel");
        const rect = panel.getBoundingClientRect();
        out.panel = { width: Math.round(rect.width), right: Math.round(innerWidth - rect.right), full: Math.round(rect.height) };
        out.cards = document.querySelectorAll(".inspiration-card").length;
        out.context = document.querySelector(".inspiration-context").textContent.trim();

        const firstText = document.querySelector(".inspiration-card p").textContent;
        document.querySelector(".inspiration-card .ghost-button").click();
        await sleep(250);
        out.selected = document.querySelectorAll(".inspiration-card.selected").length;

        const cards = [...document.querySelectorAll(".inspiration-card")];
        cards[1].querySelectorAll(".ghost-button")[1].click();
        await sleep(250);
        out.rerollKeptSelection = document.querySelectorAll(".inspiration-card.selected").length === 1;
        out.rerollChanged = document.querySelectorAll(".inspiration-card")[1].querySelector("p").textContent !== cards[1].querySelector("p").textContent;

        document.querySelector(".inspiration-tabs button:nth-child(2)").click();
        await sleep(300);
        out.categorySwitched = document.querySelector(".inspiration-tabs .active").textContent.trim() === "性格";

        [...document.querySelectorAll(".inspiration-pending button")].find((b) => b.textContent.trim() === "预览应用").click();
        await sleep(350);
        out.previewRows = document.querySelectorAll(".inspiration-diff > li").length;
        out.previewText = document.querySelector(".inspiration-preview").textContent;

        const before = localStorage.getItem("character-studio.characters");
        [...document.querySelectorAll(".inspiration-preview button")].find((b) => b.textContent.trim() === "应用到草稿").click();
        await sleep(500);

        const sectionAfter = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("外貌设定"));
        const area = sectionAfter.querySelector("textarea");
        out.appliedToDraft = Boolean(area && area.value.trim().length > 0);
        out.storedUnchanged = localStorage.getItem("character-studio.characters") === before;
        out.studioClosed = !document.querySelector(".inspiration-panel");
        return out;
      })()`);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await sleep(400);
      const mobile = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const section = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("外貌设定"));
        [...section.querySelectorAll("button")].find((b) => b.textContent.trim() === "灵感工作室").click();
        await sleep(400);
        const panel = document.querySelector(".inspiration-panel");
        const rect = panel.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          full: Math.round(rect.height),
          viewport: innerWidth,
          scrollable: document.querySelector(".inspiration-body").scrollHeight >= document.querySelector(".inspiration-body").clientHeight,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      })()`);

      const pass =
        result.button &&
        result.panel.width >= 400 &&
        result.panel.width <= 470 &&
        result.panel.right <= 12 &&
        result.cards === 3 &&
        result.context.includes("参考") &&
        result.selected === 1 &&
        result.rerollKeptSelection &&
        result.rerollChanged &&
        result.categorySwitched &&
        result.previewRows === 1 &&
        result.previewText.includes("当前") &&
        result.previewText.includes("建议") &&
        result.appliedToDraft &&
        result.storedUnchanged &&
        result.studioClosed &&
        mobile.width === mobile.viewport &&
        mobile.overflow === 0;

      return {
        pass,
        detail:
          `桌面：按钮 ${result.button}、面板 ${result.panel.width}px 贴右 ${result.panel.right}、候选 ${result.cards}、已选 ${result.selected}、` +
          `重抽保留 ${result.rerollKeptSelection}/变化 ${result.rerollChanged}、类别切换 ${result.categorySwitched}；` +
          `预览 ${result.previewRows} 行、写入草稿 ${result.appliedToDraft}、localStorage 未变 ${result.storedUnchanged}、关闭 ${result.studioClosed}；` +
          `移动：面板 ${mobile.width}/${mobile.viewport}、高 ${mobile.full}、可滚动 ${mobile.scrollable}、溢出 ${mobile.overflow}`,
      };
    });

    await check("头像：列表里的 Emoji、图片与默认头像都与容器同心", async () => {
      // Four rows, three appearances: an emoji, a picture, the default emoji and a
      // second emoji with different metrics. Measured in the dashboard's list view and
      // in the timeline dialog's character rows, because those are the two list
      // avatars the app draws at different sizes.
      const seedAvatars = `
        (async () => {
          const now = "2026-01-01T00:00:00.000Z";
          const make = (id, name, avatarEmoji, avatarAssetId) => ({
            id, name, occupation: "调查员", worldview: "北境", createdAt: now, updatedAt: now,
            ...(avatarEmoji ? { avatarEmoji } : {}),
            ...(avatarAssetId ? { avatarAssetId } : {}),
          });
          localStorage.setItem("character-studio.characters", JSON.stringify([
            make("av-1", "表情头像", "🙂"),
            make("av-2", "图片头像", "", "asset-list"),
            make("av-3", "默认头像"),
            make("av-4", "狐狸头像", "🦊"),
          ]));
          localStorage.setItem("character-studio.relationships", JSON.stringify([]));
          localStorage.setItem("character-studio.timeline", JSON.stringify([{
            id: "av-tl", title: "列表头像检查", date: "2026-01-01", kind: "origin",
            characterIds: ["av-1", "av-2", "av-3", "av-4"], createdAt: now, updatedAt: now,
          }]));
          localStorage.setItem("character-studio.world", JSON.stringify([]));
          localStorage.setItem("character-studio.about-seen", "true");
          localStorage.setItem("character-studio.dashboard-prefs", JSON.stringify({
            searchTerm: "", sortMode: "updated-desc", worldviewFilter: "全部",
            genderFilter: "全部", visualStyleFilter: "全部", favoriteMode: "all", viewMode: "list",
          }));

          const source = document.createElement("canvas");
          source.width = 64;
          source.height = 96;
          source.getContext("2d").fillStyle = "#3366cc";
          source.getContext("2d").fillRect(0, 0, 64, 96);
          const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));

          await new Promise((resolve, reject) => {
            const request = indexedDB.open("character-studio-assets", 1);
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("avatar-assets")) {
                request.result.createObjectStore("avatar-assets", { keyPath: "id" });
              }
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction("avatar-assets", "readwrite");
              transaction.objectStore("avatar-assets").put({
                id: "asset-list", type: "avatar", name: "tall.png", mimeType: "image/png",
                blob, size: blob.size, width: 64, height: 96, createdAt: now, updatedAt: now,
              });
              transaction.oncomplete = () => { db.close(); resolve(true); };
              transaction.onerror = () => reject(transaction.error);
            };
          });
          return true;
        })()
      `;

      const measure = `
        (() => {
          const centre = (rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
          const rows = [...document.querySelectorAll(window.__avatarScope || ".character-row-avatar, .table-avatar")].map((box) => {
            const outer = box.getBoundingClientRect();
            const image = box.querySelector("img");
            let inner = null;
            let kind = "";
            if (image) {
              kind = "image";
              inner = image.getBoundingClientRect();
            } else {
              const text = [...box.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
              if (!text) return null;
              kind = "emoji";
              const range = document.createRange();
              range.selectNodeContents(text);
              inner = range.getBoundingClientRect();
            }
            const a = centre(outer);
            const b = centre(inner);
            return {
              kind,
              glyph: (box.textContent || "").trim(),
              dx: Math.round((b.x - a.x) * 100) / 100,
              dy: Math.round((b.y - a.y) * 100) / 100,
              box: [Math.round(outer.width), Math.round(outer.height)],
              inner: [Math.round(inner.width), Math.round(inner.height)],
              row: Math.round((box.closest(".character-picker-option") || box.closest(".character-table-row") || box.parentElement).getBoundingClientRect().height),
              fit: image ? getComputedStyle(image).objectFit : "",
              clipped: getComputedStyle(box).overflow,
              lineHeight: getComputedStyle(box).lineHeight,
            };
          }).filter(Boolean);
          return rows;
        })()
      `;

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      await cdp.goto(base);
      await cdp.value(seedAvatars);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 500))`);
      await cdp.value(`window.__avatarScope = ".character-table .table-avatar"`);
      const listRows = await cdp.value(measure);

      // The same rows inside a dialog: open 新建事件, whose 涉及角色 list is the
      // CharacterRow presentation.
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.waitFor(`!!document.querySelector(".timeline-toolbar")`, 8000);
      await cdp.value(`window.__avatarScope = ".timeline-dialog .character-row-avatar"`);
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const create = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建事件");
        if (!create) throw new Error("新建事件 missing");
        create.click();
        await sleep(500);
        return true;
      })()`);
      const dialogRows = await cdp.value(measure);

      // Dark theme, same measurement: the alignment is a layout question, not a colour
      // one, but the two themes have different borders and backgrounds.
      await cdp.value(`localStorage.setItem("character-studio.theme", "dark")`);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 500))`);
      await cdp.value(clickWorkspace("世界观时间线"));
      await cdp.waitFor(`!!document.querySelector(".timeline-toolbar")`, 8000);
      await cdp.value(`window.__avatarScope = ".timeline-dialog .character-row-avatar"`);
      await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const create = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "新建事件");
        if (!create) throw new Error("新建事件 missing");
        create.click();
        await sleep(500);
        return true;
      })()`);
      const darkRows = await cdp.value(measure);
      await cdp.value(`localStorage.removeItem("character-studio.theme")`);

      const all = [...listRows, ...dialogRows, ...darkRows];
      const tolerance = 0.75;
      const problems = all.filter((row) =>
        Math.abs(row.dx) > tolerance ||
        Math.abs(row.dy) > tolerance ||
        row.inner[0] === 0 ||
        (row.kind === "image" && row.fit !== "cover"),
      );
      const kinds = new Set(all.map((row) => row.kind));
      // The rows themselves must not have grown to fit the avatar: every row on one
      // surface keeps the same height whether it holds an emoji or a picture.
      const sameHeight = (rows) => new Set(rows.map((row) => row.row)).size === 1;
      const rowHeights = [sameHeight(listRows), sameHeight(dialogRows), sameHeight(darkRows)];

      return {
        pass:
          listRows.length >= 4 &&
          dialogRows.length >= 4 &&
          darkRows.length >= 4 &&
          kinds.has("emoji") &&
          kinds.has("image") &&
          problems.length === 0 &&
          rowHeights.every(Boolean),
        detail:
          `列表 ${listRows.length} 个（${listRows.map((r) => r.kind + ":" + r.glyph + " d=" + r.dx + "/" + r.dy).join("、")}）；`
          + `弹窗 ${dialogRows.length} 个（${dialogRows.map((r) => r.kind + " d=" + r.dx + "/" + r.dy).join("、")}）；`
          + `深色 ${darkRows.length} 个（${darkRows.map((r) => r.kind + " d=" + r.dx + "/" + r.dy).join("、")}）；`
          + `容器 ${[...new Set(all.map((r) => r.box.join("x")))].join("/")}、行高一致 ${rowHeights.join("/")}、`
          + `图片裁切 ${[...new Set(all.filter((r) => r.kind === "image").map((r) => r.fit + "/" + r.clipped))].join("/")}；`
          + (problems.length ? `偏移 ${problems.map((r) => r.kind + " " + r.dx + "/" + r.dy).join("、")}` : "全部同心"),
      };
    });


    await check("轻量弹层：外部点击、同级切换、Escape 与焦点", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 400))`);

      const dashboard = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const q = (selector) => document.querySelector(selector);
        const filter = () => q('button[aria-label="筛选"]');
        const more = () => q('button[aria-label="更多操作"]');
        const tap = (node) => {
          node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          node.click();
        };
        const state = {};
        filter().click(); await sleep(250);
        state.opened = !!q(".dashboard-controls-panel.open");
        tap(q("h1")); await sleep(250);
        state.outsideClosed = !q(".dashboard-controls-panel.open");
        filter().click(); await sleep(250);
        tap(q(".dashboard-controls label")); await sleep(200);
        state.insideKept = !!q(".dashboard-controls-panel.open");
        more().click(); await sleep(250);
        state.siblingSwap = !q(".dashboard-controls-panel.open") && !!q(".export-menu");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(250);
        state.escapeMenu = !q(".export-menu");
        state.focusAfterMenu = (document.activeElement && document.activeElement.getAttribute("aria-label")) || "";
        filter().click(); await sleep(250);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(250);
        state.escapePanel = !q(".dashboard-controls-panel.open");
        state.focusAfterPanel = (document.activeElement && document.activeElement.getAttribute("aria-label")) || "";
        return state;
      })()`);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await cdp.value(clickWorkspace("世界观时间线"));
      const timeline = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const toggle = [...document.querySelectorAll("button")].find((button) => button.textContent.trim().startsWith("筛选"));
        toggle.click(); await sleep(250);
        const opened = !!document.querySelector(".timeline-filter-row.open");
        const title = document.querySelector("h1");
        title.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await sleep(250);
        return { opened, closed: !document.querySelector(".timeline-filter-row.open") };
      })()`);

      await cdp.value(clickWorkspace("世界观管理"));
      const world = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const toggle = [...document.querySelectorAll("button")].find((button) => button.textContent.trim().startsWith("筛选"));
        toggle.click(); await sleep(250);
        const opened = !!document.querySelector(".world-filter-row.open");
        const title = document.querySelector("h1");
        title.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await sleep(250);
        return { opened, closed: !document.querySelector(".world-filter-row.open") };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const pass =
        dashboard.opened && dashboard.outsideClosed && dashboard.insideKept &&
        dashboard.siblingSwap && dashboard.escapeMenu && dashboard.escapePanel &&
        dashboard.focusAfterMenu === "更多操作" && dashboard.focusAfterPanel === "筛选" &&
        timeline.opened && timeline.closed && world.opened && world.closed;

      return {
        pass,
        detail: `Dashboard：打开 ${dashboard.opened}、外部关闭 ${dashboard.outsideClosed}、内部保留 ${dashboard.insideKept}、`
          + `同级切换 ${dashboard.siblingSwap}、Escape 菜单 ${dashboard.escapeMenu}（焦点 ${dashboard.focusAfterMenu || "无"}）、`
          + `Escape 面板 ${dashboard.escapePanel}（焦点 ${dashboard.focusAfterPanel || "无"}）；`
          + `375 时间线 打开 ${timeline.opened} / 外部关闭 ${timeline.closed}；世界观 打开 ${world.opened} / 外部关闭 ${world.closed}`,
      };
    });

    await check("Tooltip：贴近触发控件、边缘不溢出、键盘可达", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 720, deviceScaleFactor: 2, mobile: true });
      await cdp.goto(base);
      await cdp.value(SEED_MANY);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 500))`);

      const hover = async (selector) => {
        const rect = await cdp.value(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)});
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
        })()`);
        if (!rect) throw new Error("trigger missing: " + selector);
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, buttons: 0 });
        await new Promise((resolve) => setTimeout(resolve, 450));
        return cdp.value(`(() => {
          const tip = document.querySelector(".app-tooltip");
          const trigger = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          if (!tip) return null;
          const box = tip.getBoundingClientRect();
          return {
            text: tip.textContent,
            placement: tip.dataset.placement,
            gap: Math.round((box.top - trigger.bottom) * 10) / 10,
            inside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
            covers: box.left < trigger.right && box.right > trigger.left && box.top < trigger.bottom && box.bottom > trigger.top,
          };
        })()`);
      };

      const toolbar = await hover('button[aria-label="更多操作"]');
      // The search control lost its own tooltip when it became WorkspaceSearch: it now
      // shows the word 搜索 next to the icon (aria-label 搜索角色), so a tooltip would
      // repeat the visible text. The keyboard path is therefore checked on 更多操作 --
      // still icon-only, still labelled, still the case this check exists to protect.
      // Nothing here is a synthetic key press: the element is focused, and whether the
      // tooltip appears is read back from the DOM.
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const keyboard = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const button = document.querySelector('button[aria-label="更多操作"]');
        if (!button) throw new Error("更多操作 button missing");
        button.focus();
        await sleep(300);
        const tip = document.querySelector(".app-tooltip");
        return tip ? tip.textContent : "";
      })()`);

      // The floating action sits at the bottom of the window, so its label has to
      // flip. It is a desktop affordance; a phone reaches the same place by scrolling.
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 720, deviceScaleFactor: 1, mobile: false });
      await cdp.value(`window.scrollTo(0, document.documentElement.scrollHeight)`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const floating = await hover(".floating-action");

      return {
        pass: Boolean(
          toolbar && toolbar.text === "更多操作" && toolbar.placement === "bottom" &&
          toolbar.gap >= 5 && toolbar.gap <= 8 && toolbar.inside && !toolbar.covers &&
          keyboard === "更多操作" &&
          Boolean(floating) && floating.placement === "top" && floating.inside && !floating.covers,
        ),
        detail: `320px 更多操作：${toolbar ? toolbox(toolbar) : "无提示"}；键盘聚焦更多操作：${keyboard || "无提示"}；`
          + `贴底浮动按钮：${floating ? toolbox(floating) : "未出现"}`,
      };

      function toolbox(state) {
        return `「${state.text}」${state.placement}、间距 ${state.gap}px、在视口内 ${state.inside}、遮挡触发 ${state.covers}`;
      }
    });


    await check("编辑器：世界观与视觉风格可自由填写、保存后回显", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.goto(base);
      await cdp.value(SEED);
      // Earlier checks leave the dashboard on whichever view they needed; this check
      // opens a card, so it states the view it depends on instead of inheriting one.
      await cdp.value(`localStorage.setItem("character-studio.dashboard-prefs", JSON.stringify({
        searchTerm: "", sortMode: "updated-desc", worldviewFilter: "全部",
        genderFilter: "全部", visualStyleFilter: "全部", favoriteMode: "all", viewMode: "cards",
      }))`);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 400))`);

      const save = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setValue = (node, value) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(node, value);
          node.dispatchEvent(new Event("input", { bubbles: true }));
        };
        document.querySelector(".card-title-button").click();
        await sleep(500);
        const edit = document.querySelector('button[aria-label="编辑"]');
        if (!edit) throw new Error("编辑 button missing");
        edit.click();
        await sleep(700);

        const world = document.querySelector('input[aria-label="世界观，可直接输入自定义名称"]');
        const style = document.querySelector('input[aria-label="视觉风格，可直接输入自定义名称"]');
        if (!world || !style) throw new Error("combo inputs missing");
        setValue(world, "自定义界域·测试");
        setValue(style, "自定义风格·测试");
        await sleep(300);

        const saveButton = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "保存角色");
        if (!saveButton) throw new Error("保存角色 button missing");
        saveButton.click();
        await sleep(1000);

        const stored = JSON.parse(localStorage.getItem("character-studio.characters") || "[]")
          .find((entry) => entry.id === "seed-1") || {};
        return { worldview: stored.worldview || "", visualStyle: stored.visualStyle || "" };
      })()`);

      const reopened = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const edit = document.querySelector('button[aria-label="编辑"]');
        if (!edit) throw new Error("编辑 button missing after save");
        edit.click();
        await sleep(700);
        const world = document.querySelector('input[aria-label="世界观，可直接输入自定义名称"]');
        const style = document.querySelector('input[aria-label="视觉风格，可直接输入自定义名称"]');
        return {
          worldview: world ? world.value : "",
          visualStyle: style ? style.value : "",
          editable: Boolean(world && !world.disabled && !world.readOnly && style && !style.disabled && !style.readOnly),
        };
      })()`);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const narrow = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const world = document.querySelector('input[aria-label="世界观，可直接输入自定义名称"]');
        world.scrollIntoView({ block: "center" });
        await sleep(350);
        const box = world.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          inside: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0,
          width: Math.round(box.width),
          hit: hit === world || Boolean(hit && hit.contains(world)),
        };
      })()`);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const pass =
        save.worldview === "自定义界域·测试" &&
        save.visualStyle === "自定义风格·测试" &&
        reopened.worldview === save.worldview &&
        reopened.visualStyle === save.visualStyle &&
        reopened.editable &&
        narrow.inside && narrow.width >= 80 && narrow.hit;

      return {
        pass,
        detail: `保存后存储：世界观「${save.worldview || "空"}」、视觉风格「${save.visualStyle || "空"}」；`
          + `再次打开：世界观「${reopened.worldview || "空"}」、视觉风格「${reopened.visualStyle || "空"}」、可编辑 ${reopened.editable}；`
          + `375px 输入框宽 ${narrow.width}px、在视口内 ${narrow.inside}、命中 ${narrow.hit}`,
      };
    });


    await check("动效：按压反馈存在，prefers-reduced-motion 下不播动画", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await cdp.goto(base);
      await cdp.value(SEED);
      // SEED does not dismiss 使用指南, and its hero sits over the whole dashboard
      // toolbar: the press below used to land on `.first-about-hero`, so "no press
      // feedback" was a statement about a card, not about the button.
      await cdp.value(`localStorage.setItem("character-studio.about-seen", "true")`);
      await cdp.goto(base);
      await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 400))`);

      const PRESS_STATE = `(() => {
        const button = document.querySelector('button[aria-label="筛选"]');
        if (!button) return null;
        const style = getComputedStyle(button);
        return {
          background: style.backgroundColor,
          transform: style.transform,
          transition: style.transitionProperty + "/" + style.transitionDuration,
          // Which of the two the press actually changes is decided by measuring, not
          // by assuming every button presses the same way.
          durations: Object.fromEntries(style.transitionProperty.split(",").map((name, index) => [
            name.trim(),
            style.transitionDuration.split(",")[index]?.trim() ?? "",
          ])),
        };
      })()`;

      const resting = await cdp.value(PRESS_STATE);
      if (!resting) throw new Error("筛选按钮不存在");

      // A real press: mousedown lands the :active state, and the click that opens the
      // panel only happens on mouseup, so this does not disturb the panel assertions.
      const box = await cdp.value(`(() => {
        const r = document.querySelector('button[aria-label="筛选"]').getBoundingClientRect();
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: hit ? hit.tagName + "." + String(hit.getAttribute("class") || "") : "none", expanded: document.querySelector('button[aria-label="筛选"]').getAttribute("aria-expanded") };
      })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 40));
      const pressed = await cdp.value(PRESS_STATE);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const changedByFill = Boolean(pressed) && pressed.background !== resting.background;
      const changedByMove = Boolean(pressed) && pressed.transform !== resting.transform;
      // Whichever it is, the property that moves has to be the one being animated.
      const changedKey = changedByFill ? "background" : changedByMove ? "transform" : null;

      // Two ticks: the click sets React state, and reading the panel in the same
      // evaluation reads the DOM before the re-render.
      const opened = await cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const button = document.querySelector('button[aria-label="筛选"]');
        if (button.getAttribute("aria-expanded") !== "true") button.click();
        await sleep(120);
        const panel = document.querySelector(".dashboard-controls-panel.open");
        return panel ? getComputedStyle(panel).animationDuration : "";
      })()`);

      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      const reduced = await cdp.value(`(() => {
        const panel = document.querySelector(".dashboard-controls-panel.open");
        const button = document.querySelector('button[aria-label="筛选"]');
        const style = getComputedStyle(button);
        const durations = Object.fromEntries(style.transitionProperty.split(",").map((name, index) => [
          name.trim(),
          style.transitionDuration.split(",")[index]?.trim() ?? "",
        ]));
        return { animation: panel ? getComputedStyle(panel).animationDuration : "", durations };
      })()`);
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });

      // Computed durations come back in seconds ("0.15s"); the thresholds are in ms.
      const ms = (value) => {
        const number = parseFloat(value) || 0;
        return String(value).trim().endsWith("ms") ? number : number * 1000;
      };
      // `background` in the rule lands in the computed list as `background-color`; the
      // duration has to be looked up by prefix, or a 150ms fade reads as 0ms.
      const durationFor = (durations, key) =>
        durations[key] ?? Object.entries(durations).find(([name]) => name.startsWith(key))?.[1] ?? "";
      const normalPressMs = changedKey ? ms(durationFor(resting.durations, changedKey)) : 0;
      const reducedPressMs = changedKey ? ms(durationFor(reduced.durations, changedKey)) : 0;

      const conditions = {
        按压改变了外观: changedByFill || changedByMove,
        常态下按压有过渡: normalPressMs > 20,
        面板入场有动画: ms(opened) >= 100 && ms(opened) <= 250,
        reduced下按压无过渡: reducedPressMs <= 1,
        reduced下面板无动画: ms(reduced.animation) <= 1,
      };
      const failing = Object.entries(conditions).filter(([, ok]) => !ok).map(([name]) => name);

      return {
        pass: failing.length === 0,
        detail: `筛选按钮 ${resting.transition}；按下时底色 ${resting.background}→${pressed?.background}、位移 ${resting.transform}→${pressed?.transform}；`
          + `变化项 ${changedKey ?? "无"} 常态 ${normalPressMs}ms / reduced ${reducedPressMs}ms；`
          + `按压点 ${box.x},${box.y} 命中 ${box.hit}（展开 ${box.expanded}）；筛选面板 ${opened} → reduced ${reduced.animation}`
          + (failing.length ? `；不成立：${failing.join("、")}` : ""),
      };
    });

    await check("布局：时间线阅读列居中、世界观分栏与正文行宽", async () => {
      const nav = async (label) => cdp.value(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector(".workspace-switch").click();
        await sleep(350);
        const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent.includes(${JSON.stringify(label)}));
        if (!button) throw new Error("nav missing");
        button.click();
        await sleep(900);
        return true;
      })()`);

      const snapshots = [];
      for (const width of [1440, 1920]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width === 1440 ? 900 : 1080, deviceScaleFactor: 1, mobile: false });
        await cdp.goto(base);
        await cdp.value(SEED);
        await cdp.value(`localStorage.setItem("character-studio.world", JSON.stringify([{
          id: "w-layout", name: "测试大陆", category: "location",
          summary: "一段用来检查行宽的摘要，足够长以触发换行。",
          details: "潮汐失衡之后，沿海聚落各自收缩，形成今天互相试探的格局。这一段刻意写得足够长，用来验证详情正文的行宽上限是否生效，而不是一路铺到容器边缘。",
          tags: [], characterIds: [],
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        }]))`);
        // A long description, because 行宽 is a claim about prose: the seeded event has
        // none, so measuring the container was the only thing the old check could do.
        await cdp.value(`localStorage.setItem("character-studio.timeline", JSON.stringify([{
          id: "tl-layout", title: "潮汐失衡与沿海收缩", date: "2026-03-02", kind: "conflict",
          characterIds: [], location: "北境海岸",
          description: ${JSON.stringify("潮汐失衡之后，沿海聚落各自收缩，形成今天互相试探的格局。".repeat(12))},
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        }]))`);
        await cdp.goto(base);
        await cdp.value(`new Promise((resolve) => setTimeout(() => resolve(true), 600))`);
        await nav("世界观时间线");

        const timeline = await cdp.value(`(() => {
          const section = document.querySelector(".timeline-page");
          const workspace = section.getBoundingClientRect();
          const header = section.querySelector(".workspace-header");
          const column = [...section.children].find((node) => !node.classList.contains("workspace-header"));
          const box = column.getBoundingClientRect();
          return {
            left: +(box.left - workspace.left).toFixed(2),
            right: +(workspace.right - box.right).toFixed(2),
            width: +box.width.toFixed(1),
            headerLeft: +(header.getBoundingClientRect().left - workspace.left).toFixed(1),
            innerLeft: +(header.firstElementChild ? header.firstElementChild.getBoundingClientRect().left - workspace.left : 0).toFixed(1),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            // The container and the prose are two different widths. A 1120px card is the
            // workspace; what a reader's eye has to track back is the line of text in it,
            // so measure the text elements and state both.
            // The long-text element specifically. A title is capped in ch of its own
            // (larger) font, so taking the widest of the three mixes two measures.
            prose: (() => {
              const node = section.querySelector(".timeline-description");
              return node ? +node.getBoundingClientRect().width.toFixed(1) : 0;
            })(),
            proseCount: section.querySelectorAll(".timeline-description, .timeline-card-title, .timeline-meta").length,
            proseFont: (() => {
              const node = section.querySelector(".timeline-description");
              return node ? +parseFloat(getComputedStyle(node).fontSize).toFixed(2) : 0;
            })(),
            proseMaxWidth: (() => {
              const node = section.querySelector(".timeline-description");
              return node ? getComputedStyle(node).maxWidth : "";
            })(),
            perLine: [...section.querySelectorAll(".timeline-description, .timeline-card-title, .timeline-meta")]
              .map((node) => {
                const style = getComputedStyle(node);
                return node.className.replace("timeline-", "") + ":" + Math.round(node.getBoundingClientRect().width) + "/" + style.maxWidth;
              })
              .slice(0, 4),
          };
        })()`);

        await nav("世界观管理");
        const world = await cdp.value(`(() => {
          const explorer = document.querySelector(".world-explorer");
          const columns = getComputedStyle(explorer).gridTemplateColumns.split(" ").map((value) => parseFloat(value));
          const detail = document.querySelector(".world-detail");
          const body = document.querySelector(".world-detail-body") || document.querySelector(".world-detail-section p");
          const section = document.querySelector(".world-page");
          const workspace = section.getBoundingClientRect();
          return {
            sidebar: +columns[0].toFixed(0),
            gap: parseFloat(getComputedStyle(explorer).columnGap),
            detail: +detail.getBoundingClientRect().width.toFixed(0),
            body: body ? +body.getBoundingClientRect().width.toFixed(0) : 0,
            bodyText: body ? body.textContent.slice(0, 12) : "",
            bodyFont: parseFloat(getComputedStyle(body || detail).fontSize),
            // Measured against the explorer, not the page: the reading guide now sits
            // under the work as a line of the page, so page-bottom would count the
            // guide as empty space below the detail. The question this answers is still
            // "does the detail pane leave a large blank under its own content".
            bottom: +(
              (explorer.getBoundingClientRect().bottom - detail.getBoundingClientRect().bottom) || 0
            ).toFixed(0),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);

        snapshots.push({ width, timeline, world });
      }
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const failures = [];
      for (const snapshot of snapshots) {
        const { timeline, world } = snapshot;
        // The card is the workspace now; the measure is the line of prose inside it.
        // Asserting on the card's width instead made a 1120px card look like a 1120px
        // line of text, and would have been "fixed" by narrowing the whole page.
        if (Math.abs(timeline.left - timeline.right) > 2) failures.push(`${snapshot.width}: 阅读列不居中`);
        if (timeline.overflow > 0) failures.push(`${snapshot.width}: 时间线横向溢出`);
        if (timeline.proseCount < 3) failures.push(`${snapshot.width}: 只量到 ${timeline.proseCount} 段正文，行宽结论不可用`);
        // 46-odd CJK glyphs at 14.4px is the shipped measure; the band guards both a
        // runaway line and a column squeezed to nothing.
        const charsPerLine = timeline.prose / (timeline.proseFont || 1);
        if (charsPerLine > 50) failures.push(`${snapshot.width}: 正文每行约 ${charsPerLine.toFixed(0)} 字，过宽`);
        if (charsPerLine < 26) failures.push(`${snapshot.width}: 正文每行约 ${charsPerLine.toFixed(0)} 字，过窄`);
        if (!(timeline.prose > 0) || timeline.prose > timeline.width - 80) {
          failures.push(`${snapshot.width}: 正文 ${timeline.prose} 未比卡片 ${timeline.width} 收窄`);
        }
        if (world.sidebar !== 320) failures.push(`${snapshot.width}: 左栏 ${world.sidebar}`);
        if (world.gap !== 20) failures.push(`${snapshot.width}: 分栏间距 ${world.gap}`);
        // --container-form is the token the detail pane is capped by; 720 was a number
        // nobody could point at a rule for, and it failed by ten pixels.
        if (world.detail > 760) failures.push(`${snapshot.width}: 详情 ${world.detail}`);
        if (world.body > world.bodyFont * 46 + 2) failures.push(`${snapshot.width}: 正文 ${world.body}`);
        if (world.overflow > 0) failures.push(`${snapshot.width}: 世界观横向溢出`);
        if (world.bottom > 60) failures.push(`${snapshot.width}: 详情下方空白 ${world.bottom}`);
      }

      return {
        pass: failures.length === 0,
        detail: snapshots.map((snapshot) =>
          `${snapshot.width}：左右 ${snapshot.timeline.left}/${snapshot.timeline.right}、列宽 ${snapshot.timeline.width}、`
          + `标题内缘 ${snapshot.timeline.innerLeft}、卡片 ${snapshot.timeline.width}、正文 ${snapshot.timeline.prose}（每行约 ${(snapshot.timeline.prose / (snapshot.timeline.proseFont || 1)).toFixed(0)} 字，字号 ${snapshot.timeline.proseFont}，上限 ${snapshot.timeline.proseMaxWidth}）；世界观 ${snapshot.world.sidebar}+${snapshot.world.detail}（间距 ${snapshot.world.gap}）、`
          + `正文 ${snapshot.world.body}（字号 ${snapshot.world.bodyFont}，「${snapshot.world.bodyText}」）、下方空白 ${snapshot.world.bottom}`,
        ).join(" ｜ ") + (failures.length ? `；问题：${failures.join("、")}` : ""),
      };
    });

    await check("窄屏（375）：后退同样恢复工作区页面", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 800,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.value(clickWorkspace("世界观时间线"));
      const step = await cdp.value(goBack("relationships"));
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      return { pass: step.pass, detail: `375px 下 back→${step.page}（期望 relationships）` };
    });
  } finally {
    cleanup();
  }

  runRecord.finishedAt = new Date().toISOString();
  runRecord.finished = true;
  runRecord.counts.executed = runRecord.checks.length;
  runRecord.counts.notAssigned = runRecord.notAssigned.length;
  runRecord.counts.skipped = skipped.length;
  runRecord.counts.pass = runRecord.checks.filter((check) => check.status === "PASS").length;
  runRecord.counts.fail = runRecord.checks.filter((check) => check.status === "FAIL").length;
  runRecord.counts.timeout = runRecord.checks.filter((check) => check.status === "TIMEOUT").length;
  flush();

  if (plan.shardTotal > 0) {
    console.log(
      `\n分段 ${plan.shardIndex}/${plan.shardTotal}：执行 ${runRecord.counts.executed} 项、`
        + `本段的其余检查 ${runRecord.counts.notAssigned} 项归其他分段；`
        + `结果写入 ${shardFile}`,
    );
  }

  console.log("\n浏览器验证（真实 Chrome，Pages 子路径构建）\n");
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}\n      ${result.detail}`);
  }

  const failed = results.filter((result) => !result.pass).length;
  console.log(
    `\n${results.length - failed}/${results.length} 通过`
      // The effective filter, whichever way it arrived: a summary that says
      // "ONLY=undefined" under `--only=` hides which subset actually ran.
      + (skipped.length ? `（ONLY=${activeOnly}：跳过 ${skipped.length} 项，不计为通过）` : ""),
  );
  process.exit(failed === 0 && skipped.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify:browser 无法运行：", error.message);
  process.exit(2);
});
