const XLSX = require("xlsx");
const { loadTs } = require("./.verify/loader.cjs");

const wb = loadTs("./src/lib/attendance-export-workbook.ts");
const { missingLabel, statusLabels } = loadTs("./src/lib/attendance-export.ts");

// `AttendanceSession.date` is a `@db.Date`, which Prisma hands back as UTC
// midnight. Fixtures must be built the same way or the UTC parts read differently.
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const moment = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi));

const columns = [
  { sessionId: "s1", date: day(2026, 3, 1), title: "المحاضرة الأولى" },
  { sessionId: "s2", date: day(2026, 3, 8), title: "المحاضرة الثانية" },
  { sessionId: "s3", date: day(2026, 3, 15), title: null },
];

const matrix = {
  subjectName: "قواعد البيانات", subjectCode: "CS201", professorName: "د. أحمد محمد",
  attendanceLimit: 75, columns,
  rows: [
    { studentId: "u1", serial: "1", fullName: "أحمد علي", universityId: "2026002",
      academicYear: 2, departmentName: "الحاسبات", specializationName: "قواعد بيانات",
      statuses: new Map([["s1", "PRESENT"], ["s2", "ABSENT"], ["s3", "PRESENT"]]),
      reasons: new Map() },
    { studentId: "u2", serial: "2", fullName: "محمود حسن", universityId: "20260010",
      academicYear: 2, departmentName: "الحاسبات", specializationName: null,
      statuses: new Map([["s1", "PRESENT"]]),
      reasons: new Map() },
    { studentId: "u3", serial: null, fullName: "سارة إبراهيم", universityId: "20260100",
      academicYear: 3, departmentName: "الحاسبات", specializationName: "برمجيات",
      statuses: new Map([["s1", "EXCUSED"], ["s3", "ABSENT"]]),
      reasons: new Map([["s1", "مرض"]]) },
  ],
  present: 5, absent: 2, excused: 1, missing: 9 - 8, sessionsCount: 3, studentsCount: 3,
};

const sessionExport = {
  subjectName: "قواعد البيانات", subjectCode: "CS201", professorName: "د. أحمد محمد",
  title: "المحاضرة الأولى", date: moment(2026, 3, 1, 10, 30), attendanceLimit: 75,
  rows: [
    { serial: "1", fullName: "أحمد علي", universityId: "2026002", academicYear: 2,
      departmentName: "الحاسبات", specializationName: "قواعد بيانات", status: "PRESENT",
      reason: null, recordedAt: moment(2026, 3, 1, 10, 35) },
    { serial: "2", fullName: "محمود حسن", universityId: "20260010", academicYear: 2,
      departmentName: "الحاسبات", specializationName: null, status: "ABSENT",
      reason: "مرض", recordedAt: moment(2026, 3, 1, 10, 36) },
    { serial: null, fullName: "سارة إبراهيم", universityId: "20260100", academicYear: 3,
      departmentName: "الحاسبات", specializationName: "برمجيات", status: null,
      reason: null, recordedAt: null },
  ],
  present: 1, absent: 1, excused: 0, missing: 1,
};

let failures = 0;
const check = (label, condition) => {
  if (condition) console.log(`ok  : ${label}`);
  else { failures += 1; console.log(`FAIL: ${label}`); }
};
const ARABIC_DIGITS = /[٠-٩]/;

function read(buffer) {
  const book = XLSX.read(buffer, { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  return {
    name: book.SheetNames[0],
    sheet,
    raw: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }),
  };
}

// The pane and the merges live in the XML, so they are asserted on the file rather
// than on properties SheetJS would drop again when reading.
function sheetXml(buffer) {
  const cfb = XLSX.CFB.read(buffer, { type: "buffer" });
  const at = cfb.FullPaths.findIndex((p) =>
    p.replace(/^\//, "").endsWith("worksheets/sheet1.xml"));
  return Buffer.from(cfb.FileIndex[at].content).toString("utf8");
}

// ================= matrix =================
const matrixBuffer = wb.writeFrozenWorkbook(
  wb.buildAttendanceMatrixWorkbook(matrix), wb.matrixFrozenRows());
const m = read(matrixBuffer);
const a = m.raw;
const matrixXml = sheetXml(matrixBuffer);

const DATES = 7, STATE_TITLES = 8, REASON_TITLES = 9, TOTALS = 10, FIRST = 11;
// Each lecture owns a state column and a reason column: 6 identity + 3*2 + 4 summary.
const state = (lecture) => 6 + lecture * 2;
const reason = (lecture) => 6 + lecture * 2 + 1;
const SUMMARY = 6 + columns.length * 2;

const first = a[FIRST], second = a[FIRST + 1], third = a[FIRST + 2];

console.log("matrix sheet:", m.name);
check("sheet named after the subject code", m.name === "CS201");
check("summary uses latin digits only", !ARABIC_DIGITS.test(String(a[5][1])));
check("summary is readable", String(a[5][1]).includes("حاضر"));

// A Date cell moved these by a day, so the exact string is the regression guard.
check("first lecture date is exact", a[DATES][state(0)] === "2026-03-01");
check("second lecture date is exact", a[DATES][state(1)] === "2026-03-08");
check("third lecture date is exact", a[DATES][state(2)] === "2026-03-15");
check("reason column holds no second date", a[DATES][reason(0)] === null);
check("identity columns carry no dates", a[DATES][0] === null && a[DATES][5] === null);

check("state row keeps identity headers", a[STATE_TITLES][0] === "المسلسل");
check("state row holds lecture titles", a[STATE_TITLES][state(0)] === "المحاضرة الأولى");
check("untitled lecture falls back", a[STATE_TITLES][state(2)] === "بدون عنوان");
check("reason row is labelled per lecture",
  a[REASON_TITLES][reason(0)] === "الاعذار" && a[REASON_TITLES][reason(2)] === "الاعذار");
check("totals row labels itself", a[TOTALS][0] === "الإجمالي");
check("totals row leaves grid cells empty", a[TOTALS][state(0)] === null);

check("attendance limit is a number", a[4][1] === 75);
check("identity: serial", first[0] === "1");
check("identity: name", first[1] === "أحمد علي");
check("identity: university id", first[2] === "2026002");
check("identity: year is a number", first[3] === 2);

// The requested shape: one word of state, then the reason.
check("lecture 1 state", first[state(0)] === statusLabels.PRESENT);
check("lecture 2 state", first[state(1)] === statusLabels.ABSENT);
check("lecture 3 state", first[state(2)] === statusLabels.PRESENT);
check("present has no reason", first[reason(0)] === null);
check("absent has no reason cell", first[reason(1)] === null);
check("state is a single word", String(first[state(0)]).split(/\s+/).length === 1);

check("summary cols: present", first[SUMMARY] === 2);
check("summary cols: absent", first[SUMMARY + 1] === 1);
check("summary cols: excused", first[SUMMARY + 2] === 0);
check("percentage is a number Excel can total", typeof first[SUMMARY + 3] === "number");
check("percentage value is 66.7", first[SUMMARY + 3] === 66.7);
check("summary headers are labelled",
  a[STATE_TITLES][SUMMARY] === "محاضر" && a[STATE_TITLES][SUMMARY + 3] === "نسبة الحضور %");

check("unrecorded lecture is blank, not a label", second[state(1)] === null);
check("unrecorded lecture 2 blank", second[state(2)] === null);
check("all-present row is 100%", second[SUMMARY + 3] === 100);
check("blank serial preserved", third[0] === null);
check("excused state", third[state(0)] === statusLabels.EXCUSED);
check("excused reason is kept", third[reason(0)] === "مرض");
check("missing lecture blank", third[state(1)] === null);
check("absent has no reason cell", third[reason(2)] === null);
check("missing row counts two lectures",
  third[SUMMARY] + third[SUMMARY + 1] + third[SUMMARY + 2] === 2);

// Each date must visually cover both of its columns.
const mergeRefs = (m.sheet["!merges"] || []).map((merge) => `${merge.s.r},${merge.s.c}`);
check("three date merges, one per lecture", mergeRefs.length === 3);
check("merge sits on the date row and spans the pair",
  mergeRefs[0] === `${DATES},${state(0)}` &&
  m.sheet["!merges"][0].e.c === state(0) + 1);
check("the xml actually carries a merge", matrixXml.includes("<mergeCells"));
check("identity columns are not merged", !mergeRefs.includes(`${DATES},0`));

// ================= single session =================
const sessionBuffer = wb.writeFrozenWorkbook(
  wb.buildSessionAttendanceWorkbook(sessionExport), wb.sessionFrozenRows());
const s = read(sessionBuffer);
const r = s.raw;
const sessionXml = sheetXml(sessionBuffer);

console.log("session sheet:", s.name);
check("sheet name", s.name === "سجل المحاضرة");
check("info: subject with code", String(r[0][1]).includes("CS201"));
check("info: lecture title", r[1][1] === "المحاضرة الأولى");
check("info: professor", r[2][1] === "د. أحمد محمد");
check("info: date is exact", r[3][1] === "2026-03-01");
check("info: time is exact", r[4][1] === "2026-03-01 10:30");
check("info: attendance limit is a number", r[5][1] === 75);
check("info: percent label", r[5][0] === "حد الحضور %");
check("info: summary uses latin digits", !ARABIC_DIGITS.test(String(r[6][1])));
check("info: blank separator", r[7].every((cell) => cell === null));
check("header: serial first", r[8][0] === "المسلسل");
check("header: recording time", r[8][8] === "وقت التسجيل");

check("row 1: present", r[9][6] === statusLabels.PRESENT);
check("row 1: reason blank when present", r[9][7] === null);
check("row 1: year is a number", r[9][3] === 2);
check("row 1: recorded at is exact", r[9][8] === "2026-03-01 10:35");
check("row 2: absent", r[10][6] === statusLabels.ABSENT);
check("row 2: reason kept", r[10][7] === "مرض");
check("row 3: missing is labelled", r[11][6] === missingLabel);
check("row 3: missing has no time", r[11][8] === null);

// ================= panes =================
check("matrix pane is frozen", matrixXml.includes(`ySplit="${TOTALS + 1}"`));
check("matrix pane state is frozen", matrixXml.includes('state="frozen"'));
check("matrix pane top-left matches the split",
  matrixXml.includes(`topLeftCell="A${TOTALS + 2}"`));
check("only one sheetViews block", (matrixXml.match(/<sheetViews>/g) || []).length === 1);
check("session pane is frozen", sessionXml.includes('ySplit="9"'));
check("session pane top-left matches the split", sessionXml.includes('topLeftCell="A10"'));
check("session has one sheetViews block", (sessionXml.match(/<sheetViews>/g) || []).length === 1);
check("pane precedes sheetData",
  matrixXml.indexOf("<sheetViews>") < matrixXml.indexOf("<sheetData>"));

check("matrix file is a real zip", matrixBuffer[0] === 0x50 && matrixBuffer[1] === 0x4b);
check("session file is a real zip", sessionBuffer[0] === 0x50 && sessionBuffer[1] === 0x4b);

// ================= a subject with no lectures =================
const empty = { ...matrix, columns: [], rows: [], sessionsCount: 0, studentsCount: 0 };
const emptyBuffer = wb.writeFrozenWorkbook(
  wb.buildAttendanceMatrixWorkbook(empty), wb.matrixFrozenRows());
check("a subject with no lectures still writes a file",
  emptyBuffer[0] === 0x50 && emptyBuffer[1] === 0x4b);
check("empty matrix keeps the header rows", read(emptyBuffer).raw[STATE_TITLES][0] === "المسلسل");
check("empty matrix merges nothing",
  (read(emptyBuffer).sheet["!merges"] || []).length === 0);

// ====== a sheet built for a class where every lecture is an excuse =====
// The reason must show, and the state column must still say one word.
const allExcused = {
  ...matrix,
  rows: [{
    studentId: "u9", serial: "9", fullName: "نور حسن", universityId: "2026099",
    academicYear: 2, departmentName: "الحاسبات", specializationName: null,
    statuses: new Map([["s1", "EXCUSED"], ["s2", "EXCUSED"], ["s3", "EXCUSED"]]),
    reasons: new Map([["s1", "سفر"], ["s2", "مرض"], ["s3", null]]),
  }],
};
const excusedRead = read(
  wb.writeFrozenWorkbook(wb.buildAttendanceMatrixWorkbook(allExcused), wb.matrixFrozenRows()));
const excusedRow = excusedRead.raw[FIRST];
check("every excuse state is one word",
  excusedRow[state(0)] === "بعذر" && excusedRow[state(1)] === "بعذر" && excusedRow[state(2)] === "بعذر");
check("excuse reasons are kept per lecture",
  excusedRow[reason(0)] === "سفر" && excusedRow[reason(1)] === "مرض");
check("an excuse with no reason leaves the cell blank", excusedRow[reason(2)] === null);
check("an all-excused row has no attendance to measure", excusedRow[SUMMARY + 3] === null);

console.log(failures === 0 ? "\nALL WORKBOOK CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;