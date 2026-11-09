import { AppError } from "../../shared/app-error.js";

const definitions = {
  VOCAB_EMPTY: { code: "not_found", message: "Vocabulary has no entries." },
  INVALID_ID_RANGE: { code: "bad_request", message: "Study range is invalid." },
  PERSISTENCE_WRITE_FAILED: { code: "internal", message: "Persisting study data failed." },
  REVISION_CONFLICT: { code: "conflict", message: "Entry changed since it was read." },
} as const;

export class StudyError extends AppError {
  readonly legacyCode: keyof typeof definitions;

  constructor(
    legacyCode: keyof typeof definitions,
    options: { context?: Record<string, unknown> } = {},
  ) {
    const definition = definitions[legacyCode];
    super(definition.code, {
      message: definition.message,
      reason: legacyCode,
      details: { private: options.context ?? {} },
    });
    this.legacyCode = legacyCode;
  }
}
