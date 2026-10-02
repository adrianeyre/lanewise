import { useState } from "react";
import credits from "virtual:credits";

import type { Credit } from "../../scripts/credits.ts";

/** One package, whose licence texts are drawn only once it is opened: there are hundreds. */
function Notice({ credit }: { credit: Credit }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <details className="credit" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="credit-name">{credit.name}</span> {credit.version}, licence: {credit.licence}
        </summary>
        {open &&
          credit.texts.map((index) => (
            <pre key={index} className="credit-text">
              {credits.texts[index]}
            </pre>
          ))}
      </details>
    </li>
  );
}

function CreditList({ id, title, note, list }: { id: string; title: string; note: string; list: Credit[] }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <p>{note}</p>
      <ul className="credit-list">
        {list.map((credit) => (
          <Notice key={`${credit.name}@${credit.version}`} credit={credit} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Every npm package and crate bundled into Lanewise, with the licence texts
 * they ship, collected when this version was built (`scripts/credits.ts`).
 */
export default function BundledCredits() {
  return (
    <>
      <CreditList
        id="credits-npm"
        title="npm packages"
        note={`The user interface is built with these ${credits.npm.length} npm packages. Open one for its licence.`}
        list={credits.npm}
      />
      <CreditList
        id="credits-crates"
        title="Crates"
        note={`Lanewise's core, the Desktop App and Web Mode are built with these ${credits.crates.length} Rust crates. Open one for its licence.`}
        list={credits.crates}
      />
    </>
  );
}
