import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import type { SignInHelp } from "../signIn/signInWords";

interface Props extends LinkOpener {
  help: SignInHelp;
  /** What Git said, if anything, shown on request. */
  message?: string;
}

/** Why a Host couldn't be signed in to, or listed, with the steps that fix it and links to the Host's own instructions. */
export function HostHelp({ help: { said, steps, links }, message = "", onOpenLink }: Props) {
  return (
    <div className="sign-in-failure">
      <p>{said}</p>
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
