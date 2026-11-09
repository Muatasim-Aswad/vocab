import type { Generation } from "../lib/gemini.ts";
import { cost, pricesAsOf } from "../lib/pricing.ts";
import type { Case } from "./cases.ts";
import type { RunCheck } from "./checks.ts";
import type { Grade } from "./grading.ts";

export interface RunRecord {
  variant: string;
  model: string;
  input: string;
  run: number;
  generation: Generation;
  checks?: RunCheck;
}

export interface CaseGrade {
  input: string;
  agent: string;
  /** Blind label → "variant#run". */
  key: Record<string, string>;
  grade?: Grade;
  error?: string;
}

const field = (value: unknown) => (typeof value === "string" ? value : "");
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "–");
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function table(header: string[], rows: string[][]): string {
  return [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function gradedOutputs(grades: CaseGrade[], variant: string) {
  return grades.flatMap((caseGrade) =>
    (caseGrade.grade?.outputs ?? [])
      .filter((output) => caseGrade.key[output.label]?.startsWith(`${variant}#`))
      .map((output) => ({ input: caseGrade.input, output })),
  );
}

export function report(
  cases: Case[],
  variants: Array<{ name: string; model: string }>,
  runs: RunRecord[],
  grades: CaseGrade[],
): string {
  const usageRows = variants.map(({ name, model }) => {
    const mine = runs.filter((run) => run.variant === name);
    const ok = mine.flatMap((run) => (run.generation.ok ? [run.generation] : []));
    const costs = ok.map((generation) => cost(model, generation.usage) ?? Number.NaN);
    const latency = mine.flatMap((run) => run.generation.attempts.map((attempt) => attempt.ms));
    const retries = mine.reduce((sum, run) => sum + run.generation.attempts.length - 1, 0);
    return [
      name,
      model,
      `${ok.length}/${mine.length}`,
      String(retries),
      `${(mean(latency) / 1000).toFixed(1)}s`,
      `${Math.round(mean(ok.map((g) => g.usage.input)))} / ${Math.round(mean(ok.map((g) => g.usage.output)))} / ${Math.round(mean(ok.map((g) => g.usage.thinking)))}`,
      costs.some(Number.isNaN) ? "unknown" : `$${(mean(costs) * 1000).toFixed(2)}`,
    ];
  });

  const checkRows = variants.map(({ name }) => {
    const checks = runs.flatMap((run) => (run.variant === name && run.checks ? [run.checks] : []));
    const senses = checks.flatMap((check) => check.senses);
    const withForms = senses.filter((sense) => sense.forms);
    return [
      name,
      pct(checks.filter((check) => check.parsed).length, checks.length),
      mean(checks.map((check) => check.senseCount)).toFixed(1),
      pct(
        withForms.filter((s) => !s.forms?.missing.length && !s.forms?.unexpected.length).length,
        withForms.length,
      ),
      pct(senses.filter((sense) => sense.forms === null).length, senses.length),
      String(senses.reduce((sum, sense) => sum + sense.flagIssues.length, 0)),
      pct(
        senses.filter((sense) => sense.termKnown && sense.correctedOk && sense.partOfSpeechOk)
          .length,
        senses.length,
      ),
      pct(senses.filter((sense) => sense.exampleUsesWord).length, senses.length),
      String(checks.reduce((sum, check) => sum + check.issues.length, 0)),
    ];
  });

  const gradeRows = variants.map(({ name }) => {
    const graded = gradedOutputs(grades, name);
    const essential = graded.flatMap(({ input, output }) => {
      const ids = new Set(
        cases
          .find((item) => item.input === input)
          ?.senses.filter((s) => s.tier === "essential")
          .map((s) => s.id),
      );
      return output.reference_coverage.filter((row) => ids.has(row.reference_sense));
    });
    const senses = graded.flatMap(({ output }) => output.output_senses);
    const count = (verdict: string) => String(senses.filter((s) => s.verdict === verdict).length);
    const failed = (key: "term_ok" | "example_ok" | "gloss_ok" | "label_ok" | "forms_fit") =>
      String(senses.filter((sense) => !sense[key]).length);
    return [
      name,
      `${essential.filter((row) => row.status === "covered").length}/${essential.length}`,
      String(essential.filter((row) => row.status === "blended").length),
      String(essential.filter((row) => row.status === "missing").length),
      count("invalid"),
      count("duplicate"),
      count("valid_unlisted"),
      `${failed("term_ok")} / ${failed("example_ok")} / ${failed("gloss_ok")} / ${failed("label_ok")} / ${failed("forms_fit")}`,
      `${senses.reduce((sum, s) => sum + s.relation_issues.length, 0)} / ${senses.reduce((sum, s) => sum + s.collocation_issues.length, 0)}`,
    ];
  });

  const caseSections = cases.map((item) => {
    const caseGrade = grades.find((grade) => grade.input === item.input);
    const labelOf = Object.fromEntries(
      Object.entries(caseGrade?.key ?? {}).map(([label, id]) => [id, label]),
    );
    const outputs = runs
      .filter((run) => run.input === item.input)
      .map((run) => {
        const id = `${run.variant}#${run.run}`;
        const label = labelOf[id];
        const graded = caseGrade?.grade?.outputs.find((output) => output.label === label);
        if (!run.generation.ok)
          return `- **${id}**: failed (${run.generation.attempts.map((a) => a.status ?? "error").join(", ")}): ${run.generation.error.replaceAll(/\s+/g, " ").slice(0, 100)}`;
        let senses: Array<Record<string, unknown>> = [];
        try {
          const parsed: unknown = JSON.parse(run.generation.text);
          if (Array.isArray(parsed) && parsed.every(isRecord)) senses = parsed;
        } catch {
          senses = [];
        }
        const lines = senses.map((sense, index) => {
          const check = run.checks?.senses[index];
          const verdict = graded?.output_senses.find((row) => row.index === index);
          const formsNote = check?.forms
            ? check.forms.missing.length || check.forms.unexpected.length
              ? ` forms vs ${check.forms.lemma}: missing [${check.forms.missing.join(", ")}] unexpected [${check.forms.unexpected.join(", ")}]`
              : ` forms ✓ ${check.forms.lemma}`
            : " no forms";
          const problems = verdict
            ? [
                verdict.term_issue,
                verdict.example_issue,
                verdict.gloss_issue,
                verdict.label_issue,
                verdict.forms_issue,
                ...verdict.relation_issues.map((r) => `${r.term}: ${r.issue}`),
                ...verdict.collocation_issues.map((c) => `${c.text}: ${c.issue}`),
              ].filter(Boolean)
            : [];
          return `    ${index}. \`${field(sense.term)}\` [${field(sense.partOfSpeech)}] cue=${field(sense.senseCue) || "–"} — ${field(sense.extra)}${verdict ? ` → **${verdict.verdict}**${verdict.reference_senses.length ? ` (${verdict.reference_senses.join(", ")})` : ""}` : ""};${formsNote}${problems.length ? `\n       issues: ${problems.join("; ")}` : ""}`;
        });
        const coverage = graded?.reference_coverage
          .map((row) => `${row.reference_sense}:${row.status}`)
          .join(", ");
        return `- **${id}** (${label ?? "ungraded"})${run.checks?.issues.length ? ` checks: ${run.checks.issues.join(", ")}` : ""}\n${coverage ? `    coverage: ${coverage}\n` : ""}${graded ? `    ${graded.summary}\n` : ""}${lines.join("\n")}`;
      });
    const tail = caseGrade?.error
      ? `\nGrader failed: ${caseGrade.error}`
      : caseGrade?.grade
        ? `\n**Comparison:** ${caseGrade.grade.comparison}${caseGrade.grade.reference_issues.length ? `\n\n**Reference issues:** ${caseGrade.grade.reference_issues.join(" · ")}` : ""}`
        : "";
    return `### ${item.input}\n\nEssential: ${item.senses
      .filter((s) => s.tier === "essential")
      .map((s) => s.id)
      .join(", ")}\n\n${outputs.join("\n")}\n${tail}`;
  });

  return `# One-word eval

## Calls

${table(["Variant", "Model", "OK", "Retries", "Avg latency", "Avg tokens in / out / thinking", `Cost per 1,000 words (prices ${pricesAsOf})`], usageRows)}

## Automatic checks

${table(["Variant", "Parsed", "Avg senses", "Forms exact", "Forms omitted", "Flag issues", "Term/corrected/POS ok", "Example uses word", "Label issues"], checkRows)}

## Grader checks${grades[0] ? ` (${grades[0].agent})` : ""}

${table(["Variant", "Essential covered", "Essential blended", "Essential missing", "Invalid senses", "Duplicates", "Valid, not in reference", "Term / example / gloss / label / forms problems", "Relation / collocation problems"], gradeRows)}

## Cases

${caseSections.join("\n\n")}
`;
}
