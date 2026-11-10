import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/ui";
import Wizard, { type RefData } from "./Wizard";

export default async function EvaluatePage() {
  const profile = await requireRole(["parent"]);
  const supabase = await createClient();
  const [school, stages, grades, classes, subjects, departments, positions, criteria] = await Promise.all([
    supabase.from("schools").select("id, name_ar, allow_anonymous").eq("id", profile.school_id!).single(),
    supabase.from("school_stages").select("id, name_ar").order("sort"),
    supabase.from("grades").select("id, stage_id, name_ar").order("sort"),
    supabase.from("classes").select("id, grade_id, name_ar").order("name_ar"),
    supabase.from("subjects").select("id, name_ar").order("name_ar"),
    supabase.from("departments").select("id, code, name_ar").eq("active", true).order("sort"),
    supabase.from("positions").select("id, code, department_id, name_ar, requires_subject_and_class").eq("active", true).order("sort"),
    supabase.from("evaluation_criteria").select("id, code, name_ar, position_codes").order("sort"),
  ]);
  const failed = [school, stages, grades, classes, subjects, departments, positions, criteria].find((r) => r.error);
  if (failed) {
    return (
      <>
        <PageHeader title="تقييم موظف" />
        <ErrorBox message="تعذّر تحميل بيانات المدرسة. حدّث الصفحة أو حاول لاحقًا." />
      </>
    );
  }
  const data: RefData = {
    allowAnonymous: !!school.data?.allow_anonymous,
    stages: stages.data ?? [],
    grades: grades.data ?? [],
    classes: classes.data ?? [],
    subjects: subjects.data ?? [],
    departments: departments.data ?? [],
    positions: positions.data ?? [],
    criteria: criteria.data ?? [],
  };
  return (
    <>
      <PageHeader title="تقييم موظف" subtitle={`${school.data?.name_ar ?? ""} — يمكنك التقييم حتى لو لم تعرف اسم الموظف.`} />
      <Wizard data={data} />
    </>
  );
}
