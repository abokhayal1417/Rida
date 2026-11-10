import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, ErrorBox, PageHeader, StatusBadge } from "@/components/ui";

const FILTERS = [
  ["all", "الكل"],
  ["pending_review", "بانتظار المراجعة"],
  ["ambiguous", "غير محسوم"],
  ["unmatched", "غير مرتبط"],
  ["clarification", "بانتظار رد وليّ الأمر"],
] as const;

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireRole(["quality_manager", "school_admin"]);
  const { f = "all" } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("v_review_queue")
    .select("*")
    .order("is_negative", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (f === "clarification") query = query.eq("review_state", "clarification_requested");
  else if (f !== "all") query = query.eq("employee_matching_status", f);
  const { data, error } = await query;

  return (
    <>
      <PageHeader
        title="تقييمات تحتاج مراجعة"
        subtitle="تقييمات لم يُحدَّد فيها الموظف بأدلة كافية، أو سلبية تحتاج تحققًا قبل احتسابها في سجل أي موظف."
      />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="تصفية">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/quality/review?f=${k}`}
                className={`rounded-full border px-3 py-1.5 text-sm ${f === k ? "border-brand bg-brand text-white" : "border-line bg-card"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {error && <ErrorBox message="تعذّر تحميل قائمة المراجعة." />}
      {!error && data?.length === 0 && <EmptyState title="لا توجد تقييمات بانتظار المراجعة" body="كل التقييمات الحالية محسومة." />}

      {/* mobile: cards; desktop: table */}
      <div className="space-y-3 md:hidden">
        {data?.map((r) => (
          <Link key={r.id} href={`/quality/review/${r.id}`} className="card block">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold tabular-nums" dir="ltr">{r.reference_no}</span>
              <StatusBadge status={r.employee_matching_status} />
            </div>
            <p className="mt-1 text-sm">{[r.department_name, r.position_name].filter(Boolean).join(" · ")}</p>
            <p className="text-sm text-muted">{[r.stage_name, r.grade_name, r.class_name && `فصل ${r.class_name}`, r.subject_name].filter(Boolean).join(" · ")}</p>
            {r.comments_preview && <p className="mt-2 line-clamp-2 text-sm">{r.comments_preview}</p>}
          </Link>
        ))}
      </div>

      {data && data.length > 0 && (
        <div className="hidden overflow-x-auto rounded-2xl border border-line bg-card md:block">
          <table className="w-full text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                {["المرجع", "القسم", "المنصب", "المرحلة", "الصف/الفصل", "الحالة", "ملاحظات وليّ الأمر", "المرشحون", ""].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((r) => (
                <tr key={r.id} className={r.is_negative ? "bg-danger-soft/30" : ""}>
                  <td className="px-3 py-2.5 font-semibold tabular-nums" dir="ltr">{r.reference_no}</td>
                  <td className="px-3 py-2.5">{r.department_name ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.position_name ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.stage_name ?? "—"}</td>
                  <td className="px-3 py-2.5">{[r.grade_name, r.class_name].filter(Boolean).join(" / ") || "—"}{r.subject_name ? ` · ${r.subject_name}` : ""}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.employee_matching_status} />
                    {r.review_state === "clarification_requested" && <span className="mt-1 block text-xs text-amber">بانتظار رد</span>}
                  </td>
                  <td className="max-w-xs px-3 py-2.5"><span className="line-clamp-2">{r.comments_preview ?? "—"}</span></td>
                  <td className="px-3 py-2.5 tabular-nums">{r.candidate_count}</td>
                  <td className="px-3 py-2.5"><Link className="btn-ghost px-3 py-1.5" href={`/quality/review/${r.id}`}>مراجعة</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
