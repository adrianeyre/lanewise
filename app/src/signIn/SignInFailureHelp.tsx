import type { SignInFailure } from "../commands/api";
import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import { explainSignInFailure, signedInTo } from "./signInWords";

interface Props extends LinkOpener {
  /** What didn't happen, such as "Nothing was fetched". */
  lead: string;
  failure: SignInFailure;
  /** What Git said, with any credentials in a URL hidden by the core. */
  message: string;
}

/**
 * A Sign-in Failure explained (PRD §9.3): why Git couldn't sign in, how to
 * fix it, a link to the Host's own instructions, and what Git said, shown
 * on request. For inside an alert, which reads it out as it appears.
 */
export function SignInFailureHelp({ lead, failure, message, onOpenLink }: Props) {
  const { said, steps, links } = explainSignInFailure(failure);
  return (
    <div className="sign-in-failure">
      <p>
        <strong>
          {lead}: Git couldn't sign in to {signedInTo(failure)}.
        </strong>{" "}
        {said}
      </p>
      <ol className="sign-in-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {links.length > 0 && (
        <ul className="sign-in-links">
          {links.map(({ href, text }) => (
            <li key={href}>
              <ExternalLink href={href} onOpenLink={onOpenLink}>
                {text}
              </ExternalLink>
            </li>
          ))}
        </ul>
      )}
      {message !== "" && (
        <details className="sign-in-said">
          <summary>What Git said</summary>
          <pre className="problem-output">{message}</pre>
        </details>
      )}
    </div>
  );
}
