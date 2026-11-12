export interface AiInputPart {
  type: string;
  text?: string;
  data_base64?: string;
  mime_type?: string;
  url?: string;
}

export interface AiRequest {
  request_id: string;
  io: { inputs: string[]; outputs: string[] };
  input: AiInputPart[];
  options?: { temperature?: number; max_tokens?: number };
  budget: { seconds: number; output_bytes: number };
}

export interface AiStatusResult {
  status?: string;
  result?: { output?: unknown[]; error?: unknown } | null;
}

export interface AiClient {
  readonly contractVersion: number;
  validate(input: AiRequest, checkSetup?: boolean): Promise<{ valid: true; setup?: { status: string; error?: unknown } }>;
  invoke(input: AiRequest): Promise<Record<string, unknown>>;
  status(requestId: string): Promise<AiStatusResult>;
}

export function readAiText(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const output = (result as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const part of output) {
    if (typeof part !== "object" || part === null) continue;
    const row = part as { type?: unknown; text?: unknown };
    if (typeof row.text === "string" && row.text.length > 0) parts.push(row.text);
  }
  return parts.join("\n").trim();
}
