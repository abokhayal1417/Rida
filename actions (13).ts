"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const err = (m: string) => redirect(`/login?error=${encodeURIComponent(m)}`);

export async function signIn(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (error) err("البريد أو كلمة المرور غير صحيحة.");
  redirect("/");
}

export async function signUp(form: FormData) {
  const password = String(form.get("password") ?? "");
  if (password.length < 8) err("كلمة المرور يجب ألا تقل عن 8 أحرف.");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: String(form.get("email") ?? ""),
    password,
    options: {
      data: {
        full_name: String(form.get("full_name") ?? "").slice(0, 120),
        school_code: String(form.get("school_code") ?? "").trim().toUpperCase().slice(0, 32),
      },
    },
  });
  if (error) err("تعذّر إنشاء الحساب. ربما البريد مسجّل مسبقًا.");
  // With email confirmation off, sign-up already returns a session.
  redirect(data.session ? "/" : "/login?sent=1");
}
