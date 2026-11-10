import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox, PageHeader } from "@/components/ui";

async function addPosition(form: FormData) {
  "use server";
  const profile = await requireRole(["school_admin"]);
  const name = String(form.get("name_ar") ?? "").trim().slice(0, 120);
  const dept = String(form.get("department_id") ?? "");
  const code = String(form.get("code") ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);
  if (!name || !dept || !code) redirect("/quality/positions?error=" + encodeURIComponent("أكمل الاسم والرمز والقسم."));
  const supabase = await createClient();
  const { error } = await supabase.from("positions").insert({
    school_id: profile.school_id,
    department_id: dept,
    code,
    name_ar: name,
    requires_subject_and_class: form.get("requires") === "on",
    sort: 100,
  });
  if (error) redirect("/quality/positions?error=" + encodeURIComponent("تعذّر الحفظ. ربما الرمز مستخدم."));
  revalidatePath("/quality/positions");
  redirect("/quality/positions");
}

async function toggle(form: FormData) {
  "use server";
  await requireRole(["school_admin"]);
  const supabase = await createClient();
  await supabase.from("positions").update({ active: form.get("active") === "true" }).eq("id", String(form.get("id")));
  revalidatePath("/quality/positions");
}

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireRole(["school_admin"]);
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: depts }, { data: positions }] = await Promise.all([
    supabase.from("departments").select("id, name_ar").order("sort"),
    supabase.from("positions").select("id, code, name_ar, active, requires_subject_and_class, department_id").order("sort"),
  ]);
  return (
    <>
      <PageHeader title="المناصب القابلة للتقييم" subtitle="أضف مناصب جديدة أو أوقف منصبًا. الإيقاف لا يحذف التقييمات السابقة." />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      <form action={addPosition} className="card mb-6 grid gap-3 sm:grid-cols-4 sm:items-end">
        <div><label className="label" htmlFor="name_ar">اسم المنصب</label><input id="name_ar" name="name_ar" className="field" required /></div>
        <div><label className="label" htmlFor="code">الرمز (إنجليزي)</label><input id="code" name="code" className="field" dir="ltr" placeholder="librarian" required /></div>
        <div>
          <label className="label" htmlFor="department_id">القسم</label>
          <select id="department_id" name="department_id" className="field" required>
            {depts?.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requires" /> يتطلب المادة والفصل</label>
        <button className="btn-primary sm:col-span-4">إضافة المنصب</button>
      </form>
      <div className="card divide-y divide-line p-0">
        {positions?.map((p) => (
          <form key={p.id} action={toggle} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <span>
              <span className="font-semibold">{p.name_ar}</span>
              <span className="text-sm text-muted"> · {depts?.find((d) => d.id === p.department_id)?.name_ar}{p.requires_subject_and_class ? " · يتطلب المادة والفصل" : ""}</span>
            </span>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="active" value={String(!p.active)} />
            <button className="btn-ghost px-3 py-1.5">{p.active ? "إيقاف" : "تفعيل"}</button>
          </form>
        ))}
      </div>
    </>
  );
}
