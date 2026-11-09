import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

/** The prompt pieces one eval sends; a variant replaces any of them. */
export interface PromptParts<Input> {
  systemInstruction: string;
  responseJsonSchema: Record<string, unknown>;
  input: (value: Input) => string;
}

/**
 * One configuration under test, loaded from a TypeScript module's default export. Omitted parts
 * fall back to the app's current prompt, settings and the run's `--model`.
 */
export interface Variant<Input> {
  name: string;
  model?: string;
  /** Merged over the app's generation settings, e.g. `{ temperature: 0, thinkingConfig: {...} }`. */
  config?: Record<string, unknown>;
  prompt?: Partial<PromptParts<Input>>;
}

export interface ResolvedVariant<Input> {
  name: string;
  model: string;
  config: Record<string, unknown>;
  prompt: PromptParts<Input>;
}

const variantShape = z.object({
  name: z.string(),
  model: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  prompt: z
    .object({
      systemInstruction: z.string().optional(),
      responseJsonSchema: z.record(z.string(), z.unknown()).optional(),
      input: z.custom<Function>((value) => typeof value === "function").optional(),
    })
    .optional(),
});

async function loadVariant<Input>(path: string): Promise<Variant<Input>> {
  const module: unknown = await import(pathToFileURL(resolve(path)).href);
  const loaded = z.object({ default: variantShape }).parse(module).default;
  const { prompt, ...variant } = loaded;
  const input = prompt?.input;
  return {
    ...variant,
    ...(prompt && {
      prompt: {
        ...(prompt.systemInstruction !== undefined && {
          systemInstruction: prompt.systemInstruction,
        }),
        ...(prompt.responseJsonSchema !== undefined && {
          responseJsonSchema: prompt.responseJsonSchema,
        }),
        ...(input && {
          input: (value: Input) => {
            const result: unknown = Reflect.apply(input, undefined, [value]);
            if (typeof result !== "string") throw new Error("Variant input must return a string");
            return result;
          },
        }),
      },
    }),
  };
}

export async function loadVariants<Input>(
  paths: string[],
  defaults: {
    model: string | undefined;
    config: Record<string, unknown>;
    prompt: PromptParts<Input>;
  },
): Promise<ResolvedVariant<Input>[]> {
  const declared: Variant<Input>[] = paths.length
    ? await Promise.all(paths.map((path) => loadVariant<Input>(path)))
    : [{ name: "app" }];
  const names = new Set(declared.map((variant) => variant.name));
  if (names.size !== declared.length) throw new Error("Variant names must be unique");
  return declared.map((variant) => {
    const model = variant.model ?? defaults.model;
    if (!model) throw new Error(`Variant "${variant.name}" has no model; pass --model`);
    return {
      name: variant.name,
      model,
      config: { ...defaults.config, ...variant.config },
      prompt: { ...defaults.prompt, ...variant.prompt },
    };
  });
}
