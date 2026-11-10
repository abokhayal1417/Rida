import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, ErrorBox, PageHeader, Stat } from "@/components/ui";
import { categoryLabel } from "@/lib/ai/classify";

type Row = { total: number; avg_overall: number | null; negative_count: number };

export default async function Dashboard() {
  await requireRole(["quality_manager", "school_admin"]);
  const supabase = await createClient();
  const [summary, byPos, byDept, trend, recurring, perf] = await Promise.all([
    supabase.from("v_eval_status_summary").select("*").maybeSingle(),
    supabase.from("v_eval_by_position").select("*").order("total", { ascending: false }),
    supabase.from("v_eval_by_department").select("*").order("total", { ascending: false }),
    supabase.from("v_satisfaction_trend").select("*").order("month", { ascending: true }),
    supabase.from("v_recurring_complaints").select("*").order("negative_90d", { ascending: false }),
    supabase.from("v_employee_performance").select("*").order("total", { ascending: false }).limit(20),
  ]);
  if ([summary, byPos, byDept, trend, recurring, perf].some((r) => r.error)) {
    return <ErrorBox message="تعذّر تحميل المؤشرات." />;
  }
  const s = summary.data ?? { total: 0, linked_verified: 0, unmatched: 0, ambiguous: 0, awaiting_review: 0, department_level: 0 };

  // Trend: last 6 months per position as a small table.
  const months = [...new Set((trend.data ?? []).map((t) => t.month as string))].slice(-6);
  const positions = [...new Set((trend.data ?? []).map((t) => t.position_name as string))];
  const cell = (pos: string, m: string) => (trend.data ?? []).find((t) => t.position_name === pos && t.month === m);

  return (
    <>
      <PageHeader title="لوحة المؤشرات" subtitle="أداء الموظفين الفردي يعتمد فقط على التقييمات المرتبطة بموظف موثّق." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="إجمالي التقييمات" value={s.total} />
        <Stat label="مرتبطة بموظف موثّق" value={s.linked_verified} />
        <Stat label="غير مرتبطة" value={s.unmatched} hint="لم يُعثر على موظف" />
        <Stat label="غير محسومة" value={s.ambiguous} />
        <Stat label="بانتظار المراجعة" value={<Link href="/quality/review" className="text-brand underline">{s.awaiting_review}</Link>} />
      </div>

      {s.total === 0 ? (
        <div className="mt-6"><EmptyState title="لا توجد تقييمات بعد" body="ستظهر المؤشرات بعد أول تقييم من أولياء الأمور." /></div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Bars title="التقييمات حسب المنصب" rows={(byPos.data ?? []).map((r) => ({ name: r.position_name, ...(r as Row) }))} />
          <Bars title="التقييمات حسب القسم" rows={(byDept.data ?? []).map((r) => ({ name: r.department_name, ...(r as Row) }))} />

          <section className="card lg:col-span-2">
            <h2 className="mb-3 font-bold">اتجاه الرضا حسب المنصب (متوسط شهري من 5)</h2>
            {months.length === 0 ? <p className="text-muted">لا بيانات.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th className="px-2 py-2 text-start">المنصب</th>
                      {months.map((m) => <th key={m} className="px-2 py-2 text-start">{new Date(m).toLocaleDateString("ar-SA", { month: "short", year: "numeric" })}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {positions.map((p) => (
                      <tr key={p}>
                        <td className="px-2 py-2 font-medium">{p}</td>
                        {months.map((m) => {
                          const c = cell(p, m);
                          return (
                            <td key={m} className={`px-2 py-2 tabular-nums ${c && c.avg_overall < 3 ? "text-danger font-semibold" : ""}`}>
                              {c ? `${c.avg_overall} (${c.total})` : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="mb-1 font-bold">شكاوى متكررة على مناصب</h2>
            <p className="mb-3 text-xs text-muted">3 تقييمات سلبية فأكثر خلال 90 يومًا. تخص المنصب وليس شخصًا بعينه.</p>
            {(recurring.data ?? []).length === 0 ? <p className="text-muted">لا توجد أنماط متكررة.</p> : (
              <ul className="space-y-2 text-sm">
                {recurring.data!.map((r) => (
                  <li key={r.position_id} className="flex justify-between gap-2 rounded-lg bg-danger-soft/50 px-3 py-2">
                    <span className="font-medium">{r.position_name}{r.top_ai_category && <span className="text-muted"> · {categoryLabel[r.top_ai_category] ?? r.top_ai_category}</span>}</span>
                    <span className="font-bold tabular-nums">{r.negative_90d}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="mb-1 font-bold">أداء الموظفين (روابط موثّقة فقط)</h2>
            <p className="mb-3 text-xs text-muted">التقييمات غير المحسومة أو بانتظار المراجعة مستبعدة.</p>
            {(perf.data ?? []).length === 0 ? <p className="text-muted">لا توجد تقييمات موثّقة بعد.</p> : (
              <table className="w-full text-sm">
                <thead className="text-muted"><tr><th className="py-1 text-start">الموظف</th><th className="py-1 text-start">العدد</th><th className="py-1 text-start">المتوسط</th><th className="py-1 text-start">سلبية</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {perf.data!.map((r) => (
                    <tr key={r.employee_id}>
                      <td className="py-1.5">{r.full_name_ar}</td>
                      <td className="py-1.5 tabular-nums">{r.total}</td>
                      <td className="py-1.5 tabular-nums">{r.avg_overall}</td>
                      <td className="py-1.5 tabular-nums">{r.negative_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Bars({ title, rows }: { title: string; rows: ({ name: string } & Row)[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="card">
      <h2 className="mb-3 font-bold">{title}</h2>
      {rows.length === 0 ? <p className="text-muted">لا بيانات.</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted tabular-nums">{r.total} · متوسط {r.avg_overall ?? "—"} · سلبية {r.negative_count}</span>
              </div>
              <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-paper" aria-hidden>
                <div className="bg-brand" style={{ width: `${((r.total - r.negative_count) / max) * 100}%` }} />
                <div className="bg-danger" style={{ width: `${(r.negative_count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
