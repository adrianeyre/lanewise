import { lazy, Suspense } from "react";

import { ExternalLink, type LinkOpener } from "./ExternalLink";
import { REPOSITORY_URL } from "./links";

// Every licence text is long, so they load only when Credits is opened.
const BundledCredits = lazy(() => import("./BundledCredits"));

/** Who made Lanewise, and every bundled npm package and crate with its licence, shown in its dialog. */
export function Credits({ onOpenLink }: LinkOpener) {
  return (
    <>
      <section aria-labelledby="credits-lanewise">
        <h3 id="credits-lanewise">Lanewise</h3>
        <p>
          <strong>Lanewise by {import.meta.env.VITE_APP_AUTHOR}</strong>.{" "}
          <ExternalLink href={REPOSITORY_URL} onOpenLink={onOpenLink}>
            Lanewise on GitHub
          </ExternalLink>
          . It is free software under the MIT licence. It runs the Git on your machine, which isn&apos;t bundled
          with it.
        </p>
      </section>
      <Suspense
        fallback={
          <p role="status" className="policy-updated">
            Loading the credits…
          </p>
        }
      >
        <BundledCredits />
      </Suspense>
    </>
  );
}
