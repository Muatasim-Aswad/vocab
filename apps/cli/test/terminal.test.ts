import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { parseJsonDefaults } from "../src/modules/vocabulary/json-input.ts";
import { needsMoreJsonInput } from "../src/platform/json-input.ts";
import {
  configureStyles,
  createTerminalIO,
  isPromptAbort,
  PromptAbortedError,
  type TerminalIO,
} from "../src/platform/terminal.ts";

function pipedTerminal() {
  configureStyles({ dark: false, level: 0 });
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk: Buffer) => (text += chunk.toString()));
  return { io: createTerminalIO(input, output), input, output: () => text };
}

describe("piped terminal", () => {
  it("answers prompts line by line, including lines typed ahead", async () => {
    const { io, input, output } = pipedTerminal();
    input.write("eerste\ntweede\n");
    expect(await io.ask("A: ")).toBe("eerste");
    expect(await io.ask("B: ")).toBe("tweede");
    expect(output()).toContain("A: eerste\nB: tweede\n");
    io.close();
  });

  it("offers numbered choices without a TTY", async () => {
    const { io, input, output } = pipedTerminal();
    const choice = io.choose("Choose what to do", [
      { value: "a", label: "Add a new meaning" },
      { value: "q", label: "Cancel" },
    ]);
    input.write("9\n2\n");
    expect(await choice).toBe("q");
    expect(output()).toContain("  1) Add a new meaning\n  2) Cancel\n");
    const abort = io.choose("Pick", [{ value: "x", label: "X" }]);
    input.write("q\n");
    await expect(abort).rejects.toBeInstanceOf(PromptAbortedError);
    io.close();
  });

  it("collects multi-line JSON until brackets close", async () => {
    const { io, input } = pipedTerminal();
    const pasted = io.askJson("[JSON] > ");
    input.write('{"term":\n"huis",\n"examples":["een {accolade}"]}\n');
    expect(JSON.parse(await pasted)).toEqual({ term: "huis", examples: ["een {accolade}"] });
    io.close();
  });

  it("answers quit once input ends", async () => {
    const { io, input } = pipedTerminal();
    const pending = io.ask("A: ");
    input.end();
    expect(await pending).toBe("q");
    expect(await io.ask("B: ")).toBe("q");
  });
});

describe("interactive terminal", () => {
  const terminals: TerminalIO[] = [];
  afterEach(() => {
    for (const io of terminals.splice(0)) io.close();
    vi.unstubAllEnvs();
  });

  function terminal() {
    vi.stubEnv("TERM", "xterm-256color");
    configureStyles({ dark: false, level: 0 });
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    let text = "";
    output.on("data", (chunk: Buffer) => (text += chunk.toString()));
    const io = createTerminalIO(input, output);
    terminals.push(io);
    const ready = (prompt: string) => vi.waitFor(() => expect(text).toContain(prompt));
    return { io, input, ready };
  }

  it("keeps command completion and history across Inquirer text and choice prompts", async () => {
    const { io, input, ready } = terminal();
    io.setupCompleter(["search", "show"], () => ["huis"]);
    const command = io.ask("Command: ", true);
    input.write("sea");
    input.write("\t");
    input.write("\r");
    expect(await command).toBe("search");

    const field = io.ask("Meaning: ");
    await ready("Meaning:");
    input.write("  dwelling  \r");
    expect(await field).toBe("  dwelling  ");

    const choice = io.choose("Action:", [
      { value: "save", label: "Save" },
      { value: "skip", label: "Skip" },
    ]);
    await ready("Action:");
    input.write("\x1b[B");
    input.write("\r");
    expect(await choice).toBe("skip");

    const recalled = io.ask("Next: ", true);
    input.write("\x1b[A");
    input.write("\r");
    expect(await recalled).toBe("search");

    const word = io.ask("Word: ", true);
    input.write("hu");
    input.write("\t");
    input.write("\r");
    expect(await word).toBe("huis");

    const json = io.askJson("JSON: ");
    input.write('{"term":\r"huis"}\r');
    expect(JSON.parse(await json)).toEqual({ term: "huis" });

    const empty = io.ask("Keep current: ");
    await ready("Keep current:");
    input.write("\r");
    expect(await empty).toBe("");
  });

  it("returns quit on Ctrl+C in a text prompt and restores the command reader", async () => {
    const { io, input, ready } = terminal();
    const field = io.ask("Field: ");
    await ready("Field:");
    input.write("\x03");
    expect(await field).toBe("q");
    const command = io.ask("Command: ", true);
    input.write("help\r");
    expect(await command).toBe("help");
  });

  it("aborts a menu on Ctrl+C without leaving the command reader attached", async () => {
    const { io, input, ready } = terminal();
    const aborted = io.choose("Pick:", [{ value: "save", label: "Save" }]).catch(isPromptAbort);
    await ready("Pick:");
    input.write("\x03");
    expect(await aborted).toBe(true);
    const command = io.ask("Command: ", true);
    input.write("q\r");
    expect(await command).toBe("q");
  });

  it("answers quit when input ends during an Inquirer prompt", async () => {
    const { io, input, ready } = terminal();
    const field = io.ask("Field: ");
    await ready("Field:");
    input.end();
    expect(await field).toBe("q");
    expect(await io.ask("Next: ", true)).toBe("q");
    expect(await io.ask("Another: ")).toBe("q");
  });

  it("treats Ctrl+D on an empty field as EOF without interrupting edits to a nonempty field", async () => {
    const { io, input, ready } = terminal();
    const field = io.ask("Meaning: ");
    await ready("Meaning:");
    input.write("huis");
    input.write("\x04");
    input.write("\r");
    expect(await field).toBe("huis");

    const eof = io.ask("Done: ");
    await ready("Done:");
    input.write("\x04");
    expect(await eof).toBe("q");
    expect(await io.ask("Command: ", true)).toBe("q");
  });
});

describe("JSON drafts", () => {
  it("detects incomplete pasted JSON", () => {
    expect(needsMoreJsonInput('{"term":"a"}')).toBe(false);
    expect(needsMoreJsonInput('[{"term":"a"},')).toBe(true);
    expect(needsMoreJsonInput('{"term":"}"')).toBe(true);
    expect(needsMoreJsonInput("{]}")).toBe(false);
  });

  it("keeps legacy validation and relation tokens", () => {
    expect(
      parseJsonDefaults(
        '{"term":" huis ","relations":[{"type":"synonym","term":"woning"},{"type":"wordFamily","term":"huizen"}],"separable":false,"unknown":1}',
      ).result?.defaults,
    ).toEqual({ term: "huis", separable: false, related: ["+woning", "~huizen"] });
    expect(parseJsonDefaults("[]").error).toBe("JSON array must include at least one object.");
    expect(parseJsonDefaults("[1]").error).toBe(
      "Invalid JSON entry at index 0: expected an object.",
    );
    expect(parseJsonDefaults('{"forms":"x"}').error).toBe(
      'Invalid "forms": expected an array of strings.',
    );
    expect(parseJsonDefaults('{"constructionType":"idiom"}').error).toMatch(
      /^Invalid "constructionType": expected one of verbal phrase/,
    );
    expect(parseJsonDefaults('{"relations":[{"type":"cousin","term":"x"}]}').error).toBe(
      'Invalid "relations": unknown relation type "cousin".',
    );
  });
});
