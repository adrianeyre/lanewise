import { Network, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";

import type { ModelProvider } from "../ai/modelProvider";
import type { GatewayError, GatewayShown } from "../commands/api";
import type { Platform } from "../platform/platform";
import { describeFailure } from "../repository/problems";

interface Props {
  provider: Pick<ModelProvider, "id" | "name">;
  platform: Pick<Platform, "commands">;
  onAnnounce(announcement: string): void;
}

/** A header in the form: its name, and a value typed now, or `null` for one kept, which isn't shown. */
interface Row {
  key: number;
  name: string;
  value: string;
  kept: boolean;
}

function describeGatewayError(error: GatewayError): string {
  switch (error.kind) {
    case "invalidUrl":
      return "Enter the gateway's address, starting https://, or http:// for one on this computer, with no user, query or #.";
    case "invalidHeader":
      return `“${error.name}” isn't a header a gateway can set. A name is letters, digits and - _ . only, and not one HTTP sets itself, such as Host.`;
    case "tooManyHeaders":
      return "A gateway takes 32 headers at most.";
    case "noGateway":
    case "invalidPath":
    case "unreachable":
      return "The gateway couldn't be kept.";
    default:
      return "message" in error ? `The credential store said: ${error.message}` : "The gateway couldn't be kept.";
  }
}

/**
 * A cloud Model Provider's gateway (ADR 0035): an address its requests go
 * to in place of its own API, such as a company's AI gateway, with headers
 * of its own, such as the gateway's key. Kept in the OS credential store,
 * each header's value never shown again once saved; leave it blank to keep it.
 */
export function GatewaySettings({ provider, platform, onAnnounce }: Props) {
  const urlId = useId();
  const noteId = useId();
  const problemId = useId();
  const [kept, setKept] = useState<GatewayShown | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    platform.commands.call("gatewayOf", { provider: provider.id }).then(
      (outcome) => {
        if (!live) return;
        const shown = outcome.ok ? outcome.value : null;
        setKept(shown);
        setBaseUrl(shown?.baseUrl ?? "");
        setRows((shown?.headerNames ?? []).map((name, key) => ({ key, name, value: "", kept: true })));
        setNext(shown?.headerNames.length ?? 0);
      },
      () => {
        if (live) setKept(null);
      },
    );
    return () => {
      live = false;
    };
  }, [platform.commands, provider.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const outcome = await platform.commands.call("saveGateway", {
        provider: provider.id,
        baseUrl,
        headers: rows.filter((row) => row.name.trim() !== "").map(({ name, value }) => ({ name, value })),
      });
      if (!outcome.ok) return setProblem(describeGatewayError(outcome.error));
      const names = rows.filter((row) => row.name.trim() !== "").map((row) => row.name.trim());
      setKept({ baseUrl: baseUrl.trim().replace(/\/+$/, ""), headerNames: names });
      setRows(names.map((name, key) => ({ key, name, value: "", kept: true })));
      setNext(names.length);
      setProblem(null);
      onAnnounce(`${provider.name}'s requests go through the gateway at ${baseUrl.trim()} from now on.`);
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
  }

  async function forget() {
    try {
      const outcome = await platform.commands.call("forgetGateway", { provider: provider.id });
      if (!outcome.ok) return setProblem(describeGatewayError(outcome.error));
      setKept(null);
      setBaseUrl("");
      setRows([]);
      setOpen(false);
      onAnnounce(`${provider.name}'s requests go to its own API again.`);
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
  }

  if (kept === undefined) return null;
  if (kept === null && !open) {
    return (
      <div>
        <button type="button" className="button button-small" onClick={() => setOpen(true)}>
          <Network aria-hidden="true" className="button-icon" />
          Use a gateway for {provider.name}…
        </button>
      </div>
    );
  }
  return (
    <form className="gateway-form" noValidate onSubmit={(event) => void save(event)} aria-label={`Gateway for ${provider.name}`}>
      <div className="branch-field">
        <label htmlFor={urlId}>Gateway address</label>
        <input
          id={urlId}
          type="url"
          value={baseUrl}
          placeholder="https://gateway.example.com/anthropic"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={[noteId, problem === null ? undefined : problemId].filter(Boolean).join(" ")}
          aria-invalid={problem !== null || undefined}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            setProblem(null);
          }}
        />
        <p id={noteId} className="settings-choice-note">
          {provider.name}&apos;s requests go here in its API&apos;s place, each path added to it, with the headers
          below. Kept in your system&apos;s credential store; a header&apos;s value isn&apos;t shown again once saved:
          leave it blank to keep it.
        </p>
      </div>
      <fieldset className="gateway-headers">
        <legend className="settings-choice-label">Headers</legend>
        {rows.map((row, index) => (
          <div key={row.key} className="gateway-header">
            <input
              type="text"
              value={row.name}
              aria-label={`Header ${index + 1} name`}
              placeholder="X-Gateway-Key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setRows(rows.map((each) => (each.key === row.key ? { ...each, name: event.target.value } : each)))
              }
            />
            <input
              type="password"
              value={row.value}
              aria-label={`Header ${index + 1} value`}
              placeholder={row.kept ? "Kept: type to replace" : "Value"}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setRows(rows.map((each) => (each.key === row.key ? { ...each, value: event.target.value } : each)))
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove header ${row.name || index + 1}`}
              onClick={() => setRows(rows.filter((each) => each.key !== row.key))}
            >
              <X aria-hidden="true" className="button-icon" />
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              setRows([...rows, { key: next, name: "", value: "", kept: false }]);
              setNext(next + 1);
            }}
          >
            <Plus aria-hidden="true" className="button-icon" />
            Add a header
          </button>
        </div>
      </fieldset>
      <div className="dialog-actions">
        <button type="submit" className="button">
          Save the gateway
        </button>
        {kept !== null ? (
          <button type="button" className="button" onClick={() => void forget()}>
            <Trash2 aria-hidden="true" className="button-icon" />
            Stop using the gateway
          </button>
        ) : (
          <button type="button" className="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
      {problem !== null && (
        <p id={problemId} role="alert" className="problem">
          {problem}
        </p>
      )}
    </form>
  );
}
