import { redirect } from "next/navigation";
import { getProfile, isReviewer } from "@/lib/auth";

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const { denied } = await searchParams;
  if (!denied) {
    if (profile.role === "parent" && profile.school_id) redirect("/parent/evaluate");
    if (isReviewer(profile.role) && profile.school_id) redirect("/quality/review");
  }
  return (
    <div className="card max-w-xl">
      <h1 className="text-xl font-bold">مرحبًا {profile.full_name ?? ""}</h1>
      <p className="mt-2 text-muted">
        {!profile.school_id
          ? "حسابك غير مرتبط بمدرسة بعد. تواصل مع إدارة المدرسة لتفعيله."
          : "لا توجد صفحة متاحة لدورك الحالي، أو ليست لديك صلاحية للصفحة المطلوبة."}
      </p>
    </div>
  );
}
