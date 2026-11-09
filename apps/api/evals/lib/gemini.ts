import { GoogleGenAI } from "@google/genai";

/** Same retry policy as the app: unavailable and rate-limited attempts retry at 8 and 16 s. */
const retryDelays = [8000, 16000];
const retryable = new Set([429, 503]);

export interface Usage {
  input: number;
  output: number;
  thinking: number;
}

interface Attempt {
  ms: number;
  status?: number;
  error?: string;
}

export type Generation =
  | { ok: true; text: string; usage: Usage; modelVersion?: string; attempts: Attempt[] }
  | { ok: false; error: string; attempts: Attempt[] };

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function generate(request: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  contents: string;
  responseJsonSchema: Record<string, unknown>;
  config: Record<string, unknown>;
}): Promise<Generation> {
  const ai = new GoogleGenAI({ apiKey: request.apiKey });
  const attempts: Attempt[] = [];
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: request.model,
        contents: request.contents,
        config: {
          ...request.config,
          systemInstruction: request.systemInstruction,
          responseJsonSchema: request.responseJsonSchema,
        },
      });
      attempts.push({ ms: Date.now() - started });
      const usage = response.usageMetadata;
      return {
        ok: true,
        text: response.text ?? "",
        usage: {
          input: usage?.promptTokenCount ?? 0,
          output: usage?.candidatesTokenCount ?? 0,
          thinking: usage?.thoughtsTokenCount ?? 0,
        },
        ...(response.modelVersion && { modelVersion: response.modelVersion }),
        attempts,
      };
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error ? error.status : undefined;
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        ms: Date.now() - started,
        ...(typeof status === "number" && { status }),
        error: message.slice(0, 300),
      });
      const delay = retryDelays[attempt];
      if (delay === undefined || typeof status !== "number" || !retryable.has(status))
        return { ok: false, error: message.slice(0, 300), attempts };
      await sleep(delay);
    }
  }
}
