"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { errorMessage } from "@/lib/evaluation/flow";
import { classify } from "@/lib/ai/classify";

export type ActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max = 2000) => String(s ?? "").trim().slice(0, max) || null;

async function rpc(fn: string, args: Record<string, unknown>, id: string): Promise<ActionResult> {
  await requireRole(["quality_manager", "school_admin"]);
  if (!UUID.test(id)) return { ok: false, error: errorMessage("invalid_input") };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: errorMessage(error.message) };
  revalidatePath(`/quality/review/${id}`);
  revalidatePath("/quality/review");
  revalidatePath("/quality/dashboard");
  return { ok: true };
}

export async function setEmployee(id: string, employeeId: string, note: string) {
  if (!UUID.test(employeeId)) return { ok: false, error: "اختر موظفًا." } as ActionResult;
  return rpc("review_set_employee", { p_eval: id, p_employee: employeeId, p_note: clean(note) }, id);
}
export async function keepDepartment(id: string, note: string) {
  return rpc("review_keep_department", { p_eval: id, p_note: clean(note) }, id);
}
export async function requestClarification(id: string, message: string) {
  return rpc("review_request_clarification", { p_eval: id, p_message: clean(message) }, id);
}
export async function markReviewed(id: string, note: string) {
  return rpc("review_mark_reviewed", { p_eval: id, p_note: clean(note) }, id);
}

/** AI suggestion. Reads only what this reviewer can already see (RLS), stores a suggestion, links nobody. */
export async function suggestWithAI(id: string): Promise<ActionResult> {
  await requireRole(["quality_manager", "school_admin"]);
  if (!UUID.test(id)) return { ok: false, error: errorMessage("invalid_input") };
  const supabase = await createClient();
  const { data: ev, error } = await supabase
    .from("evaluations")
    .select("id, comments, suggested_improvements, suggested_employee_ids, selected_position_id, selected_department_id, departments:selected_department_id(name_ar), positions:selected_position_id(name_ar)")
    .eq("id", id)
    .single();
  if (error || !ev) return { ok: false, error: "التقييم غير موجود." };

  const [depts, positions, emps] = await Promise.all([
    supabase.from("departments").select("id, code, name_ar"),
    supabase.from("positions").select("code, name_ar, department_id"),
    // Candidates: the matcher's suggestions, or holders of the selected position.
    ev.suggested_employee_ids?.length
      ? supabase.from("employees").select("id, full_name_ar, employee_assignments(positions(name_ar))").in("id", ev.suggested_employee_ids)
      : ev.selected_position_id
        ? supabase.from("employees").select("id, full_name_ar, employee_assignments!inner(position_id, positions(name_ar))")
            .eq("employee_assignments.position_id", ev.selected_position_id).eq("active", true).limit(20)
        : Promise.resolve({ data: [] as { id: string; full_name_ar: string; employee_assignments: unknown }[] }),
  ]);
  const deptCode = new Map((depts.data ?? []).map((d) => [d.id, d.code]));
  const result = await classify({
    comments: ev.comments ?? "",
    improvements: ev.suggested_improvements ?? "",
    selectedDepartment: (ev.departments as unknown as { name_ar: string } | null)?.name_ar,
    selectedPosition: (ev.positions as unknown as { name_ar: string } | null)?.name_ar,
    departments: (depts.data ?? []).map((d) => ({ code: d.code, name_ar: d.name_ar })),
    positions: (positions.data ?? []).map((p) => ({ code: p.code, name_ar: p.name_ar, department_code: deptCode.get(p.department_id) ?? "" })),
    candidates: (emps.data ?? []).map((e) => ({
      id: e.id,
      name: e.full_name_ar,
      positions: ((e.employee_assignments as { positions: { name_ar: string } | null }[] | null) ?? [])
        .map((a) => a.positions?.name_ar).filter(Boolean).join("، "),
    })),
  });
  return rpc("review_save_ai", { p_eval: id, p_ai: result }, id);
}
