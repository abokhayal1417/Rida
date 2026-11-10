# رضا | RIDA — التقييم الذكي حسب المنصب

منصة لتقييم موظفي المدرسة وأقسامها من أولياء الأمور، حتى لو لم يعرف وليّ الأمر اسم الموظف.
Next.js 16 + Supabase (PostgreSQL + Auth + RLS)، واجهة عربية RTL، تعمل على الجوال، جاهزة للنشر على Vercel.

---

## ما الذي يفعله النظام

**وليّ الأمر** يختار واحدًا من ثلاثة:
1. **التقييم حسب المنصب**: المرحلة ← القسم ← المنصب ← (للمعلم: المادة والصف والفصل). يحدد النظام الموظف من جدول الإسناد.
2. **التقييم حسب اسم الموظف**: بحث بالاسم (اسم + المسمى فقط، لا بيانات سرية).
3. **التقييم حسب القسم**: دون تحديد شخص.

ثم معايير خاصة بالمنصب، والرضا العام، والملاحظات، والمقترحات، واختيار طريقة الإرسال (باسمه / دون هوية إن سمحت المدرسة / مع طلب متابعة) مع شرح أثر كل خيار على الخصوصية.

**مدير الجودة** يرى صفحة «تقييمات تحتاج مراجعة»، ويؤكد الموظف أو يصححه، أو يبقي التقييم على مستوى القسم، أو يطلب توضيحًا من وليّ الأمر المعروف، أو يضع علامة «تمت المراجعة». كل تغيير يُسجَّل في سجل تدقيق لا يمكن تعديله أو حذفه.

## قواعد المطابقة (قلب الميزة)

| الحالة | ما يحدث |
|---|---|
| موظف واحد يطابق المنصب والسياق | `matched` — يُربط تلقائيًا |
| أكثر من موظف | يُسأل وليّ الأمر فقط عن الحقل الذي يفرّق بينهم (مرحلة/صف/فصل/مادة). إن بقي الغموض: `ambiguous` ← مراجعة |
| لا أحد | `unmatched` ← مراجعة، ويُقبل التقييم |
| تطابق فريد لكن التقييم **سلبي** | `pending_review` — لا يُربط بأحد حتى يؤكده مدير الجودة |
| تأكيد يدوي | `manually_verified` |

- المطابقة تتم على **تاريخ الموقف** الذي يدخله وليّ الأمر، لا تاريخ الإرسال. المعلم المنقول أو البديل لا يتحمل تقييم فترة لم يكن فيها.
- النظام لا يخمّن هوية أحد، ولا يعيد لوليّ الأمر اسم الموظف المطابق.
- قيد في قاعدة البيانات يمنع أي حالة `matched`/`manually_verified` دون موظف، ويمنع ربط موظف بحالات المراجعة.
- إحصاءات الأداء الفردي (`v_employee_performance`) تشمل فقط `matched` و`manually_verified`.
- السلوك «السلبي ← مراجعة أولًا» يُتحكم فيه لكل مدرسة عبر `schools.negative_requires_review`.

## الذكاء الاصطناعي

زر «اقتراح بالذكاء الاصطناعي» في صفحة المراجعة يصنّف التقييم ويقترح القسم والمنصب، وقد يقترح موظفًا **من قائمة المرشحين المصرّح بها فقط**، مع شرح بالعربية. يُحفظ الاقتراح في `ai_classification` ولا يلمس `matched_employee_id` أبدًا؛ القرار لمدير الجودة.
- مع `ANTHROPIC_API_KEY`: يستخدم Claude.
- دونه، أو عند فشل الاتصال: مصنّف بالكلمات المفتاحية مدمج، لا يقترح أسماء أشخاص.

---

## خطوات النشر (مطلوبة منك)

### 1) Supabase
1. أنشئ مشروعًا جديدًا (أو استخدم مشروع RIDA الحالي — انظر «الدمج مع قاعدة بيانات قائمة» أدناه).
2. **SQL Editor** ← شغّل بالترتيب:
   - `supabase/migrations/0001_core.sql`
   - `supabase/migrations/0002_smart_evaluation.sql`
   - (اختياري للتجربة) `supabase/seed.sql` — مدرسة نموذجية برمز `RIDA2026`.
3. **Authentication ← Sign In / Providers ← Email**: فعّل Email. إن أبقيت «Confirm email» مفعّلًا، يجب أن يؤكد وليّ الأمر بريده قبل الدخول.
4. **Authentication ← URL Configuration**: ضع رابط Vercel في Site URL.

### 2) بيانات مدرستك
استبدل بيانات seed ببيانات مدرستك: `schools`, `school_stages`, `grades`, `classes`, `subjects`, `departments`, `positions`, `employees`, `employee_assignments`.
**جودة المطابقة تساوي جودة جدول `employee_assignments`.** حدّث `effective_to` عند نقل أي موظف.

رمز انضمام أولياء الأمور:
```sql
update public.schools set join_code = 'ABC123' where id = '<school-id>';
```

### 3) منح أدوار الموظفين (بعد أن يسجلوا حسابات)
التسجيل يُنشئ دائمًا دور `parent`؛ الأدوار الأخرى تُمنح من SQL فقط:
```sql
update public.profiles p
set role = 'quality_manager', school_id = '<school-id>'
from auth.users u
where u.id = p.id and u.email = 'quality@school.edu.sa';
-- الأدوار: parent | employee | quality_manager | school_admin
```

### 4) Vercel
1. ارفع المشروع إلى GitHub (المجلد كما هو، دون `node_modules` و`.next`).
2. Import في Vercel، ثم **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - اختياري: `ANTHROPIC_API_KEY` و`ANTHROPIC_MODEL` (الافتراضي `claude-haiku-5-5`)
3. Deploy.

> لا يحتاج التطبيق مفتاح `service_role`. كل العمليات تمر بجلسة المستخدم وRLS.

---

## الدمج مع قاعدة بيانات RIDA قائمة

الملفات مكتوبة بحيث لا تحذف شيئًا (`if not exists`، `add column if not exists`، قيود `not valid`). إن كان لديك جدول `evaluations` فعلًا، تُضاف إليه الأعمدة الجديدة دون المساس ببياناتك.
راجع قبل التشغيل:
- إن كانت جداولك بأسماء مختلفة (مثلًا `staff` بدل `employees`)، عدّل المراجع في الملفين.
- إن كان عندك جدول `profiles` بأعمدة مختلفة، تأكد من وجود `role` و`school_id`.
- خذ نسخة احتياطية (Database ← Backups) قبل أي تشغيل على بيانات حقيقية.

## البنية

```
supabase/migrations/0001_core.sql            المدارس، المراحل، الأقسام، المناصب، الموظفون، الإسناد، RLS
supabase/migrations/0002_smart_evaluation.sql التقييمات، المطابقة، RPCs، سجل التدقيق، العروض التحليلية
supabase/seed.sql                            بيانات تجريبية تغطي حالات: فريد / غامض / غير مطابق
src/lib/evaluation/flow.ts                   منطق المعالج (مُختبر)
src/lib/ai/classify.ts                       التصنيف بالذكاء الاصطناعي + البديل
src/app/parent/evaluate                      معالج وليّ الأمر
src/app/parent/evaluations                   تقييماتي + الرد على طلبات التوضيح
src/app/quality/review                       تقييمات تحتاج مراجعة + التفاصيل والإجراءات
src/app/quality/dashboard                    لوحة المؤشرات
src/app/quality/positions                    إدارة المناصب (school_admin)
```

**الأمان**: كل الكتابة على التقييمات تمر بدوال `SECURITY DEFINER` في مخطط `private` (غير مكشوف عبر API)، تُستدعى من أغلفة `SECURITY INVOKER` في `public`. لا توجد صلاحيات INSERT/UPDATE/DELETE مباشرة على جداول التقييم. بيانات الموظفين السرية في `employee_private` يقرؤها `school_admin` فقط.

## الاختبارات

```bash
npm test          # منطق المعالج + الذكاء الاصطناعي (vitest)
npm run test:db   # Postgres 16 محلي: فريد/غامض/غير مطابق + RLS + سجل التدقيق + تكرار تشغيل الهجرات
npm run e2e       # متصفح حقيقي ضد تطبيق يعمل + Supabase (انظر e2e/smoke.mjs)
```
