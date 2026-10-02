import { KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";

import {
  type AiSettings,
  type ModelChoice,
  allowedContextLines,
  localBaseUrl,
  modelProvidersInUse,
  undisclosed,
  versionFor,
} from "../ai/aiSettings";
import { EFFORT_WORDS, aiFailureWords, keyStoreWords, sentForASuggestion } from "../ai/aiWords";
import type { Effort, Model, ModelProvider } from "../ai/modelProvider";
import type { CatalogSource } from "../ai/modelCatalog";
import { CLOUD_MODEL_PROVIDERS } from "../ai/modelProviders";
import { listModels } from "../ai/requests";
import { MOST_CONTEXT_LINES } from "../ai/suggestionRequest";
import type { AiSettingsState } from "../ai/useAiSettings";
import type { OpenedRepository } from "../commands/api";
import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import type { Platform } from "../platform/platform";
import { GatewaySettings } from "./GatewaySettings";

interface Props extends LinkOpener {
  ai: AiSettingsState;
  /** The Model Providers there are adapters for. */
  providers: readonly ModelProvider[];
  platform: Pick<Platform, "commands" | "fetch">;
  /** Where the model catalog that describes each Model Provider's models comes from. */
  catalogs: CatalogSource;
  /** The repository shown, whose choice can be set apart from the global one. */
  repository: OpenedRepository | null;
}

/** A Model Provider's models, as listed for this run. */
type Listing =
  | { state: "listing" }
  | { state: "listed"; models: readonly Model[] }
  | { state: "failed"; problem: string };

/** A change waiting on the first-use disclosure of the Model Providers it would send Conflict Hunks to. */
interface PendingChange {
  next: AiSettings;
  providers: readonly string[];
  /** What to focus once it's accepted or cancelled: what asked for it. */
  from: HTMLElement | null;
}

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

/**
 * Settings' AI (PRD §8.2): whether AI is on, which is off until the user
 * turns it on after the first-use disclosure; the Model Provider, model,
 * version and effort for every repository, and for the shown one set apart;
 * each Model Provider's API key, kept in the OS credential store and only
 * ever said to be kept here; the base URL of a Model Provider on this
 * computer; and why a consumer subscription won't do.
 */
export function ModelProviderSettings({
  ai: { settings, change },
  providers,
  platform,
  catalogs,
  repository,
  onOpenLink,
}: Props) {
  const headingId = useId();
  const noteId = useId();
  const needsProviderId = useId();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [stored, setStored] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(new Map());
  const [announcement, setAnnouncement] = useState("");
  // Whether turning AI on waits for a Model Provider to be chosen, so the disclosure can name it.
  const [needsProvider, setNeedsProvider] = useState(false);
  const inUse = modelProvidersInUse(settings);
  const inUseKey = inUse.join(" ");
  const name = useCallback(
    (id: string) => providers.find((provider) => provider.id === id)?.name ?? id,
    [providers],
  );

  /** Makes `next` the settings, unless it would send to a Model Provider not yet disclosed: then the disclosure asks first. */
  function propose(next: AiSettings) {
    const waiting = undisclosed(next);
    if (waiting.length === 0) {
      change(() => next);
      return;
    }
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending({ next, providers: waiting, from });
  }

  function settle(accepted: boolean) {
    if (pending === null) return;
    if (accepted) {
      const { next, providers: disclosed } = pending;
      change(() => ({ ...next, disclosed: [...next.disclosed, ...disclosed] }));
      setAnnouncement(`AI is on, with ${disclosed.map(name).join(" and ")}.`);
    }
    setPending(null);
    pending.from?.focus();
  }

  // Whether each Model Provider chosen has an API key kept, asked once each.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const id of inUseKey.split(" ").filter(Boolean)) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      void platform.commands.call("modelProviderKeyStored", { provider: id }).then(
        (outcome) => {
          if (outcome.ok) setStored((previous) => new Map(previous).set(id, outcome.value));
        },
        () => {},
      );
    }
  }, [inUseKey, platform.commands]);

  // Each Model Provider's models are asked for once, and asked afresh when
  // refreshed, with the model catalog, or given a new API key. One still
  // being listed has no entry.
  const requested = useRef(new Set<string>());
  const list = useCallback(
    (provider: ModelProvider, aiSettings: AiSettings, refresh = false) => {
      requested.current.add(provider.id);
      (refresh ? catalogs.refresh() : catalogs.current())
        .then(({ catalog }) => listModels(platform, provider, aiSettings, catalog))
        .then(
          (models) => {
            setListings((previous) => new Map(previous).set(provider.id, { state: "listed", models }));
            setAnnouncement(
              `Listed ${models.length} ${models.length === 1 ? "model" : "models"} from ${provider.name}.`,
            );
          },
          (failure: unknown) =>
            setListings((previous) =>
              new Map(previous).set(provider.id, { state: "failed", problem: aiFailureWords(failure, name) }),
            ),
        );
    },
    [platform, catalogs, name],
  );

  function forgetListing(provider: ModelProvider) {
    requested.current.delete(provider.id);
    setListings((previous) => {
      const next = new Map(previous);
      next.delete(provider.id);
      return next;
    });
  }

  // Each Model Provider chosen lists its models once AI is on for it and its
  // API key is kept, or at once where its key is optional.
  useEffect(() => {
    for (const provider of providers) {
      const ready =
        settings.enabled &&
        settings.disclosed.includes(provider.id) &&
        inUse.includes(provider.id) &&
        (provider.key === "optional" || stored.get(provider.id) === true);
      if (ready && !requested.current.has(provider.id)) list(provider, settings);
    }
  });

  function keyChanged(provider: ModelProvider, kept: boolean) {
    setStored((previous) => new Map(previous).set(provider.id, kept));
    forgetListing(provider);
  }

  const choiceProps = {
    settings,
    providers,
    platform,
    stored,
    listings,
    onOpenLink,
    onKeyChanged: keyChanged,
    onBaseUrl: (provider: ModelProvider, baseUrl: string) => {
      change((previous) => ({ ...previous, baseUrls: { ...previous.baseUrls, [provider.id]: baseUrl } }));
      // Its models are listed afresh from where it now is.
      forgetListing(provider);
      setAnnouncement(`${provider.name} is asked at ${baseUrl}.`);
    },
    onRefresh: (provider: ModelProvider) => {
      forgetListing(provider);
      list(provider, settings, true);
    },
    onAnnounce: setAnnouncement,
  };
  const root = repository?.root ?? null;
  const override = root === null ? undefined : settings.repositories[root];
  const others = Object.keys(settings.repositories).filter((each) => each !== root);
  const blank = (): ModelChoice => ({
    provider: settings.global?.provider ?? providers[0]?.id ?? "",
    model: null,
    version: null,
    effort: null,
  });

  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-legend">
        AI
      </h3>
      <p id={noteId} className="settings-choice-note">
        Lanewise can suggest a Resolution for a Conflict Hunk, through a Model Provider you choose and your own API
        key. AI is off until you turn it on, and a Suggestion is never applied unless you accept it. With AI on,
        Lanewise also fetches its model catalog from GitHub, sending nothing with it, to describe each Model
        Provider's models.
      </p>
      {providers.length === 0 ? (
        <p className="settings-choice-note">No Model Provider can be chosen in this version of Lanewise yet.</p>
      ) : (
        <>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.enabled}
              aria-describedby={[noteId, needsProvider && inUse.length === 0 ? needsProviderId : undefined]
                .filter(Boolean)
                .join(" ")}
              onChange={(event) => {
                const enabled = event.target.checked;
                if (enabled && inUse.length === 0) {
                  setNeedsProvider(true);
                  return;
                }
                setNeedsProvider(false);
                propose({ ...settings, enabled });
                if (!enabled) setAnnouncement("AI is off.");
              }}
            />
            Suggest Resolutions with AI
          </label>
          {needsProvider && inUse.length === 0 && (
            <p id={needsProviderId} role="alert" className="problem">
              Choose a Model Provider for every repository first, so Lanewise can say what's sent to it.
            </p>
          )}
          {pending !== null && (
            <Disclosure
              providers={pending.providers.map((id) => providers.find((each) => each.id === id)).filter(
                (provider): provider is ModelProvider => provider !== undefined,
              )}
              contextLines={pending.next.contextLines}
              turningOn={!settings.enabled}
              onAccept={() => settle(true)}
              onCancel={() => settle(false)}
            />
          )}
          <ChoiceFields
            {...choiceProps}
            legend="For every repository"
            choice={settings.global}
            onChoose={(global) => propose({ ...settings, global })}
          />
          {repository !== null && root !== null && (
            <fieldset className="settings-group settings-ai-choice">
              <legend className="settings-legend">For {repository.name}</legend>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={override !== undefined}
                  onChange={(event) => {
                    const repositories = { ...settings.repositories };
                    if (event.target.checked) repositories[root] = settings.global ?? blank();
                    else delete repositories[root];
                    propose({ ...settings, repositories });
                  }}
                />
                Set {repository.name} apart, with a choice of its own
              </label>
              {override !== undefined && (
                <ChoiceFields
                  {...choiceProps}
                  legend={`${repository.name}'s choice`}
                  choice={override}
                  onChoose={(choice) =>
                    propose({ ...settings, repositories: { ...settings.repositories, [root]: choice } })
                  }
                />
              )}
            </fieldset>
          )}
          {others.length > 0 && (
            <div className="settings-group">
              <p className="settings-choice-label">Other repositories set apart</p>
              <ul className="settings-hosts" aria-label="Other repositories set apart">
                {others.map((other) => (
                  <li key={other} className="settings-host">
                    <span className="settings-host-name">
                      {folderName(other)}: {name(settings.repositories[other]?.provider ?? "")}
                    </span>
                    <button
                      type="button"
                      className="button button-small"
                      aria-label={`Stop setting ${folderName(other)} apart`}
                      onClick={() => {
                        const repositories = { ...settings.repositories };
                        delete repositories[other];
                        change((previous) => ({ ...previous, repositories }));
                        setAnnouncement(`${folderName(other)} uses the choice for every repository again.`);
                      }}
                    >
                      <Trash2 aria-hidden="true" className="button-icon" />
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ContextLines settings={settings} onChange={(contextLines) => change((previous) => ({ ...previous, contextLines }))} />
        </>
      )}
      <Subscriptions onOpenLink={onOpenLink} />
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </section>
  );
}

/**
 * The first-use disclosure: exactly what's sent, and to which Model
 * Providers, before any Conflict Hunk is. Focus moves to it, and back to
 * what asked for it once it's answered.
 */
function Disclosure({
  providers,
  contextLines,
  turningOn,
  onAccept,
  onCancel,
}: {
  providers: readonly ModelProvider[];
  contextLines: number;
  turningOn: boolean;
  onAccept(): void;
  onCancel(): void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const names = providers
    .map((provider) => (provider.defaultBaseUrl === null ? `${provider.name} (${provider.host})` : `${provider.name}, on ${provider.host}`))
    .join(" and ");
  const local = providers.every((provider) => provider.defaultBaseUrl !== null);
  return (
    <div ref={box} className="settings-disclosure" role="group" aria-labelledby={titleId} tabIndex={-1}>
      <h4 id={titleId} className="settings-choice-label">
        What AI sends to {names}
      </h4>
      <p>For each Suggestion you ask for, Lanewise sends {names} this, and nothing more from your repository:</p>
      <ul>
        {sentForASuggestion(contextLines).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {local ? (
        <p>
          It's sent to the base URL you set, which is always on this computer, with your API key only if you keep one
          for it. Nothing is sent until you ask, and the server's own settings say what it keeps.
        </p>
      ) : (
        <p>
          Your API key goes with each request, and with each request for the list of models. Nothing is sent until you
          ask, the Model Provider bills your account for it, and its own terms say what it keeps.
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button" onClick={onAccept}>
          {turningOn ? "Turn on AI" : `Use ${providers.map((provider) => provider.name).join(" and ")}`}
        </button>
      </div>
    </div>
  );
}

interface ChoiceProps extends LinkOpener {
  settings: AiSettings;
  providers: readonly ModelProvider[];
  platform: Pick<Platform, "commands">;
  stored: ReadonlyMap<string, boolean>;
  listings: ReadonlyMap<string, Listing>;
  onKeyChanged(provider: ModelProvider, kept: boolean): void;
  onBaseUrl(provider: ModelProvider, baseUrl: string): void;
  onRefresh(provider: ModelProvider): void;
  onAnnounce(announcement: string): void;
}

/**
 * One choice of Model Provider, model, version and effort, with the Model
 * Provider's API key and, for one on this computer, its base URL.
 */
function ChoiceFields({
  legend,
  choice,
  onChoose,
  settings,
  providers,
  stored,
  listings,
  onBaseUrl,
  onRefresh,
  ...keyProps
}: ChoiceProps & { legend: string; choice: ModelChoice | null; onChoose(choice: ModelChoice): void }) {
  const providerId = useId();
  const provider = providers.find((each) => each.id === choice?.provider);
  const listing: Listing | undefined =
    provider === undefined ? undefined : (listings.get(provider.id) ?? { state: "listing" });
  const on = provider !== undefined && settings.enabled && settings.disclosed.includes(provider.id);
  return (
    <fieldset className="settings-group settings-ai-choice">
      <legend className="settings-choice-label">{legend}</legend>
      <div className="branch-field">
        <label htmlFor={providerId}>Model Provider</label>
        <select
          id={providerId}
          value={provider?.id ?? ""}
          onChange={(event) => onChoose({ provider: event.target.value, model: null, version: null, effort: null })}
        >
          {provider === undefined && <option value="">Choose a Model Provider</option>}
          {providers.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      </div>
      {provider !== undefined && provider.defaultBaseUrl !== null && (
        <BaseUrl
          key={provider.id}
          provider={provider}
          baseUrl={settings.baseUrls[provider.id] ?? provider.defaultBaseUrl}
          onBaseUrl={onBaseUrl}
        />
      )}
      {provider !== undefined && <ApiKey provider={provider} kept={stored.get(provider.id)} {...keyProps} />}
      {provider !== undefined && provider.defaultBaseUrl === null && (
        <GatewaySettings
          key={provider.id}
          provider={provider}
          platform={keyProps.platform}
          onAnnounce={keyProps.onAnnounce}
        />
      )}
      {provider !== undefined && choice !== null && !on && (
        <p className="settings-choice-note">Turn AI on to choose one of {provider.name}'s models.</p>
      )}
      {on && choice !== null && (
        <ModelFields
          provider={provider}
          choice={choice}
          listing={listing}
          keyNeeded={provider.key === "required" && stored.get(provider.id) !== true}
          onChoose={onChoose}
          onRefresh={() => onRefresh(provider)}
        />
      )}
    </fieldset>
  );
}

/**
 * Where a Model Provider on this computer is asked, such as Ollama's
 * `http://localhost:11434/v1`: only ever on this computer, so its requests,
 * and any API key kept for it, never leave it.
 */
function BaseUrl({
  provider,
  baseUrl,
  onBaseUrl,
}: {
  provider: ModelProvider;
  baseUrl: string;
  onBaseUrl(provider: ModelProvider, baseUrl: string): void;
}) {
  const fieldId = useId();
  const noteId = useId();
  const problemId = useId();
  const [text, setText] = useState(baseUrl);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    const url = localBaseUrl(text);
    if (url === null) {
      setProblem(`Enter a base URL on this computer, with its port, such as ${provider.defaultBaseUrl ?? "http://localhost:11434/v1"}.`);
      field.current?.focus();
      return;
    }
    setText(url);
    setProblem(null);
    onBaseUrl(provider, url);
  }

  return (
    <form className="settings-host-form" noValidate onSubmit={save}>
      <div className="branch-field">
        <label htmlFor={fieldId}>Base URL</label>
        <div className="clone-folder">
          <input
            ref={field}
            id={fieldId}
            type="url"
            inputMode="url"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={problem !== null || undefined}
            aria-describedby={[noteId, problem === null ? undefined : problemId].filter(Boolean).join(" ")}
          />
          <button type="submit" className="button">
            <Save aria-hidden="true" className="button-icon" />
            Save
          </button>
        </div>
        <p id={noteId} className="settings-choice-note">
          Where the server's OpenAI-compatible API is on this computer: Ollama's is http://localhost:11434/v1, LM
          Studio's http://localhost:1234/v1 and llama.cpp's http://localhost:8080/v1.
        </p>
      </div>
      {problem !== null && (
        <p id={problemId} role="alert" className="problem">
          {problem}
        </p>
      )}
    </form>
  );
}

/**
 * A Model Provider's API key: whether one is kept, and a field to keep one,
 * never showing it. A key that's optional, as a local server's, is kept only
 * where the server asks for one.
 */
function ApiKey({
  provider,
  kept,
  platform,
  onKeyChanged,
  onAnnounce,
  onOpenLink,
}: {
  provider: ModelProvider;
  kept: boolean | undefined;
  platform: Pick<Platform, "commands">;
  onKeyChanged(provider: ModelProvider, kept: boolean): void;
  onAnnounce(announcement: string): void;
} & LinkOpener) {
  const fieldId = useId();
  const noteId = useId();
  const problemId = useId();
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  async function run(command: "saveModelProviderKey" | "forgetModelProviderKey") {
    try {
      const outcome =
        command === "saveModelProviderKey"
          ? await platform.commands.call(command, { provider: provider.id, key })
          : await platform.commands.call(command, { provider: provider.id });
      if (!outcome.ok) {
        setProblem(keyStoreWords(outcome.error));
        field.current?.focus();
        return;
      }
      setKey("");
      setProblem(null);
      const saved = command === "saveModelProviderKey";
      onKeyChanged(provider, saved);
      onAnnounce(saved ? `Saved your API key for ${provider.name}.` : `Forgot your API key for ${provider.name}.`);
      if (!saved) field.current?.focus();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run("saveModelProviderKey");
  }

  return (
    <form className="settings-host-form" noValidate onSubmit={save}>
      <div className="branch-field">
        <label htmlFor={fieldId}>
          {kept ? "Replace your API key" : provider.key === "optional" ? "API key (optional)" : "API key"}
        </label>
        <div className="clone-folder">
          <input
            ref={field}
            id={fieldId}
            type="password"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setProblem(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={problem !== null || undefined}
            aria-describedby={[noteId, problem === null ? undefined : problemId].filter(Boolean).join(" ")}
          />
          <button type="submit" className="button">
            <KeyRound aria-hidden="true" className="button-icon" />
            Save
          </button>
        </div>
        <p id={noteId} className="settings-choice-note">
          {kept === undefined
            ? `Looking for your API key for ${provider.name}…`
            : kept
              ? `Your API key for ${provider.name} is kept in your system's credential store.`
              : provider.key === "optional"
                ? "No API key is kept, and most local servers take none. If yours asks for one, it's kept in your system's credential store, never in Lanewise's settings."
                : `No API key for ${provider.name} is kept yet. It's kept in your system's credential store, never in Lanewise's settings.`}{" "}
          {provider.apiKeyPage !== null && (
            <ExternalLink href={provider.apiKeyPage} onOpenLink={onOpenLink}>
              Make an API key for {provider.name}
            </ExternalLink>
          )}
        </p>
      </div>
      {kept && (
        <div>
          <button type="button" className="button button-small" onClick={() => void run("forgetModelProviderKey")}>
            <Trash2 aria-hidden="true" className="button-icon" />
            Forget the API key for {provider.name}
          </button>
        </div>
      )}
      {problem !== null && (
        <p id={problemId} role="alert" className="problem">
          {problem}
        </p>
      )}
    </form>
  );
}

/** The model, its version, newest first, and its effort, from the Model Provider's live list. */
function ModelFields({
  provider,
  choice,
  listing,
  keyNeeded,
  onChoose,
  onRefresh,
}: {
  provider: ModelProvider;
  choice: ModelChoice;
  listing: Listing | undefined;
  keyNeeded: boolean;
  onChoose(choice: ModelChoice): void;
  onRefresh(): void;
}) {
  const modelId = useId();
  const versionId = useId();
  const effortId = useId();
  if (keyNeeded) {
    return <p className="settings-choice-note">Save your API key for {provider.name} to list its models.</p>;
  }
  const models = listing?.state === "listed" ? listing.models : [];
  const model = models.find((each) => each.id === choice.model);
  const version = model === undefined || model.versions.length === 0 ? undefined : versionFor(choice, model);
  const [newest] = model?.versions ?? [];
  return (
    <div className="settings-group">
      {listing?.state === "listing" && <p className="settings-choice-note">Listing {provider.name}'s models…</p>}
      {listing?.state === "failed" && (
        <p role="alert" className="problem">
          {listing.problem}
        </p>
      )}
      {listing?.state === "listed" && (
        <>
          <div className="branch-field">
            <label htmlFor={modelId}>Model</label>
            <select
              id={modelId}
              value={model?.id ?? ""}
              onChange={(event) => onChoose({ ...choice, model: event.target.value, version: null, effort: null })}
            >
              {model === undefined && <option value="">Choose a model</option>}
              {models.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </div>
          {model !== undefined && newest !== undefined && version !== undefined && (
            <>
              <div className="branch-field">
                <label htmlFor={versionId}>Version</label>
                <select
                  id={versionId}
                  value={choice.version !== null && version.id === choice.version ? version.id : ""}
                  onChange={(event) => onChoose({ ...choice, version: event.target.value || null, effort: null })}
                >
                  <option value="">Newest: {newest.name}</option>
                  {model.versions.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </select>
              </div>
              {version.efforts === null ? (
                <p className="settings-choice-note">
                  Lanewise's model catalog doesn't describe {version.name} yet, so it's used with {provider.name}'s
                  default effort.
                </p>
              ) : version.efforts.length === 0 ? (
                <p className="settings-choice-note">{version.name} takes no effort.</p>
              ) : (
                <div className="branch-field">
                  <label htmlFor={effortId}>Effort</label>
                  <select
                    id={effortId}
                    value={choice.effort !== null && version.efforts.includes(choice.effort) ? choice.effort : ""}
                    onChange={(event) => onChoose({ ...choice, effort: (event.target.value || null) as Effort | null })}
                  >
                    <option value="">
                      {provider.name}'s default
                      {version.defaultEffort === null ? "" : `: ${EFFORT_WORDS[version.defaultEffort]}`}
                    </option>
                    {version.efforts.map((effort) => (
                      <option key={effort} value={effort}>
                        {EFFORT_WORDS[effort]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </>
      )}
      <div>
        <button
          type="button"
          className="button button-small"
          aria-disabled={listing?.state === "listing" || undefined}
          onClick={() => {
            if (listing?.state !== "listing") onRefresh();
          }}
        >
          <RefreshCw aria-hidden="true" className="button-icon" />
          Refresh models
        </button>
      </div>
    </div>
  );
}

/** How many lines round a Conflict Hunk are sent on each side. */
function ContextLines({ settings, onChange }: { settings: AiSettings; onChange(lines: number): void }) {
  const fieldId = useId();
  const noteId = useId();
  const [text, setText] = useState(String(settings.contextLines));
  const lines = Number(text);
  const allowed = text.trim() !== "" && allowedContextLines(lines);
  return (
    <div className="branch-field">
      <label htmlFor={fieldId}>Lines of context</label>
      <input
        id={fieldId}
        type="number"
        inputMode="numeric"
        min={0}
        max={MOST_CONTEXT_LINES}
        step={1}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() !== "" && allowedContextLines(next)) onChange(next);
        }}
        aria-invalid={!allowed || undefined}
        aria-describedby={noteId}
      />
      <p id={noteId} className="settings-choice-note">
        How many lines of the file above and below a Conflict Hunk are sent with it: a whole number from 0 to{" "}
        {MOST_CONTEXT_LINES}.
      </p>
    </div>
  );
}

/** Why a consumer subscription won't do, with each cloud Model Provider's API-key page (PRD §8.2). */
function Subscriptions({ onOpenLink }: LinkOpener) {
  const headingId = useId();
  return (
    <div className="settings-group" role="group" aria-labelledby={headingId}>
      <h4 id={headingId} className="settings-choice-label">
        API keys, not subscriptions
      </h4>
      <p className="settings-choice-note">
        Consumer subscriptions can't be used by other apps, Lanewise included: Claude Pro or Max, ChatGPT Plus,
        SuperGrok, Gemini Advanced and Meta AI won't work. Each Model Provider needs an API key of its own, and bills
        what it's used for separately from any subscription.
      </p>
      <ul className="settings-links">
        {CLOUD_MODEL_PROVIDERS.map(({ name, subscriptions, apiKeyPage }) => (
          <li key={name}>
            <ExternalLink href={apiKeyPage} onOpenLink={onOpenLink}>
              {name}: API keys
            </ExternalLink>{" "}
            <span className="settings-choice-note">({subscriptions} can't be used)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
