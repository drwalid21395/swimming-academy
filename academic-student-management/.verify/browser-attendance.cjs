/**
 * Drives headless Chrome over the DevTools Protocol to open the attendance pages
 * with a real session, and reports what the browser actually does: how long the
 * navigation took, how many nodes the page ended up with, how much main-thread
 * time was spent in long tasks, and whether the renderer ever stopped responding.
 *
 * Uses only Node built-ins plus the Chrome that is already installed.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3111";
const ADMIN = { email: "seed-admin@verify.test", password: "SeedAdmin@2026" };
const PROF = { email: "seed-prof@verify.test", password: "SeedProf@2026" };

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "attendance-cdp-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=9333",
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--window-size=1440,900",
  "about:blank",
], { stdio: "ignore" });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevTools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const body = await new Promise((resolve, reject) => {
        http
          .get("http://127.0.0.1:9333/json/version", (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
          })
          .on("error", reject);
      });
      return JSON.parse(body);
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome DevTools never became reachable");
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  onMessage(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 120000);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
    }
    return result.result.value;
  }
}

async function connect(wsUrl) {
  const socket = new globalThis.WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return new Session(socket);
}

async function newPage() {
  // Chrome rejects GET on /json/new with "Using unsafe HTTP verb GET"; it has to
  // be a PUT.
  const body = await new Promise((resolve, reject) => {
    const request = http.request(
      "http://127.0.0.1:9333/json/new?about:blank",
      { method: "PUT" },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      },
    );
    request.on("error", reject);
    request.end();
  });
  return JSON.parse(body);
}

async function login(page, credentials) {
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");

  await page.send("Page.navigate", { url: `${BASE}/sign-in` });
  await sleep(2500);

  await page.evaluate(`
    (() => {
      const setNative = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const email = document.querySelector('input[type="email"]');
      const password = document.querySelector('input[type="password"]');
      setNative(email, ${JSON.stringify(credentials.email)});
      setNative(password, ${JSON.stringify(credentials.password)});
      const form = email.closest('form');
      form.requestSubmit();
      return 'submitted';
    })()
  `);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    const url = await page.evaluate("location.pathname");
    if (url && !url.includes("sign-in")) return url;
  }
  return null;
}

async function visit(page, path) {
  const events = [];
  const stopListening = page.onMessage((message) => events.push(message));

  const started = Date.now();
  await page.send("Page.navigate", { url: `${BASE}${path}` });

  // Watch for the renderer telling us it is busy, which is the browser-side
  // version of "the page is not responding".
  let longTasks = 0;
  let longestTask = 0;
  let frozenFrames = 0;
  const deadline = Date.now() + 60000;
  let painted = false;

  while (Date.now() < deadline) {
    await sleep(400);

    const probe = await page
      .evaluate(`
        (() => {
          const observer = window.__lt || [];
          return {
            nodes: document.getElementsByTagName('*').length,
            text: (document.body.innerText || '').slice(0, 80),
            busy: Boolean(window.__cdpBusy),
          };
        })()
      `)
      .catch(() => null);

    if (probe && probe.text.trim()) painted = true;

    // If the renderer stops answering evaluate() entirely it is wedged.
    const responsive = await page
      .evaluate("1 + 1")
      .then(() => true)
      .catch(() => false);

    if (!responsive) {
      frozenFrames += 1;
      if (frozenFrames > 3) {
        stopListening();
        return {
          path,
          hung: true,
          seconds: Math.round((Date.now() - started) / 1000),
          nodes: probe?.nodes ?? null,
          painted,
        };
      }
    } else {
      frozenFrames = 0;
    }

    if (painted && Date.now() - started > 6000) break;
  }

  stopListening();

  const stats = await page
    .evaluate(`
      (() => ({
        nodes: document.getElementsByTagName('*').length,
        chars: (document.body.innerText || '').length,
        title: document.title,
        heading: (document.querySelector('h1') || {}).innerText || null,
      }))()
    `)
    .catch(() => null);

  const navTiming = await page
    .evaluate(
      `(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), responseEnd: Math.round(n.responseEnd) } : null; })()`,
    )
    .catch(() => null);

  return {
    path,
    hung: false,
    seconds: Math.round((Date.now() - started) / 1000),
    longTasks,
    longestTask,
    ...stats,
    navTiming,
    consoleErrors: events
      .filter((event) => event.method === "Runtime.exceptionThrown")
      .map((event) => event.params.exceptionDetails?.exception?.description ?? "exception"),
  };
}

async function main() {
  await waitForDevTools();
  console.log("chrome is up\n");

  const pageInfo = await newPage();
  const page = await connect(pageInfo.webSocketDebuggerUrl);

  console.log("logging in as the administrator");
  const landed = await login(page, ADMIN);
  console.log(`  landed on ${landed}\n`);

  const listPage = await newPage();
  const adminPage = await connect(listPage.webSocketDebuggerUrl);
  await adminPage.send("Page.enable");
  await adminPage.send("Runtime.enable");
  // Reuse the cookies the first page already has by navigating within the same
  // browser context: DevTools pages share a profile, so this is the same session.

  const targets = [
    { page: adminPage, path: "/admin/attendance" },
    { page: adminPage, path: "/admin/students" },
    { page: adminPage, path: "/admin" },
    { page: adminPage, path: "/admin/subjects" },
  ];

  console.log("page                 hung   time   nodes   chars");
  console.log("----------------------------------------------------");

  for (const target of targets) {
    const result = await visit(target.page, target.path);
    console.log(
      `${target.path.padEnd(20)} ${String(result.hung).padEnd(6)} ${String(result.seconds).padEnd(6)} ${String(result.nodes ?? "-").padEnd(7)} ${result.chars ?? "-"}`,
    );
    if (result.hung) console.log("   *** the renderer stopped responding ***");
    if (result.consoleErrors?.length) {
      for (const error of result.consoleErrors.slice(0, 3)) {
        console.log(`   error: ${error.split("\n")[0]}`);
      }
    }
    if (result.navTiming) {
      console.log(
        `   server responseEnd=${result.navTiming.responseEnd}ms domContentLoaded=${result.navTiming.domContentLoaded}ms load=${result.navTiming.load}ms`,
      );
    }
  }

  // Now the sheet page, which renders one row per student in the subject.
  const sessionId = await adminPage.evaluate(`
    (() => {
      const link = Array.from(document.querySelectorAll('a[href*="/admin/attendance/"]'))[0];
      return link ? link.getAttribute('href') : null;
    })()
  `);

  if (sessionId) {
    const result = await visit(adminPage, sessionId);
    console.log(
      `${sessionId.padEnd(20)} ${String(result.hung).padEnd(6)} ${String(result.seconds).padEnd(6)} ${String(result.nodes ?? "-").padEnd(7)} ${result.chars ?? "-"}`,
    );
    if (result.hung) console.log("   *** the renderer stopped responding ***");
  } else {
    console.log("\nno session link found on the attendance list");
  }

  chrome.kill();
}

main()
  .catch((error) => {
    console.error(error);
    chrome.kill();
    process.exit(1);
  });