"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { errorMessage } from "@/lib/evaluation/flow";

export async function replyAction(form: FormData) {
  await requireRole(["parent"]);
  const id = String(form.get("id") ?? "");
  const body = String(form.get("body") ?? "").trim().slice(0, 2000);
  const supabase = await createClient();
  const { error } = await supabase.rpc("parent_reply", { p_eval: id, p_body: body });
  if (error) redirect(`/parent/evaluations?error=${encodeURIComponent(errorMessage(error.message))}`);
  revalidatePath("/parent/evaluations");
  redirect("/parent/evaluations?ok=1");
}
