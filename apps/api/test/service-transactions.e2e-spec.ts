import { routes } from "@vocab/contracts";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vite-plus/test";

import { Database } from "../src/infra/db/database.js";
import { AiAuditService } from "../src/modules/ai/ai-audit.service.js";
import { CapturesService } from "../src/modules/captures/captures.service.js";
import { AnswerScore } from "../src/modules/study/memory.js";
import { StudySessionRepository } from "../src/modules/study/study-session.repository.js";
import { StudyService } from "../src/modules/study/study.service.js";
import { VocabularyService } from "../src/modules/vocabulary/vocabulary.service.js";
import { createTestApp, tempDir, testConfig } from "./support.js";

describe("feature service transactions", () => {
  it("rolls entry, initial memory and receipt back when capture consumption fails", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      const vocabulary = app.get(VocabularyService);
      const captures = app.get(CapturesService);
      const db = app.get(Database).sqlite;
      const capture = captures.create("peer");
      const body = routes.createEntry.body.parse({
        mutationId: uuidv7(),
        entry: { lemma: "fiets" },
        captureId: capture.id,
      });
      expect(() => vocabulary.create(body)).toThrow(
        "Capture must be completed as an active entry with the same term",
      );
      expect(vocabulary.findEntriesByLemma("fiets")).toEqual([]);
      expect(captures.findById(capture.id)).toEqual(capture);
      expect(db.prepare("SELECT COUNT(*) AS count FROM study_memory").get()).toEqual({ count: 0 });
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM mutation_receipts WHERE mutation_id = ?")
          .get(body.mutationId),
      ).toEqual({ count: 0 });
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("rolls capture consumption back if saved provenance fails, then permits an identical retry", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      const vocabulary = app.get(VocabularyService);
      const captures = app.get(CapturesService);
      const audit = app.get(AiAuditService);
      const capture = captures.create("fiets");
      const body = routes.createEntry.body.parse({
        mutationId: uuidv7(),
        entry: { lemma: "fiets" },
        captureId: capture.id,
        ai: { generationId: uuidv7(), drafts: [{ draftId: uuidv7() }] },
      });
      const auditWrite = vi
        .spyOn(audit, "recordSaved")
        .mockImplementationOnce(() => {
          throw new Error("audit failed");
        })
        .mockImplementation(() => {});
      expect(() => vocabulary.create(body)).toThrow("audit failed");
      expect(vocabulary.findEntriesByLemma("fiets")).toEqual([]);
      expect(captures.findById(capture.id)).toEqual(capture);
      const saved = vocabulary.create(body);
      expect(vocabulary.create(body)).toEqual(saved);
      expect(auditWrite).toHaveBeenCalledTimes(2);
      expect(() => captures.findById(capture.id)).toThrow("Capture not found");
      auditWrite.mockRestore();
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("does not rewrite study memory when an active entry is edited", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      const vocabulary = app.get(VocabularyService);
      const sqlite = app.get(Database).sqlite;
      const created = vocabulary.create(
        routes.createEntry.body.parse({ mutationId: uuidv7(), entry: { lemma: "fiets" } }),
      );
      const before = vocabulary.findEntryById(created.entry.id)!.memory;
      sqlite.exec(`CREATE TRIGGER no_memory_delete BEFORE DELETE ON study_memory BEGIN SELECT RAISE(ABORT, 'memory deleted'); END;
        CREATE TRIGGER no_memory_update BEFORE UPDATE ON study_memory BEGIN SELECT RAISE(ABORT, 'memory updated'); END;`);
      const updated = vocabulary.update(
        { id: created.entry.id },
        routes.updateEntry.body.parse({
          mutationId: uuidv7(),
          expectedRevision: created.entry.revision,
          changes: { extra: "bicycle" },
        }),
      );
      expect(updated.entry.memory).toEqual(before);
      expect(updated.entry.revision).toBe(created.entry.revision + 1);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("enforces hint limits and rolls memory back if a direct answer cannot save the session", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      const vocabulary = app.get(VocabularyService);
      const study = app.get(StudyService);
      const sessions = app.get(StudySessionRepository);
      const created = vocabulary.create(
        routes.createEntry.body.parse({ mutationId: uuidv7(), entry: { lemma: "fiets" } }),
      );
      const started = study.startStudySession({ maxWords: 1, nowMs: Date.now() });
      const before = vocabulary.findEntryById(created.entry.id)!.memory;
      const answer = routes.answerStudy.body.parse({
        mutationId: uuidv7(),
        expectedRevision: started.revision,
        entryId: created.entry.id,
        answerScore: 1,
        answerTimeMs: 900,
        hintCount: 1,
      });
      expect(() => study.answer({ id: started.id }, answer)).toThrow(
        "Answer score exceeds the hint limit",
      );
      expect(() =>
        study.answer({ id: started.id }, { ...answer, hintCount: 2, answerScore: 0.5 }),
      ).toThrow("Answer score exceeds the hint limit");
      expect(study.findStudySession(started.id)).toEqual(started);
      const failed = vi.spyOn(sessions, "update").mockImplementation(() => {
        throw new Error("save failed");
      });
      expect(() =>
        study.answerStudySession(
          started.id,
          started.revision,
          created.entry.id,
          AnswerScore.KNOW,
          900,
          Date.now(),
        ),
      ).toThrow("save failed");
      failed.mockRestore();
      expect(vocabulary.findEntryById(created.entry.id)!.memory).toEqual(before);
      expect(study.findStudySession(started.id)).toEqual(started);
      const valid = { ...answer, hintCount: 2, answerScore: 0.2 as const };
      const saved = study.answer({ id: started.id }, valid);
      expect(study.answer({ id: started.id }, valid)).toEqual(saved);
      expect(saved.session.revision).toBe(started.revision + 1);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });
});
