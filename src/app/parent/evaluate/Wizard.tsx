"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  criteriaFor,
  fieldLabel,
  missingRequired,
  nextStepAfterPreview,
  outcomeMessage,
  privacyText,
  type Context,
  type ContextField,
  type Criterion,
  type MatchStatus,
  type Position,
  type PrivacyChoice,
  type TargetType,
} from "@/lib/evaluation/flow";
import { ErrorBox, Spinner } from "@/components/ui";
import { previewMatch, searchEmployees, submitEvaluation } from "./actions";

type Opt = { id: string; name_ar: string };
export type RefData = {
  allowAnonymous: boolean;
  stages: Opt[];
  grades: (Opt & { stage_id: string })[];
  classes: (Opt & { grade_id: string })[];
  subjects: Opt[];
  departments: (Opt & { code: string })[];
  positions: Position[];
  criteria: Criterion[];
};

type Step = "mode" | "stage" | "department" | "position" | "context" | "more" | "employee" | "form" | "done";

const today = () => new Date().toISOString().slice(0, 10);
const RATING = ["غير راضٍ جدًا", "غير راضٍ", "محايد", "راضٍ", "راضٍ جدًا"];

export default function Wizard({ data }: { data: RefData }) {
  const [mode, setMode] = useState<TargetType | null>(null);
  const [step, setStep] = useState<Step>("mode");
  const [history, setHistory] = useState<Step[]>([]);
  const [ctx, setCtx] = useState<Context>({ incident_date: today() });
  const [needs, setNeeds] = useState<ContextField[]>([]);
  const [employee, setEmployee] = useState<{ id: string; full_name_ar: string; positions: string | null } | null>(null);
  const [overall, setOverall] = useState<number>(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState("");
  const [improvements, setImprovements] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyChoice>("identified");
  const [contact, setContact] = useState({ contact_name: "", contact_phone: "", contact_email: "" });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reference_no: string; status: MatchStatus | null } | null>(null);
  const [pending, start] = useTransition();

  const position = data.positions.find((p) => p.id === ctx.position_id) ?? null;
  const criteria = useMemo(() => criteriaFor(data.criteria, mode ?? "department", position), [data.criteria, mode, position]);

  const go = (next: Step) => {
    setError(null);
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const back = () => {
    setError(null);
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setStep(prev);
    if (prev === "mode") setMode(null);
  };
  const set = (patch: Context) => setCtx((c) => ({ ...c, ...patch }));

  function runPreview(current: Context) {
    start(async () => {
      const r = await previewMatch(current);
      if (!r.ok) return setError(r.error);
      const next = nextStepAfterPreview(r, current);
      if (next.action === "ask") {
        setNeeds(next.fields);
        go("more");
      } else {
        go("form");
      }
    });
  }

  function submit() {
    if (!overall) return setError("اختر مستوى الرضا العام.");
    if (privacy === "follow_up" && !contact.contact_phone.trim() && !contact.contact_email.trim()) {
      return setError("أدخل رقم جوال أو بريدًا إلكترونيًا للمتابعة.");
    }
    start(async () => {
      const r = await submitEvaluation(
        {
          ...ctx,
          target_type: mode,
          employee_id: employee?.id,
          overall_satisfaction: overall,
          scores,
          comments,
          suggested_improvements: improvements,
          anonymous: false,
          follow_up: false,
          ...contact,
        },
        privacy,
      );
      if (!r.ok) return setError(r.error);
      setResult({ reference_no: r.reference_no, status: r.status });
      setStep("done");
    });
  }

  const BackBtn = () =>
    history.length > 0 && step !== "done" ? (
      <button type="button" onClick={back} className="btn-ghost" disabled={pending}>رجوع</button>
    ) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {step !== "mode" && step !== "done" && <Breadcrumb mode={mode} step={step} />}
      {error && <ErrorBox message={error} />}

      {step === "mode" && (
        <div className="grid gap-3">
          {(
            [
              ["position", "التقييم حسب المنصب", "لا تعرف اسم الموظف؟ اختر المرحلة والقسم والمنصب، وسنحدد الموظف من سجلات المدرسة."],
              ["employee", "التقييم حسب اسم الموظف", "ابحث عن موظف بعينه واختره."],
              ["department", "التقييم حسب القسم", "قيّم خدمة قسم كامل دون تحديد شخص."],
            ] as const
          ).map(([m, title, body]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                go(m === "employee" ? "employee" : "stage");
              }}
              className="card text-start transition hover:border-brand hover:shadow-sm focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className="block text-lg font-bold">{title}</span>
              <span className="mt-1 block text-muted">{body}</span>
            </button>
          ))}
        </div>
      )}

      {step === "stage" && (
        <Panel title="١. اختر المرحلة الدراسية">
          <Choices options={data.stages} value={ctx.stage_id} onPick={(id) => { set({ stage_id: id, grade_id: null, class_id: null }); go("department"); }} />
          {mode === "department" && (
            <button type="button" className="mt-3 text-sm text-muted underline" onClick={() => { set({ stage_id: null }); go("department"); }}>
              لا يخص مرحلة بعينها
            </button>
          )}
          <Footer><BackBtn /></Footer>
        </Panel>
      )}

      {step === "department" && (
        <Panel title="٢. اختر القسم">
          <Choices
            options={data.departments}
            value={ctx.department_id}
            onPick={(id) => { set({ department_id: id, position_id: null }); go(mode === "department" ? "form" : "position"); }}
          />
          <Footer><BackBtn /></Footer>
        </Panel>
      )}

      {step === "position" && (
        <Panel title="٣. اختر المنصب">
          {data.positions.filter((p) => p.department_id === ctx.department_id).length === 0 ? (
            <p className="text-muted">لا توجد مناصب مُعرّفة لهذا القسم. يمكنك الرجوع وتقييم القسم كاملًا.</p>
          ) : (
            <Choices
              options={data.positions.filter((p) => p.department_id === ctx.department_id)}
              value={ctx.position_id}
              onPick={(id) => {
                const p = data.positions.find((x) => x.id === id)!;
                const next = { ...ctx, position_id: id };
                setCtx(next);
                if (p.requires_subject_and_class) go("context");
                else runPreview(next);
              }}
            />
          )}
          {pending && <div className="mt-3"><Spinner label="نبحث عن الموظف المسؤول…" /></div>}
          <Footer><BackBtn /></Footer>
        </Panel>
      )}

      {step === "context" && (
        <Panel title="٤. المادة والصف" hint="نستخدمها فقط لتحديد المعلم المسؤول من جدول الإسناد.">
          <ContextFields fields={["subject", "grade", "class"]} data={data} ctx={ctx} set={set} />
          <Footer>
            <BackBtn />
            <button
              type="button"
              className="btn-primary"
              disabled={pending || missingRequired(ctx, position).length > 0}
              onClick={() => runPreview(ctx)}
            >
              {pending ? "جارٍ التحقق…" : "متابعة"}
            </button>
          </Footer>
        </Panel>
      )}

      {step === "more" && (
        <Panel title="نحتاج معلومة إضافية" hint="يوجد أكثر من موظف في هذا المنصب. هذه المعلومة تساعدنا على تحديد الموظف دون تخمين.">
          <ContextFields fields={expandNeeds(needs, ctx)} data={data} ctx={ctx} set={set} />
          <Footer>
            <BackBtn />
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => go("form")}>
              لا أعرف — تابِع
            </button>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => runPreview(ctx)}>
              {pending ? "جارٍ التحقق…" : "متابعة"}
            </button>
          </Footer>
        </Panel>
      )}

      {step === "employee" && (
        <EmployeeSearch
          onPick={(e) => { setEmployee(e); go("form"); }}
          footer={<BackBtn />}
        />
      )}

      {step === "form" && (
        <Panel title="التقييم">
          <p className="mb-4 rounded-lg bg-paper px-3 py-2 text-sm text-muted">
            {mode === "employee" && employee ? `تقييم: ${employee.full_name_ar}` : summary(data, ctx, mode)}
          </p>

          <div className="mb-5">
            <label className="label" htmlFor="incident_date">تاريخ الموقف أو الخدمة</label>
            <input id="incident_date" type="date" className="field" max={today()} value={ctx.incident_date ?? ""}
                   onChange={(e) => set({ incident_date: e.target.value })} />
            <p className="mt-1 text-xs text-muted">يُستخدم لتحديد من كان يشغل المنصب في ذلك اليوم.</p>
          </div>

          <p className="mb-3 text-xs text-muted sm:hidden">١ = غير راضٍ جدًا · ٥ = راضٍ جدًا</p>
          <div className="space-y-4">
            {criteria.map((c) => (
              <Rating key={c.code} label={c.name_ar} value={scores[c.code] ?? 0}
                      onChange={(v) => setScores((s) => ({ ...s, [c.code]: v }))} />
            ))}
            <div className="border-t border-line pt-4">
              <Rating label="الرضا العام (مطلوب)" value={overall} onChange={setOverall} strong />
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="comments">ملاحظاتك</label>
              <textarea id="comments" className="field min-h-28" maxLength={4000} value={comments}
                        onChange={(e) => setComments(e.target.value)}
                        placeholder="صف الموقف أو الخدمة. تجنّب ذكر بيانات شخصية لطلاب آخرين." />
            </div>
            <div>
              <label className="label" htmlFor="improvements">مقترحات للتحسين</label>
              <textarea id="improvements" className="field min-h-20" maxLength={4000} value={improvements}
                        onChange={(e) => setImprovements(e.target.value)} />
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="label">طريقة الإرسال</legend>
            <div className="grid gap-2">
              {(["identified", "anonymous", "follow_up"] as PrivacyChoice[])
                .filter((p) => p !== "anonymous" || data.allowAnonymous)
                .map((p) => (
                  <label key={p} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${privacy === p ? "border-brand bg-brand-soft/40" : "border-line"}`}>
                    <input type="radio" name="privacy" className="mt-1 accent-[var(--color-brand)]" checked={privacy === p} onChange={() => setPrivacy(p)} />
                    <span>
                      <span className="block font-semibold">{privacyText[p].title}</span>
                      <span className="block text-sm text-muted">{privacyText[p].body}</span>
                    </span>
                  </label>
                ))}
            </div>
            {!data.allowAnonymous && <p className="mt-2 text-xs text-muted">سياسة المدرسة لا تتيح التقييم دون هوية.</p>}
          </fieldset>

          {privacy === "follow_up" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input className="field" placeholder="الاسم" value={contact.contact_name} onChange={(e) => setContact({ ...contact, contact_name: e.target.value })} />
              <input className="field" placeholder="رقم الجوال" dir="ltr" inputMode="tel" value={contact.contact_phone} onChange={(e) => setContact({ ...contact, contact_phone: e.target.value })} />
              <input className="field" placeholder="البريد الإلكتروني" dir="ltr" type="email" value={contact.contact_email} onChange={(e) => setContact({ ...contact, contact_email: e.target.value })} />
            </div>
          )}

          <Footer>
            <BackBtn />
            <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
              {pending ? "جارٍ الإرسال…" : "إرسال التقييم"}
            </button>
          </Footer>
        </Panel>
      )}

      {step === "done" && result && (
        <div className="card text-center">
          <p className="text-sm text-muted">رقم المرجع</p>
          <p className="mt-1 text-2xl font-bold tabular-nums" dir="ltr">{result.reference_no}</p>
          <p className="mx-auto mt-4 max-w-md">{outcomeMessage(result.status, mode ?? "department")}</p>
          {privacy === "anonymous" && (
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">احتفظ برقم المرجع؛ التقييم دون هوية لا يظهر في قائمة تقييماتك.</p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>تقييم جديد</button>
            {privacy !== "anonymous" && <Link className="btn-ghost" href="/parent/evaluations">تقييماتي</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- pieces ----------

function expandNeeds(needs: ContextField[], ctx: Context): ContextField[] {
  const out = new Set(needs);
  if (out.has("class") && !ctx.grade_id) out.add("grade");
  if (out.has("grade") && !ctx.stage_id) out.add("stage");
  return (["stage", "grade", "class", "subject"] as ContextField[]).filter((f) => out.has(f));
}

function summary(data: RefData, ctx: Context, mode: TargetType | null) {
  const name = (list: Opt[], id?: string | null) => list.find((x) => x.id === id)?.name_ar;
  const parts = [
    name(data.stages, ctx.stage_id),
    name(data.departments, ctx.department_id),
    mode === "position" ? name(data.positions, ctx.position_id) : null,
    name(data.subjects, ctx.subject_id),
    name(data.grades, ctx.grade_id),
    ctx.class_id ? `فصل ${name(data.classes, ctx.class_id)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function Breadcrumb({ mode, step }: { mode: TargetType | null; step: Step }) {
  const label = mode === "position" ? "حسب المنصب" : mode === "employee" ? "حسب اسم الموظف" : "حسب القسم";
  return <p className="text-sm text-muted">تقييم {label}{step === "form" ? " · الخطوة الأخيرة" : ""}</p>;
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-between gap-3">{children}</div>;
}

function Choices({ options, value, onPick }: { options: Opt[]; value?: string | null; onPick: (id: string) => void }) {
  if (!options.length) return <p className="text-muted">لا توجد خيارات متاحة.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onPick(o.id)}
                className={`rounded-xl border px-4 py-3 text-start font-medium transition hover:border-brand ${value === o.id ? "border-brand bg-brand-soft/50" : "border-line"}`}>
          {o.name_ar}
        </button>
      ))}
    </div>
  );
}

function ContextFields({ fields, data, ctx, set }: { fields: ContextField[]; data: RefData; ctx: Context; set: (p: Context) => void }) {
  const grades = data.grades.filter((g) => !ctx.stage_id || g.stage_id === ctx.stage_id);
  const classes = data.classes.filter((c) => c.grade_id === ctx.grade_id);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.includes("stage") && (
        <Select id="stage" label={fieldLabel.stage} value={ctx.stage_id} options={data.stages}
                onChange={(v) => set({ stage_id: v, grade_id: null, class_id: null })} />
      )}
      {fields.includes("subject") && (
        <Select id="subject" label={fieldLabel.subject} value={ctx.subject_id} options={data.subjects} onChange={(v) => set({ subject_id: v })} />
      )}
      {fields.includes("grade") && (
        <Select id="grade" label={fieldLabel.grade} value={ctx.grade_id} options={grades} onChange={(v) => set({ grade_id: v, class_id: null })} />
      )}
      {fields.includes("class") && (
        <Select id="class" label={fieldLabel.class} value={ctx.class_id} options={classes} disabled={!ctx.grade_id}
                placeholder={ctx.grade_id ? "اختر" : "اختر الصف أولًا"} onChange={(v) => set({ class_id: v })} />
      )}
    </div>
  );
}

function Select({ id, label, value, options, onChange, disabled, placeholder = "اختر" }: {
  id: string; label: string; value?: string | null; options: Opt[]; onChange: (v: string | null) => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="field" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name_ar}</option>)}
      </select>
    </div>
  );
}

function Rating({ label, value, onChange, strong }: { label: string; value: number; onChange: (v: number) => void; strong?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className={`mb-2 text-sm ${strong ? "font-bold" : "font-semibold"}`}>{label}</p>
      <div className="grid grid-cols-5 gap-1.5">
        {RATING.map((t, i) => {
          const v = i + 1;
          return (
            <button key={v} type="button" role="radio" aria-checked={value === v} title={t} onClick={() => onChange(v)}
                    className={`rounded-lg border py-2 text-sm font-semibold transition ${value === v ? "border-brand bg-brand text-white" : "border-line hover:border-brand"}`}>
              {v}
              <span className="hidden text-[11px] font-normal sm:block">{t}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmployeeSearch({ onPick, footer }: { onPick: (e: { id: string; full_name_ar: string; positions: string | null }) => void; footer: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; full_name_ar: string; positions: string | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const search = () =>
    start(async () => {
      setErr(null);
      const r = await searchEmployees(q);
      if (!r.ok) return setErr(r.error);
      setRows(r.rows);
    });
  return (
    <Panel title="ابحث عن الموظف" hint="اكتب جزءًا من الاسم (حرفان على الأقل).">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: الشمري" aria-label="اسم الموظف" />
        <button className="btn-primary shrink-0" disabled={pending || q.trim().length < 2}>بحث</button>
      </form>
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
      {pending && <div className="mt-4"><Spinner label="جارٍ البحث…" /></div>}
      {!pending && rows && rows.length === 0 && (
        <p className="mt-4 text-muted">لا نتائج. جرّب جزءًا آخر من الاسم، أو ارجع واختر «التقييم حسب المنصب».</p>
      )}
      {!pending && rows && rows.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full px-4 py-3 text-start hover:bg-paper" onClick={() => onPick(r)}>
                <span className="block font-semibold">{r.full_name_ar}</span>
                {r.positions && <span className="block text-sm text-muted">{r.positions}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Footer>{footer}</Footer>
    </Panel>
  );
}
