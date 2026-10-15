/**
 * Checks that moving the status choice from a radio input to a button plus a
 * hidden field did not change what the form posts.
 *
 * Opens the sheet in a real browser, marks one student absent with a reason and
 * one excused with no reason, submits, then reads the rows back from the
 * database. The action reads `studentId`, `status` and `reason` positionally, so
 * this is the property that matters: one status and one reason per student, in
 * the same order as the student ids.
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

// Saving has to work from both entry points: the administrator's sheet and the
// professor's. The action is shared, but the professor reaches it through a grant
// check, so both paths are exercised.
const PROFILE = process.env.PROFILE === "professor" ? "professor" : "admin";
const LOGIN =
  PROFILE === "professor"
    ? { email: "seed-prof@verify.test", password: "SeedProf@2026" }
    : { email: "seed-admin@verify.test", password: "SeedAdmin@2026" };
const SHEET_PATH = (sessionId) => (PROFILE === "professor" ? `/professor/attendance/${sessionId}` : `/admin/attendance/${sessionId}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pickSession() {
  const { prisma } = load("src/lib/prisma.ts");
  const rows = await prisma.$queryRawUnsafe(`
    SELECT s."id", COUNT(r."studentId") AS students
    FROM "AttendanceSession" s
    LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s."id"
    GROUP BY s."id"
    ORDER BY students DESC
    LIMIT 1
  `);

  const sessionId = rows[0].id;

  // Reset the three rows we are about to touch so a rerun starts from PRESENT.
  const sample = await prisma.attendanceRecord.findMany({
    where: { sessionId },
    orderBy: { studentId: "asc" },
    take: 3,
    select: { studentId: true },
  });

  await prisma.attendanceRecord.updateMany({
    where: { sessionId, studentId: { in: sample.map((record) => record.studentId) } },
    data: { status: "PRESENT", reason: null },
  });

  await prisma.$disconnect();
  return { sessionId, students: sample.map((record) => record.studentId) };
}

async function main() {
  const { sessionId, students } = await pickSession();
  const [absentId, excusedId, untouchedId] = students;
  console.log(`session ${sessionId}, ${students.length} rows reset to PRESENT (as ${PROFILE})`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "submit-cdp-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=9335",
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
          http.get("http://127.0.0.1:9335/json/version", (res) => {
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
      const req = http.request("http://127.0.0.1:9335/json/new?about:blank", { method: "PUT" }, (res) => {
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
        setTimeout(
          () => pending.has(messageId) && (pending.delete(messageId), reject(new Error(`${method} timed out`))),
          180000,
        );
      });
    };

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "failed");
      return result.result.value;
    };

    await send("Page.enable");
    await send("Runtime.enable");

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

    await send("Page.navigate", { url: `${BASE}${SHEET_PATH(sessionId)}` });
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      if ((await evaluate("(document.body.innerText || '').length").catch(() => 0)) > 500 && i > 3) break;
    }

    // Click the absent button on one row and the excused button on another,
    // then type a reason into the row that now exposes one.
    const clicked = await evaluate(`
      (() => {
        const rowFor = (studentId) => {
          const input = document.querySelector('input[name="studentId"][value="' + studentId + '"]');
          const row = input.closest('tr') || input.closest('div.rounded-2xl');
          return row;
        };
        const clickButton = (row, label) => {
          const button = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === label);
          if (!button) return label + ': not found';
          button.click();
          return label + ': clicked';
        };

        const out = [];
        out.push(clickButton(rowFor(${JSON.stringify(absentId)}), 'غائب'));
        out.push(clickButton(rowFor(${JSON.stringify(excusedId)}), 'بعذر'));
        return out.join(' | ');
      })()
    `);
    console.log(clicked);

    await sleep(400);

    const typed = await evaluate(`
      (() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const row = (document.querySelector('input[name="studentId"][value="' + ${JSON.stringify(absentId)} + '"]').closest('tr'));
        const field = row.querySelector('input[aria-label^="سبب"]');
        if (!field) return 'reason input did not appear';
        setter.call(field, 'مرض');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()
    `);
    console.log(typed);
    await sleep(400);

    // Count how many controls are on the page now, for comparison.
    const before = await evaluate(`
      (() => ({
        nodes: document.getElementsByTagName('*').length,
        visibleTextInputs: Array.from(document.querySelectorAll('input')).filter((i) => i.type === 'text').length,
        buttons: document.querySelectorAll('tbody button').length,
        formControls: document.querySelectorAll('input, textarea, select, button').length,
      }))()
    `);
    console.log("\nDOM after the change:");
    console.log(`  nodes          ${before.nodes}`);
    console.log(`  text inputs    ${before.visibleTextInputs}`);
    console.log(`  status buttons ${before.buttons}`);
    console.log(`  all controls   ${before.formControls}`);

    // Submit the form the way the page does.
    await evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('حفظ سجلات الحضور'));
        button.click();
        return 1;
      })()
    `);

    let saved = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      const message = await evaluate(
        `(document.querySelector('[role="status"]') || {}).innerText || ''`,
      );
      if (message && message.includes("حفظ")) {
        console.log(`\npage said: ${message}`);
        saved = true;
        break;
      }
    }
    if (!saved) console.log("\nno save confirmation appeared");

    socket.close();
  } finally {
    chrome.kill();
  }

  const { prisma } = load("src/lib/prisma.ts");
  const rows = await prisma.attendanceRecord.findMany({
    where: { sessionId, studentId: { in: students } },
    select: { studentId: true, status: true, reason: true },
    orderBy: { studentId: "asc" },
  });

  console.log("\nwhat reached the database:");
  for (const row of rows) {
    console.log(`  ${row.studentId === absentId ? "absent" : row.studentId === excusedId ? "excused" : "untouched"}: ${row.status}${row.reason ? ` (${row.reason})` : ""}`);
  }

  const byId = new Map(rows.map((row) => [row.studentId, row]));
  const checks = [
    ["the absent student was saved", byId.get(absentId)?.status === "ABSENT"],
    ["the absent student's reason was saved", byId.get(absentId)?.reason === "مرض"],
    ["the excused student was saved", byId.get(excusedId)?.status === "EXCUSED"],
    ["the untouched row kept its status", byId.get(untouchedId)?.status === "PRESENT"],
    ["no row was left without a status", rows.every((row) => Boolean(row.status))],
  ];

  console.log("");
  let failed = 0;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "pass" : "FAIL"}  ${label}`);
    if (!passed) failed += 1;
  }

  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});