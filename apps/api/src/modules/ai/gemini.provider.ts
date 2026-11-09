import { GoogleGenAI } from "@google/genai";

import type { AiProvider } from "./ai.options.js";
import { generationSettings } from "./generation-settings.js";

/** Concrete provider boundary; tests replace this with a fake and never call Gemini. */
export class GeminiProvider implements AiProvider {
  async generate(input: Parameters<AiProvider["generate"]>[0]): ReturnType<AiProvider["generate"]> {
    const ai = new GoogleGenAI({ apiKey: input.apiKey });
    const response = await ai.models.generateContent({
      model: input.model,
      contents: input.contents,
      config: {
        systemInstruction: input.systemInstruction,
        ...generationSettings,
        responseJsonSchema: input.responseJsonSchema,
        abortSignal: input.signal,
      },
    });
    const usage = response.usageMetadata;
    return {
      text: response.text ?? null,
      envelope: JSON.parse(JSON.stringify(response)) as unknown,
      ...(response.modelVersion && { returnedModel: response.modelVersion }),
      ...(response.responseId && { providerResponseId: response.responseId }),
      ...(response.candidates?.[0]?.finishReason && {
        finishReason: response.candidates[0].finishReason,
      }),
      ...(usage?.promptTokenCount !== undefined && { inputTokens: usage.promptTokenCount }),
      ...(usage?.candidatesTokenCount !== undefined && {
        outputTokens: usage.candidatesTokenCount,
      }),
      ...(usage?.thoughtsTokenCount !== undefined && { thinkingTokens: usage.thoughtsTokenCount }),
      ...(usage?.cachedContentTokenCount !== undefined && {
        cachedTokens: usage.cachedContentTokenCount,
      }),
    };
  }
}
