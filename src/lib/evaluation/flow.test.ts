import { describe, expect, it } from "vitest";
import {
  buildPayload,
  criteriaFor,
  errorMessage,
  missingRequired,
  nextStepAfterPreview,
  outcomeMessage,
  type Criterion,
  type Position,
} from "./flow";

const teacher: Position = { id: "p5", code: "teacher", department_id: "d2", name_ar: "المعلم", requires_subject_and_class: true };
const principal: Position = { id: "p1", code: "principal", department_id: "d1", name_ar: "قائد", requires_subject_and_class: false };
const criteria: Criterion[] = [
  { id: "1", code: "professionalism", name_ar: "المهنية", position_codes: null },
  { id: "2", code: "explanation_clarity", name_ar: "وضوح الشرح", position_codes: ["teacher"] },
  { id: "3", code: "decision_fairness", name_ar: "عدالة", position_codes: ["principal"] },
];

describe("unique match", () => {
  it("continues straight to the form", () => {
    expect(nextStepAfterPreview({ status: "matched", needs: [] }, {})).toEqual({ action: "continue" });
  });
  it("tells the parent the link was made from assignment records, without a name", () => {
    expect(outcomeMessage("matched", "position")).toContain("سجلات الإسناد");
  });
});

describe("ambiguous match", () => {
  it("asks only for the fields that separate candidates", () => {
    expect(nextStepAfterPreview({ status: "ambiguous", needs: ["stage"] }, {})).toEqual({ action: "ask", fields: ["stage"] });
  });
  it("does not re-ask fields already given", () => {
    expect(nextStepAfterPreview({ status: "ambiguous", needs: ["class"] }, { class_id: "c1" })).toEqual({ action: "continue" });
  });
  it("continues to review when the parent has nothing more to add", () => {
    expect(nextStepAfterPreview({ status: "ambiguous", needs: [] }, { class_id: "c1" })).toEqual({ action: "continue" });
    expect(outcomeMessage("ambiguous", "position")).toContain("مدير الجودة");
  });
});

describe("unmatched", () => {
  it("still lets the parent submit and routes to review", () => {
    expect(nextStepAfterPreview({ status: "unmatched", needs: [] }, {})).toEqual({ action: "continue" });
    expect(outcomeMessage("unmatched", "position")).toContain("أُحيل إلى مدير الجودة");
  });
});

describe("teacher requirements", () => {
  it("requires subject, grade and class", () => {
    expect(missingRequired({}, teacher)).toEqual(["subject", "grade", "class"]);
    expect(missingRequired({ subject_id: "s", grade_id: "g", class_id: "c" }, teacher)).toEqual([]);
    expect(missingRequired({}, principal)).toEqual([]);
  });
});

describe("criteria", () => {
  it("adds role-specific criteria only for the matching position", () => {
    expect(criteriaFor(criteria, "position", teacher).map((c) => c.code)).toEqual(["professionalism", "explanation_clarity"]);
    expect(criteriaFor(criteria, "department").map((c) => c.code)).toEqual(["professionalism"]);
    expect(criteriaFor(criteria, "employee").map((c) => c.code)).toEqual(["professionalism"]);
  });
});

describe("privacy", () => {
  const base = {
    target_type: "position" as const,
    position_id: "p1",
    overall_satisfaction: 2,
    scores: {},
    anonymous: false,
    follow_up: false,
    contact_name: "x",
    contact_phone: "050",
    contact_email: "",
  };
  it("anonymous drops contact details", () => {
    const p = buildPayload(base, "anonymous");
    expect(p.anonymous).toBe(true);
    expect(p.follow_up).toBe(false);
    expect(p.contact_phone).toBeUndefined();
  });
  it("follow-up keeps contact details and is never anonymous", () => {
    const p = buildPayload(base, "follow_up");
    expect(p.anonymous).toBe(false);
    expect(p.contact_phone).toBe("050");
    expect(p.contact_email).toBeUndefined();
  });
  it("department target drops position context", () => {
    const p = buildPayload({ ...base, target_type: "department", department_id: "d7" }, "identified");
    expect(p.position_id).toBeUndefined();
    expect(p.department_id).toBe("d7");
  });
});

describe("errors", () => {
  it("maps server codes to Arabic and hides unknown ones", () => {
    expect(errorMessage("subject_and_class_required")).toContain("المادة");
    expect(errorMessage("invalid_criterion:safety")).toContain("غير صالحة");
    expect(errorMessage("some internal pg detail")).toBe("حدث خطأ غير متوقع. حاول مرة أخرى.");
  });
});
