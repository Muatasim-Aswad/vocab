/**
 * Reads a separable verb's particle from its stored forms rather than a prefix list:
 * finite forms put the particle last ("stond op", "kleedde zich aan"), so it is exact
 * whenever the forms are. Returns undefined unless exactly one candidate is a proper
 * prefix of the lemma, so a missing split is possible but a wrong one is not.
 */
export function separablePart(
  lemma: string,
  forms: readonly string[] | undefined,
): string | undefined {
  const verb = lemma.trim().toLowerCase();
  if (!verb || /\s/.test(verb)) return undefined;
  const candidates = new Set<string>();
  for (const form of forms ?? []) {
    const words = form.trim().toLowerCase().split(/\s+/);
    const last = words.at(-1);
    if (words.length > 1 && last && last.length < verb.length && verb.startsWith(last))
      candidates.add(last);
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}
