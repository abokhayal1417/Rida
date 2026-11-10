"use client";
import { ErrorBox } from "@/components/ui";

export default function QualityError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <ErrorBox message="حدث خطأ أثناء تحميل الصفحة." />
      <button className="btn-ghost" onClick={reset}>إعادة المحاولة</button>
    </div>
  );
}
