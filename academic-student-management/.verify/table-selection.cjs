/**
 * Checks the shared part-or-all row selection across the tables that gained it.
 *
 * The reference behaviour is the students tab, so this asserts the same contract
 * everywhere: a header checkbox that ticks every visible row, a half-ticked state
 * once some rows are chosen, per-row checkboxes, and a bar that reports the count.
 *
 * Run against a seeded local server: `node .seed-realistic.cjs` then this file.
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
const ADMIN_EMAIL = "seed-admin@verify.test";
const ADMIN_PASSWORD = "SeedAdmin@2026";

/**
 * Rows are always read from the table that carries the selection header.
 * A page can hold more than one table, and the subject page in particular has
 * stray row groups, so a bare `tbody tr` would mix two different lists together.
 */
const ROWS_IN_SELECTION_TABLE = "table:has(thead input[type=checkbox]) tbody tr";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
const record = (label, passed, detail = "") => {
  checks.push([label, passed]);
  console.log(`  ${passed ? "pass" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
};

async function findSubjectAndSession() {
  const { prisma } = load("src/lib/prisma.ts");
  const session = await prisma.attendanceSession.findFirst({
    orderBy: { date: "desc" },
    select: { id: true },
  });

  // The subject with the largest roster, so "select part of the table" is a real
  // case rather than a table that happens to hold a single row.
  const subjects = await prisma.subject.findMany({
    select: { id: true, _count: { select: { enrollments: true } } },
    orderBy: { enrollments: { _count: "desc" } },
    take: 1,
  });

  await prisma.$disconnect();
  return {
    sessionId: session?.id,
    subjectId: subjects[0]?.id,
    rosterSize: subjects[0]?._count.enrollments ?? 0,
  };
}

/** The count in the bar is formatted with Arabic-Indic digits, like the rest of the site. */
const arabicDigits = (value) =>
  String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);

async function main() {
  const { sessionId, subjectId } = await findSubjectAndSession();
  if (!sessionId) throw new Error("no attendance session to check; run the seed first");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sel-cdp-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=9337",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        await new Promise((resolve, reject) => {
          http
            .get("http://127.0.0.1:9337/json/version", (res) => {
              res.on("data", () => {});
              res.on("end", resolve);
            })
            .on("error", reject);
        });
        break;
      } catch {
        await sleep(250);
      }
    }

    const info = await new Promise((resolve, reject) => {
      const req = http.request(
        "http://127.0.0.1:9337/json/new?about:blank",
        { method: "PUT" },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => resolve(raw));
        },
      );
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
        setTimeout(
          () =>
            pending.has(messageId) &&
            (pending.delete(messageId), reject(new Error(`${method} timed out`))),
          180000,
        );
      });
    };

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
      }
      return result.result.value;
    };

    /** Reads the shared selection state off whichever page is open. */
    const readSelection = () => `
      (function () {
        const head = document.querySelector('thead input[type="checkbox"]');
        const bar = Array.from(document.querySelectorAll('p')).find((p) =>
          (p.innerText || '').startsWith('تحديد ') || (p.innerText || '').startsWith('تم تحديد'),
        );
        return {
          checked: head ? head.checked : null,
          indeterminate: head ? head.indeterminate : null,
          bar: bar ? bar.innerText : null,
        };
      })()
    `;

    /**
     * Waits for the requested page, not the one that happened to be on screen.
     * Reading the body length alone passes instantly on the previous page, so the
     * text has to be stable across two reads before the page counts as arrived.
     */
    const goto = async (url, expectSelector) => {
      await send("Page.navigate", { url });

      for (let i = 0; i < 120; i += 1) {
        await sleep(500);
        const state = await evaluate(`
          (function () {
            if (document.readyState !== 'complete') return null;
            const present = ${
              expectSelector ? `Boolean(document.querySelector(${JSON.stringify(expectSelector)}))` : "true"
            };
            if (!present) return null;
            const text = (document.body.innerText || '').length;
            return text;
          })()
        `);
        if (state === null) continue;

        const settled = await evaluate(`(document.body.innerText || '').length`);
        if (settled === state) return true;
      }

      const seen = await evaluate(`(document.body.innerText || '').slice(0, 200)`).catch(() => "");
      console.log(`  FAIL  ${url} never matched ${expectSelector ?? "readyState"}`);
      console.log(`        saw: ${String(seen).replace(/\s+/g, " ")}`);
      return false;
    };

    const tickFirstRows = (count) => `
      (function () {
        const rows = document.querySelectorAll(${JSON.stringify(ROWS_IN_SELECTION_TABLE)});
        for (let i = 0; i < ${count}; i += 1) {
          rows[i].querySelector('input[type="checkbox"]').click();
        }
        return rows.length;
      })()
    `;

    const clickButton = (needle) => `
      (function () {
        const button = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.innerText || '').includes(${JSON.stringify(needle)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()
    `;

    /**
     * Waits for the bar to report a given count instead of sleeping a fixed time.
     * A table of two thousand rows settles far more slowly than a page of a
     * hundred, and a fixed pause would read the state from before the update.
     */
    const waitForCount = async (count) => {
      const wanted = arabicDigits(count);
      const matches = (bar) =>
        count === 0 ? bar === null : typeof bar === "string" && bar.includes(wanted);

      for (let i = 0; i < 80; i += 1) {
        const state = await evaluate(readSelection());
        if (matches(state.bar)) return state;
        await sleep(500);
      }
      return await evaluate(readSelection());
    };

    /**
     * The contract every table now shares. Ticking part of the table has to leave
     * the header half-ticked, the header has to be able to take the rest, and the
     * bar has to be able to empty the selection again.
     */
    const auditSelection = async (label) => {
      const hasHeader = await evaluate(`Boolean(document.querySelector('thead input[type="checkbox"]'))`);
      if (!hasHeader) {
        record(`${label}: has a header checkbox`, false);
        return false;
      }
      record(`${label}: has a header checkbox`, true);

      const rowCount = await evaluate(
        `document.querySelectorAll(${JSON.stringify(ROWS_IN_SELECTION_TABLE)}).length`,
      );
      record(`${label}: has rows to select`, rowCount > 1, `${rowCount} rows`);
      if (rowCount < 2) return false;

      const started = Date.now();
      await evaluate(tickFirstRows(2));
      const partial = await waitForCount(2);

      record(
        `${label}: two rows ticked leaves the header half-ticked`,
        partial.indeterminate === true,
        `indeterminate=${partial.indeterminate}`,
      );
      record(
        `${label}: the bar counts the selection`,
        typeof partial.bar === "string" && partial.bar.includes(arabicDigits(2)),
        String(partial.bar),
      );

      await evaluate(`document.querySelector('thead input[type="checkbox"]').click()`);
      const all = await waitForCount(rowCount);

      record(
        `${label}: the header ticks every row`,
        all.checked === true &&
          typeof all.bar === "string" &&
          all.bar.includes(arabicDigits(rowCount)),
        `${String(all.bar)} in ${Date.now() - started}ms`,
      );

      await evaluate(clickButton("إلغاء تحديد الكل"));
      const cleared = await waitForCount(0);

      record(
        `${label}: the bar can clear the selection`,
        cleared.checked === false && cleared.bar === null,
        String(cleared.bar),
      );

      return true;
    };

    await send("Page.enable");
    await send("Runtime.enable");

    await goto(`${BASE}/sign-in`, 'input[type="password"]');
    await evaluate(`
      (function () {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const email = document.querySelector('input[type="email"]');
        const password = document.querySelector('input[type="password"]');
        setter.call(email, ${JSON.stringify(ADMIN_EMAIL)});
        email.dispatchEvent(new Event('input', { bubbles: true }));
        setter.call(password, ${JSON.stringify(ADMIN_PASSWORD)});
        password.dispatchEvent(new Event('input', { bubbles: true }));
        email.closest('form').requestSubmit();
        return 1;
      })()
    `);
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      if (!(await evaluate("location.pathname")).includes("sign-in")) break;
    }
    record("signed in as an administrator", !(await evaluate("location.pathname")).includes("sign-in"));

    console.log("\nthe students table, which this feature copies");
    await goto(`${BASE}/admin/students`, 'tbody tr');
    await auditSelection("طلاب");

    console.log("\nthe roster of one subject");
    await goto(`${BASE}/admin/subjects`, 'tbody tr');
    record("a subject page is reachable from the subjects list", typeof subjectId === "string");

    if (typeof subjectId === "string") {
      await goto(`${BASE}/admin/subjects/${subjectId}`, 'tbody tr');
      await auditSelection("طلاب المادة");

      // The bulk action has to reach the database, not only move some buttons.
      const readIds = `
        (function () {
          const rows = Array.from(
            document.querySelectorAll(${JSON.stringify(ROWS_IN_SELECTION_TABLE)}),
          );
          // The university id is the one cell that is a bare alphanumeric token.
          // A name carries an email underneath it and the counts are localised
          // digits, so neither can be mistaken for it.
          return rows.map((row) => {
            const cells = Array.from(row.querySelectorAll('td')).map((c) => (c.innerText || '').trim());
            const match = cells.find((text) => /^[A-Za-z0-9_-]{2,20}$/.test(text));
            return match || null;
          });
        })()
      `;
      const before = await evaluate(readIds);
      record(
        "the roster exposes a stable id per row",
        Array.isArray(before) && before.length > 1 && before.every(Boolean),
        `${Array.isArray(before) ? before.filter(Boolean).length : 0} of ${before.length} rows`,
      );

      await evaluate(`
        (function () {
          // The confirmation dialog is part of the product; the test accepts it.
          window.confirm = () => true;
          document.querySelector('${ROWS_IN_SELECTION_TABLE} input[type="checkbox"]').click();
          return 1;
        })()
      `);
      await sleep(800);

      const clicked = await evaluate(clickButton("إلغاء تسجيل المحدد"));
      await sleep(4000);

      const after = await evaluate(readIds);
      const removed =
        Array.isArray(before) && Array.isArray(after) ? before.filter((row) => !after.includes(row)) : [];

      record(
        "un-enrolling the ticked student persists",
        clicked === true && removed.length === 1 && after.length === before.length - 1,
        `removed ${removed.length} of ${before.length}`,
      );
    }

    console.log("\nthe attendance sheet");
    await goto(`${BASE}/admin/attendance/${sessionId}`, 'thead');
    await auditSelection("ورقة الحضور");

    // The sheet is the one table where a selection also has to do something, so
    // that is checked directly: mark two students absent in a single step.
    await evaluate(tickFirstRows(2));
    await sleep(800);

    const applied = await evaluate(clickButton("تحديد غائب"));
    await sleep(1200);

    const pressed = await evaluate(`
      (function () {
        const rows = Array.from(
          document.querySelectorAll(${JSON.stringify(ROWS_IN_SELECTION_TABLE)}),
        ).slice(0, 2);
        return rows.map((row) =>
          Array.from(row.querySelectorAll('button[aria-pressed="true"]')).map((b) =>
            (b.innerText || '').trim(),
          ),
        );
      })()
    `);
    record(
      "the sheet marks just the ticked students",
      applied === true &&
        Array.isArray(pressed) &&
        pressed.length === 2 &&
        pressed.every((labels) => labels.includes("غائب")),
      JSON.stringify(pressed),
    );

    const thirdPressed = await evaluate(`
      (function () {
        const rows = Array.from(
          document.querySelectorAll(${JSON.stringify(ROWS_IN_SELECTION_TABLE)}),
        );
        const third = rows[2];
        if (!third) return null;
        return Array.from(third.querySelectorAll('button[aria-pressed="true"]')).map((b) =>
          (b.innerText || '').trim(),
        );
      })()
    `);
    record(
      "an unticked student keeps its own status",
      Array.isArray(thirdPressed) && !thirdPressed.includes("غائب"),
      JSON.stringify(thirdPressed),
    );

    socket.close();
  } finally {
    chrome.kill();
  }

  const failed = checks.filter(([, passed]) => !passed).length;
  console.log(
    failed === 0 ? "\nALL TABLE SELECTION CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});