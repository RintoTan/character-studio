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
