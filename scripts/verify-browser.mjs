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
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(root, "dist");
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    if (document.querySelector(".intro-panel")) return "dashboard";
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
    await sleep(200);
    const item = [...document.querySelectorAll('button[role="menuitem"]')].find((button) =>
      button.textContent.includes(${JSON.stringify(label)}),
    );
    if (!item) throw new Error("menu item missing: " + ${JSON.stringify(label)});
    item.click();
    await sleep(700);
    return true;
  })()
`;

// Opens the app-level clear through the route a user takes: any page but the
// dashboard shows the footer, and the footer holds the Settings entry.
const OPEN_CLEAR_DIALOG = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const settings = [...document.querySelectorAll("footer button")].find((button) => /Settings/.test(button.textContent));
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
    return true;
  })()
`;

const READ_GRAPH_CANVAS = `
  (() => {
    const nodes = [...document.querySelectorAll(".relationship-node")];
    const names = nodes.map((node) => node.querySelector(".relationship-node-name")?.textContent || "");
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
      zoom: (document.querySelector(".graph-zoom-value")?.textContent || "").trim(),
      transform: document.querySelector(".relationship-canvas > g")?.getAttribute("transform") || "",
      canvasWidth: rect ? Math.round(rect.width) : 0,
      nameFontPx: named ? getComputedStyle(named.querySelector(".relationship-node-name")).fontSize : "",
      viewportWidth: window.innerWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()
`;

// The node's own screen centre, so a hover can be sent where the circle actually is.
const graphNodeCentre = (name) => `
  (() => {
    const node = [...document.querySelectorAll(".relationship-node")].find(
      (candidate) => candidate.querySelector(".relationship-node-name")?.textContent.trim() === ${JSON.stringify(name)},
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
    const results = () =>
      [...document.querySelectorAll(".graph-search-panel .character-picker-option")].map((option) => ({
        name: option.querySelector(".character-row-name")?.textContent || "",
        avatar: Boolean(option.querySelector(".character-row-avatar")?.getAttribute("data-avatar-image") === "true" || option.querySelector(".character-row-avatar")),
        state: (option.querySelector(".graph-search-state")?.textContent || "").trim(),
      }));

    const field = document.querySelector(".graph-search-field input");
    if (!field) throw new Error("graph search field missing");

    const read = async (needle) => {
      setValue(field, needle);
      await sleep(300);
      return results();
    };

    const byName = await read("沈青梧");
    const byJob = await read("工匠");
    const byWorld = await read("云海");
    const namesBefore = [...document.querySelectorAll(".relationship-node-name")].map((node) => node.textContent.trim());
    const before = {
      transform: document.querySelector(".relationship-canvas > g")?.getAttribute("transform") || "",
      zoom: (document.querySelector(".graph-zoom-value")?.textContent || "").trim(),
    };

    // Search the name once more before choosing, so the option taken is the one this
    // check is about rather than whatever the last search left in the panel.
    await read("沈青梧");
    const chosen = [...document.querySelectorAll(".graph-search-panel .character-picker-option")][0];
    chosen.click();
    await sleep(500);

    const focusedName = (document.querySelector(".relationship-node.focused .relationship-node-name") || {}).textContent || "";
    const focused = {
      name: focusedName.trim(),
      focusedCount: document.querySelectorAll(".relationship-node.focused").length,
      names: [...document.querySelectorAll(".relationship-node-name")].map((node) => node.textContent.trim()),
      dimmedNames: [...document.querySelectorAll(".relationship-node")].filter((node) => node.classList.contains("dimmed")).map((node) => node.querySelector(".relationship-node-name")?.textContent?.trim() || "（无名称）"),
      activeEdges: document.querySelectorAll(".relationship-edge.active").length,
      panelClosed: !document.querySelector(".graph-search-panel"),
      chip: (document.querySelector(".graph-focus-chip")?.textContent || "").trim(),
      transform: document.querySelector(".relationship-canvas > g")?.getAttribute("transform") || "",
      zoom: (document.querySelector(".graph-zoom-value")?.textContent || "").trim(),
    };

    // Escape is the keyboard way out; the chip is the visible one.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(300);
    const afterEscape = {
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

    const field = document.querySelector(".graph-search-field input");
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
        focused: (document.querySelector(".relationship-node.focused .relationship-node-name") || {}).textContent || "",
        notice: Boolean(document.querySelector(".graph-notice")),
        storedRelationships: JSON.parse(localStorage.getItem("character-studio.relationships") || "[]").length,
        storedCharacters: JSON.parse(localStorage.getItem("character-studio.characters") || "[]").length,
      },
    };
  })()
`;

// The display switches and the export buttons, driven and read back.
const GRAPH_DISPLAY_AND_EXPORT = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickText = (text) => {
      const button = [...document.querySelectorAll(".graph-panel button")].find(
        (candidate) => candidate.textContent.trim() === text,
      );
      if (!button) throw new Error("panel button missing: " + text);
      button.click();
    };
    const counts = () => ({
      names: document.querySelectorAll(".relationship-node-name").length,
      images: document.querySelectorAll(".relationship-node-image").length,
      emojis: document.querySelectorAll(".relationship-node-emoji").length,
    });

    const toggle = [...document.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "显示设置",
    );
    if (!toggle) throw new Error("显示设置 missing");
    toggle.click();
    await sleep(250);

    const panel = document.querySelector(".graph-panel");
    const panelRect = panel?.getBoundingClientRect();
    const opened = {
      present: Boolean(panel),
      rows: [...document.querySelectorAll(".graph-panel-row")].map((row) => row.textContent.replace(/\\s+/g, " ").trim()),
      insideViewport: panelRect ? panelRect.left >= -1 && panelRect.right <= window.innerWidth + 1 && panelRect.top >= -1 : false,
      namesBefore: counts().names,
    };

    clickText("隐藏");
    await sleep(250);
    const namesHidden = counts();
    clickText("显示");
    await sleep(250);
    const namesBack = counts().names;

    // The avatar row is the second one: its 隐藏 is the second 隐藏 button in the panel.
    [...document.querySelectorAll(".graph-panel button")].filter((button) => button.textContent.trim() === "隐藏")[1].click();
    await sleep(250);
    const avatarsHidden = counts();
    [...document.querySelectorAll(".graph-panel button")].filter((button) => button.textContent.trim() === "显示")[1].click();
    await sleep(250);
    const avatarsBack = counts();

    toggle.click();
    await sleep(200);
    const closed = !document.querySelector(".graph-panel");

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
    for (const format of ["JPG", "PNG", "PDF"]) {
      const button = [...document.querySelectorAll(".graph-canvas-bar button")].find(
        (candidate) => candidate.textContent.trim() === format,
      );
      if (!button) throw new Error("export button missing: " + format);
      // Each format starts from an empty node, so a message can only be its own.
      await waitForClear(6000);
      button.click();
      messages.push((await waitForMessage(30000)) || "（没有结果提示）");
    }

    return { opened, namesHidden, namesBack, avatarsHidden, avatarsBack, closed, messages };
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
  (() => {
    const card = [...document.querySelectorAll("article")].find((article) => article.querySelector(".related-characters"));
    const chips = card ? [...card.querySelectorAll(".related-chip")] : [];
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
    const toggle = document.querySelector('button[aria-label="切换列表视图"]');
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
    const settings = [...document.querySelectorAll("footer button")].find((button) => /Settings/.test(button.textContent));
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
    const pending = dialog.querySelector(".settings-group-pending");
    const live = dialog.querySelector(".settings-group:not(.settings-group-pending)");
    const liveCard = live && live.querySelector(".settings-grid article");
    const pendingCard = pending && pending.querySelector(".settings-grid article");
    const background = (node) => (node ? getComputedStyle(node).backgroundColor : "");
    return {
      open: true,
      labels: [...dialog.querySelectorAll(".settings-group-label")].map((node) => node.textContent.trim()),
      liveCards: live ? texts(live) : [],
      pendingCards: pending ? texts(pending) : [],
      englishLeft: /Appearance|About Data|Coming Soon|Connection Test|Follow System/.test(dialog.textContent),
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogWidth: Math.round(dialog.getBoundingClientRect().width),
      viewportWidth: window.innerWidth,
      liveCardBackground: background(liveCard),
      pendingCardBackground: background(pendingCard),
      dialogBackground: background(dialog),
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

    const check = async (name, run) => {
      try {
        const detail = await run();
        results.push({ name, pass: detail.pass, detail: detail.detail });
      } catch (error) {
        results.push({ name, pass: false, detail: String(error.message ?? error) });
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

      const liveOk =
        state.open &&
        state.labels.includes("可用设置") &&
        state.liveCards.includes("主题外观") &&
        state.liveCards.includes("数据与存储") &&
        !state.englishLeft;
      const pendingOk =
        state.labels.includes("未发布功能") &&
        state.pendingCards.includes("AI 设置") &&
        !state.liveCards.includes("AI 设置");
      // Kept apart visually as well, not only in the markup.
      const layered = state.liveCardBackground !== state.pendingCardBackground;

      return {
        pass: Boolean(liveOk && pendingOk && layered && state.dialogOverflow <= 1 && state.pageOverflow <= 1),
        detail: `分组 ${state.labels.join(" / ")}；可用卡片 ${state.liveCards.join(" / ")}；未发布卡片 ${state.pendingCards.join(" / ") || "（开关关闭）"}；英文残留 ${state.englishLeft ? "有" : "无"}；弹窗 ${state.dialogWidth}px（视口 ${state.viewportWidth}px）溢出 ${state.dialogOverflow}px，页面溢出 ${state.pageOverflow}px；可用卡底 ${state.liveCardBackground} vs 未发布卡底 ${state.pendingCardBackground}`,
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

    await check("关系网：节点默认显示名称，悬停给出职业/世界观/关系数（任务 A）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
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
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(centre.x), y: Math.round(centre.y), buttons: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(centre.x), y: Math.round(centre.y), button: "left", clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const opened = await cdp.value(
        `({ page: ${PAGE_IDS}, showsName: document.body.textContent.includes("沈青梧"), tapTarget: window.__tapTarget || "(没有 click 事件)" })`,
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
        pass: Boolean(named && pictureDrawn && emojiDrawn && cardOk && opened.page === "preview" && opened.showsName && state.pageOverflow <= 1),
        detail: `节点 ${state.nodeCount} 个、显示名称 ${state.names.join("/")}；图片头像 ${state.imageCount} 个（clipPath ${state.clipCount}、href ${state.imageHref}…）、Emoji 头像 ${state.emojiCount} 个；字号 ${state.nameFontPx}、适配 ${state.zoom}、横向溢出 ${state.pageOverflow}px；悬停卡片 ${card.present ? "有" : "无"}：${card.text}（框内 ${!card.overflowsLeft && !card.overflowsRight}、不在截图内 ${card.outsideFrame}）；点击节点 → ${opened.page}（显示角色名 ${opened.showsName}、click 目标 ${opened.tapTarget}）`,
      };
    });

    await check("关系网：400 个角色下搜索定位、聚焦高亮与退出聚焦（任务 B）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH_LARGE);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".graph-search-field input")`, 8000);
      const sketch = await cdp.value(READ_GRAPH_CANVAS);
      const state = await cdp.value(GRAPH_SEARCH_AND_FOCUS);

      // Four hundred nodes and not one name at fit, which is what makes the rest of this
      // check mean something: the names that appear afterwards appear because of the
      // focus, not because they were always there.
      const startingPoint = sketch.nodeCount === 400 && sketch.names.length === 0;

      const searchOk =
        state.byName.length === 1 &&
        state.byName[0].name === "沈青梧" &&
        state.byName[0].avatar &&
        state.byJob.length > 1 &&
        state.byWorld.length > 1 &&
        state.byWorld.every((entry) => entry.name);
      // 沈青梧 sits between 陆停云 and 角色089 in the chain: exactly three names are on
      // the canvas — the focused character and its two direct connections — its two
      // edges are lit, and the other 397 nodes are dimmed.
      const focusOk =
        state.focused.name === "沈青梧" &&
        state.focused.focusedCount === 1 &&
        state.focused.activeEdges === 2 &&
        state.focused.names.length === 3 &&
        state.focused.names.includes("沈青梧") &&
        state.focused.names.includes("陆停云") &&
        state.focused.names.includes("角色089") &&
        state.focused.dimmedNames.length === 397 &&
        state.focused.panelClosed &&
        state.focused.chip.includes("沈青梧") &&
        state.focused.transform !== state.before.transform;
      const escapeOk =
        state.afterEscape.focusedCount === 0 &&
        state.afterEscape.dimmedCount === 0 &&
        state.afterEscape.activeEdges === 0 &&
        !state.afterEscape.chip;

      return {
        pass: Boolean(startingPoint && searchOk && focusOk && escapeOk),
        detail: `画布 ${sketch.nodeCount} 个节点、适配时名称 ${state.namesBefore.length} 个；按名 命中 ${state.byName.length}（${state.byName.map((entry) => entry.name).join("/")}）、按职业 命中 ${state.byJob.length}、按世界观 命中 ${state.byWorld.length}；聚焦 ${state.focused.name}（节点 ${state.focused.focusedCount}、高亮关系线 ${state.focused.activeEdges}、聚焦后名称 ${state.focused.names.join("/")}、变暗 ${state.focused.dimmedNames.length} 个）、平移 ${state.before.transform} → ${state.focused.transform}、缩放 ${state.before.zoom} → ${state.focused.zoom}、聚焦标 ${state.focused.chip}；Escape 后 聚焦 ${state.afterEscape.focusedCount} / 变暗 ${state.afterEscape.dimmedCount} / 高亮线 ${state.afterEscape.activeEdges} / 聚焦标 ${state.afterEscape.chip ? "仍在" : "已消失"}`,
      };
    });

    await check("关系网：画布外的角色有明确提示与查看方式，不静默失败（任务 B）", async () => {
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".graph-search-field input")`, 8000);
      const state = await cdp.value(GRAPH_SEARCH_OFF_CANVAS);

      const told =
        state.state === "不在画布" &&
        state.before.notice.includes("文森特·梵高") &&
        state.before.notice.includes("还没有任何关系") &&
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

    await check("关系网：显示设置只含生效开关，导出三种格式无报错（任务 D）", async () => {
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".graph-canvas-bar")`, 8000);
      const state = await cdp.value(GRAPH_DISPLAY_AND_EXPORT);

      const panelOk =
        state.opened.present &&
        state.opened.rows.join("|").includes("名称显示隐藏") &&
        state.opened.rows.join("|").includes("头像显示隐藏") &&
        state.opened.insideViewport;
      const switched =
        state.namesHidden.names === 0 &&
        state.namesBack === 5 &&
        state.avatarsHidden.images === 0 &&
        state.avatarsHidden.emojis === 0 &&
        state.avatarsBack.images === 1 &&
        state.avatarsBack.emojis === 4;
      const exported = state.messages.map((message) => message.replace(" 已导出", "")).join("/") === "JPG/PNG/PDF";

      return {
        pass: Boolean(panelOk && switched && exported && state.closed),
        detail: `面板 ${state.opened.present ? "已打开" : "未打开"}（在视口内 ${state.opened.insideViewport}）：${state.opened.rows.join("；")}；名称 隐藏后 ${state.namesHidden.names} 个 → 恢复 ${state.namesBack} 个；头像 隐藏后 图片 ${state.avatarsHidden.images} / Emoji ${state.avatarsHidden.emojis} → 恢复 ${state.avatarsBack.images} / ${state.avatarsBack.emojis}；导出结果「${state.messages.join("」「")}」`,
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

    await check("关系网：375px 下默认就能读到名称，且无横向溢出（任务 C）", async () => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.goto(base);
      await cdp.value(SEED_GRAPH);
      await cdp.goto(base);
      await cdp.value(clickWorkspace("角色关系网"));
      await cdp.waitFor(`!!document.querySelector(".relationship-canvas")`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const state = await cdp.value(READ_GRAPH_CANVAS);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      // Starting zoomed in enough to read a name is the narrow-screen version of "fit":
      // at the fitted scale a phone gives a twelve-character wheel seven-pixel names.
      const zoomed = Number(state.zoom.replace("%", "")) >= 100;
      const readable = state.names.length === state.nodeCount && state.names.length > 0;
      const fits = state.canvasWidth <= state.viewportWidth && state.pageOverflow <= 1;

      return {
        pass: Boolean(zoomed && readable && fits && state.imageCount === 1),
        detail: `375px：节点 ${state.nodeCount}、名称 ${state.names.length} 个（${state.names.join("/")}）、字号 ${state.nameFontPx}、缩放 ${state.zoom}、画布 ${state.canvasWidth}px / 视口 ${state.viewportWidth}px、横向溢出 ${state.pageOverflow}px`,
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
    }

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

  console.log("\n浏览器验证（真实 Chrome，Pages 子路径构建）\n");
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}\n      ${result.detail}`);
  }

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify:browser 无法运行：", error.message);
  process.exit(2);
});
