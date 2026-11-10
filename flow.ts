// Pure logic for the evaluation wizard. No I/O, fully unit-tested.

export type TargetType = "position" | "employee" | "department";
export type MatchStatus = "matched" | "ambiguous" | "unmatched" | "pending_review" | "manually_verified";
export type ContextField = "stage" | "grade" | "class" | "subject";

export type Context = {
  stage_id?: string | null;
  department_id?: string | null;
  position_id?: string | null;
  grade_id?: string | null;
  class_id?: string | null;
  subject_id?: string | null;
  incident_date?: string | null;
};

export type Position = {
  id: string;
  code: string;
  department_id: string;
  name_ar: string;
  requires_subject_and_class: boolean;
};

export type Criterion = { id: string; code: string; name_ar: string; position_codes: string[] | null };

/** Criteria shown for a target. Department/name evaluations get the shared set only. */
export function criteriaFor(all: Criterion[], target: TargetType, position?: Position | null): Criterion[] {
  return all.filter((c) => {
    if (!c.position_codes) return true;
    return target === "position" && !!position && c.position_codes.includes(position.code);
  });
}

/** Fields the parent must still fill before the position step is complete. */
export function missingRequired(ctx: Context, position: Position | null | undefined): ContextField[] {
  if (!position) return [];
  const missing: ContextField[] = [];
  if (position.requires_subject_and_class) {
    if (!ctx.subject_id) missing.push("subject");
    if (!ctx.grade_id) missing.push("grade");
    if (!ctx.class_id) missing.push("class");
  }
  return missing;
}

/**
 * What the wizard does after a preview_match result.
 * - matched/unmatched: continue to the form (unmatched still submits; it goes to review).
 * - ambiguous with needs: ask only for those fields, and only ones still empty.
 * - ambiguous with no needs: nothing more the parent can add; continue, reviewer decides.
 */
export function nextStepAfterPreview(
  preview: { status: MatchStatus; needs: ContextField[] },
  ctx: Context,
): { action: "continue" } | { action: "ask"; fields: ContextField[] } {
  if (preview.status !== "ambiguous") return { action: "continue" };
  const key: Record<ContextField, keyof Context> = {
    stage: "stage_id",
    grade: "grade_id",
    class: "class_id",
    subject: "subject_id",
  };
  const fields = preview.needs.filter((f) => !ctx[key[f]]);
  return fields.length ? { action: "ask", fields } : { action: "continue" };
}

/** Parent-facing explanation of the outcome. Never names the employee. */
export function outcomeMessage(status: MatchStatus | null, target: TargetType): string {
  if (target === "department") return "سُجّل تقييمك على مستوى القسم، وستطّلع عليه إدارة الجودة.";
  switch (status) {
    case "matched":
      return "تم ربط تقييمك بالموظف المسؤول عن هذا المنصب بناءً على سجلات الإسناد في المدرسة.";
    case "pending_review":
      return "تقييمك محفوظ، وسيتحقق مدير الجودة من الموظف المعني قبل احتسابه في سجله.";
    case "ambiguous":
      return "يوجد أكثر من موظف محتمل لهذا المنصب، لذا سيراجع مدير الجودة تقييمك لتحديد الموظف بدقة.";
    case "unmatched":
    default:
      return "لم نتمكن من تحديد الموظف من البيانات المتاحة. حُفظ تقييمك وأُحيل إلى مدير الجودة للمراجعة.";
  }
}

export type PrivacyChoice = "identified" | "anonymous" | "follow_up";

export const privacyText: Record<PrivacyChoice, { title: string; body: string }> = {
  identified: {
    title: "إرسال باسمي",
    body: "يرى مدير الجودة أن التقييم منك، ويمكنه طلب توضيح عبر المنصة. لا يظهر اسمك للموظف المُقيَّم.",
  },
  anonymous: {
    title: "إرسال دون هوية",
    body: "لا يُحفظ أي رابط بين التقييم وحسابك، ولن تراه في قائمة تقييماتك، ولا يمكن التواصل معك بشأنه. انتبه: تفاصيل مثل الصف والفصل قد تُضيّق دائرة من كتب التقييم.",
  },
  follow_up: {
    title: "أطلب متابعة",
    body: "يُرسل التقييم باسمك مع وسيلة تواصل يراها مدير الجودة فقط ليعود إليك بالنتيجة.",
  },
};

export type SubmitPayload = Context & {
  target_type: TargetType;
  employee_id?: string | null;
  overall_satisfaction: number;
  scores: Record<string, number>;
  comments?: string;
  suggested_improvements?: string;
  anonymous: boolean;
  follow_up: boolean;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
};

/** Builds the RPC payload and drops anything the chosen privacy mode must not carry. */
export function buildPayload(input: SubmitPayload, privacy: PrivacyChoice): SubmitPayload {
  const p: SubmitPayload = { ...input, anonymous: privacy === "anonymous", follow_up: privacy === "follow_up" };
  if (privacy !== "follow_up") {
    delete p.contact_name;
    delete p.contact_phone;
    delete p.contact_email;
  }
  if (p.target_type !== "employee") delete p.employee_id;
  if (p.target_type === "department") {
    delete p.position_id;
    delete p.grade_id;
    delete p.class_id;
    delete p.subject_id;
  }
  for (const k of Object.keys(p) as (keyof SubmitPayload)[]) {
    if (p[k] === "" || p[k] === null || p[k] === undefined) delete p[k];
  }
  return p;
}

const ERRORS: Record<string, string> = {
  overall_required: "اختر مستوى الرضا العام.",
  subject_and_class_required: "عند تقييم معلم، اختر المادة والصف والفصل.",
  anonymous_not_allowed: "سياسة المدرسة لا تسمح بالتقييم دون هوية.",
  follow_up_requires_identity: "طلب المتابعة يتطلب الإرسال باسمك.",
  follow_up_requires_contact: "أدخل رقم جوال أو بريدًا إلكترونيًا للمتابعة.",
  invalid_incident_date: "تاريخ الواقعة يجب أن يكون خلال السنة الماضية وليس في المستقبل.",
  daily_limit_reached: "وصلت إلى الحد اليومي للتقييمات. حاول غدًا.",
  not_authorized: "ليست لديك صلاحية لهذا الإجراء.",
  anonymous_cannot_be_contacted: "هذا التقييم دون هوية، ولا يمكن التواصل مع مرسله.",
  message_required: "اكتب نص الرسالة.",
  invalid_employee: "الموظف غير موجود في هذه المدرسة.",
};

export function errorMessage(raw: string | undefined | null): string {
  if (!raw) return "حدث خطأ غير متوقع. حاول مرة أخرى.";
  const key = raw.split(":")[0].trim();
  if (ERRORS[key]) return ERRORS[key];
  if (key.startsWith("invalid_")) return "بعض الاختيارات غير صالحة. راجعها وحاول مرة أخرى.";
  return "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

export const statusLabel: Record<string, string> = {
  matched: "مرتبط تلقائيًا",
  manually_verified: "تم التحقق يدويًا",
  ambiguous: "غير محسوم",
  unmatched: "غير مرتبط",
  pending_review: "بانتظار المراجعة",
};

export const fieldLabel: Record<ContextField, string> = {
  stage: "المرحلة الدراسية",
  grade: "الصف",
  class: "الفصل",
  subject: "المادة",
};
