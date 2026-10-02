import type { ReactNode } from "react";

export interface LinkOpener {
  /**
   * Opens a link in the user's browser. The Desktop App gives the Platform's,
   * since its own window never navigates away; without one, as on the project
   * website, the link opens a new tab itself.
   */
  onOpenLink?: (url: string) => void;
}

interface Props extends LinkOpener {
  href: string;
  className?: string;
  /** What a screen reader hears after the link's text. */
  note?: string;
  children: ReactNode;
}

/** A link out of Lanewise, which says it opens a new tab. */
export function ExternalLink({ href, className, note = "opens in a new tab", onOpenLink, children }: Props) {
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={
        onOpenLink &&
        ((event) => {
          event.preventDefault();
          onOpenLink(href);
        })
      }
    >
      {children}
      <span className="visually-hidden"> ({note})</span>
    </a>
  );
}
