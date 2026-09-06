import { useState, type FormEvent } from "react";
import { Button } from "../bflabs/Button";
import { Field } from "../bflabs/Field";
import { Input } from "../bflabs/Input";
import { Notice } from "../bflabs/Notice";
import { AlertIcon } from "../bflabs/icons";
import { useI18n } from "../state/I18nContext";
import { useAuthContext } from "../state/AuthContext";

export function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuthContext();
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const ok = await login(accessKey);
      if (!ok) setError(t.login.invalid);
    } catch {
      setError(t.login.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <header className="login-head">
          <h1 id="login-title" className="login-title">{t.login.title}</h1>
          <p className="login-sub">{t.login.subtitle}</p>
        </header>
        <form className="login-form" data-testid="login-form" onSubmit={(e) => void onSubmit(e)}>
          <Field label={t.login.accessKey} hint={t.login.hint}>
            <Input
              type="password"
              autoComplete="current-password"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder={t.login.placeholder}
            />
          </Field>
          {error ? (
            <Notice
              role="alert"
              className="bf-notice--danger"
              icon={<AlertIcon />}
              title={t.login.errorTitle}
              description={error}
            />
          ) : null}
          <Button type="submit" variant="primary" size="lg" loading={submitting}>
            {t.login.submit}
          </Button>
        </form>
      </section>
    </div>
  );
}
