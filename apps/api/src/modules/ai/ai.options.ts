export const AI_OPTIONS = Symbol("AiOptions");
export interface AiOptions {
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  maxConcurrent: number;
}
export const AI_PROVIDER = Symbol("AiProvider");
export const AI_SLEEP = Symbol("AiSleep");
export interface AiProvider {
  generate(input: {
    contents: string;
    systemInstruction: string;
    responseJsonSchema: Record<string, unknown>;
    model: string;
    apiKey: string;
    signal: AbortSignal;
  }): Promise<AttemptResponse>;
}
import type { AttemptResponse } from "./ai-audit.service.js";
