/**
 * Round-trip check for the Excel upload path.
 *
 * The question template carries one sheet per question type and the server parser
 * looks each sheet up by its exact name, while the client splits the file into
 * chunk workbooks. This checks that a real template still parses after being
 * split, that every type survives, that a chunk keeps its own sheet name, and
 * that the flat student template keeps working unchanged.
 */
const XLSX = require("xlsx");
const { loadTs } = require("./.verify/loader.cjs");

const { splitWorkbookForImport, shiftChunkErrors, planContiguousChunks } = loadTs(
  "./src/lib/excel-chunks.ts",
);
const { parseQuestionRows, buildQuestionTemplateWorkbook } = loadTs("./src/lib/question-import.ts");
const { questionTemplateSheets, questionSheetLabel } = loadTs("./src/lib/question-excel.ts");
const { parseStudentExcel } = loadTs("./src/lib/student-import.ts");
const { buildStudentTemplateWorkbook } = loadTs("./src/lib/student-template.ts");
const { studentTemplateSheetName, studentTemplateColumnsLabels } = loadTs(
  "./src/lib/student-excel.ts",
);

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const toFile = (workbook) =>
  new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "upload.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

/** Rewrites a template sheet's body with real rows, keeping the header row. */
function fillSheet(workbook, sheetName, rows) {
  const sheet = workbook.Sheets[sheetName];
  const header = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" })[0];
  const filled = XLSX.utils.aoa_to_sheet([header, ...rows]);
  filled["!cols"] = sheet["!cols"];
  workbook.Sheets[sheetName] = filled;
}

const mcq = (n, i) => [
  `سؤال اختيار من متعدد رقم ${i}`,
  "متوسط",
  "الوحدة الأولى",
  `الفصل ${i}`,
  "",
  `الخيار الأول ${i}`,
  `الخيار الثاني ${i}`,
  `الخيار الثالث ${i}`,
  "",
  "",
  "",
  2,
  "",
  "",
];

const trueFalse = (i) => [
  `سؤال صح وخطأ رقم ${i}`,
  "سهل",
  i % 2 === 0 ? "صح" : "خطأ",
  "الوحدة الثانية",
  "",
  "",
  "",
  "",
];

const essay = (i) => [
  `سؤال مقالي رقم ${i}`,
  "صعب",
  "",
  "الوحدة الثالثة",
  "",
  `إجابة نموذجية ${i}`,
  `شرح ${i}`,
];

(async () => {
  console.log("question template -> chunks -> parser");

  const mcqRows = Array.from({ length: 30 }, (_, i) => mcq(30, i + 1));

  const template = buildQuestionTemplateWorkbook();
  fillSheet(template, "اختيار من متعدد", mcqRows);
  fillSheet(template, "صح وخطأ", [trueFalse(1), trueFalse(2)]);
  fillSheet(template, "سؤال مقالي", [essay(1)]);

  const plan = await splitWorkbookForImport(toFile(template), "questions");

  check("total rows counted", plan.total === 33, `got ${plan.total}`);
  check(
    "the 30 row sheet is split into two chunks and the others stay whole",
    plan.chunks.length === 4,
    `got ${plan.chunks.length}`,
  );
  check(
    "every chunk keeps its own sheet name",
    plan.sheetNames.every((name) => questionTemplateSheets.some((s) => s.sheetName === name)),
    plan.sheetNames.join(", "),
  );
  check(
    "the guide sheet is never uploaded",
    !plan.sheetNames.includes("إرشادات"),
    plan.sheetNames.join(", "),
  );

  // Feed every chunk to the real server parser, exactly as the action does.
  const seen = [];
  for (const chunk of plan.chunks) {
    const buffer = Buffer.from(await chunk.arrayBuffer());
    const parsed = parseQuestionRows(buffer);
    check(
      `chunk ${chunk.name} parses without errors`,
      parsed.errors.length === 0,
      JSON.stringify(parsed.errors),
    );
    seen.push(...parsed.rows);
  }

  check("no row was lost", seen.length === 33, `got ${seen.length}`);
  check(
    "every row carries the type of its own sheet",
    seen.filter((r) => r.type === "MULTIPLE_CHOICE").length === 30 &&
      seen.filter((r) => r.type === "TRUE_FALSE").length === 2 &&
      seen.filter((r) => r.type === "ESSAY").length === 1,
    seen.reduce((acc, r) => ({ ...acc, [r.type]: (acc[r.type] ?? 0) + 1 }), {}),
  );
  check(
    "an option from the multiple-choice sheet survived",
    seen.some((r) => r.type === "MULTIPLE_CHOICE" && r.optionTexts[1] === "الخيار الثاني 1"),
  );
  check(
    "a true/false answer survived",
    seen.some((r) => r.type === "TRUE_FALSE" && r.correctRaw === "خطأ"),
  );

  // Line numbers must point back at the original sheet, per sheet.
  const shifted = shiftChunkErrors([{ row: 2, message: "خطأ" }], plan.firstLines[0], plan.sheetNames[0]);
  check(
    "errors are shifted onto the original line and named",
    shifted[0].row === plan.firstLines[0] && shifted[0].message.startsWith("ورقة «"),
    JSON.stringify(shifted),
  );

  console.log("\nquestions file with no recognised sheet");
  let thrown = "";
  try {
    await splitWorkbookForImport(toFile(buildQuestionTemplateWorkbook()), "questions");
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  check(
    "an empty template explains which sheets it looked for",
    thrown.includes("اختيار من متعدد") && thrown.includes("إرشادات"),
    thrown,
  );

  console.log("\nstudent template still imports unchanged");
  const studentBook = buildStudentTemplateWorkbook(
    [{ id: "d1", code: "CS", name: "الحاسبات" }],
    [{ id: "s1", departmentId: "d1", code: "DB", name: "قواعد بيانات" }],
  );
  const sheetName = studentBook.SheetNames.includes(studentTemplateSheetName)
    ? studentTemplateSheetName
    : studentBook.SheetNames[0];
  const studentHeader = XLSX.utils.sheet_to_json(studentBook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: "",
  })[0];
  check("student header is the template header", studentHeader[1] === studentTemplateColumnsLabels[1]);

  const studentRows = Array.from({ length: 12 }, (_, i) => [
    String(i + 1),
    `طالب رقم ${i + 1}`,
    `student${i + 1}@example.com`,
    `2026${i + 1}`,
    "",
    "الحاسبات",
    "",
    2,
    "",
  ]);
  const studentFilled = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentFilled, XLSX.utils.aoa_to_sheet([studentHeader, ...studentRows]), "الطلاب");
  const studentFile = toFile(studentFilled);

  const studentPlan = await splitWorkbookForImport(studentFile, "students");
  check("student default kind still reads the first sheet", studentPlan.total === 12, `${studentPlan.total}`);
  check("student chunk keeps the one expected sheet name", studentPlan.sheetNames.every((n) => n === "الطلاب"));

  let studentParsed = [];
  for (const chunk of studentPlan.chunks) {
    studentParsed = studentParsed.concat(parseStudentExcel(Buffer.from(await chunk.arrayBuffer())));
  }
  check("every student row survived the split", studentParsed.length === 12, `${studentParsed.length}`);
  check(
    "serials came back in file order",
    studentParsed.map((r) => r.serial).join(",") === "1,2,3,4,5,6,7,8,9,10,11,12",
  );

  console.log("\nstudents sharing an email stay in one chunk");
  const shared = [
    ["1", "طالب أول", "same@example.com", "A1", "", "الحاسبات", "", 1, ""],
    ["2", "طالب ثان", "same@example.com", "A2", "", "الحاسبات", "", 1, ""],
    ["3", "طالب ثالث", "third@example.com", "A3", "", "الحاسبات", "", 1, ""],
  ];
  const sharedBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(sharedBook, XLSX.utils.aoa_to_sheet([studentHeader, ...shared]), "الطلاب");
  const sharedPlan = await splitWorkbookForImport(toFile(sharedBook), "students");
  check("the shared pair is not split apart", sharedPlan.chunks.length === 1, `${sharedPlan.chunks.length}`);

  console.log("\nheader labels keep the required-column star out of the match");
  check(
    "template header cells carry the star",
    questionSheetLabel("نص السؤال", true) === "نص السؤال *",
  );

  console.log("\ncontiguous chunk planner still groups by identity");
  // The shared pair straddles the chunk boundary, so the first chunk has to grow.
  const straddling = [
    ["1", "أول", "one@example.com", "A1"],
    ["2", "ثان", "pair@example.com", "A2"],
    ["3", "ثالث", "pair@example.com", "A3"],
    ["4", "رابع", "four@example.com", "A4"],
  ];
  const grouped = planContiguousChunks(straddling, { email: 2 }, 2);
  check(
    "a group cut by the boundary widens its chunk instead of splitting",
    grouped.length === 2 && grouped[0].length === 3 && grouped[1].length === 1,
    grouped.map((part) => part.length).join("/"),
  );
  check(
    "both rows of the pair land in the same chunk",
    grouped.filter((part) => part.some((row) => row[2] === "pair@example.com")).length === 1,
  );

  console.log(
    failures === 0 ? "\nALL QUESTION CHUNK CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();