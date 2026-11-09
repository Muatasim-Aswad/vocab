import { z } from "zod";

export const loginBody = z.object({ token: z.string().min(1) });
export const authState = z.object({ authenticated: z.boolean() });
