import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { classify, ruleClassify } from "./classify";

const base = { improvements: "", departments: [], positions: [], candidates: [{ id: "e1", name: "أ. فلان", positions: "المعلم" }] };

describe("rule classifier", () => {
  it("routes bus complaints to transport and never suggests people", () => {
    const r = ruleClassify({ ...base, comments: "الحافلة تتأخر كل يوم والسائق مسرع" });
    expect(r.category).toBe("safety");
    expect(r.suggested_department_code).toBe("transport");
    expect(r.suggested_employee_ids).toEqual([]);
    expect(r.explanation.length).toBeGreaterThan(10);
  });
});

describe("AI classifier", () => {
  it("drops employee ids that were not in the authorized candidate list", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify({
              category: "teaching_quality", suggested_department_code: "teaching", suggested_position_code: "teacher",
              suggested_employee_ids: ["e1", "intruder"], confidence: "medium", explanation: "ذكر مادة الرياضيات" }) }],
          }),
        ),
      ),
    );
    const r = await classify({ ...base, comments: "شرح الرياضيات غير واضح" });
    expect(r.source).toBe("ai");
    expect(r.suggested_employee_ids).toEqual(["e1"]);
  });
  it("falls back to rules when the API fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await classify({ ...base, comments: "شكرا على التعاون ممتاز" });
    expect(r.source).toBe("rules");
    expect(r.category).toBe("praise");
  });
});
