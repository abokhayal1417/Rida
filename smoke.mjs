// End-to-end smoke test against a running app + Supabase stack.
// Usage: BASE=http://localhost:3000 SHOTS=./shots node e2e/smoke.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now();
const parentEmail = `parent${stamp}@rida.test`;
const PASS = "Passw0rd!23";
const log = (...a) => console.log("✓", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });

async function newPage(mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { throw e; });
  return page;
}
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("button:text-is('دخول')");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { waitUntil: "commit" });
}
const noHorizontalScroll = async (page, name) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) throw new Error(`${name}: horizontal overflow ${over}px`);
};

// ---------- parent (mobile) ----------
const p = await newPage(true);
await p.goto(`${BASE}/login`);
await p.fill("#email", parentEmail);
await p.fill("#password", PASS);
await p.fill("#full_name", "وليّ أمر تجريبي");
await p.fill("#school_code", "rida2026");
await p.click("text=إنشاء حساب وليّ أمر");
await p.waitForURL(/\/parent\/evaluate/, { waitUntil: "commit" });
await p.waitForSelector("text=التقييم حسب المنصب");
await p.screenshot({ path: `${SHOTS}/01-modes-mobile.png`, fullPage: true });
await noHorizontalScroll(p, "modes");
log("parent signed up with school code and reached the wizard");

// A) position -> needs grade -> unique
await p.click("text=التقييم حسب المنصب");
await p.click("text=المرحلة الابتدائية");
await p.click("text=الإشراف التربوي");
await p.click("text=المشرف التربوي");
await p.waitForSelector("text=نحتاج معلومة إضافية");
await p.screenshot({ path: `${SHOTS}/02-needs-grade-mobile.png`, fullPage: true });
await p.selectOption("#grade", { label: "الصف الأول" });
await p.click("button:has-text('متابعة')");
await p.waitForSelector("text=الرضا العام (مطلوب)");
await p.click("[aria-label='الرضا العام (مطلوب)'] >> text=5");
await p.fill("#comments", "متابعة ممتازة لمستوى الطلاب");
await p.screenshot({ path: `${SHOTS}/03-form-mobile.png`, fullPage: true });
await noHorizontalScroll(p, "form");
await p.click("text=إرسال التقييم");
await p.waitForSelector("text=رقم المرجع");
if (!(await p.textContent("body")).includes("سجلات الإسناد")) throw new Error("A: expected matched message");
await p.screenshot({ path: `${SHOTS}/04-done-matched-mobile.png`, fullPage: true });
log("A: ambiguous position asked for grade, then matched");

// B) teacher co-taught -> ambiguous, anonymous
await p.click("text=تقييم جديد");
await p.click("text=التقييم حسب المنصب");
await p.click("text=المرحلة الابتدائية");
await p.click("text=الهيئة التعليمية");
await p.click("text=المعلم");
await p.selectOption("#subject", { label: "اللغة الإنجليزية" });
await p.selectOption("#grade", { label: "الصف الثالث" });
await p.selectOption("#class", { label: "أ" });
await p.click("button:has-text('متابعة')");
await p.waitForSelector("text=الرضا العام (مطلوب)");
await p.click("[aria-label='وضوح الشرح'] >> text=2");
await p.click("[aria-label='الرضا العام (مطلوب)'] >> text=2");
await p.fill("#comments", "الواجبات كثيرة والشرح غير واضح في الحصة");
await p.click("text=إرسال دون هوية");
await p.click("text=إرسال التقييم");
await p.waitForSelector("text=رقم المرجع");
if (!(await p.textContent("body")).includes("أكثر من موظف")) throw new Error("B: expected ambiguous message");
log("B: co-taught class stayed ambiguous; sent anonymously");

// C) by name, follow-up
await p.click("text=تقييم جديد");
await p.click("text=التقييم حسب اسم الموظف");
await p.fill("[aria-label='اسم الموظف']", "السبيعي");
await p.click("button:has-text('بحث')");
await p.click("text=أ. بندر السبيعي");
await p.click("[aria-label='الرضا العام (مطلوب)'] >> text=4");
await p.click("text=أطلب متابعة");
await p.click("text=إرسال التقييم");
await p.waitForSelector("role=alert");
await p.fill("input[placeholder='رقم الجوال']", "0500000000");
await p.click("text=إرسال التقييم");
await p.waitForSelector("text=رقم المرجع");
log("C: name search + follow-up validation works");

// D) science teacher nobody assigned -> unmatched, identified
await p.click("text=تقييم جديد");
await p.click("text=التقييم حسب المنصب");
await p.click("text=المرحلة الابتدائية");
await p.click("text=الهيئة التعليمية");
await p.click("text=المعلم");
await p.selectOption("#subject", { label: "العلوم" });
await p.selectOption("#grade", { label: "الصف الأول" });
await p.selectOption("#class", { label: "أ" });
await p.click("button:has-text('متابعة')");
await p.click("[aria-label='الرضا العام (مطلوب)'] >> text=1");
await p.fill("#comments", "لا يوجد تواصل من معلم العلوم منذ بداية الفصل");
await p.click("text=إرسال التقييم");
await p.waitForSelector("text=رقم المرجع");
if (!(await p.textContent("body")).includes("لم نتمكن من تحديد")) throw new Error("D: expected unmatched message");
log("D: unmatched routed to review");

// ---------- quality manager (desktop) ----------
const q = await newPage(false);
await login(q, "qm@rida.test");
await q.waitForURL(/\/quality\/review/, { waitUntil: "commit" });
await q.waitForSelector("table");
const rows = await q.locator("tbody tr").count();
if (rows < 2) throw new Error(`QM queue expected >=2 rows, got ${rows}`);
await q.screenshot({ path: `${SHOTS}/05-queue-desktop.png`, fullPage: true });
log(`QM queue shows ${rows} evaluations`);

// open the unmatched science one (identified) -> AI suggest + request clarification
await q.click("tbody tr:has-text('غير مرتبط') >> text=مراجعة");
await q.waitForSelector("text=إجراءات المراجعة");
await q.click("text=اقتراح بالذكاء الاصطناعي");
await q.waitForSelector("text=اقتراح التصنيف الآلي");
await q.fill("#msg", "هل يمكنك تحديد اسم المعلم أو اليوم الذي حدث فيه ذلك؟");
await q.click("text=إرسال الطلب");
await q.waitForSelector("text=تم: إرسال طلب التوضيح");
await q.reload();
await q.waitForSelector("text=طلب توضيح");
await q.screenshot({ path: `${SHOTS}/06-review-detail-desktop.png`, fullPage: true });
log("QM: AI suggestion saved, clarification requested, audit visible");

// open the ambiguous one -> confirm candidate
await q.goto(`${BASE}/quality/review?f=ambiguous`);
await q.click("tbody tr >> text=مراجعة");
await q.waitForSelector("text=المرشحون من سجلات الإسناد");
q.once("dialog", (d) => d.accept());
await q.locator("li:has-text('أ. ناصر الغامدي') >> text=تأكيد").click();
await q.waitForSelector("text=تم: تأكيد الموظف");
await q.reload();
await q.waitForSelector("text=تأكيد الموظف");
log("QM: ambiguous evaluation confirmed and audited");

await q.goto(`${BASE}/quality/dashboard`);
await q.waitForSelector("text=التقييمات حسب المنصب");
await q.screenshot({ path: `${SHOTS}/07-dashboard-desktop.png`, fullPage: true });
const perf = await q.textContent("body");
if (!perf.includes("أ. ناصر الغامدي")) throw new Error("verified employee should appear in performance");
if (perf.includes("أ. ماجد الشمري")) throw new Error("unverified employee must not appear");
log("dashboard: only verified links in employee performance");

// QM must not reach admin page
await q.goto(`${BASE}/quality/positions`);
await q.waitForURL(/denied=1/, { waitUntil: "commit" });
log("QM blocked from admin-only positions page");

// ---------- parent replies ----------
await p.goto(`${BASE}/parent/evaluations`);
await p.waitForSelector("text=ردّك على طلب التوضيح");
await p.fill("textarea[name=body]", "المعلم الذي يحضر يوم الأحد");
await p.click("text=إرسال الرد");
await p.waitForURL(/ok=1/, { waitUntil: "commit" });
await p.screenshot({ path: `${SHOTS}/08-parent-reply-mobile.png`, fullPage: true });
const mine = await p.locator("article").count();
if (mine !== 3) throw new Error(`parent should see 3 identified evaluations (not the anonymous one), saw ${mine}`);
log("parent replied; anonymous evaluation hidden from own list");

// parent blocked from QM pages
await p.goto(`${BASE}/quality/review`);
await p.waitForURL(/denied=1/, { waitUntil: "commit" });
log("parent blocked from quality pages");

// QM mobile view of queue
const qm = await newPage(true);
await login(qm, "qm@rida.test");
await qm.goto(`${BASE}/quality/review`);
await qm.waitForSelector("h1:has-text('تقييمات تحتاج مراجعة')");
await qm.waitForSelector("a.card");
await qm.screenshot({ path: `${SHOTS}/09-queue-mobile.png`, fullPage: true });
await noHorizontalScroll(qm, "queue mobile");
log("queue renders on mobile without horizontal scroll");

await browser.close();
console.log("\nE2E PASSED");
