import type { QuestionType } from "@prisma/client";

export type QuestionExcelColumn = {
  key: string;
  label: string;
  required: boolean;
};

export type QuestionExcelSheet = {
  type: QuestionType;
  sheetName: string;
  guide: string;
  columns: QuestionExcelColumn[];
};

/**
 * Single source of truth for the question-bank Excel template. Every question
 * type has its own sheet inside the same file. The builder, the sheet-missing
 * check and the row parser all read from this list so the downloadable
 * template always matches what the importer understands.
 */
export const questionTemplateSheets: QuestionExcelSheet[] = [
  {
    type: "MULTIPLE_CHOICE",
    sheetName: "اختيار من متعدد",
    guide: "اكتب الخيارات في أعمدة «الخيار 1..6»، ثم ضع رقم الخيار الصحيح في عمود «رقم الإجابة الصحيحة» (مثلاً 2).",
    columns: [
      { key: "text", label: "نص السؤال", required: true },
      { key: "difficulty", label: "الصعوبة", required: true },
      { key: "unit", label: "الوحدة", required: false },
      { key: "chapter", label: "الفصل", required: false },
      { key: "category", label: "التصنيف", required: false },
      { key: "optionText1", label: "الخيار 1", required: false },
      { key: "optionText2", label: "الخيار 2", required: false },
      { key: "optionText3", label: "الخيار 3", required: false },
      { key: "optionText4", label: "الخيار 4", required: false },
      { key: "optionText5", label: "الخيار 5", required: false },
      { key: "optionText6", label: "الخيار 6", required: false },
      { key: "correctNumber", label: "رقم الإجابة الصحيحة", required: true },
      { key: "correctAnswer", label: "الإجابة النموذجية", required: false },
      { key: "explanation", label: "الشرح", required: false },
    ],
  },
  {
    type: "TRUE_FALSE",
    sheetName: "صح وخطأ",
    guide: "اكتب «صح» أو «خطأ» في عمود «الإجابة الصحيحة»، ويُبنى الخياران (صح / خطأ) تلقائياً.",
    columns: [
      { key: "text", label: "نص السؤال", required: true },
      { key: "difficulty", label: "الصعوبة", required: true },
      { key: "correct", label: "الإجابة الصحيحة", required: true },
      { key: "unit", label: "الوحدة", required: false },
      { key: "chapter", label: "الفصل", required: false },
      { key: "category", label: "التصنيف", required: false },
      { key: "explanation", label: "الشرح", required: false },
    ],
  },
  {
    type: "SHORT_ANSWER",
    sheetName: "إجابة قصيرة",
    guide: "اكتب الإجابة النموذجية في عمود «الإجابة النموذجية».",
    columns: [
      { key: "text", label: "نص السؤال", required: true },
      { key: "difficulty", label: "الصعوبة", required: true },
      { key: "correctAnswer", label: "الإجابة النموذجية", required: false },
      { key: "unit", label: "الوحدة", required: false },
      { key: "chapter", label: "الفصل", required: false },
      { key: "category", label: "التصنيف", required: false },
      { key: "explanation", label: "الشرح", required: false },
    ],
  },
  {
    type: "ESSAY",
    sheetName: "سؤال مقالي",
    guide: "اكتب الإجابة النموذجية في عمود «الإجابة النموذجية».",
    columns: [
      { key: "text", label: "نص السؤال", required: true },
      { key: "difficulty", label: "الصعوبة", required: true },
      { key: "correctAnswer", label: "الإجابة النموذجية", required: false },
      { key: "unit", label: "الوحدة", required: false },
      { key: "chapter", label: "الفصل", required: false },
      { key: "category", label: "التصنيف", required: false },
      { key: "explanation", label: "الشرح", required: false },
    ],
  },
];

/** Sheet appended last with human-readable instructions (ignored by the importer). */
export const questionGuideSheetName = "إرشادات";

/** Column label used in the empty template; trailing " *" marks a required column. */
export function questionSheetLabel(label: string, required: boolean) {
  return required ? `${label} *` : label;
}

/** Header matching ignores case, whitespace and the required-column star. */
export function normalizeQuestionHeaderLabel(value: string) {
  return value.trim().replace(/[\s*]+/g, "").toLowerCase();
}