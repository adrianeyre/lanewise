import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  /** What the close button says to a screen reader, such as "Close cookie policy". */
  closeLabel: string;
  children: ReactNode;
}

/** What Tab can land on. A closed `<details>` hides all but its summary. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function tabStops(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    const closed = element.closest("details:not([open])");
    return closed === null || element === closed.querySelector(":scope > summary");
  });
}

// A modal `<dialog>` lets Tab out to the browser's own controls; this keeps it on the dialog's.
function keepFocusIn(event: KeyboardEvent<HTMLDialogElement>) {
  const stops = tabStops(event.currentTarget);
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return;
  const inside = event.currentTarget.contains(document.activeElement);
  if (event.shiftKey && (!inside || document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * A modal dialog on the platform's own `<dialog>`, carried over from
 * soundcheck: it moves focus to what its body marks `data-autofocus`, or
 * else to its close button, keeps Tab and Shift+Tab inside it, closes on
 * Escape and on the backdrop, and hands focus back to whatever opened it.
 * Everything behind it is inert while it is open.
 */
export function Dialog({ open, onClose, title, closeLabel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Where showModal is missing (jsdom), the dialog still opens, just not modally.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      // What the body asks to focus, such as a form's first field, or else the close button.
      const autofocus =
        dialog.querySelector<HTMLElement>(".dialog-body [data-autofocus]") ??
        dialog.querySelector<HTMLElement>("[data-autofocus]");
      autofocus?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    if (!open && returnTo.current) {
      returnTo.current.focus();
      returnTo.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      // Escape: the platform's `cancel`, or the key itself where there is no platform dialog.
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeRef.current();
        } else if (event.key === "Tab") {
          keepFocusIn(event);
        }
      }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      {open && (
        <>
          <div className="dialog-head">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            <button type="button" className="dialog-close" aria-label={closeLabel} data-autofocus onClick={onClose}>
              <X aria-hidden="true" className="button-icon" />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
