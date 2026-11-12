import { readAiText, type AiClient, type AiRequest } from "../contracts/ai";
import { SEVERITIES, type AestheticFinding, type JudgeInput, type JudgeOutcome, type Severity, type VisionJudge } from "../contracts/qa";

export const SOURCE_PREFIX = "qa-see-";

function identifier(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${SOURCE_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function describe(input: JudgeInput): string {
  const lines = [
    "คุณคือ QA ที่ดูภาพหน้าจอจริงแล้วตอบคำถามปิดเท่านั้น",
    `คำถาม: ${input.question}`,
    input.must_show.length > 0 ? `ต้องเห็นบนภาพ: ${input.must_show.join(" | ")}` : "ไม่มีการบังคับว่าต้องเห็นอะไร",
    input.must_not_show.length > 0 ? `ต้องไม่เห็นบนภาพ: ${input.must_not_show.join(" | ")}` : "",
    input.standard.length > 0 ? `มาตรฐานหน้าตาของทีม: ${input.standard.join(" | ")}` : "",
    input.mode === "critique" ? "โหมดนี้ให้วิจารณ์หน้าตาเป็นรายการข้อสังเกต ไม่ใช่แค่ผ่าน/ไม่ผ่าน" : "โหมดนี้ตัดสินผ่าน/ไม่ผ่านตามคำถาม",
    input.baseline_base64 === null ? "ไม่มีภาพอ้างอิง" : "ภาพที่สองคือภาพอ้างอิงที่เคยอนุมัติแล้ว",
    "ตอบเป็น JSON ก้อนเดียวเท่านั้น ห้ามมีคำอธิบายอื่น:",
    '{"answer":"yes|no|unsure","confidence":0.0,"visible_text":["ข้อความที่อ่านได้จริง"],"evidence_quote":"ข้อความที่ยกมาเป็นหลักฐาน","findings":[{"severity":"blocker|major|minor|nit","bbox":[x,y,w,h],"issue":"...","evidence_text":"ข้อความบนภาพที่ยืนยันข้อสังเกตนี้"}]}',
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

function balancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function readFindings(value: unknown, visible: string[]): AestheticFinding[] {
  if (!Array.isArray(value)) return [];
  const haystack = visible.join(" ").toLowerCase();
  const findings: AestheticFinding[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const evidence = typeof row.evidence_text === "string" ? row.evidence_text : "";
    const box = Array.isArray(row.bbox) ? row.bbox.map((part) => Number(part) || 0) : [];
    if (evidence.length > 0 && haystack.length > 0 && !haystack.includes(evidence.toLowerCase())) continue;
    findings.push({
      severity: (SEVERITIES as readonly string[]).includes(String(row.severity)) ? (row.severity as Severity) : "minor",
      bbox: { x: box[0] ?? 0, y: box[1] ?? 0, width: box[2] ?? 0, height: box[3] ?? 0 },
      issue: typeof row.issue === "string" ? row.issue : "",
      evidence_text: evidence,
    });
  }
  return findings;
}

export function parseJudge(text: string): JudgeOutcome {
  const body = balancedJson(text);
  if (body === null) {
    return { verdict: "error", confidence: 0, quote: "", visible_text: [], findings: [], error: `the answer carried no JSON: ${text.slice(0, 200)}` };
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const answer = String(parsed.answer ?? "");
    const verdict = answer === "yes" || answer === "no" || answer === "unsure" ? answer : "unsure";
    const visible = Array.isArray(parsed.visible_text) ? parsed.visible_text.filter((part): part is string => typeof part === "string") : [];
    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : 0;
    return {
      verdict,
      confidence,
      quote: typeof parsed.evidence_quote === "string" ? parsed.evidence_quote : "",
      visible_text: visible,
      findings: readFindings(parsed.findings, visible),
      error: null,
    };
  } catch (error) {
    return { verdict: "error", confidence: 0, quote: "", visible_text: [], findings: [], error: String(error) };
  }
}

async function settle(ai: AiClient, requestId: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const answer = await ai.status(requestId);
    const text = readAiText(answer.result ?? answer);
    if (text.length > 0) return text;
    const status = typeof answer.status === "string" ? answer.status : "";
    if (status === "failed" || status === "error" || status === "cancelled") return "";
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}

async function judgeOnce(ai: AiClient, input: JudgeInput): Promise<JudgeOutcome> {
  try {
    const request: AiRequest = {
      request_id: identifier(),
      io: { inputs: input.baseline_base64 === null ? ["image", "text"] : ["image", "text"], outputs: ["text"] },
      input: [
        { type: "image", data_base64: input.base64, mime_type: "image/png" },
        ...(input.baseline_base64 === null ? [] : [{ type: "image", data_base64: input.baseline_base64, mime_type: "image/png" }]),
        { type: "text", text: describe(input) },
      ],
      options: { temperature: 0, max_tokens: 800 },
      budget: { seconds: 120, output_bytes: 65_536 },
    };
    await ai.invoke(request);
    const text = await settle(ai, request.request_id);
    if (text.length === 0) {
      return { verdict: "error", confidence: 0, quote: "", visible_text: [], findings: [], error: "the model answered nothing within the wait" };
    }
    return parseJudge(text);
  } catch (error) {
    return { verdict: "error", confidence: 0, quote: "", visible_text: [], findings: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function createVisionJudge(ai: AiClient): VisionJudge {
  return { judge: (input) => judgeOnce(ai, input) };
}
