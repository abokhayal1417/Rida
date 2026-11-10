"use client";
import { useState, useTransition } from "react";
import { ErrorBox } from "@/components/ui";
import {
  keepDepartment,
  markReviewed,
  requestClarification,
  setEmployee,
  suggestWithAI,
  type ActionResult,
} from "../actions";

export type Candidate = { id: string; name: string; active: boolean };

export default function ReviewActions(props: {
  id: string;
  reviewerRole: string;
  candidates: Candidate[];
  candidateSource: string;
  allEmployees: Candidate[];
  canContactParent: boolean;
  currentEmployeeId: string | null;
  reviewState: string;
}) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (label: string, fn: () => Promise<ActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    setDone(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else setDone(label);
    });
  };

  return (
    <section className="card space-y-5">
      <h2 className="font-bold">إجراءات المراجعة</h2>
      {error && <ErrorBox message={error} />}
      {done && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand" role="status">تم: {done}. سُجّل في سجل التدقيق.</p>}

      <div>
        <label className="label" htmlFor="note">ملاحظة المراجعة (تُحفظ في سجل التدقيق)</label>
        <textarea id="note" className="field min-h-16" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div>
        <h3 className="text-sm font-bold">
          {props.candidateSource === "matcher" ? "المرشحون من سجلات الإسناد" : "من يشغلون المنصب المختار"}
        </h3>
        {props.candidateSource !== "matcher" && props.candidates.length > 0 && (
          <p className="mt-1 text-xs text-amber">لم يطابق أيٌّ منهم سياق التقييم في سجل الإسناد. لا تؤكد إلا بدليل إضافي.</p>
        )}
        {props.candidates.length === 0 ? (
          <p className="mt-1 text-sm text-muted">لا يوجد مرشحون في السجلات لهذا السياق.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {props.candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="text-sm">{c.name}{!c.active && <span className="text-muted"> (غير نشط)</span>}{props.currentEmployeeId === c.id && <span className="text-brand"> — مرتبط حاليًا</span>}</span>
                <button className={`${props.candidateSource === "matcher" ? "btn-primary" : "btn-ghost"} px-3 py-1.5`} disabled={pending}
                        onClick={() => run("تأكيد الموظف", () => setEmployee(props.id, c.id, note),
                          `تأكيد ربط التقييم بـ ${c.name}؟ سيُحتسب في سجل أدائه.`)}>
                  تأكيد
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="label" htmlFor="other">تصحيح أو اختيار موظف آخر</label>
        <div className="flex gap-2">
          <select id="other" className="field" value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">اختر موظفًا</option>
            {props.allEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn-ghost shrink-0" disabled={pending || !other}
                  onClick={() => run(props.currentEmployeeId ? "تصحيح الموظف" : "ربط الموظف", () => setEmployee(props.id, other, note),
                    "هل تملك دليلًا كافيًا على أن هذا الموظف هو المعني؟")}>
            ربط
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">استخدمه فقط عند وجود دليل واضح. التقييم السلبي يُحتسب في سجل الموظف بعد الربط.</p>
      </div>

      <div className="grid gap-2">
        <button className="btn-ghost" disabled={pending} onClick={() => run("الإبقاء على مستوى القسم", () => keepDepartment(props.id, note))}>
          إبقاء التقييم على مستوى القسم
        </button>
        <button className="btn-ghost" disabled={pending || props.reviewState === "reviewed"} onClick={() => run("تمت المراجعة", () => markReviewed(props.id, note))}>
          وضع علامة «تمت المراجعة»
        </button>
        <button className="btn-ghost" disabled={pending} onClick={() => run("حفظ اقتراح التصنيف", () => suggestWithAI(props.id))}>
          {pending ? "جارٍ التنفيذ…" : "اقتراح بالذكاء الاصطناعي"}
        </button>
      </div>

      <div>
        <label className="label" htmlFor="msg">طلب توضيح من وليّ الأمر</label>
        {props.canContactParent ? (
          <>
            <textarea id="msg" className="field min-h-16" maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)}
                      placeholder="مثال: هل تذكر وقت الحصة أو مكان الموقف؟" />
            <button className="btn-ghost mt-2 w-full" disabled={pending || !message.trim()}
                    onClick={() => run("إرسال طلب التوضيح", () => requestClarification(props.id, message))}>
              إرسال الطلب
            </button>
          </>
        ) : (
          <p className="text-sm text-muted">التقييم مُرسل دون هوية، لذا لا يمكن التواصل مع مرسله.</p>
        )}
      </div>
    </section>
  );
}
