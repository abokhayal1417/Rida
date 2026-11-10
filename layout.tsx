import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import Link from "next/link";
import { getProfile, isReviewer } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "رضا | تقييم الخدمات المدرسية",
  description: "منصة رضا لتقييم موظفي المدرسة وأقسامها",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const links: { href: string; label: string }[] = [];
  if (profile?.role === "parent") {
    links.push({ href: "/parent/evaluate", label: "تقييم موظف" }, { href: "/parent/evaluations", label: "تقييماتي" });
  }
  if (profile && isReviewer(profile.role)) {
    links.push(
      { href: "/quality/review", label: "تقييمات تحتاج مراجعة" },
      { href: "/quality/dashboard", label: "لوحة المؤشرات" },
    );
  }
  if (profile?.role === "school_admin") links.push({ href: "/quality/positions", label: "المناصب" });

  return (
    <html lang="ar" dir="rtl">
      <body className="font-sans antialiased">
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-xl font-bold text-brand">رضا</Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="text-muted hover:text-ink">{l.label}</Link>
              ))}
            </nav>
            {profile && (
              <form action="/auth/signout" method="post" className="ms-auto">
                <button className="text-sm text-muted hover:text-ink">تسجيل الخروج</button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
