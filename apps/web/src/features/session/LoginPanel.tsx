import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { actions, button, fieldError, fieldStack, supporting } from "../../shared/ui.ts";
import { useSession, type LoginResult } from "./session-context.ts";

type Failure = Extract<LoginResult, { ok: false }>;

/** Token-once sign-in: the token goes only to the login request and the field is cleared. */
export function LoginPanel({ expired }: { expired: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const tokenId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Losing access mid-use moves focus to the sign-in form instead of a hidden page.
  useEffect(() => {
    if (expired) heading.current?.focus();
  }, [expired]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = input.current;
    if (!field || pending) return;
    const token = field.value.trim();
    if (!token) {
      setFailure({ ok: false, reason: "invalid" });
      field.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    const result = await session.login(token);
    field.value = "";
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      field.focus();
    }
  }

  return (
    <section className="grid gap-4 py-6" aria-labelledby={`${tokenId}-heading`}>
      <h1 id={`${tokenId}-heading`} ref={heading} tabIndex={-1}>
        {expired ? t("session.expiredHeading") : t("session.heading")}
      </h1>
      <p className={supporting}>{expired ? t("session.expiredHelp") : t("session.help")}</p>
      <form className="grid max-w-md gap-4" onSubmit={submit} noValidate>
        <div className={fieldStack}>
          <label htmlFor={tokenId}>{t("session.tokenLabel")}</label>
          <input
            ref={input}
            id={tokenId}
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={failure ? true : undefined}
            aria-describedby={failure ? errorId : undefined}
          />
          {failure ? (
            <p id={errorId} className={fieldError} role="alert">
              {t(`session.error.${failure.reason}`)}
              {failure.reason === "unexpected" && failure.requestId ? (
                <span> {t("common.requestReference", { id: failure.requestId })}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className={actions}>
          <button type="submit" className={button.primary} disabled={pending}>
            {pending ? t("session.signingIn") : t("session.signIn")}
          </button>
        </div>
      </form>
    </section>
  );
}
