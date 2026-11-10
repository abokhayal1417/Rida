"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  buildPayload,
  errorMessage,
  type ContextField,
  type MatchStatus,
  type PrivacyChoice,
  type SubmitPayload,
} from "@/lib/evaluation/flow";

// Plain 8-4-4-4-12 hex check (Postgres validates the rest).
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).nullish();
const Ctx = z.object({
  stage_id: uuid,
  department_id: uuid,
  position_id: uuid,
  grade_id: uuid,
  class_id: uuid,
  subject_id: uuid,
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export type PreviewResult = { ok: true; status: MatchStatus; needs: ContextField[] } | { ok: false; error: string };

export async function previewMatch(ctx: unknown): Promise<PreviewResult> {
  await requireRole(["parent"]);
  const parsed = Ctx.safeParse(ctx);
  if (!parsed.success) return { ok: false, error: errorMessage("invalid_input") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_match", { p: parsed.data });
  if (error) return { ok: false, error: errorMessage(error.message) };
  return { ok: true, status: data.status, needs: data.needs ?? [] };
}

export async function searchEmployees(q: string) {
  await requireRole(["parent"]);
  const term = String(q ?? "").trim().slice(0, 60);
  if (term.length < 2) return { ok: true as const, rows: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_employees", { q: term });
  if (error) return { ok: false as const, error: errorMessage(error.message) };
  return { ok: true as const, rows: (data ?? []) as { id: string; full_name_ar: string; positions: string | null }[] };
}

const Submit = Ctx.extend({
  target_type: z.enum(["position", "employee", "department"]),
  employee_id: uuid,
  overall_satisfaction: z.number().int().min(1).max(5),
  scores: z.record(z.string().max(40), z.number().int().min(1).max(5)),
  comments: z.string().max(4000).optional(),
  suggested_improvements: z.string().max(4000).optional(),
  anonymous: z.boolean(),
  follow_up: z.boolean(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(40).optional(),
  contact_email: z.string().max(200).optional(),
});

export type SubmitResult = { ok: true; reference_no: string; status: MatchStatus | null } | { ok: false; error: string };

export async function submitEvaluation(input: unknown, privacy: PrivacyChoice): Promise<SubmitResult> {
  await requireRole(["parent"]);
  if (!["identified", "anonymous", "follow_up"].includes(privacy)) return { ok: false, error: errorMessage("invalid_input") };
  const parsed = Submit.safeParse(input);
  if (!parsed.success) return { ok: false, error: "بعض الحقول غير مكتملة أو غير صالحة." };
  const payload = buildPayload(parsed.data as SubmitPayload, privacy);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_evaluation", { p: payload });
  if (error) return { ok: false, error: errorMessage(error.message) };
  return { ok: true, reference_no: data.reference_no, status: data.status ?? null };
}
