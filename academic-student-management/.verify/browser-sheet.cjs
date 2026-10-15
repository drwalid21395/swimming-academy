/**
 * Opens the attendance sheet, which is the heaviest attendance view: it renders
 * one row per enrolled student, each with three status radios and a reason input.
 * Reports node counts, long-task pressure and whether the renderer ever wedges.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { loadTs } = require("./loader.cjs");
const load = (relative) => loadTs(path.join(process.cwd(), relative));

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3111";

// The sheet is rendered by two different pages: the administrator's and the
// professor's. Same component, different wrapper, so both are worth opening.
const PROFILE = process.env.PROFILE === "professor" ? "professor" : "admin";
const LOGIN =
  PROFILE === "professor"
    ? { email: "seed-prof@verify.test", password: "SeedProf@2026" }
    : { email: "seed-admin@verify.test", password: "SeedAdmin@2026" };
const SHEET_PATH = (sessionId) => (PROFILE === "professor" ? `/professor/attendance/${sessionId}` : `/admin/attendance/${sessionId}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sessionIdForLargestRoster() {
  const { prisma } = load("src/lib/prisma.ts");
  const rows = await prisma.$queryRawUnsafe(`
    SELECT s."id", COUNT(r."studentId") AS students
    FROM "AttendanceSession" s
    LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s."id"
    GROUP BY s."id"
    ORDER BY students DESC
    LIMIT 1
  `);
  await prisma.$disconnect();
  return rows[0];
}

async function main() {
  const target = await sessionIdForLargestRoster();
  console.log(`profile ${PROFILE}: largest roster ${target.students} students, session ${target.id}\n`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-cdp-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=9334",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1440,900",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        await new Promise((resolve, reject) => {
          http.get("http://127.0.0.1:9334/json/version", (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }).on("error", reject);
        });
        break;
      } catch {
        await sleep(250);
      }
    }

    const info = await new Promise((resolve, reject) => {
      const req = http.request("http://127.0.0.1:9334/json/new?about:blank", { method: "PUT" }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.end();
    });

    const socket = new globalThis.WebSocket(JSON.parse(info).webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    });

    const send = (method, params = {}) => {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        setTimeout(() => pending.has(messageId) && (pending.delete(messageId), reject(new Error(`${method} timed out`))), 180000);
      });
    };

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "failed");
      return result.result.value;
    };

    await send("Page.enable");
    await send("Runtime.enable");

    // Sign in.
    await send("Page.navigate", { url: `${BASE}/sign-in` });
    await sleep(2500);
    await evaluate(`
      (() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const email = document.querySelector('input[type="email"]');
        const password = document.querySelector('input[type="password"]');
        setter.call(email, ${JSON.stringify(LOGIN.email)});
        email.dispatchEvent(new Event('input', { bubbles: true }));
        setter.call(password, ${JSON.stringify(LOGIN.password)});
        password.dispatchEvent(new Event('input', { bubbles: true }));
        email.closest('form').requestSubmit();
        return 1;
      })()
    `);
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      if (!(await evaluate("location.pathname")).includes("sign-in")) break;
    }

    // Start recording how much main-thread work the page asks for.
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__longTasks = [];
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
          }).observe({ entryTypes: ['longtask'] });
        } catch (error) {}
      `,
    });

    console.log("opening the sheet");
    const started = Date.now();
    await send("Page.navigate", { url: `${BASE}${SHEET_PATH(target.id)}` });

    let wedged = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(500);
      const responsive = await evaluate("1 + 1").then(() => true).catch(() => false);
      if (!responsive) {
        wedged = true;
        console.log(`  renderer stopped answering after ${Math.round((Date.now() - started) / 1000)}s`);
        break;
      }
      const painted = await evaluate("(document.body.innerText || '').length").catch(() => 0);
      if (painted > 500 && attempt > 3) break;
    }

    if (!wedged) {
      const stats = await evaluate(`
        (() => {
          const nav = performance.getEntriesByType('navigation')[0];
          return {
            nodes: document.getElementsByTagName('*').length,
            radios: document.querySelectorAll('input[type="radio"]').length,
            inputs: document.querySelectorAll('input').length,
            rows: document.querySelectorAll('tbody tr').length,
            longTasks: window.__longTasks || [],
            responseEnd: nav ? Math.round(nav.responseEnd) : null,
            load: nav ? Math.round(nav.loadEventEnd) : null,
          };
        })()
      `);

      const total = stats.longTasks.reduce((sum, value) => sum + value, 0);
      console.log(`\n  server responseEnd : ${stats.responseEnd} ms`);
      console.log(`  page load          : ${stats.load} ms`);
      console.log(`  dom nodes          : ${stats.nodes}`);
      console.log(`  table rows         : ${stats.rows}`);
      console.log(`  radio inputs       : ${stats.radios}`);
      console.log(`  long tasks         : ${stats.longTasks.length} totalling ${total} ms`);
      console.log(`  slowest long task  : ${stats.longTasks.length ? Math.max(...stats.longTasks) : 0} ms`);

      // Interact: mark the whole roster present, which is the button a teacher
      // presses before saving.
      console.log("\n  pressing \"mark everyone present\"");
      const clickStarted = Date.now();
      await evaluate(`
        (() => {
          const button = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('تحضير الجميع'));
          if (!button) return 'button not found';
          button.click();
          return 'clicked';
        })()
      `);

      let frozeOnClick = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(400);
        const responsive = await evaluate("1 + 1").then(() => true).catch(() => false);
        if (!responsive) {
          frozeOnClick = true;
          break;
        }
        if (attempt > 2) break;
      }
      console.log(`  responded after    : ${Math.round((Date.now() - clickStarted) / 1000)}s ${frozeOnClick ? "*** FROZE ***" : ""}`);
    }

    socket.close();
  } finally {
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});