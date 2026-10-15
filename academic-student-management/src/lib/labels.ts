export const roleLabels = {
  ADMIN: "مدير النظام",
  PROFESSOR: "عضو هيئة تدريس",
  STUDENT: "طالب",
} as const;

export const attendanceStatusLabels = {
  PRESENT: "حاضر",
  ABSENT: "غائب",
  EXCUSED: "غياب بعذر",
} as const;

export const examStatusLabels = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  CLOSED: "مغلق",
  ARCHIVED: "مؤرشف",
} as const;

export const attemptStatusLabels = {
  IN_PROGRESS: "قيد الإجابة",
  SUBMITTED: "تم التسليم",
  GRADED: "مصحح",
} as const;

export const questionTypeLabels = {
  MULTIPLE_CHOICE: "اختيار من متعدد",
  TRUE_FALSE: "صح وخطأ",
  SHORT_ANSWER: "إجابة قصيرة",
  ESSAY: "سؤال مقالي",
} as const;

export const difficultyLabels = {
  EASY: "سهل",
  MEDIUM: "متوسط",
  HARD: "صعب",
} as const;

export const activityLabels: Record<string, string> = {
  "auth.login": "تسجيل دخول",
  "student.create": "إضافة طالب",
  "student.update": "تعديل بيانات طالب",
  "student.delete": "حذف طالب",
  "subject.create": "إضافة مادة دراسية",
  "subject.update": "تعديل مادة دراسية",
  "subject.delete": "حذف مادة دراسية",
  "attendance.create": "إنشاء محاضرة",
  "attendance.update": "تسجيل حضور",
  "attendance.delete": "حذف محاضرة",
  "exam.create": "إنشاء امتحان",
  "exam.update": "تعديل امتحان",
  "exam.publish": "نشر امتحان",
  "exam.close": "إغلاق امتحان",
  "exam.delete": "حذف امتحان",
  "question.create": "إضافة سؤال للبنك",
  "question.update": "تعديل سؤال",
  "question.delete": "حذف سؤال",
  "question.import": "استيراد بنك أسئلة من إكسل",
  "exam.questions.update": "تعديل أسئلة امتحان",
  "exam.attempt.start": "بدء محاولة امتحان",
  "exam.attempt.submit": "تسليم إجابات امتحان",
  "exam.attempt.grade": "تصحيح إجابات امتحان",
  "announcement.create": "نشر إعلان",
  "announcement.update": "تعديل إعلان",
  "announcement.delete": "حذف إعلان",
  "term.create": "إضافة فصل دراسي",
  "term.update": "تعديل فصل دراسي",
  "term.delete": "حذف فصل دراسي",
  "term.activate": "تعيين الفصل الدراسي الحالي",
  "auth.password.change": "تغيير كلمة المرور",
  "professor.create": "إضافة حساب دكتور",
  "professor.update": "تعديل حساب دكتور",
  "professor.delete": "حذف حساب دكتور",
  "professor.activate": "تفعيل حساب دكتور",
  "professor.deactivate": "إيقاف حساب دكتور",
  "professor.assistant.create": "إضافة حساب عضو هيئة معاونة",
  "professor.permission.grant": "منح صلاحية لعضو هيئة التدريس",
  "professor.permission.revoke": "سحب صلاحية من عضو هيئة التدريس",
  "professor.scope.update": "تعديل نطاق مواد عضو هيئة التدريس",
};

export function activityLabel(action: string) {
  return activityLabels[action] ?? action;
}
