import "server-only";
import { z } from "zod";

export type ClassifyInput = {
  comments: string;
  improvements: string;
  selectedDepartment?: string | null;
  selectedPosition?: string | null;
  departments: { code: string; name_ar: string }[];
  positions: { code: string; name_ar: string; department_code: string }[];
  /** Only employees the reviewer is already authorized to see. */
  candidates: { id: string; name: string; positions: string }[];
};

export const CATEGORIES = [
  "communication",
  "responsiveness",
  "professionalism",
  "teaching_quality",
  "safety",
  "respect",
  "procedures",
  "praise",
  "other",
] as const;

export const categoryLabel: Record<string, string> = {
  communication: "التواصل",
  responsiveness: "سرعة الاستجابة",
  professionalism: "المهنية",
  teaching_quality: "جودة التدريس",
  safety: "السلامة",
  respect: "التعامل باحترام",
  procedures: "الإجراءات",
  praise: "إشادة",
  other: "أخرى",
};

const Result = z.object({
  category: z.enum(CATEGORIES),
  suggested_department_code: z.string().nullable(),
  suggested_position_code: z.string().nullable(),
  suggested_employee_ids: z.array(z.string()).max(5),
  confidence: z.enum(["low", "medium", "high"]),
  explanation: z.string().max(1200),
});
export type ClassifyResult = z.infer<typeof Result> & { source: "ai" | "rules" };

/** Keyword fallback when no API key is configured or the API fails. */
export function ruleClassify(input: ClassifyInput): ClassifyResult {
  const text = `${input.comments} ${input.improvements}`;
  const rules: { cat: (typeof CATEGORIES)[number]; words: string[]; dept?: string; pos?: string }[] = [
    { cat: "safety", words: ["حافلة", "باص", "سائق", "النقل", "سلامة", "خطر"], dept: "transport", pos: "transport_supervisor" },
    { cat: "teaching_quality", words: ["شرح", "درس", "واجب", "اختبار", "حصة", "منهج", "درجات"], dept: "teaching", pos: "teacher" },
    { cat: "procedures", words: ["تسجيل", "قبول", "نقل الطالب", "أوراق", "مستندات"], dept: "admissions", pos: "admissions_officer" },
    { cat: "responsiveness", words: ["تأخر", "لم يرد", "لا يرد", "انتظار", "متأخر", "رد"] },
    { cat: "communication", words: ["تواصل", "إبلاغ", "رسالة", "اتصال", "إشعار"] },
    { cat: "respect", words: ["احترام", "أسلوب", "إهانة", "صراخ", "تعامل"] },
    { cat: "praise", words: ["شكر", "ممتاز", "رائع", "متعاون", "أشكر"] },
  ];
  const hit = rules.find((r) => r.words.some((w) => text.includes(w)));
  const matched = hit ? hit.words.filter((w) => text.includes(w)) : [];
  return {
    category: hit?.cat ?? "other",
    suggested_department_code: hit?.dept ?? null,
    suggested_position_code: hit?.pos ?? null,
    suggested_employee_ids: [],
    confidence: "low",
    explanation: hit
      ? `تصنيف آلي بالكلمات المفتاحية: ظهرت كلمات مثل «${matched.slice(0, 3).join("، ")}». لم تُقترح أسماء موظفين لأن المطابقة بالكلمات لا تكفي لتحديد الهوية.`
      : "لم تظهر كلمات مفتاحية واضحة. يحتاج التقييم إلى قراءة بشرية.",
    source: "rules",
  };
}

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !input.comments.trim()) return ruleClassify(input);

  const prompt = `أنت مساعد لمدير جودة في مدرسة. صنّف تقييم وليّ الأمر التالي واقترح القسم والمنصب المعنيين.
قواعد صارمة:
- اقترح موظفين فقط من قائمة المرشحين، وفقط إذا كان النص يشير إليهم بوضوح (اسم، مادة، دور محدد). وإلا أعد قائمة فارغة.
- لا تخمّن هوية أي شخص. اقتراحك ليس قرارًا؛ المراجع البشري يقرر.
- اشرح بالعربية في جملتين أو ثلاث سبب التصنيف والاقتراح.
أعد JSON فقط بالحقول: category (${CATEGORIES.join("|")}), suggested_department_code, suggested_position_code, suggested_employee_ids, confidence (low|medium|high), explanation.

القسم الذي اختاره وليّ الأمر: ${input.selectedDepartment ?? "غير محدد"}
المنصب الذي اختاره: ${input.selectedPosition ?? "غير محدد"}
الأقسام: ${JSON.stringify(input.departments)}
المناصب: ${JSON.stringify(input.positions)}
المرشحون: ${JSON.stringify(input.candidates)}
نص التقييم: """${input.comments.slice(0, 3000)}"""
اقتراحات التحسين: """${input.improvements.slice(0, 1500)}"""`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = Result.parse(JSON.parse(json));
    // Never trust ids that were not in the authorized candidate list.
    const allowed = new Set(input.candidates.map((c) => c.id));
    parsed.suggested_employee_ids = parsed.suggested_employee_ids.filter((id) => allowed.has(id));
    return { ...parsed, source: "ai" };
  } catch (e) {
    console.error("AI classification failed, using rules", e);
    return ruleClassify(input);
  }
}
