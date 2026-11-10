import { signIn, signUp } from "./actions";
import { ErrorBox } from "@/components/ui";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold">الدخول إلى رضا</h1>
      <p className="mb-6 text-muted">منصة تقييم الخدمات المدرسية لأولياء الأمور وإدارة الجودة.</p>
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {sent && <p className="mb-4 rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand">تم إنشاء الحساب. إن طُلب منك تأكيد البريد فافتح الرسالة ثم سجّل الدخول.</p>}
      <form className="card space-y-4">
        <div>
          <label className="label" htmlFor="email">البريد الإلكتروني</label>
          <input id="email" name="email" type="email" required className="field" dir="ltr" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">كلمة المرور</label>
          <input id="password" name="password" type="password" required minLength={8} className="field" dir="ltr" autoComplete="current-password" />
        </div>
        <div>
          <label className="label" htmlFor="full_name">الاسم (عند إنشاء حساب جديد)</label>
          <input id="full_name" name="full_name" className="field" autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="school_code">رمز المدرسة (عند إنشاء حساب جديد)</label>
          <input id="school_code" name="school_code" className="field" dir="ltr" autoComplete="off" />
          <p className="mt-1 text-xs text-muted">تحصل عليه من إدارة المدرسة، ويربط حسابك بمدرستك.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button formAction={signIn} className="btn-primary flex-1">دخول</button>
          <button formAction={signUp} className="btn-ghost flex-1">إنشاء حساب وليّ أمر</button>
        </div>
      </form>
    </div>
  );
}
