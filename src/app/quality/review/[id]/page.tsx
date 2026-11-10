import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox, PageHeader, StatusBadge } from "@/components/ui";
import { categoryLabel } from "@/lib/ai/classify";
import ReviewActions, { type Candidate } from "./ReviewActions";

const ACTION_LABEL: Record<string, string> = {
  submitted: "إرسال التقييم",
  match_confirmed: "تأكيد الموظف",
  match_corrected: "تصحيح الموظف",
  kept_department_level: "إبقاء على مستوى القسم",
  clarification_requested: "طلب توضيح",
  parent_replied: "رد وليّ الأمر",
  marked_reviewed: "تمت المراجعة",
  ai_suggestion_saved: "حفظ اقتراح التصنيف",
};
const METHOD_LABEL: Record<string, string> = {
  auto_unique_assignment: "تطابق فريد مع سجل الإسناد",
  parent_selected_by_name: "اختيار وليّ الأمر بالاسم",
  manual_quality_review: "مراجعة الجودة",
  none: "لا يوجد",
};
type Named = { name_ar: string } | null;

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(["quality_manager", "school_admin"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: ev, error } = await supabase
    .from("evaluations")
    .select(`*, departments:selected_department_id(name_ar), positions:selected_position_id(name_ar),
             stage:selected_stage_id(name_ar), grade:selected_grade_id(name_ar), klass:selected_class_id(name_ar),
             subject:selected_subject_id(name_ar), parent:parent_id(full_name),
             evaluation_scores(score, evaluation_criteria(name_ar, sort)),
             evaluation_messages(id, author_role, body, created_at)`)
    .eq("id", id)
    .maybeSingle();
  if (error) return <ErrorBox message="تعذّر تحميل التقييم." />;
  if (!ev) notFound();

  // Candidates: matcher suggestions first; otherwise current holders of the selected position.
  let candidates: Candidate[] = [];
  let candidateSource = "matcher";
  if (ev.suggested_employee_ids?.length) {
    const { data } = await supabase.from("employees").select("id, full_name_ar, active").in("id", ev.suggested_employee_ids);
    candidates = (data ?? []).map((e) => ({ id: e.id, name: e.full_name_ar, active: e.active }));
  } else if (ev.selected_position_id) {
    candidateSource = "position";
    const { data } = await supabase
      .from("employees")
      .select("id, full_name_ar, active, employee_assignments!inner(position_id)")
      .eq("employee_assignments.position_id", ev.selected_position_id);
    candidates = (data ?? []).map((e) => ({ id: e.id, name: e.full_name_ar, active: e.active }));
  }
  const [{ data: allEmployees }, { data: audit }, matched] = await Promise.all([
    supabase.from("employees").select("id, full_name_ar").eq("active", true).order("full_name_ar"),
    supabase.from("evaluation_audit_log").select("id, action, note, created_at, actor:actor_id(full_name)").eq("evaluation_id", id).order("id"),
    ev.matched_employee_id
      ? supabase.from("employees").select("full_name_ar").eq("id", ev.matched_employee_id).single()
      : Promise.resolve({ data: null as { full_name_ar: string } | null }),
  ]);

  const ai = ev.ai_classification as null | {
    category: string; explanation: string; confidence: string; source: string;
    suggested_department_code: string | null; suggested_position_code: string | null; suggested_employee_ids: string[];
  };
  const scores = [...(ev.evaluation_scores ?? [])].sort(
    (a, b) => ((a.evaluation_criteria as unknown as { sort: number })?.sort ?? 0) - ((b.evaluation_criteria as unknown as { sort: number })?.sort ?? 0),
  );
  const nameOf = (o: unknown) => (o as Named)?.name_ar;
  const ctx = [nameOf(ev.stage), nameOf(ev.grade), nameOf(ev.klass) && `فصل ${nameOf(ev.klass)}`, nameOf(ev.subject)].filter(Boolean).join(" · ");

  return (
    <>
      <Link href="/quality/review" className="text-sm text-muted hover:text-ink">← العودة إلى القائمة</Link>
      <PageHeader title={`التقييم ${ev.reference_no}`} subtitle={new Date(ev.created_at).toLocaleString("ar-SA")} actions={<StatusBadge status={ev.employee_matching_status} />} />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="card">
            <h2 className="mb-3 font-bold">ما اختاره وليّ الأمر</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Item k="نوع التقييم" v={{ position: "حسب المنصب", employee: "حسب الاسم", department: "حسب القسم" }[ev.evaluation_target_type as string]} />
              <Item k="القسم" v={nameOf(ev.departments)} />
              <Item k="المنصب" v={nameOf(ev.positions)} />
              <Item k="السياق" v={ctx} />
              <Item k="تاريخ الموقف" v={ev.incident_date} />
              <Item k="طريقة الربط" v={METHOD_LABEL[ev.employee_matching_method ?? ""] ?? "—"} />
              <Item k="الموظف المرتبط" v={matched.data?.full_name_ar ?? "لا يوجد"} />
              <Item k="المُرسل" v={ev.anonymous_submission ? "دون هوية" : ((ev.parent as unknown as { full_name: string } | null)?.full_name ?? "وليّ أمر")} />
              {ev.follow_up_requested && <Item k="التواصل للمتابعة" v={[ev.contact_name, ev.contact_phone, ev.contact_email].filter(Boolean).join(" · ")} />}
            </dl>
          </section>

          <section className="card">
            <h2 className="mb-3 font-bold">ملاحظات وليّ الأمر</h2>
            <p className="whitespace-pre-wrap">{ev.comments || <span className="text-muted">لا توجد ملاحظات مكتوبة.</span>}</p>
            {ev.suggested_improvements && (
              <>
                <h3 className="mt-4 text-sm font-bold">مقترحات التحسين</h3>
                <p className="mt-1 whitespace-pre-wrap">{ev.suggested_improvements}</p>
              </>
            )}
            <div className="mt-4 grid gap-2 border-t border-line pt-4 text-sm sm:grid-cols-2">
              {scores.map((s, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span>{nameOf(s.evaluation_criteria)}</span>
                  <span className={`font-semibold tabular-nums ${s.score <= 2 ? "text-danger" : ""}`}>{s.score}/5</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 font-bold">
                <span>الرضا العام</span>
                <span className={`tabular-nums ${ev.overall_satisfaction <= 2 ? "text-danger" : ""}`}>{ev.overall_satisfaction}/5</span>
              </div>
            </div>
          </section>

          {(ev.evaluation_messages ?? []).length > 0 && (
            <section className="card">
              <h2 className="mb-3 font-bold">المراسلات</h2>
              <div className="space-y-2">
                {[...ev.evaluation_messages].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => (
                  <p key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.author_role === "reviewer" ? "bg-amber-soft" : "bg-paper"}`}>
                    <span className="font-semibold">{m.author_role === "reviewer" ? "الجودة: " : "وليّ الأمر: "}</span>{m.body}
                  </p>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h2 className="mb-3 font-bold">سجل التدقيق</h2>
            <ol className="space-y-2 text-sm">
              {(audit ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <span>
                    <span className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span>
                    {a.note && <span className="text-muted"> — {a.note}</span>}
                  </span>
                  <span className="text-muted">
                    {(a.actor as unknown as { full_name: string } | null)?.full_name ?? (a.action === "submitted" ? "وليّ الأمر" : "—")} ·{" "}
                    {new Date(a.created_at).toLocaleString("ar-SA")}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          {ai && (
            <section className="card border-amber/40">
              <h2 className="font-bold">اقتراح {ai.source === "ai" ? "الذكاء الاصطناعي" : "التصنيف الآلي"}</h2>
              <p className="mt-1 text-xs text-muted">اقتراح فقط. لا يُربط أي موظف إلا بقرارك.</p>
              <p className="mt-3 text-sm"><span className="font-semibold">التصنيف: </span>{categoryLabel[ai.category] ?? ai.category}</p>
              <p className="text-sm"><span className="font-semibold">الثقة: </span>{{ low: "منخفضة", medium: "متوسطة", high: "مرتفعة" }[ai.confidence]}</p>
              <p className="mt-2 text-sm">{ai.explanation}</p>
              {ai.suggested_employee_ids?.length > 0 && (
                <p className="mt-2 text-sm"><span className="font-semibold">مرشّح مقترح: </span>
                  {ai.suggested_employee_ids.map((x) => candidates.find((c) => c.id === x)?.name ?? "—").join("، ")}</p>
              )}
            </section>
          )}
          <ReviewActions
            id={ev.id}
            reviewerRole={profile.role}
            candidates={candidates}
            candidateSource={candidateSource}
            allEmployees={(allEmployees ?? []).map((e) => ({ id: e.id, name: e.full_name_ar, active: true }))}
            canContactParent={!ev.anonymous_submission && !!ev.parent_id}
            currentEmployeeId={ev.matched_employee_id}
            reviewState={ev.review_state}
          />
        </aside>
      </div>
    </>
  );
}

function Item({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium">{v || "—"}</dd>
    </div>
  );
}
