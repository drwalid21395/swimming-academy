"use client";

import { ClipboardList, Eye } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  RowSelectCheckbox,
  SelectAllRowsCheckbox,
  SelectionBar,
  TableSelectionProvider,
  useSelectedRows,
  useTableSelection,
} from "@/components/ui/table-selection";
import type { QuestionListItem } from "@/lib/exams";

import { CreateExamFromSelectionDialog, type ExamCreatorChoice, type ExamSubjectChoice } from "./create-exam-from-selection-dialog";
import { ExamPreviewDialog } from "./exam-preview-dialog";

/**
 * The two things a tick selection of questions leads to: previewing the picked
 * questions as a practice set, or building an exam out of them.
 *
 * It reads the selection from the shared context rather than being handed the
 * chosen rows, so it cannot drift out of step with the checkboxes.
 */
function QuestionBulkActions({
  creators,
  examHrefBase,
  questions,
  subjects,
}: {
  creators: ExamCreatorChoice[];
  examHrefBase?: string;
  questions: QuestionListItem[];
  subjects: ExamSubjectChoice[];
}) {
  const { clear } = useTableSelection();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const selected = useSelectedRows(questions, (question) => question.id);

  return (
    <>
      <Button onClick={() => setPreviewOpen(true)} size="sm" type="button" variant="ghost">
        <Eye aria-hidden className="size-4" />
        معاينة كنموذج تدريب
      </Button>
      <Button onClick={() => setCreateOpen(true)} size="sm" type="button" variant="primary">
        <ClipboardList aria-hidden className="size-4" />
        إنشاء امتحان بهذه الأسئلة
      </Button>

      <ExamPreviewDialog
        onClose={() => setPreviewOpen(false)}
        open={previewOpen}
        questions={selected}
      />
      <CreateExamFromSelectionDialog
        creators={creators}
        examHrefBase={examHrefBase}
        onClose={() => {
          setCreateOpen(false);
          clear();
        }}
        open={createOpen}
        questions={selected}
        subjects={subjects}
      />
    </>
  );
}

/** Wraps the question bank table so rows can be ticked and turned into an exam. */
export function QuestionSelectionProvider({
  children,
  creators,
  questions,
  subjects,
  examHrefBase,
}: {
  children: React.ReactNode;
  creators: ExamCreatorChoice[];
  questions: QuestionListItem[];
  subjects: ExamSubjectChoice[];
  examHrefBase?: string;
}) {
  return (
    <TableSelectionProvider ids={questions.map((question) => question.id)}>
      {children}

      <SelectionBar
        noun="سؤال"
        // Arabic counts differently here: "سؤال" becomes "أسئلة" past ten, and the
        // row total makes "3 من 120 سؤال" read more naturally than a bare count.
        nounPlural="سؤال"
      >
        <QuestionBulkActions
          creators={creators}
          examHrefBase={examHrefBase}
          questions={questions}
          subjects={subjects}
        />
      </SelectionBar>
    </TableSelectionProvider>
  );
}

export function QuestionSelectCheckbox({ questionId }: { questionId: string }) {
  return <RowSelectCheckbox id={questionId} label="تحديد السؤال" />;
}

export function SelectAllQuestionsCheckbox() {
  return <SelectAllRowsCheckbox label="تحديد كل الأسئلة المعروضة" />;
}