/**
 * End-to-end check of the assistant attendance flow.
 *
 * An assistant is created with the attendance permission and *no* subjects of its
 * own. The test then signs in as that assistant in a real browser and asserts the
 * whole flow the user described: the supervisor's subjects are listed, a session
 * can be added to one of them, and attendance can be recorded and saved.
 *
 * It also asserts the ceiling still holds: a subject the supervisor does not teach
 * is neither offered nor accepted.
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
const TAG = "ATV";
const ASSISTANT_EMAIL = "assist.v@verify.test";
const ASSISTANT_PASSWORD = "Assist@2026";
const SUBJECT_CODE = `${TAG}-S1`;
const OTHER_CODE = `${TAG}-S2`;
const SECOND_CODE = `${TAG}-S3`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup() {
  const bcrypt = require("bcryptjs");
  const { prisma } = load("src/lib/prisma.ts");

  const stale = await prisma.subject.findMany({
    where: { code: { startsWith: TAG } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.attendanceRecord.deleteMany({
      where: { session: { subjectId: { in: stale.map((s) => s.id) } } },
    });
    await prisma.attendanceSession.deleteMany({ where: { subjectId: { in: stale.map((s) => s.id) } } });
  }
  await prisma.subject.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.student.deleteMany({ where: { universityId: { startsWith: TAG } } });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { contains: TAG } },
        { email: ASSISTANT_EMAIL },
        { email: "sup.v-sup.test" },
      ],
    },
  });
  await prisma.academicTerm.deleteMany({ where: { name: { startsWith: TAG } } });

  const department =
    (await prisma.department.findFirst()) ??
    (await prisma.department.create({
      data: { name: `${TAG} قسم`, code: `${TAG}-D` },
      select: { id: true },
    }));

  const term = await prisma.academicTerm.create({
    data: {
      name: `${TAG} فصل`,
      startDate: new Date("2025-09-01"),
      endDate: new Date("2026-06-30"),
    },
    select: { id: true },
  });

  const subject = await prisma.subject.create({
    data: {
      code: SUBJECT_CODE,
      name: `${TAG} مادة المشرف`,
      departmentId: department.id,
      academicTermId: term.id,
    },
    select: { id: true, code: true },
  });

  const other = await prisma.subject.create({
    data: {
      code: OTHER_CODE,
      name: `${TAG} مادة أخرى`,
      departmentId: department.id,
      academicTermId: term.id,
    },
    select: { id: true, code: true },
  });

  const second = await prisma.subject.create({
    data: {
      code: SECOND_CODE,
      name: `${TAG} مادة ثانية`,
      departmentId: department.id,
      academicTermId: term.id,
    },
    select: { id: true, code: true },
  });

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (!admin) throw new Error("need an admin to own the grant audit");

  const supervisorUser = await prisma.user.create({
    data: {
      email: "sup.v-sup.test",
      passwordHash: await bcrypt.hash("Supervisor@2026", 10),
      fullName: `${TAG} دكتور مشرف`,
      role: "PROFESSOR",
    },
    select: { id: true },
  });

  const supervisor = await prisma.professor.create({
    data: {
      userId: supervisorUser.id,
      employeeCode: `${TAG}-SUP`,
      departmentId: department.id,
    },
    select: { id: true },
  });

  // The supervisor teaches the one subject; the other belongs to nobody.
  await prisma.subjectProfessor.create({
    data: { subjectId: subject.id, professorId: supervisor.id, isPrimary: true },
  });
  await prisma.professorPermission.create({
    data: { professorId: supervisor.id, permission: "ATTENDANCE_RECORD", grantedById: admin.id },
  });

  const assistantUser = await prisma.user.create({
    data: {
      email: ASSISTANT_EMAIL,
      passwordHash: await bcrypt.hash(ASSISTANT_PASSWORD, 10),
      fullName: `${TAG} عضو معاونة`,
      role: "PROFESSOR",
    },
    select: { id: true },
  });

  const assistant = await prisma.professor.create({
    data: {
      userId: assistantUser.id,
      employeeCode: `${TAG}-ASST`,
      departmentId: department.id,
      kind: "ASSISTANT",
      supervisorId: supervisor.id,
    },
    select: { id: true },
  });

  // Deliberately no SubjectProfessor rows for the assistant.
  await prisma.professorPermission.create({
    data: { professorId: assistant.id, permission: "ATTENDANCE_RECORD", grantedById: admin.id },
  });

  // A second assistant proves the precedence rule the other way: assigned subjects
  // win over inheritance, so this one must stay on its own single subject even
  // though their supervisor teaches two.
  const leadUser = await prisma.user.create({
    data: {
      email: `lead.${TAG}@v.test`,
      passwordHash: "x",
      fullName: `${TAG} دكتور ثاني`,
      role: "PROFESSOR",
    },
    select: { id: true },
  });
  const lead = await prisma.professor.create({
    data: { userId: leadUser.id, employeeCode: `${TAG}-LEAD`, departmentId: department.id },
    select: { id: true },
  });
  await prisma.subjectProfessor.create({
    data: { subjectId: subject.id, professorId: lead.id, isPrimary: true },
  });
  await prisma.subjectProfessor.create({
    data: { subjectId: second.id, professorId: lead.id, isPrimary: false },
  });

  const narrowUser = await prisma.user.create({
    data: {
      email: `narrow.${TAG}@v.test`,
      passwordHash: "x",
      fullName: `${TAG} معاون مقيد`,
      role: "PROFESSOR",
    },
    select: { id: true },
  });
  const narrow = await prisma.professor.create({
    data: {
      userId: narrowUser.id,
      employeeCode: `${TAG}-NARROW`,
      departmentId: department.id,
      kind: "ASSISTANT",
      supervisorId: lead.id,
    },
    select: { id: true },
  });
  await prisma.subjectProfessor.create({
    data: { subjectId: subject.id, professorId: narrow.id, isPrimary: true },
  });
  await prisma.professorPermission.create({
    data: { professorId: narrow.id, permission: "ATTENDANCE_RECORD", grantedById: admin.id },
  });

  const students = [];
  for (let i = 0; i < 5; i += 1) {
    const user = await prisma.user.create({
      data: {
        email: `${TAG}-st${i}@v.test`,
        passwordHash: "x",
        fullName: `${TAG} طالب ${i}`,
        role: "STUDENT",
      },
      select: { id: true },
    });
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        universityId: `${TAG}U${i}`,
        academicYear: 1,
        departmentId: department.id,
      },
      select: { id: true },
    });
    await prisma.enrollment.create({
      data: { subjectId: subject.id, studentId: student.id, status: "ACTIVE" },
    });
    students.push(student.id);
  }

  await prisma.$disconnect();
  return {
    subject,
    other,
    second,
    supervisor: supervisor.id,
    assistant: assistant.id,
    assistantUserId: assistantUser.id,
    narrowUserId: narrowUser.id,
    students,
  };
}

async function cleanup() {
  const { prisma } = load("src/lib/prisma.ts");
  const stale = await prisma.subject.findMany({
    where: { code: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = stale.map((s) => s.id);
  if (ids.length > 0) {
    await prisma.attendanceRecord.deleteMany({ where: { session: { subjectId: { in: ids } } } });
    await prisma.attendanceSession.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.subject.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.student.deleteMany({ where: { universityId: { startsWith: TAG } } });
  await prisma.user.deleteMany({
    where: {
      OR: [{ email: { contains: TAG } }, { email: ASSISTANT_EMAIL }, { email: "sup.v-sup.test" }],
    },
  });
  await prisma.academicTerm.deleteMany({ where: { name: { startsWith: `${TAG} فصل` } } });
  await prisma.department.deleteMany({ where: { code: `${TAG}-D` } });
  await prisma.$disconnect();
}

async function main() {
  const data = await setup();
  console.log(
    `seeded: supervisor teaches ${data.subject.code}, assistant has no subjects of its own\n`,
  );

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asst-cdp-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=9336",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const checks = [];
  const record = (label, passed, detail = "") => {
    checks.push([label, passed, detail]);
    console.log(`  ${passed ? "pass" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        await new Promise((resolve, reject) => {
          http
            .get("http://127.0.0.1:9336/json/version", (res) => {
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
        "http://127.0.0.1:9336/json/new?about:blank",
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

    await send("Page.enable");
    await send("Runtime.enable");

    await send("Page.navigate", { url: `${BASE}/sign-in` });
    await sleep(2500);
    await evaluate(`
      (() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const email = document.querySelector('input[type="email"]');
        const password = document.querySelector('input[type="password"]');
        setter.call(email, ${JSON.stringify(ASSISTANT_EMAIL)});
        email.dispatchEvent(new Event('input', { bubbles: true }));
        setter.call(password, ${JSON.stringify(ASSISTANT_PASSWORD)});
        password.dispatchEvent(new Event('input', { bubbles: true }));
        email.closest('form').requestSubmit();
        return 1;
      })()
    `);
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      if (!(await evaluate("location.pathname")).includes("sign-in")) break;
    }

    console.log("the assistant reaches the attendance page");
    await send("Page.navigate", { url: `${BASE}/professor/attendance` });
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      const ready = await evaluate("(document.body.innerText || '').length").catch(() => 0);
      if (ready > 300 && i > 3) break;
    }

    const path = await evaluate("location.pathname");
    record("the attendance page is not blocked for a granted assistant", path === "/professor/attendance", path);

    const addButton = await evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('محاضرة جديدة'));
        if (!button) return false;
        button.click();
        return true;
      })()
    `);
    record("the new-session button is available", addButton === true);
    await sleep(900);

    const options = await evaluate(`
      (() => {
        const select = document.getElementById('subjectId');
        if (!select) return null;
        return Array.from(select.options).map((option) => option.value).filter(Boolean);
      })()
    `);

    record(
      "the supervisor's subject is offered",
      Array.isArray(options) && options.includes(data.subject.id),
      `offered ${JSON.stringify(options)}`,
    );
    record(
      "a subject the supervisor does not teach is not offered",
      Array.isArray(options) && !options.includes(data.other.id),
    );

    const created = await evaluate(`
      (() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        const select = document.getElementById('subjectId');
        selectSetter.call(select, ${JSON.stringify(data.subject.id)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const title = document.getElementById('title');
        setter.call(title, 'محاضرة أنشأها المعاون');
        title.dispatchEvent(new Event('input', { bubbles: true }));
        const submit = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('إنشاء المحاضرة'));
        submit.click();
        return 1;
      })()
    `);
    void created;
    await sleep(3500);

    const listed = await evaluate(`
      (() => (document.body.innerText || '').includes('محاضرة أنشأها المعاون'))()
    `);
    record("the assistant's new session appears in the list", listed === true);

    const href = await evaluate(`
      (() => {
        const link = Array.from(document.querySelectorAll('a[href^="/professor/attendance/"]')).find((a) => (a.innerText || '').includes('محاضرة أنشأها المعاون'));
        return link ? link.getAttribute('href') : null;
      })()
    `);
    record("the session links to its sheet", typeof href === "string" && href.length > 0, String(href));

    if (typeof href === "string" && href) {
      await send("Page.navigate", { url: `${BASE}${href}` });
      for (let i = 0; i < 60; i += 1) {
        await sleep(500);
        const ready = await evaluate("(document.body.innerText || '').length").catch(() => 0);
        if (ready > 300 && i > 3) break;
      }

      const rows = await evaluate("document.querySelectorAll('tbody tr').length");
      record("the sheet lists the subject's students", rows === data.students.length, `${rows} rows`);

      // The reason box only exists once the absence status renders, so the status
      // click and the typing have to happen in separate turns of the event loop.
      const marked = await evaluate(`
        (() => {
          const row = document.querySelector('tbody tr');
          const absent = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'غائب');
          absent.click();
          return 1;
        })()
      `);
      void marked;
      await sleep(1200);

      const typed = await evaluate(`
        (() => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          const field = document.querySelector('input[aria-label^="سبب"]');
          if (!field) return 'no reason field';
          setter.call(field, 'مرض');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed';
        })()
      `);
      await sleep(800);

      await evaluate(`
        (() => {
          const submit = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('حفظ سجلات الحضور'));
          submit.click();
          return 1;
        })()
      `);

      let message = "";
      for (let i = 0; i < 60; i += 1) {
        await sleep(500);
        const text = await evaluate(
          `(document.body.innerText || '').includes('تم حفظ') ? 'تم حفظ' : ''`,
        );
        if (text) {
          message = text;
          break;
        }
      }
      record(
        "attendance saved from the assistant's sheet",
        message.includes("حفظ"),
        `${marked} · ${message}`,
      );
    }

    socket.close();
  } finally {
    chrome.kill();
  }

  const { prisma } = load("src/lib/prisma.ts");
  const session = await prisma.attendanceSession.findFirst({
    where: { subjectId: data.subject.id, title: "محاضرة أنشأها المعاون" },
    select: { id: true, subjectId: true, createdById: true },
  });

  console.log("\nwhat reached the database:");
  record("the session exists on the supervisor's subject", session !== null);
  record(
    "the session is owned by the assistant",
    session?.createdById === data.assistant,
    String(session?.createdById),
  );

  const record_ = session
    ? await prisma.attendanceRecord.findFirst({
        where: { sessionId: session.id, status: "ABSENT" },
        select: { status: true, reason: true },
      })
    : null;
  record(
    "the absence and its reason were stored",
    record_?.status === "ABSENT" && record_.reason === "مرض",
    JSON.stringify(record_),
  );

  await prisma.$disconnect();

  console.log("\nhow the scope is resolved on the server:");
  const { loadProfessorScope } = load("src/lib/professor-auth.ts");
  const inherited = await loadProfessorScope(data.assistantUserId);
  const narrowed = await loadProfessorScope(data.narrowUserId);

  record(
    "an assistant with no subjects inherits the supervisor's scope",
    inherited !== null &&
      inherited.subjectIds.includes(data.subject.id) &&
      inherited.subjectIds.length === 1,
    JSON.stringify(inherited?.subjectIds),
  );
  record(
    "assigned subjects narrow instead of inheriting",
    narrowed !== null &&
      narrowed.subjectIds.length === 1 &&
      narrowed.subjectIds[0] === data.subject.id,
    JSON.stringify(narrowed?.subjectIds),
  );
  record(
    "the narrowed assistant cannot reach the supervisor's other subject",
    narrowed !== null && !narrowed.subjectIds.includes(data.second.id),
  );

  await cleanup();
  console.log("cleaned up the verification data");

  const failed = checks.filter(([, passed]) => !passed).length;
  console.log(
    failed === 0
      ? "\nALL ASSISTANT ATTENDANCE CHECKS PASSED"
      : `\n${failed} CHECK(S) FAILED`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});