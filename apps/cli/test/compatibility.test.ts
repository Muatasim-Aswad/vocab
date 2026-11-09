import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { routes } from "@vocab/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { parseListArgs, parseSearchInput } from "../src/platform/args.ts";
import { configureStyles } from "../src/platform/terminal.ts";
import {
  apiRequest,
  seedEntry,
  sql,
  startApi,
  startFakeGemini,
  startProxy,
  studyHistory,
  type ApiServer,
} from "./support/api-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";

const oracle: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/compatibility.json", import.meta.url), "utf8"),
);
assert(oracle && typeof oracle === "object" && "oracle" in oracle);
assert(oracle.oracle && typeof oracle.oracle === "object" && "cases" in oracle.oracle);
assert(
  oracle.oracle.cases &&
    typeof oracle.oracle.cases === "object" &&
    "pageVsCursor" in oracle.oracle.cases,
);
const parserOracle = oracle.oracle.cases.pageVsCursor;
assert(
  parserOracle &&
    typeof parserOracle === "object" &&
    "literalUnknown" in parserOracle &&
    "list" in parserOracle &&
    "missing" in parserOracle &&
    "legacyFlags" in parserOracle &&
    "search" in parserOracle &&
    "whitespace" in parserOracle,
);
const plainJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const count = (text: string) => text.split("\x1b[40m").length - 1;

let shared: ApiServer;
let catalog: ApiServer;
let studyApi: ApiServer;
/** Starts empty; later its database receives an injected persistence fault. */
let isolated: ApiServer;
let gemini: Awaited<ReturnType<typeof startFakeGemini>>;
const harnesses: Harness[] = [];
const catalogIds: Record<string, number> = {};

function harness(server: ApiServer, options?: Parameters<typeof createHarness>[1]): Harness {
  const created = createHarness(server, options);
  harnesses.push(created);
  return created;
}

const getEntry = (server: ApiServer, id: number) =>
  apiRequest(server, "GET", `/api/entries/${id}`, undefined, (value) =>
    routes.getEntry.response.parse(value),
  );
const lookup = (server: ApiServer, term: string) =>
  apiRequest(
    server,
    "GET",
    `/api/entries/lookup?term=${encodeURIComponent(term)}`,
    undefined,
    (value) => routes.lookupEntry.response.parse(value),
  );
const captures = async (server: ApiServer, term: string) =>
  (
    await apiRequest(
      server,
      "GET",
      `/api/captures?term=${encodeURIComponent(term)}`,
      undefined,
      (value) => routes.listCaptures.response.parse(value),
    )
  ).items;
beforeAll(async () => {
  gemini = await startFakeGemini();
  [shared, catalog, studyApi, isolated] = await Promise.all([
    startApi({
      env: {
        VOCAB_GEMINI_API_KEY: "fake-gemini-key",
        GOOGLE_GEMINI_BASE_URL: gemini.url,
        VOCAB_AI_TIMEOUT_MS: "30000",
      },
    }),
    startApi(),
    startApi(),
    startApi(),
  ]);
  const seeds: Array<[string, Record<string, unknown>]> = [
    [
      "appel",
      { lemma: "de appel", partOfSpeech: "NOUN", extra: "apple", examples: ["Ik eet een appel."] },
    ],
    ["lopen", { lemma: "lopen", partOfSpeech: "VERB" }],
    ["peer", { lemma: "de peer", partOfSpeech: "NOUN", extra: "pear" }],
    [
      "zwemmen",
      {
        lemma: "zwemmen",
        partOfSpeech: "VERB",
        examples: ["Wij zwemmen in de zee."],
        collocations: ["gaan zwemmen"],
      },
    ],
    ["mooi", { lemma: "mooi", partOfSpeech: "ADJ" }],
    ["tafel", { lemma: "de tafel", partOfSpeech: "NOUN", relatedTokens: ["~tafelen"] }],
    ["fietsen", { lemma: "fietsen", partOfSpeech: "VERB" }],
    ["snel", { lemma: "snel", partOfSpeech: "ADJ" }],
    ["stoel", { lemma: "de stoel", partOfSpeech: "NOUN" }],
    ["werken", { lemma: "werken", partOfSpeech: "VERB", examples: ["Zij werken hard."] }],
    ["kast", { lemma: "de kast", partOfSpeech: "NOUN" }],
    [
      "zee",
      { lemma: "de zee", partOfSpeech: "NOUN", examples: ["De zee is blauw en de zee is diep."] },
    ],
  ];
  for (const [key, entry] of seeds) catalogIds[key] = (await seedEntry(catalog, entry)).entry.id;
}, 60_000);

afterAll(async () => {
  for (const created of harnesses) created.dispose();
  await Promise.all([shared, catalog, studyApi, isolated].map((server) => server?.dispose()));
  await gemini?.close();
});

describe("modes", () => {
  it("compatibility: fast/f", async () => {
    const h = harness(shared);
    expect(await h.run("f")).toContain("Switched to FAST INPUT mode.");
    expect(h.app.currentMode).toBe("fast");
    const existing = (await seedEntry(shared, { lemma: "de snelfiets" })).entry.id;
    const prompts = h.io.prompts.length;
    // Fast mode captures the term with one request: no preparation, sense choice or prompts.
    const output = await h.run("  de   snelfiets ");
    expect(output).toContain('Captured "de snelfiets" for later review.');
    expect(h.io.prompts.length).toBe(prompts);
    expect(await h.run("DE SNELFIETS")).toContain('Captured "de snelfiets" for later review.');
    expect(await captures(shared, "de snelfiets")).toHaveLength(1);
    expect((await lookup(shared, "de snelfiets")).map((detail) => detail.entry.id)).toEqual([
      existing,
    ]);
    await h.run("snelwoord");
    expect(await lookup(shared, "snelwoord")).toEqual([]);
    expect(await captures(shared, "snelwoord")).toHaveLength(1);
    expect(await h.run("fast")).toContain("Switched to FAST INPUT mode.");
    expect(await h.run("   ")).toContain("Please enter a term to capture.");
    expect(await h.run("help")).toContain(
      "Switch to Fast Input Mode (capture terms for later review)",
    );
  });

  it("pages through captured terms newest first", async () => {
    const h = harness(catalog);
    expect(await h.run("captures")).toContain("No captured terms.");
    await h.run("f");
    for (const term of ["vangst-een", "vangst-twee", "vangst-drie"]) await h.run(term);
    const first = await h.run("cap -l 2");
    expect(first).toContain("=== Captured Terms (Page 1: 1-2) ===");
    expect(first.indexOf("1. vangst-drie")).toBeLessThan(first.indexOf("2. vangst-twee"));
    expect(first).toContain("More captured terms: captures -p 2 -l 2");
    const second = await h.run("captures -p 2 -l 2");
    expect(second).toContain("3. vangst-een");
    expect(second).toContain("no more captured terms");
    expect(await h.run("captures -p 5 -l 2")).toContain(
      'Page 5 is out of range. Valid pages: 1-2 (captured terms: 3, page size: 2). Use "-p <page>".',
    );
    expect(await h.run("captures -ft noun")).toContain(
      'Flags "-ft" and "-se" do not apply to captures and were ignored.',
    );
    expect(await lookup(catalog, "vangst-een")).toEqual([]);
  });

  it("compatibility: normal/n", async () => {
    const h = harness(shared);
    expect(await h.run("n")).toContain("Switched to NORMAL INPUT mode.");
    const output = await h.run("de normaaltafel", "dit is een normaaltafel", "", "");
    expect(output).toContain('Adding term: "de normaaltafel"');
    expect(output).toContain("Noun forms (singular, plural)");
    expect(output).toContain("Examples: ");
    expect(output).toContain("Related terms: ");
    const [detail] = await lookup(shared, "de normaaltafel");
    expect(detail!.entry.examples).toEqual(["Dit is een normaaltafel."]);
    // Legacy inference reads the display term: an article marks a noun, `zich` a reflexive verb.
    expect(detail!.entry).toMatchObject({ partOfSpeech: "NOUN", grammar: { article: "de" } });
    await h.run("zich normaalvergissen", "", "", "");
    expect((await lookup(shared, "zich normaalvergissen"))[0]!.entry).toMatchObject({
      partOfSpeech: "VERB",
      tags: ["reflexive"],
    });
  });

  it("compatibility: detail/dt", async () => {
    const h = harness(shared);
    expect(await h.run("dt")).toContain("Switched to DETAIL INPUT mode.");
    const output = await h.run("detailwerken", "", "", "samen detailwerken", "v", "", "n", "");
    expect(output).toContain('Adding term: "detailwerken" in DETAIL mode');
    expect(output).toMatch(/Part of speech \(VERB\): /);
    expect(output).toMatch(/Irregular\? \(n\) \[y\/N\]: /);
    expect(output).toMatch(/Verb forms \(detailwerk, detailwerkt, .*gedetailwerkt/);
    const [detail] = await lookup(shared, "detailwerken");
    expect(detail!.entry).toMatchObject({
      partOfSpeech: "VERB",
      collocations: ["samen detailwerken"],
    });
    expect(detail!.entry.forms).toContain("detailwerkt");
  });

  it("compatibility: json/j", async () => {
    const h = harness(shared);
    expect(await h.run("j")).toContain("Switched to JSON INPUT mode.");
    expect(await h.run("")).toContain(
      'Paste a JSON object or array of objects with at least a "term" field.',
    );
    expect(await h.run("{bad")).toContain("Invalid JSON:");
    expect(await h.run('{"examples":["x"]}')).toContain(
      'JSON must include a non-empty "term" field.',
    );
    expect(await h.run('{"term":"jsonwoord","partOfSpeech":"noun"}')).toContain(
      'Invalid "partOfSpeech": expected one of NOUN',
    );
    const output = await h.run(
      '{"term":"het jsonhuis","partOfSpeech":"NOUN","examples":["een jsonhuis"],"extra":"json house"}',
    );
    expect(output).toContain("het jsonhuis");
    const [detail] = await lookup(shared, "het jsonhuis");
    expect(detail!.entry).toMatchObject({
      partOfSpeech: "NOUN",
      extra: "json house",
      examples: ["Een jsonhuis."],
    });
  });

  it("compatibility: ai", async () => {
    const h = harness(shared);
    expect(await h.run("ai")).toContain("Switched to AI INPUT mode.");
    gemini.respond(
      200,
      '```json\n[{"term":"de aiboot","corrected":false,"partOfSpeech":"NOUN","examples":["De aiboot vaart."],"extra":"AI boat","relations":[{"type":"related","term":"water"}]}]\n```',
    );
    const before = gemini.requests.length;
    const output = await h.run("aiboot");
    expect(gemini.requests.length).toBe(before + 1);
    expect(gemini.requests.at(-1)!.body).toContain("Input term: aiboot");
    expect(output).toContain("AI: generating suggestions...");
    const [detail] = await lookup(shared, "de aiboot");
    expect(detail!.entry).toMatchObject({
      extra: "AI boat",
      examples: ["De aiboot vaart."],
      partOfSpeech: "NOUN",
    });
    expect(detail!.relations.map((relation) => relation.type)).toEqual(["related"]);
    const existing = await h.run("aiboot", "use-existing");
    expect(existing).toContain('The term "aiboot" already exists in 1 entry.');
    expect(existing).toContain("Using existing entries. AI was not called.");
    expect(gemini.requests.length).toBe(before + 1);
  });

  it("compatibility: searchmode/sm", async () => {
    const h = harness(catalog);
    expect(await h.run("sm")).toContain("Switched to SEARCH mode.");
    expect(h.app.currentMode).toBe("search");
    const output = await h.run("  De   APPEL  ");
    expect(output).toContain('=== Terms matching "de appel" (Page 1 of 1: 1 entries) ===');
    expect(output).toMatch(/1\. de appel znw\s+\{\d+\}/);
    expect(await h.run("  de   appel -ss")).toContain('No terms found matching "  de   appel".');
    expect(await h.run("help")).toContain("Current mode: SEARCH");
  });

  it("compatibility: study/st", async () => {
    const h = harness(studyApi);
    const first = (
      await seedEntry(studyApi, { lemma: "studiewoord", examples: ["Een studiewoord leren."] })
    ).entry.id;
    const second = (await seedEntry(studyApi, { lemma: "studieboek" })).entry.id;
    const historyBefore = (await studyHistory(studyApi)).length;
    const output = await h.run("st", "2", String(first), String(second), "", "k", "", "o", "");
    expect(output).toContain("📚 Study Session Configuration");
    expect(output).toContain("🎓 Starting Study Session");
    expect(output).toContain("You will review 2 terms.");
    expect(output).toContain("✓ Study session completed!");
    expect(output).toContain("Terms reviewed: 2");
    expect(output).toContain("Accuracy: 100%");
    const history = await studyHistory(studyApi);
    expect(history.length).toBe(historyBefore + 1);
    expect(history.at(-1)!.outcome?.status).toBe("completed");
    expect((await getEntry(studyApi, first)).entry.memory).toBeDefined();
  });
});

describe("commands", () => {
  it("compatibility: delete/d", async () => {
    const h = harness(shared);
    const id = (await seedEntry(shared, { lemma: "wisbaar" })).entry.id;
    expect(await h.run("d wisbaar", "n")).toContain("Delete operation cancelled.");
    const deleted = await h.run("d wisbaar", "y");
    expect(h.io.prompts).toContain(`Are you sure you want to delete term ${id}. "wisbaar"? (y): `);
    expect(deleted).toContain("✗ Deleted successfully");
    expect(await lookup(shared, "wisbaar")).toEqual([]);
    const byId = (await seedEntry(shared, { lemma: "wisnummer" })).entry.id;
    expect(await h.run(`delete ${byId}`, "y")).toContain("✗ Deleted successfully");
    const last = (await seedEntry(shared, { lemma: "wislaatste" })).entry.id;
    await h.run("d", "yes");
    expect(h.io.prompts.at(-1)).toContain(`${last}. "wislaatste"`);
    expect(await h.run("d 99999")).toContain("No term found with id 99999.");
    expect(await h.run("d onbestaandwoord")).toContain(
      'Term "onbestaandwoord" not found in the database.',
    );
    await seedEntry(shared, { lemma: "wisdubbel", senseCue: "een" });
    await seedEntry(shared, { lemma: "wisdubbel", senseCue: "twee" });
    expect(await h.run("d wisdubbel")).toContain(
      'Multiple entries match "wisdubbel". Use an id to target one entry.',
    );
  });

  it("compatibility: edit/e", async () => {
    const h = harness(shared);
    const id = (await seedEntry(shared, { lemma: "bewerkbaar", examples: ["Oud voorbeeld."] }))
      .entry.id;
    const output = await h.run("e bewerkbaar", "", "", "nieuw voorbeeld", "");
    expect(output).toContain(`Editing term: ${id}. "bewerkbaar"`);
    expect(output).toContain("✓ Updated successfully!");
    expect((await getEntry(shared, id)).entry.examples).toEqual(["Nieuw voorbeeld."]);
    expect(await h.run(`edit ${id}`, "", "", "", "")).toContain(
      `Found term with id ${id}: "bewerkbaar"`,
    );
    const cancelled = await h.run(`e ${id}`, "q");
    expect(cancelled).toContain("Edit cancelled.");
    const last = (await seedEntry(shared, { lemma: "bewerklaatste" })).entry.id;
    expect(await h.run("e", "", "", "", "")).toContain(`Editing term: ${last}. "bewerklaatste"`);
    expect(await h.run("e 99999")).toContain("No term found with id 99999.");
    await h.run("detail");
    const detailEdit = await h.run(`e ${id}`, "", "", "", "", "", "adv", "");
    expect(detailEdit).toContain("Part of speech");
    expect((await getEntry(shared, id)).entry.partOfSpeech).toBe("ADV");
  });

  it("compatibility: list/ls", async () => {
    const h = harness(catalog);
    const output = await h.run("ls");
    expect(output).toContain("=== Term List (Page 1 of 2: 1-10 of 12) ===");
    expect(output).toContain("Showing 1-10 of 12 terms (page 1 of 2)");
    const positions = [...output.matchAll(/^(\d+)\. (.+?) .*\{(\d+)\}$/gm)].map((match) =>
      Number(match[3]),
    );
    expect(positions).toEqual([...positions].toSorted((a, b) => a - b));
    expect(positions).not.toContain(catalogIds.appel);
    expect(output).not.toMatch(/^\d+\. tafelen/m);
    expect(output).toContain("Word family: tafelen");
  });

  it("compatibility: search/s", async () => {
    const h = harness(catalog);
    const output = await h.run("s de");
    // Relation targets rank after aliases: the `tafelen` stub matches through `de tafel`.
    expect(output).toContain('=== Terms matching "de" (Page 1 of 1: 7 entries) ===');
    expect(output).toMatch(/7\. tafelen\s+\{\d+\}\n\s+Word family: de tafel/);
    expect(output).toContain("Showing 1-7 of 7 terms (page 1 of 1).");
    expect(await h.run("search zwem")).toContain("zwemmen ww");
    expect(await h.run("s onbekendzoekwoord")).toContain(
      'No terms found matching "onbekendzoekwoord".',
    );
    expect(await h.run("s   ")).toContain("Please enter a search term.");
  });

  it("compatibility: show", async () => {
    const h = harness(catalog);
    const output = await h.run(`show ${catalogIds.appel}`);
    expect(output).toMatch(new RegExp(`^de appel znw\\s+\\{${catalogIds.appel}\\}$`, "m"));
    expect(output).toContain("Extra: apple");
    expect(await h.run("show")).toContain("Please provide an entry id. Usage: show <id>.");
    expect(await h.run("show appel")).toContain(
      "Please provide a numeric entry id. Usage: show <id>.",
    );
    expect(await h.run("show 99999")).toContain("No term found with id 99999.");
    const tafel = await h.run(`show ${catalogIds.tafel}`);
    expect(tafel).toContain("Word family: tafelen");
  });

  it("compatibility: help", async () => {
    const h = harness(shared);
    const output = await h.run("help");
    for (const heading of ["Modes:", "Commands:", "Other:"]) expect(output).toContain(heading);
    expect(output).toContain("d | delete <term|id> :Delete a specific term");
    expect(output).toContain("sm | searchmode :Switch to Search Mode");
    expect(output).toContain("Current mode: NORMAL");
    expect(output).not.toContain("quitWithDbCommit");
    expect(output).not.toContain("allowCommit");
    await h.run("j");
    expect(await h.run("help")).toContain("Current mode: JSON");
  });

  it("compatibility: mode", async () => {
    const h = harness(shared);
    expect(await h.run("mode")).toContain("Current mode: NORMAL");
    await h.run("dt");
    expect(await h.run("mode")).toContain("Current mode: DETAIL");
  });

  it("compatibility: quit/q", async () => {
    const h = harness(shared);
    await h.run("q");
    expect(h.app.hasExited).toBe(true);
    const other = harness(shared);
    await other.run("quit");
    expect(other.app.hasExited).toBe(true);
  });

  it("compatibility: clear", async () => {
    const h = harness(shared);
    const before = h.io.clears;
    await h.run("clear");
    expect(h.io.clears).toBeGreaterThan(before);
    expect(h.app.hasExited).toBe(false);
  });

  it("compatibility: quitWithDbCommit/qw", async () => {
    const h = harness(shared);
    for (const command of ["qw", "quitWithDbCommit"]) {
      const output = await h.run(command);
      expect(output).toContain("was retired");
      expect(output).toContain('Use "quit" to exit.');
    }
    expect(h.app.hasExited).toBe(false);
    expect(existsSync(h.paths.preferencesFile)).toBe(false);
  });

  it("compatibility: settings", async () => {
    const h = harness(shared);
    const output = await h.run("settings");
    for (const key of ["apiUrl", "apiToken", "dark", "formsConflict"])
      expect(output).toContain(`${key}: `);
    for (const retired of ["allowCommit", "allowPush", "allowPull", "sync:", "geminiApiKey"])
      expect(output).not.toContain(retired);
    expect(await h.run("settings bogus")).toContain("Unknown settings command: bogus");
    expect(await h.run("settings set")).toContain(
      "Missing key/value. Example: settings set dark true",
    );
    expect(await h.run("settings set color red")).toContain("Unknown setting key: color");
  });
});

describe("list flags", () => {
  it("compatibility: list:-p", async () => {
    const h = harness(catalog);
    const second = await h.run("list -p 2");
    expect(second).toContain("=== Term List (Page 2 of 2: 11-12 of 12) ===");
    expect(second).toMatch(/11\. de appel/);
    expect(second).toMatch(/12\. lopen/);
    expect(await h.run("list -p 5")).toContain(
      'Page 5 is out of range. Valid pages: 1-2 (total terms: 12, page size: 10). Use "-p <page>".',
    );
    expect(await h.run("list -p")).toContain('Missing value for "-p" (page number).');
    const invalid = await h.run("list -p abc");
    expect(invalid).toContain('Ignored invalid page value for "-p": "abc" (using page 1).');
    expect(invalid).toContain("Page 1 of 2");
  });

  it("compatibility: list:-l", async () => {
    const h = harness(catalog);
    expect(await h.run("list -l 5")).toContain("=== Term List (Page 1 of 3: 1-5 of 12) ===");
    expect(await h.run("list -l 5 -p 3")).toContain("Page 3 of 3: 11-12 of 12");
    const invalid = await h.run("list -l nul");
    expect(invalid).toContain('Ignored invalid limit value: "nul" (using 10).');
    expect(invalid).toContain("Page 1 of 2: 1-10 of 12");
    expect(await h.run("list -l 150")).toContain("Page 1 of 1: 1-12 of 12");
  });

  it("compatibility: list:-ft", async () => {
    const h = harness(catalog);
    const verbs = await h.run("list -ft verb");
    expect(verbs).toContain("Page 1 of 1: 1-4 of 4");
    expect(verbs).toMatch(/│ 1\s+│ 10\s+│ verb\s+│ no/);
    expect(await h.run("list -ft noun -ft verb")).toContain("1-4 of 4");
    expect(await h.run("list -ft adv")).toContain('No terms found with type filter "adv".');
    expect(await h.run("list -ft -p 1")).toContain('Missing value for "-ft".');
  });

  it("compatibility: list:-se", async () => {
    const h = harness(catalog);
    const output = await h.run("list -p 2 -se");
    expect(output).toContain("Extra: apple");
    expect(output).toMatch(/│ 2\s+│ 10\s+│ -\s+│ yes/);
    expect(await h.run("list -p 2")).not.toContain("Extra: apple");
  });
});

describe("search flags", () => {
  it("compatibility: search:-p", async () => {
    const h = harness(catalog);
    const output = await h.run("s de -l 2 -p 2");
    expect(output).toContain('=== Terms matching "de" (Page 2 of 4: 7 entries) ===');
    expect(output).toContain("Showing 3-4 of 7 terms (page 2 of 4).");
    expect(await h.run("s de -p 9")).toContain(
      'Page 9 is out of range for search results. Valid pages: 1-1 (total matches: 7, page size: 10). Use "-p <page>".',
    );
    expect(await h.run("s de -p x")).toContain(
      'Ignored invalid page value for "-p": "x" (using page 1).',
    );
  });

  it("compatibility: search:-l", async () => {
    const h = harness(catalog);
    expect(await h.run("s de -l 4")).toContain("Showing 1-4 of 7 terms (page 1 of 2).");
    expect(await h.run("s de -l")).toContain('Missing value for "-l".');
  });

  it("compatibility: search:-ft", async () => {
    const h = harness(catalog);
    expect(await h.run("s * -ft adj")).toMatch(/Page 1 of 1: 2 entries/);
    expect(await h.run("s * -ft verb -ft adj")).toMatch(/Page 1 of 1: 2 entries/);
    expect(await h.run("s * -ft verb")).toMatch(/Page 1 of 1: 4 entries/);
  });

  it("compatibility: search:-a", async () => {
    const h = harness(catalog);
    const termOnly = await h.run("s *zee*");
    expect(termOnly).toContain("1 entries");
    expect(termOnly).toMatch(/│ term\s+│/);
    const all = await h.run("s *zee* -a");
    expect(all).toContain("2 entries");
    expect(all).toMatch(/│ all\s+│/);
    expect(all).toContain("Wij zwemmen in de zee.");
    expect(await h.run("s *apple* -a")).toContain('No terms found matching "*apple*".');
  });

  it("compatibility: search:-ss", async () => {
    const h = harness(catalog);
    expect(await h.run("s   de   peer")).toContain('Terms matching "de peer"');
    expect(await h.run("s   de   peer -ss")).toContain('No terms found matching "   de   peer".');
  });

  it("compatibility: search:-ha", async () => {
    const h = harness(catalog);
    configureStyles({ dark: false, level: 1 });
    try {
      const first = await h.run("s zee");
      const all = await h.run("s zee -ha");
      expect(count(first)).toBe(1);
      expect(count(all)).toBe(3);
    } finally {
      configureStyles({ dark: false, level: 0 });
    }
  });

  it("compatibility: search:-se", async () => {
    const h = harness(catalog);
    expect(await h.run("s peer -se")).toContain("Extra: pear");
    expect(await h.run("s peer")).not.toContain("Extra: pear");
  });

  it("compatibility: search:-s", async () => {
    const h = harness(catalog);
    const output = await h.run("s -s peer");
    expect(output).toContain('Flag "-s" is no longer supported and was ignored.');
    expect(output).toContain('Terms matching "peer"');
  });

  it("compatibility: search:-x", async () => {
    const h = harness(catalog);
    const output = await h.run("s peer -x");
    expect(output).toContain('Flag "-x" is no longer supported and was ignored.');
    expect(output).toContain('Terms matching "peer"');
  });

  it("compatibility: search:-t", async () => {
    const h = harness(catalog);
    const output = await h.run("s -t peer");
    expect(output).toContain('Flag "-t" is no longer supported and was ignored.');
    expect(output).toContain('Terms matching "peer"');
  });
});

describe("parser", () => {
  it("compatibility: parser:quoted", async () => {
    expect(parseSearchInput('"de appel" -l 3').value.query).toBe("de appel");
    expect(parseListArgs('-ft "verb"').value.typeFilter).toBe("verb");
    expect(await harness(catalog).run('s "de appel"')).toContain('Terms matching "de appel"');
  });

  it("compatibility: parser:unknown", async () => {
    expect(plainJson(parseSearchInput("--unknown woord"))).toEqual(parserOracle.literalUnknown);
    expect(await harness(catalog).run("s --unknown woord")).toContain(
      'No terms found matching "--unknown woord".',
    );
  });

  it("compatibility: parser:repeated", async () => {
    expect(plainJson(parseListArgs("-p 2 -l 5 -ft Verb -se"))).toEqual(parserOracle.list);
    expect(parseListArgs("-l 3 -l 5 -p 1 -p 2").value).toMatchObject({ limit: 5, cursor: 2 });
    expect(await harness(catalog).run("list -l 3 -l 5")).toContain("1-5 of 12");
  });

  it("compatibility: parser:missing", async () => {
    expect(plainJson(parseListArgs("-p -l -ft"))).toEqual(parserOracle.missing);
    expect(plainJson(parseSearchInput("-x -s -t woord"))).toEqual(parserOracle.legacyFlags);
    const output = await harness(catalog).run("list -p -l -ft");
    expect(output).toContain('Missing value for "-ft".');
    expect(output).not.toContain("Term List");
  });

  it("compatibility: parser:whitespace", async () => {
    expect(plainJson(parseSearchInput("  Het  huis  -p 3 -l 5 -a -ha"))).toEqual(
      parserOracle.search,
    );
    expect(plainJson(parseSearchInput("  het   huis  -ss"))).toEqual(parserOracle.whitespace);
  });

  it("compatibility: prompt:-d-stale", async () => {
    const h = harness(shared);
    const keep = (await seedEntry(shared, { lemma: "blijfstaan" })).entry.id;
    const output = await h.run("-d", "q");
    expect(output).toContain('Adding term: "-d"');
    expect(output).toContain("Add cancelled.");
    expect(output).not.toContain("Are you sure you want to delete");
    expect((await getEntry(shared, keep)).entry.lemma).toBe("blijfstaan");
  });
});

describe("add flows", () => {
  it("compatibility: add:duplicate", async () => {
    const h = harness(shared);
    await h.run("normal");
    h.io.optional.push([/^Related terms: /, ""]);
    const id = (await seedEntry(shared, { lemma: "dubbelwoord" })).entry.id;
    const edited = await h.run("dubbelwoord", "e", String(id), "", "", "samen dubbel");
    expect(edited).toContain('The term "dubbelwoord" already exists in 1 entry.');
    expect(edited).toContain("✓ Updated successfully!");
    expect((await getEntry(shared, id)).entry.examples).toEqual(["Samen dubbel."]);
    h.io.optional.push([/^Examples: /, ""], [/ forms \(/, ""]);
    expect(await h.run("dubbelwoord", "e", "back", "q")).toContain("Add cancelled.");
    const added = await h.run("dubbelwoord", "a", "eerste", "tweede");
    expect(added).toContain(
      "Before adding a new meaning, this existing entry needs a meaning label.",
    );
    const matches = (await lookup(shared, "dubbelwoord"))
      .map((detail) => detail.entry.senseCue ?? "")
      .toSorted((a, b) => a.localeCompare(b));
    expect(matches).toEqual(["eerste", "tweede"]);
  });

  it("compatibility: add:sense-cue", async () => {
    const h = harness(shared);
    await h.run("normal");
    h.io.optional.push([/^Examples: /, ""], [/ forms \(/, ""], [/^Related terms: /, ""]);
    const id = (await seedEntry(shared, { lemma: "labelwoord" })).entry.id;
    const invalid = await h.run("labelwoord", "a", "oud", "drie woorden lang");
    expect(invalid).toContain("Meaning label must be one or two words.");
    expect((await getEntry(shared, id)).entry.senseCue).toBeUndefined();
    expect(await lookup(shared, "labelwoord")).toHaveLength(1);
    await h.run("labelwoord", "a", "", "oud", "nieuw");
    const cues = (await lookup(shared, "labelwoord"))
      .map((detail) => detail.entry.senseCue ?? "")
      .toSorted((a, b) => a.localeCompare(b));
    expect(cues).toEqual(["nieuw", "oud"]);
    const duplicate = await h.run("labelwoord", "a", "oud");
    expect(duplicate).toContain('Meaning label "oud" already exists for "labelwoord".');
  });

  it("compatibility: add:relation-choice", async () => {
    const h = harness(shared);
    await seedEntry(shared, { lemma: "relbank", senseCue: "zitten" });
    const money = (await seedEntry(shared, { lemma: "relbank", senseCue: "geld" })).entry.id;
    await h.run("json");
    const output = await h.run(
      '{"term":"relkluis","relations":[{"type":"synonym","term":"relbank"}]}',
      String(money),
    );
    expect(output).toContain(
      'Related term "relbank" matches multiple entries. Choose the intended target.',
    );
    const [detail] = await lookup(shared, "relkluis");
    expect(detail!.relations).toEqual([
      expect.objectContaining({ type: "synonym", entry: expect.objectContaining({ id: money }) }),
    ]);
    const cancelled = await h.run(
      '{"term":"relkist","relations":[{"type":"related","term":"relbank"}]}',
      "cancel",
    );
    expect(cancelled).toContain("Add cancelled.");
    expect(await lookup(shared, "relkist")).toEqual([]);
  });

  it("compatibility: add:forms-conflict", async () => {
    const h = harness(shared);
    await h.run("json");
    const asked = await h.run(
      '{"term":"de vormstoel","partOfSpeech":"NOUN","forms":["vormstoels"]}',
      "provided",
    );
    expect(asked).toContain('Forms mismatch for "de vormstoel".');
    expect(asked).toContain("Provided: vormstoels");
    expect(asked).toContain(
      "Choose which forms to keep [provided=Keep provided forms | inferred=Use inferred forms",
    );
    expect((await lookup(shared, "de vormstoel"))[0]!.entry.forms).toEqual(["vormstoels"]);
    const { inferredForms } = await apiRequest(
      shared,
      "POST",
      "/api/entries/forms/resolve",
      { term: "de vormtafel", partOfSpeech: "NOUN" },
      (value) => routes.resolveForms.response.parse(value),
    );
    assert(inferredForms);
    expect(inferredForms.length).toBeGreaterThan(1);
    const reordered = [...inferredForms].toReversed();
    const sameForms = await h.run(
      JSON.stringify({ term: "de vormtafel", partOfSpeech: "NOUN", forms: reordered }),
    );
    expect(sameForms).not.toContain("Forms mismatch");
    expect((await lookup(shared, "de vormtafel"))[0]!.entry.forms).toEqual(reordered);
    await h.run("settings set formsConflict inferred");
    const inferred = await h.run(
      '{"term":"de vormlamp","partOfSpeech":"NOUN","forms":["vormlamps"]}',
    );
    expect(inferred).toContain("Using configured forms conflict resolution: inferred.");
    expect((await lookup(shared, "de vormlamp"))[0]!.entry.forms).not.toContain("vormlamps");
    await h.run("settings set formsConflict provided");
    await h.run('{"term":"de vormdeur","partOfSpeech":"NOUN","forms":["vormdeurs"]}');
    expect((await lookup(shared, "de vormdeur"))[0]!.entry.forms).toEqual(["vormdeurs"]);
    await h.run("settings set formsConflict manual");
    const manual = await h.run(
      '{"term":"de vormkist","partOfSpeech":"NOUN","forms":["vormkists"]}',
      "vormkisten",
    );
    expect(manual).toContain("Using configured forms conflict resolution: manual.");
    expect((await lookup(shared, "de vormkist"))[0]!.entry.forms).toEqual(["vormkisten"]);
  });

  it("compatibility: add:json-batch", async () => {
    const h = harness(shared);
    const existing = (
      await seedEntry(shared, { lemma: "batchwoord", senseCue: "een", examples: ["Eerste zin."] })
    ).entry.id;
    await h.run("j");
    const output = await h.run(
      '[{"term":"batchwoord","senseCue":"een","examples":["tweede zin"]},{"term":"batchwoord","senseCue":"twee"},{"term":"batchander"}]',
      "update",
    );
    expect(output).toContain('Existing entries for "batchwoord":');
    expect(output).toContain("Draft 1: batchwoord [een] matches an existing sense");
    expect((await getEntry(shared, existing)).entry.examples).toEqual([
      "Eerste zin.",
      "Tweede zin.",
    ]);
    const cues = (await lookup(shared, "batchwoord"))
      .map((detail) => detail.entry.senseCue ?? "")
      .toSorted((a, b) => a.localeCompare(b));
    expect(cues).toEqual(["een", "twee"]);
    expect(await lookup(shared, "batchander")).toHaveLength(1);
    const finalView = output.slice(output.lastIndexOf("-".repeat(40)));
    expect(finalView).toContain("batchwoord [een]");
    expect(finalView).toContain("batchwoord [twee]");
    expect(finalView).toContain("batchander");
  });

  it("keeps a backfilled label while separating conflicting incoming meanings", async () => {
    const h = harness(shared);
    const existing = (await seedEntry(shared, { lemma: "scheidingswoord" })).entry;
    await h.run("j");
    const output = await h.run(
      '[{"term":"scheidingswoord","senseCue":"eerste"},{"term":"scheidingswoord","senseCue":"tweede"}]',
      "suggest:eerste",
      "separate",
      "tweede",
      "derde",
    );
    expect(output).toContain("already matches another incoming meaning label");
    const saved = (await lookup(shared, "scheidingswoord")).map((detail) => detail.entry);
    expect(
      saved.map((entry) => entry.senseCue ?? "").toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["derde", "eerste", "tweede"]);
    expect(saved.find((entry) => entry.id === existing.id)).toMatchObject({
      senseCue: "eerste",
      revision: existing.revision + 1,
    });
  });

  it("does not persist backfilled labels when a draft conflict is cancelled", async () => {
    const h = harness(shared);
    const existing = (await seedEntry(shared, { lemma: "annuleringswoord" })).entry;
    await h.run("j");
    expect(
      await h.run(
        '[{"term":"annuleringswoord","senseCue":"oud"},{"term":"annuleringswoord","senseCue":"nieuw"}]',
        "suggest:oud",
        "cancel",
      ),
    ).toContain("Add cancelled.");
    const saved = (await lookup(shared, "annuleringswoord")).map((detail) => detail.entry);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: existing.id, revision: existing.revision });
    expect(saved[0]!.senseCue).toBeUndefined();
  });

  it("compatibility: add:ai-retry", async () => {
    const h = harness(shared);
    await h.run("ai");
    gemini.respond(400, "bad request");
    const before = gemini.requests.length;
    expect(await h.run("aifout")).toContain("AI request failed: AI generation failed");
    expect(gemini.requests.length).toBe(before + 1);
    gemini.respond(503, "overloaded");
    gemini.respond(
      200,
      '```json\n[{"term":"aiherhaal","corrected":false,"partOfSpeech":"VERB","irregular":true,"separable":true,"examples":["Nog een keer."]}]\n```',
    );
    const output = await h.run("aiherhaal");
    expect(gemini.requests.length).toBe(before + 3);
    expect(output).toContain("AI: still working");
    expect((await lookup(shared, "aiherhaal"))[0]!.entry.examples).toEqual(["Nog een keer."]);
    expect((await lookup(shared, "aiherhaal"))[0]!.entry.grammar).toMatchObject({
      irregular: true,
      isSeparable: true,
    });
  }, 40_000);
});

async function seedStudy(server: ApiServer, entries: Array<Record<string, unknown>>) {
  const ids: number[] = [];
  for (const entry of entries) ids.push((await seedEntry(server, entry)).entry.id);
  return ids;
}

describe("study flows", () => {
  it("compatibility: study:config", async () => {
    const h = harness(studyApi);
    const ids = await seedStudy(studyApi, [{ lemma: "configwoord" }]);
    const output = await h.run("study", "q");
    expect(output).toMatch(/Total terms available: \d+ \(id range: \d+-\d+\)/);
    expect(output).toContain("Cancelled.");
    expect(await h.run("st", "2", "0")).toContain("Invalid start id. Cancelled.");
    expect(await h.run("st", "2", String(ids[0]), "0")).toContain("Invalid end id. Cancelled.");
    const invalid = await h.run("st", "1", "abc", "", "q");
    expect(invalid).toContain("Invalid number. Using default: 20");
    expect(invalid).toContain("Study session ended early.");
    const empty = harness(isolated);
    expect(await empty.run("st")).toContain("No terms available to study. Add some terms first!");
  });

  it("compatibility: study:hints", async () => {
    const h = harness(studyApi);
    const [target, word] = await seedStudy(studyApi, [
      { lemma: "hintdoel" },
      {
        lemma: "hintwoord",
        partOfSpeech: "NOUN",
        examples: ["Een hintwoord helpt."],
        collocations: ["hintwoord geven"],
        relatedTokens: ["+hintdoel"],
      },
    ]);
    const output = await h.run(
      "st",
      "2",
      String(word),
      String(word),
      "",
      () => "h",
      "h",
      "o",
      "",
      () => {
        h.clock.now += 4200;
        return "k";
      },
      "",
      "n",
    );
    expect(output).toContain("💡  Een hintwoord helpt.");
    expect(output).toContain("💡  hintwoord geven");
    expect(output).toContain("Synonyms: hintdoel");
    expect(output).toContain("You already used a clue for this term.");
    expect(output).toContain("With 2 clues: 1");
    const log = (await studyHistory(studyApi)).at(-1)!;
    expect(log.reviews[0]).toMatchObject({
      id: word,
      internals: { answerScore: 0.2, answerTime: 4200 },
    });
    expect(target).toBeGreaterThan(0);
  });

  it("compatibility: study:consolidation", async () => {
    const h = harness(studyApi);
    const [first, second] = await seedStudy(studyApi, [
      { lemma: "zwakeen" },
      { lemma: "zwaktwee" },
    ]);
    const output = await h.run(
      "st",
      "2",
      String(first),
      String(second),
      "",
      "n",
      "",
      "n",
      "",
      "y",
      "",
      "k",
      "",
      "o",
      "",
    );
    expect(output).toContain("✓ Study session completed!");
    expect(output).toContain("Consolidate weak terms? (2 terms, no memory updates) [Y/n]: ");
    expect(output).toContain("🔁 Starting Consolidation 1");
    expect(output).toContain("You will review 2 weak terms (no memory updates).");
    expect(output).toContain("✓ Consolidation 1 completed!");
    const log = (await studyHistory(studyApi)).at(-1)!;
    expect(log.reviews).toHaveLength(2);
    expect(log.stats).toMatchObject({ wordsReviewed: 2, noCount: 2 });
    for (const review of log.reviews) {
      const memory = (await getEntry(studyApi, review.id)).entry.memory!;
      expect({ strength: memory.strength, streak: memory.streak }).toEqual({
        strength: review.after.strength,
        streak: review.after.streak,
      });
    }
  });

  it("compatibility: study:interrupt", async () => {
    const h = harness(studyApi);
    const [first, second] = await seedStudy(studyApi, [
      { lemma: "stopeen" },
      { lemma: "stoptwee" },
    ]);
    const untouched = (await getEntry(studyApi, second!)).entry.memory;
    const output = await h.run("st", "2", String(first), String(second), "", "k", "", "q");
    expect(output).toContain("Study session ended early.");
    expect(output).toContain("Terms reviewed: 1");
    const log = (await studyHistory(studyApi)).at(-1)!;
    expect(log.outcome?.status).toBe("quit");
    expect(log.reviews.map((review) => review.id)).toEqual([first]);
    expect((await getEntry(studyApi, second!)).entry.memory).toEqual(untouched);
    expect((await getEntry(studyApi, first!)).entry.memory).not.toEqual(untouched);
  });

  it("compatibility: study:log-failure", async () => {
    const [word] = await seedStudy(isolated, [{ lemma: "logwoord" }]);
    const proxy = await startProxy(() => isolated.url);
    const ends = () =>
      proxy.seen.filter((request) => request.method === "POST" && request.path.endsWith("/end"));
    // A real SQLite write failure while the final history record is stored.
    sql(
      isolated,
      "CREATE TRIGGER inject_history_failure BEFORE INSERT ON study_history BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END",
    );
    try {
      const bestEffort = harness(isolated, { apiUrl: proxy.url });
      const output = await bestEffort.run("st", "2", String(word), String(word), "", "k", "");
      expect(output).toContain("✓ Study session completed!");
      expect(output).toContain(
        "Warning: failed to persist study session log (Failed to save changes. Please try again.).",
      );
      const failFast = harness(isolated, { apiUrl: proxy.url, studyLogPolicy: "fail-fast" });
      const strict = await failFast.run("st", "2", String(word), String(word), "", "k", "");
      expect(strict).toContain("Failed to save changes. Please try again.");
      expect(strict).not.toContain("Warning: failed to persist");
    } finally {
      sql(isolated, "DROP TRIGGER IF EXISTS inject_history_failure");
    }
    // The failed completions rolled back entirely: sessions stay open, answers kept, no history.
    expect(ends().map((request) => request.outcome)).toEqual(["forward", "forward"]);
    expect(await studyHistory(isolated)).toEqual([]);
    for (const end of ends()) {
      const session = await apiRequest(
        isolated,
        "GET",
        end.path.replace(/\/end$/, ""),
        undefined,
        (value) => routes.startStudy.response.parse(value),
      );
      expect(session).toMatchObject({ endedAt: null, stats: { wordsReviewed: 1 } });
    }
    // Retrying the same completion after the fault clears stores exactly one final record.
    const [failed] = ends();
    const body: unknown = JSON.parse(failed!.body);
    const retried = await apiRequest(isolated, "POST", failed!.path, body, (value) =>
      routes.endStudy.response.parse(value),
    );
    expect(retried.endedAt).toBeTruthy();
    expect(await apiRequest(isolated, "POST", failed!.path, body)).toEqual(retried);
    const history = await studyHistory(isolated);
    expect(history).toHaveLength(1);
    expect(failed!.path).toContain(history[0]!.sessionId);
    expect(history[0]).toMatchObject({
      outcome: { status: "completed" },
      stats: { wordsReviewed: 1 },
    });
    await proxy.close();
  });

  it("compatibility: study:lost-end", async () => {
    const [word] = await seedStudy(studyApi, [{ lemma: "verloreneind" }]);
    const proxy = await startProxy(() => studyApi.url);
    let dropped = false;
    proxy.plan((request) => {
      if (request.method !== "POST" || !request.url?.endsWith("/end") || dropped) return "forward";
      dropped = true;
      return "drop-response";
    });
    const before = (await studyHistory(studyApi)).length;
    const h = harness(studyApi, { apiUrl: proxy.url });
    const output = await h.run("st", "2", String(word), String(word), "", "k", "");
    expect(output).toContain("✓ Study session completed!");
    expect(output).not.toContain("Warning");
    const ends = proxy.seen.filter(
      (request) => request.method === "POST" && request.path.endsWith("/end"),
    );
    expect(ends.map((request) => request.outcome)).toEqual(["drop-response", "forward"]);
    expect(JSON.parse(ends[1]!.body)).toEqual(JSON.parse(ends[0]!.body));
    const history = await studyHistory(studyApi);
    expect(history).toHaveLength(before + 1);
    expect(ends[0]!.path).toContain(history.at(-1)!.sessionId);
    expect(history.at(-1)).toMatchObject({ outcome: { status: "completed" } });
    expect(history.at(-1)!.reviews.map((review) => review.id)).toEqual([word]);
    await proxy.close();
  });
});

/** Retired keys explain themselves and change nothing. */
async function expectRetired(key: string, value = "true") {
  const h = harness(shared);
  const output = await h.run(`settings set ${key} ${value}`);
  expect(output).toContain(`Setting "${key}" was retired:`);
  expect(output).toContain("Nothing was changed.");
  expect(output).not.toContain(value === "true" ? "Updated" : value);
  expect(existsSync(h.paths.preferencesFile)).toBe(false);
  expect(existsSync(h.paths.connectionFile)).toBe(false);
  return output;
}

describe("settings", () => {
  it("compatibility: settings:show", async () => {
    const h = harness(shared);
    const output = await h.run("settings show");
    expect(output).toContain("apiToken: (set)");
    expect(output).not.toContain(h.connection.token);
    expect(output).toContain(`apiUrl: ${shared.url}`);
  });

  it("compatibility: settings:dark", async () => {
    const h = harness(shared);
    expect(await h.run("settings")).toContain("dark: false");
    expect(await h.run("settings set dark true")).toContain("Updated dark to true.");
    expect(JSON.parse(readFileSync(h.paths.preferencesFile, "utf8"))).toEqual({
      dark: true,
      formsConflict: "ask",
    });
    configureStyles({ dark: true, level: 3 });
    const { s } = await import("../src/platform/terminal.ts");
    const dark = s.alert("x");
    configureStyles({ dark: false, level: 3 });
    expect(s.alert("x")).not.toBe(dark);
    configureStyles({ dark: false, level: 0 });
    expect(await h.run("settings set dark maybe")).toContain(
      "Invalid value for dark: maybe. Use true/false.",
    );
  });

  it("compatibility: settings:formsConflict", async () => {
    const h = harness(shared);
    expect(await h.run("settings")).toContain("formsConflict: ask");
    for (const value of ["inferred", "provided", "manual", "ask"])
      expect(await h.run(`settings set formsConflict ${value}`)).toContain(
        `Updated formsConflict to ${value}.`,
      );
    expect(await h.run("settings set formsConflict never")).toContain(
      "Invalid value for formsConflict: never. Use ask/inferred/provided/manual.",
    );
  });

  it("compatibility: settings:connection", async () => {
    const h = harness(shared);
    const { readConnection } = await import("../src/infra/config.ts");
    expect(await h.run("settings set apiUrl ftp://x")).toContain("Use an http(s) URL.");
    expect(await h.run("settings set apiUrl http://127.0.0.1:9/")).toContain("Updated apiUrl to");
    const stored: unknown = JSON.parse(readFileSync(h.paths.connectionFile, "utf8"));
    expect(stored).toEqual({ apiUrl: "http://127.0.0.1:9" });
    expect(statSync(h.paths.connectionFile).mode & 0o777).toBe(0o600);
    expect(readConnection(h.paths, {})).toEqual({ apiUrl: "http://127.0.0.1:9", token: undefined });
    expect(
      readConnection(h.paths, { VOCAB_API_URL: "http://a:1", VOCAB_API_TOKEN: " t " }),
    ).toEqual({
      apiUrl: "http://a:1",
      token: "t",
    });
    expect(h.paths.connectionFile.startsWith(join(import.meta.dirname, "../../.."))).toBe(false);
    expect(await h.run("settings set token abc")).toContain("Unknown setting key: token");
  });

  it("compatibility: settings:allowCommit", async () => {
    expect(await expectRetired("allowCommit")).toContain("storage Git commits were removed");
  });

  it("compatibility: settings:allowPush", async () => {
    expect(await expectRetired("allowPush")).toContain("storage Git pushes were removed");
  });

  it("compatibility: settings:allowPull", async () => {
    expect(await expectRetired("allowPull")).toContain("startup Git pulls were removed");
  });

  it("compatibility: settings:sync", async () => {
    expect(await expectRetired("sync", "ask")).toContain("startup storage sync was removed");
  });

  it("compatibility: settings:geminiApiKey", async () => {
    expect(await expectRetired("geminiApiKey", "sekrit-value")).toContain("VOCAB_GEMINI_API_KEY");
  });
});
