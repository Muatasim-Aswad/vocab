/** True while pasted text has an unclosed string, object or array. */
export function needsMoreJsonInput(input: string): boolean {
  if (!input.trim()) return false;
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  let isEscaped = false;
  for (const char of input) {
    if (inString) {
      if (isEscaped) isEscaped = false;
      else if (char === "\\") isEscaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") objectDepth += 1;
    else if (char === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (char === "[") arrayDepth += 1;
    else if (char === "]") arrayDepth = Math.max(0, arrayDepth - 1);
  }
  return inString || objectDepth > 0 || arrayDepth > 0;
}
