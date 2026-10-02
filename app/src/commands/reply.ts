import type { CommandName, Outcome } from "./api";

/**
 * Why the core refused a command outright, as the `Rejection` in
 * `commands/src/lib.rs` says.
 */
export type Rejection =
  | { kind: "unknownCommand"; name: string }
  | { kind: "invalidRequest"; name: string; message: string }
  | { kind: "internal"; message: string };

/** A command the core didn't run, or didn't finish: a bug in Lanewise. */
export class CommandRejectedError extends Error {
  readonly rejection: Rejection;

  constructor(rejection: Rejection) {
    super(describeRejection(rejection));
    this.name = "CommandRejectedError";
    this.rejection = rejection;
  }
}

function describeRejection(rejection: Rejection): string {
  switch (rejection.kind) {
    case "unknownCommand":
      return `The core has no command called ${rejection.name}.`;
    case "invalidRequest":
      return `The core couldn't read the ${rejection.name} request: ${rejection.message}`;
    case "internal":
      return rejection.message;
  }
}

/**
 * The outcome of the command `name`, from the reply the core sent back: the
 * `Reply` in `commands/src/lib.rs`, whichever transport carried it. Throws a
 * {@link CommandRejectedError} if the core rejected the command, and a
 * `TypeError` if the reply isn't one.
 */
export function outcomeOf<N extends CommandName>(name: N, reply: unknown): Outcome<N> {
  if (typeof reply === "object" && reply !== null && "outcome" in reply) {
    const tagged = reply as Record<string, unknown>;
    switch (tagged.outcome) {
      case "ok":
        return { ok: true, value: tagged.value } as Outcome<N>;
      case "failed":
        return { ok: false, error: tagged.error } as Outcome<N>;
      case "rejected":
        throw new CommandRejectedError(tagged.rejection as Rejection);
    }
  }
  throw new TypeError(`The core's reply to ${name} isn't one: ${JSON.stringify(reply)}`);
}
