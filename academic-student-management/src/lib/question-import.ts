import type { DifficultyLevel, QuestionType } from "@prisma/client";
import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import {
  normalizeQuestionHeaderLabel,
  questionGuideSheetName,
  questionSheetLabel,
  questionTemplateSheets,
  type QuestionExcelColumn,
} from "@/lib/question-excel";
import { createQuestion, type QuestionFormValues, type QuestionOptionInput } from "@/lib/exams";

export type ExcelRowError = { row: number; message: string };

export type ImportFeedback = {
  status: "success" | "partial" | "error";
  message: string;
  errors: ExcelRowError[];
};

export type QuestionImportFeedback = ImportFeedback & {
  created: number;
  subjectCode: string;
  byType: Record<string, number>;
};

export type QuestionImportResult = {
  created: number;
  subjectCode: string;
  byType: Record<string, number>;
  errors: ExcelRowError[];
};

const emptyByType: Record<string, number> = {
  MULTIPLE_CHOICE: 0,
  TRUE_FALSE: 0,
  SHORT_ANSWER: 0,
  ESSAY: 0,
};

export type ParsedQuestionRow = {
  line: number;
  sheetName: string;
  type: QuestionType;
  text: string;
  difficultyRaw: string;
  unit: string;
  chapter: string;
  category: string;
  optionTexts: string[];
  correctRaw: string;
  correctAnswer: string;
  explanation: string;
};

const difficultyMap: Record<string, DifficultyLevel> = {
  سهل: "EASY",
  متوسط: "MEDIUM",
  صعب: "HARD",
  easy: "EASY",
  medium: "MEDIUM",
  hard: "HARD",
};

const trueAnswers = new Set(["صح", "true", "yes", "نعم", "1"]);
const falseAnswers = new Set(["خطأ", "false", "no", "لا", "0"]);

function hasData(row: unknown[]) {
  return row.some((cell) => String(cell ?? "").trim() !== "");
}

function resolveColumns(headers: unknown[], columns: QuestionExcelColumn[]) {
  const map = new Map<string, number>();
  const expected = new Map(columns.map((column) => [column.key, normalizeQuestionHeaderLabel(column.label)]));

  headers.forEach((header, index) => {
    const norm = normalizeQuestionHeaderLabel(String(header ?? ""));
    if (!norm) return;
    for (const [key, labelNorm] of expected) {
      if (!map.has(key) && norm === labelNorm) {
        map.set(key, index);
        break;
      }
    }
  });

  const missing = columns
    .filter((column) => column.required && !map.has(column.key))
    .map((column) => column.label);

  return { map, missing };
}

export function buildQuestionTemplateWorkbook(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  for (const sheetDef of questionTemplateSheets) {
    const headers = sheetDef.columns.map((column) =>
      questionSheetLabel(column.label, column.required),
    );
    const sheet = XLSX.utils.aoa_to_sheet([headers]);
    sheet["!cols"] = sheetDef.columns.map((column, index) => ({
      wch: index === 0 ? 48 : column.key === "text" || column.key === "explanation" ? 40 : 18,
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetDef.sheetName);
  }

  const start = "قالب بنك الأسئلة";
  const guideRows = [
    [start],
    [""],
    ["كلُّ نوع سؤال له ورقة مستقلة داخل هذا الملف. صفُّ الترويسة يحدّد الأعمدة، وكل صف بعده يمثّل سؤالاً جديداً."],
    ["قيم عمود «الصعوبة»: سهل أو متوسط أو صعب (أو EASY / MEDIUM / HARD)."],
    ...questionTemplateSheets.map((sheetDef) => [`ورقة «${sheetDef.sheetName}»: ${sheetDef.guide}`]),
    ["عمود «التصنيف» اختياري: إن تُرك فارغاً أُضيف السؤال دون تصنيف، وإن كُتب اسم تصنيف جديد يُنشأ تلقائياً."],
    ["بعد التعبئة، ارفع الملف من صفحة المادة ليُضاف كل صف إلى بنك أسئلة المادة."],
  ];
  const guide = XLSX.utils.aoa_to_sheet(guideRows);
  guide["!cols"] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, guide, questionGuideSheetName);

  return workbook;
}

export function parseQuestionRows(buffer: Buffer): {
  rows: ParsedQuestionRow[];
  errors: ExcelRowError[];
} {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const rows: ParsedQuestionRow[] = [];
  const errors: ExcelRowError[] = [];

  for (const sheetDef of questionTemplateSheets) {
    const sheet = workbook.Sheets[sheetDef.sheetName];
    if (!sheet) continue;

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    const headerIndex = aoa.findIndex(hasData);
    if (headerIndex === -1) continue;

    const { map, missing } = resolveColumns(aoa[headerIndex], sheetDef.columns);
    if (missing.length > 0) {
      errors.push({
        row: headerIndex + 2,
        message: `ورقة «${sheetDef.sheetName}»: الأعمدة المطلوبة مفقودة: ${missing.join("، ")}.`,
      });
      continue;
    }

    const cell = (row: unknown[], key: string) => {
      const index = map.get(key);
      if (index === undefined) return "";
      const value = row[index];
      return value === null || value === undefined ? "" : String(value).trim();
    };

    for (let r = headerIndex + 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      if (!hasData(row)) continue;

      const optionTexts: string[] = [];
      for (let n = 1; n <= 6; n++) optionTexts.push(cell(row, `optionText${n}`));

      rows.push({
        line: r + 1,
        sheetName: sheetDef.sheetName,
        type: sheetDef.type,
        text: cell(row, "text"),
        difficultyRaw: cell(row, "difficulty"),
        unit: cell(row, "unit"),
        chapter: cell(row, "chapter"),
        category: cell(row, "category"),
        optionTexts,
        correctRaw: cell(row, "correctNumber") || cell(row, "correct"),
        correctAnswer: cell(row, "correctAnswer"),
        explanation: cell(row, "explanation"),
      });
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 1, message: "لم يُعثر على أي صف بيانات في الملف." });
  }

  return { rows, errors };
}

export type ValidatedQuestion = {
  input: QuestionFormValues;
  options: QuestionOptionInput[];
  categoryName: string;
};

function resolveDifficulty(raw: string): DifficultyLevel {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "MEDIUM";
  const value = difficultyMap[normalized];
  if (!value) throw new Error(`قيمة الصعوبة غير معروفة: «${raw}» (استخدم: سهل / متوسط / صعب).`);
  return value;
}

export function validateQuestionRow(row: ParsedQuestionRow): ValidatedQuestion {
  const text = row.text.trim();
  if (text.length < 5) throw new Error("نص السؤال مطلوب (5 أحرف على الأقل).");
  if (text.length > 1000) throw new Error("نص السؤال طويل جداً (1000 حرف كحد أقصى).");

  const difficulty = resolveDifficulty(row.difficultyRaw);
  const categoryName = row.category.trim();
  const explanation = row.explanation.trim();
  const unit = row.unit.trim();
  const chapter = row.chapter.trim();

  let options: QuestionOptionInput[] = [];
  let correctAnswer = row.correctAnswer.trim();

  if (row.type === "MULTIPLE_CHOICE") {
    const filled = row.optionTexts.map((option) => option.trim()).filter(Boolean);
    if (filled.length < 2) throw new Error("سؤال الاختيار من متعدد يحتاج خيارين على الأقل.");

    const correctNumber = Number(row.correctRaw);
    if (!Number.isInteger(correctNumber) || correctNumber < 1 || correctNumber > filled.length) {
      throw new Error(`حدد رقم الإجابة الصحيحة (من 1 إلى ${filled.length}).`);
    }

    options = filled.map((textValue, index) => ({
      text: textValue,
      isCorrect: index + 1 === correctNumber,
    }));
  }

  if (row.type === "TRUE_FALSE") {
    const normalized = row.correctRaw.trim().toLowerCase();
    let isTrue: boolean | null = null;
    if (trueAnswers.has(normalized)) isTrue = true;
    else if (falseAnswers.has(normalized)) isTrue = false;
    else throw new Error("الإجابة الصحيحة يجب أن تكون «صح» أو «خطأ».");

    correctAnswer = isTrue ? "true" : "false";
    options = [
      { text: "صح", isCorrect: isTrue },
      { text: "خطأ", isCorrect: !isTrue },
    ];
  }

  return {
    input: {
      subjectId: "", // filled by the importer
      createdById: "", // filled by the importer
      categoryId: "",
      text,
      type: row.type,
      difficulty,
      unit,
      chapter,
      correctAnswer,
      explanation,
    },
    options,
    categoryName,
  };
}

export async function importQuestionsForSubjectFromExcel(
  buffer: Buffer,
  subjectId: string,
  actorId: string,
): Promise<QuestionImportResult> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: {
      id: true,
      code: true,
      professors: { orderBy: { isPrimary: "desc" }, take: 1, select: { professorId: true } },
    },
  });
  if (!subject) throw new Error("المادة غير موجودة.");
  if (!subject.professors[0]) throw new Error("لا يوجد عضو هيئة تدريس مسؤول عن هذه المادة.");

  const creatorId = subject.professors[0].professorId;
  const { rows, errors } = parseQuestionRows(buffer);

  const result: QuestionImportResult = {
    created: 0,
    subjectCode: subject.code,
    byType: { ...emptyByType },
    errors,
  };

  const categoryCache = new Map<string, string>();

  for (const row of rows) {
    try {
      const draft = validateQuestionRow(row);
      let categoryId = "";
      if (draft.categoryName) {
        const cached = categoryCache.get(draft.categoryName);
        if (cached) {
          categoryId = cached;
        } else {
          const category = await prisma.questionCategory.upsert({
            where: { subjectId_name: { subjectId, name: draft.categoryName } },
            update: {},
            create: { subjectId, name: draft.categoryName },
            select: { id: true },
          });
          categoryCache.set(draft.categoryName, category.id);
          categoryId = category.id;
        }
      }

      await createQuestion(
        { ...draft.input, subjectId, createdById: creatorId, categoryId },
        draft.options,
        actorId,
      );
      result.created++;
      result.byType[row.type]++;
    } catch (error) {
      result.errors.push({
        row: row.line,
        message: `(${row.sheetName}) ${error instanceof Error ? error.message : "خطأ غير معروف."}`,
      });
    }
  }

  if (rows.length > 0) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "question.import",
        entity: "Subject",
        entityId: subjectId,
        metadata: {
          questionImport: true,
          code: subject.code,
          created: result.created,
          byType: result.byType,
        },
      },
    });
  }

  return result;
}