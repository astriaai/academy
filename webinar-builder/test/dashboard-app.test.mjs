import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, "");
}

function segment(id, title, duration) {
  return {
    id,
    title,
    visual: "presenter-slide",
    script: `${title} script`,
    status: "built",
    duration,
    videoUrl: `videos/face-inpainting/${id}.mp4`,
    thumbnailUrl: `thumbs/face-inpainting/${id}.jpg`,
    inputs: {},
  };
}

const manifest = {
  generatedAt: "2026-05-30T10:29:24.608Z",
  buildMode: "main",
  commit: "test",
  projects: [
    {
      id: "face-inpainting",
      title: "Face Inpainting",
      tags: ["face-inpainting"],
      addedAt: "2026-05-28T19:18:43+03:00",
      addedCommit: "9aae78a",
      inBuild: true,
      segmentCount: 5,
      builtCount: 5,
      failedCount: 0,
      duration: 147.2,
      fullDraftUrl: "videos/face-inpainting/_full-draft.mp4",
      thumbnailUrl: "thumbs/face-inpainting/_full-draft.jpg",
      segments: [
        segment("00-intro", "Intro", 10),
        segment("01-overview", "Overview", 29),
        segment("02-before-after", "Before / after", 41),
        segment("02-workflow", "Workflow", 40),
        segment("03-faqs", "FAQs", 27),
      ],
    },
  ],
};

class StubElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.hidden = false;
    this.style = {};
    this.children = new Map();
    this.classList = {
      add() {},
      remove() {},
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML || "";
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  get textContent() {
    return this._textContent ?? stripTags(this.innerHTML);
  }

  addEventListener() {}

  setAttribute(name, value) {
    this[name] = String(value);
  }

  removeAttribute(name) {
    delete this[name];
  }

  appendChild() {}

  remove() {}

  select() {}

  querySelector(selector) {
    if (!this.children.has(selector)) {
      this.children.set(selector, new StubElement(selector));
    }
    return this.children.get(selector);
  }

  querySelectorAll() {
    return [];
  }
}

class StubDocument {
  constructor() {
    this.app = new StubElement("app");
    this.body = new StubElement("body");
    this.elements = new Map([["app", this.app]]);
    this.title = "";
  }

  createElement(tagName) {
    return new StubElement(tagName);
  }

  getElementById(id) {
    if (id === "app") return this.app;
    if (id === "search" && this.app.innerHTML.includes('id="search"')) {
      if (!this.elements.has(id)) this.elements.set(id, new StubElement(id));
      return this.elements.get(id);
    }
    if (id === "no-results" && this.app.innerHTML.includes('id="no-results"')) {
      if (!this.elements.has(id)) this.elements.set(id, new StubElement(id));
      return this.elements.get(id);
    }
    if (id === "watch-video" && this.app.innerHTML.includes('id="watch-video"')) {
      if (!this.elements.has(id)) this.elements.set(id, new StubElement(id));
      return this.elements.get(id);
    }
    return null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  execCommand() {
    return true;
  }
}

async function loadDashboard(hash = "") {
  const source = await readFile(join(ROOT, "dashboard", "app.js"), "utf-8");
  const document = new StubDocument();
  const location = {
    hash,
    href: `https://academy.test/${hash}`,
    pathname: "/academy/",
    protocol: "https:",
  };
  const context = {
    CSS: { escape: (value) => String(value).replace(/"/g, '\\"') },
    Intl,
    URL,
    URLSearchParams,
    clearTimeout,
    document,
    fetch: async (url) => {
      assert.equal(url, "manifest.json");
      return {
        ok: true,
        json: async () => JSON.parse(JSON.stringify(manifest)),
      };
    },
    history: { replaceState() {} },
    location,
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    window: {
      addEventListener() {},
      clearTimeout,
      location,
      setTimeout,
    },
  };
  context.globalThis = context;

  vm.runInContext(source, vm.createContext(context), {
    filename: "dashboard/app.js",
  });

  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }

  return { document };
}

test("dashboard channel route renders watch links without a boot error", async () => {
  const { document } = await loadDashboard("");
  const html = document.app.innerHTML;

  assert.doesNotMatch(html, /Could not load manifest\.json/);
  assert.match(html, /<main class="channel">/);
  assert.match(html, /Face Inpainting/);
  assert.match(html, /#watch=face-inpainting/);
});

test("dashboard watch route renders publish metadata without a boot error", async () => {
  const { document } = await loadDashboard("#watch=face-inpainting");
  const html = document.app.innerHTML;

  assert.doesNotMatch(html, /Could not load manifest\.json/);
  assert.match(html, /<main class="watch">/);
  assert.match(html, /Face Inpainting/);
  assert.match(html, /Published May 28, 2026/);
  assert.match(html, /5 segments/);
});

test("dashboard html loads a versioned app bundle", async () => {
  const html = await readFile(join(ROOT, "dashboard", "index.html"), "utf-8");

  assert.match(html, /<script src="app\.js\?v=[^"]+"><\/script>/);
});
