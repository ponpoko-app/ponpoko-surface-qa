import type { PoAnswers, ProjectTarget, QaCase, QaStep } from "../src/contracts/qa";

function num(index: number): string {
  return String(index).padStart(3, "0");
}

function seenStep(id: string, title: string): QaStep {
  return {
    id,
    title,
    actor: "gui",
    action: { type: "none" },
    see: { question: "", must_show: [], must_not_show: [], mode: "assert" },
  };
}

export function draftCases(answers: PoAnswers, target: ProjectTarget, now: number): QaCase[] {
  const cases: QaCase[] = [];
  let index = 1;
  for (const flow of answers.critical_flows) {
    const trimmed = flow.trim();
    if (trimmed.length === 0) continue;
    const first = seenStep("s1", `เปิดหน้าต่าง ${target.name} และดูว่าเห็นอยู่จริง`);
    first.see = {
      question: `หน้าต่าง ${target.name} เปิดอยู่และมองเห็นได้บนจอหรือไม่`,
      must_show: [target.name],
      must_not_show: [],
      mode: "assert",
    };
    const second = seenStep("s2", `ทำ flow: ${trimmed}`);
    second.see = {
      question: `หลังทำ "${trimmed}" แล้ว หน้าจอแสดงผลลัพธ์ที่คาดหวังหรือไม่`,
      must_show: [],
      must_not_show: [],
      mode: "assert",
    };
    const third = seenStep("s3", "ตรวจว่าผลลัพธ์ยังอยู่ ไม่ใช่ภาพค้าง");
    third.see = {
      question: `ผลลัพธ์ของ "${trimmed}" ยังแสดงอยู่จริงหลังรอ และไม่มีข้อความผิดพลาดขึ้น`,
      must_show: [],
      must_not_show: ["error", "Error", "exception"],
      mode: "assert",
    };
    cases.push({
      id: `TC-${num(index)}`,
      title: trimmed,
      priority: "high",
      intent: `${answers.purpose || target.name}: ${trimmed}`,
      preconditions: [answers.test_data].filter((row) => row.trim().length > 0),
      steps: [first, second, third],
      created_at: now,
    });
    index += 1;
  }
  for (const guard of answers.must_not_break) {
    const trimmed = guard.trim();
    if (trimmed.length === 0) continue;
    const only = seenStep("s1", `ตรวจว่า "${trimmed}" ไม่เกิดขึ้น`);
    only.see = {
      question: `บนหน้าจอมีอาการ "${trimmed}" อยู่หรือไม่`,
      must_show: [],
      must_not_show: [trimmed],
      mode: "assert",
    };
    cases.push({
      id: `TC-${num(index)}`,
      title: `ห้ามพัง: ${trimmed}`,
      priority: "high",
      intent: `${answers.purpose || target.name}: ห้ามเกิด "${trimmed}"`,
      preconditions: [],
      steps: [only],
      created_at: now,
    });
    index += 1;
  }
  return cases;
}
