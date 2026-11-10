import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "parent" | "employee" | "quality_manager" | "school_admin";

export type SessionProfile = {
  id: string;
  role: Role;
  school_id: string | null;
  full_name: string | null;
};

export async function getProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, school_id, full_name")
    .eq("id", user.id)
    .single();
  return (data as SessionProfile) ?? null;
}

/** Server-side gate. RLS still applies underneath; this only decides which page renders. */
export async function requireRole(roles: Role[]): Promise<SessionProfile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!roles.includes(profile.role) || !profile.school_id) redirect("/?denied=1");
  return profile;
}

export const isReviewer = (r: Role) => r === "quality_manager" || r === "school_admin";
