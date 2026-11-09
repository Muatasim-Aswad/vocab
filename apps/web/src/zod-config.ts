import { z } from "zod";

// The served CSP forbids eval. Zod decides on its `new Function` fast path (and probes for it)
// when schemas are built, so this module must be imported before any schema module.
z.config({ jitless: true });
