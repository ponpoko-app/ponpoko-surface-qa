import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiAskResult } from "../../src/contracts/pi";
import { message } from "../hands";

export const ASK_TIMEOUT_MS = 240_000;

export async function ask(prompt: string, cwd: string): Promise<PiAskResult> {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return { text: "", model: null, tools: [], error: "ไม่มีคำถามให้ถาม" };
  }
  const budget = new Promise<PiAskResult>((resolve) => {
    setTimeout(() => resolve({ text: "", model: null, tools: [], error: "pi ไม่ตอบภายใน 240 วินาที" }), ASK_TIMEOUT_MS);
  });
  const work = (async (): Promise<PiAskResult> => {
    const created = await createAgentSession({
      cwd,
      sessionManager: SessionManager.inMemory(),
    });
    const { session } = created;
    try {
      await session.prompt(trimmed);
      const text = session.getLastAssistantText() ?? "";
      const model = session.model as { id?: string; name?: string } | undefined;
      return {
        text,
        model: typeof model?.id === "string" ? model.id : typeof model?.name === "string" ? model.name : null,
        tools: typeof session.getActiveToolNames === "function" ? session.getActiveToolNames() : [],
        error: null,
      };
    } finally {
      session.dispose();
    }
  })().catch((error: unknown): PiAskResult => ({ text: "", model: null, tools: [], error: message(error) }));
  return Promise.race([work, budget]);
}
