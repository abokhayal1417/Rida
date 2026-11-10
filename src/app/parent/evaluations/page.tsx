import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { outcomeMessage, type TargetType, type MatchStatus } from "@/lib/evaluation/flow";
import { replyAction } from "./actions";

export default async function MyEvaluations({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireRole(["parent"]);
  const { error, ok } = await searchParams;
  const supabase = await createClient();
  const { data, error: loadError } = await supabase
    .from("evaluations")
    .select(`id, reference_no, created_at, evaluation_target_type, employee_matching_status, review_state, overall_satisfaction,
             departments:selected_department_id(name_ar), positions:selected_position_id(name_ar),
             evaluation_messages(id, author_role, body, created_at)`)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <>
      <PageHeader title="تقييماتي" subtitle="التقييمات المُرسلة باسمك. التقييمات دون هوية لا تظهر هنا." />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {ok && <p className="mb-4 rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand">تم إرسال ردّك إلى مدير الجودة.</p>}
      {loadError && <ErrorBox message="تعذّر تحميل تقييماتك." />}
      {!loadError && (!data || data.length === 0) && <EmptyState title="لا توجد تقييمات بعد" body="ابدأ من «تقييم موظف»." />}
      <div className="space-y-3">
        {data?.map((e) => {
          const dept = (e.departments as unknown as { name_ar: string } | null)?.name_ar;
          const pos = (e.positions as unknown as { name_ar: string } | null)?.name_ar;
          const msgs = [...(e.evaluation_messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
          return (
            <article key={e.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{[dept, pos].filter(Boolean).join(" · ") || "تقييم موظف"}</p>
                <span className="text-sm text-muted tabular-nums" dir="ltr">{e.reference_no}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {new Date(e.created_at).toLocaleDateString("ar-SA")} · الرضا العام {e.overall_satisfaction}/5
              </p>
              <p className="mt-2 text-sm">
                {e.review_state === "reviewed"
                  ? "راجع مدير الجودة هذا التقييم."
                  : outcomeMessage(e.employee_matching_status as MatchStatus | null, e.evaluation_target_type as TargetType)}
              </p>
              {msgs.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-line pt-3">
                  {msgs.map((m) => (
                    <p key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.author_role === "reviewer" ? "bg-amber-soft" : "bg-paper"}`}>
                      <span className="font-semibold">{m.author_role === "reviewer" ? "مدير الجودة: " : "أنت: "}</span>
                      {m.body}
                    </p>
                  ))}
                </div>
              )}
              {e.review_state === "clarification_requested" && (
                <form action={replyAction} className="mt-3 space-y-2">
                  <input type="hidden" name="id" value={e.id} />
                  <label className="label" htmlFor={`reply-${e.id}`}>ردّك على طلب التوضيح</label>
                  <textarea id={`reply-${e.id}`} name="body" required maxLength={2000} className="field min-h-20" />
                  <button className="btn-primary">إرسال الرد</button>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
