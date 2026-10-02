import { LogIn, RefreshCw, Search } from "lucide-react";
import { OpenOnHost } from "./OpenOnHost";
import { webPageOf } from "./webPage";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";

import type { CommandClient, Cursor, HostError, HostRepository } from "../commands/api";
import type { LinkOpener } from "../legal/ExternalLink";
import { describeFailure } from "../repository/problems";
import { Dialog } from "../ui/Dialog";
import { BROWSABLE_HOSTS, hostLabel } from "./browsableHosts";
import { GITHUB_COM } from "./enterpriseHosts";
import { HostHelp } from "./HostHelp";
import { explainHostError, explainMissingScopes, explainSsoLeftOut } from "./hostWords";
import type { HostsState } from "./useHosts";

interface Props extends LinkOpener {
  commands: CommandClient;
  hosts: HostsState;
  open: boolean;
  onClose(): void;
  /** The URL in the Clone form, whose Host is chosen first if a Tier 2 Host Integration serves it. */
  url: string;
  /** Clones the repository at `url`: the Clone form takes it. */
  onChoose(url: string): void;
}

/** How many repositories each page lists. */
const PAGE = 30;

/**
 * Clone's Browse repositories (PRD §9.1, Tier 2): signs in to GitHub.com,
 * GitLab.com, Bitbucket, Azure DevOps or a GitHub Enterprise Server added in
 * Settings through the user's credential helper, then lists the repositories
 * they can clone, searchable and a page at a time. On GitHub, the user and
 * their organizations are shown too, and choosing one lists only the
 * repositories it owns. Choosing a repository puts its URL in the Clone
 * form.
 */
export function BrowseRepositories({ open, onClose, ...props }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Browse repositories" closeLabel="Close browse repositories">
      <Browse {...props} onClose={onClose} />
    </Dialog>
  );
}

/** A Host's error, or a command that couldn't run at all. */
type Problem = { kind: "host"; error: HostError } | { kind: "failed"; message: string };

interface Listing {
  items: HostRepository[];
  next: Cursor | null;
  missingScopes: string[];
  ssoLeftOut: boolean;
}

function Browse({ commands, hosts, url, onChoose, onClose, onOpenLink }: Omit<Props, "open">) {
  const { enterpriseHosts, signedIn, rememberSignIn, forgetSignIn } = hosts;
  const [host, setHost] = useState(GITHUB_COM);
  // An Azure DevOps organization's older Host, such as fabrikam.visualstudio.com, if the Clone form's URL is on one.
  const [organizationHost, setOrganizationHost] = useState<string | null>(null);
  // Whether the user chose the Host, so detecting it from the URL doesn't change it.
  const chosen = useRef(false);
  const detecting = useRef(false);
  const opening = useRef(false);
  const [signingIn, setSigningIn] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  // The user and their organizations, to filter by, and the one chosen: `null` for every owner.
  const [owners, setOwners] = useState<string[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [listing, setShownListing] = useState<Listing | null>(null);
  const shownListing = useRef<Listing | null>(null);
  // Signed in to GitHub.com already, as it opens: its first page is on its way.
  const [openedSignedIn] = useState(() => signedIn.has(GITHUB_COM));
  const [loading, setLoading] = useState(openedSignedIn);
  const [over, setOver] = useState<"https" | "ssh">("https");
  const [announcement, setAnnouncement] = useState("");
  const asked = useRef(0);
  const firstNew = useRef<number | null>(null);
  const listElement = useRef<HTMLUListElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  // Signing in moves focus to the search field, once it's there.
  const focusSearch = useRef(false);
  const hostId = useId();
  const ownersId = useId();
  const searchId = useId();
  const listId = useId();
  const overName = useId();
  const signed = signedIn.get(host) ?? null;

  const setListing = useCallback((next: Listing | null) => {
    shownListing.current = next;
    setShownListing(next);
  }, []);

  /**
   * Asks `on` for the page of its repositories matching `words` from
   * `cursor`, and shows it after those shown already, unless something else
   * has been asked for since. It sets nothing until it's answered.
   */
  const fetchPage = useCallback(
    async (on: string, cursor: Cursor | null, words: string, by: string | null = null) => {
      const ask = ++asked.current;
      try {
        const outcome = await commands.call("hostRepositories", {
          host: on,
          enterpriseHosts: [...enterpriseHosts],
          query: words,
          ...(by === null ? {} : { owner: by }),
          page: { cursor, limit: PAGE },
        });
        if (ask !== asked.current) return;
        if (!outcome.ok) {
          if (outcome.error.kind === "tokenRefused") forgetSignIn(on);
          setProblem({ kind: "host", error: outcome.error });
          setAnnouncement("");
          return;
        }
        const { items, nextCursor, missingScopes, ssoLeftOut } = outcome.value;
        const previous = cursor === null ? null : shownListing.current;
        const before = previous?.items ?? [];
        firstNew.current = previous === null || items.length === 0 ? null : before.length;
        const all = [...before, ...items];
        setAnnouncement(listed(all.length, nextCursor !== null, words, by));
        setListing({
          items: all,
          next: nextCursor,
          missingScopes,
          ssoLeftOut: (previous?.ssoLeftOut ?? false) || ssoLeftOut,
        });
      } catch (failure) {
        if (ask === asked.current) setProblem({ kind: "failed", message: describeFailure(failure) });
      } finally {
        if (ask === asked.current) setLoading(false);
      }
    },
    [commands, enterpriseHosts, forgetSignIn, setListing],
  );

  /** Lists `on`'s repositories matching `words` from the top. */
  const listFromTop = useCallback(
    (on: string, words: string, by: string | null = null) => {
      setLoading(true);
      setProblem(null);
      void fetchPage(on, null, words, by);
    },
    [fetchPage],
  );

  /** Shows `next`'s repositories, if it's signed in to, or its Sign in. */
  const showHost = useCallback(
    (next: string) => {
      asked.current++;
      setHost(next);
      setProblem(null);
      setListing(null);
      setSearched("");
      setQuery("");
      setOwners([]);
      setOwner(null);
      setAnnouncement("");
      setLoading(false);
      if (signedIn.has(next)) listFromTop(next, "");
    },
    [signedIn, setListing, listFromTop],
  );

  // GitHub.com's first page, if it's signed in to as this opens.
  useEffect(() => {
    if (!openedSignedIn || opening.current) return;
    opening.current = true;
    void fetchPage(GITHUB_COM, null, "");
  }, [openedSignedIn, fetchPage]);

  // The Host of the URL in the Clone form, if a Tier 2 Host Integration serves it, unless the user chooses one first.
  useEffect(() => {
    if (url.trim() === "" || detecting.current) return;
    detecting.current = true;
    commands.call("detectHost", { url, enterpriseHosts: [...enterpriseHosts] }).then(
      (outcome) => {
        if (chosen.current || !outcome.ok) return;
        const { host: detected, integration } = outcome.value;
        if (integration === "generic" || detected === null || detected === GITHUB_COM) return;
        if (BROWSABLE_HOSTS.some((each) => each.host === detected) || enterpriseHosts.includes(detected)) {
          showHost(detected);
        } else if (integration === "azureDevOps") {
          setOrganizationHost(detected);
          showHost(detected);
        }
      },
      // Detecting only saves choosing: GitHub.com stays chosen.
      () => undefined,
    );
  }, [commands, url, enterpriseHosts, showHost]);

  // Who owns the repositories listed, once signed in, to filter them by.
  const signedLogin = signed?.login ?? null;
  useEffect(() => {
    if (signedLogin === null) return;
    let live = true;
    commands.call("hostOwners", { host, enterpriseHosts: [...enterpriseHosts] }).then(
      (outcome) => {
        if (live) setOwners(outcome.ok ? outcome.value.owners : []);
      },
      // Filtering by owner only saves searching: without it, every repository is still listed.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [commands, host, enterpriseHosts, signedLogin]);

  useEffect(() => {
    if (signed === null || !focusSearch.current) return;
    focusSearch.current = false;
    searchField.current?.focus();
  }, [signed]);

  // Showing more moves focus to the first repository it added.
  useEffect(() => {
    if (listing === null || firstNew.current === null) return;
    listElement.current?.querySelectorAll<HTMLButtonElement>(".host-repository-choose")[firstNew.current]?.focus();
    firstNew.current = null;
  }, [listing]);

  async function signIn(again: boolean) {
    if (signingIn) return;
    const ask = ++asked.current;
    setSigningIn(true);
    setProblem(null);
    setListing(null);
    if (again) forgetSignIn(host);
    setAnnouncement(`Signing in to ${host}…`);
    try {
      const outcome = await commands.call("signInToHost", { host, enterpriseHosts: [...enterpriseHosts], again });
      if (ask !== asked.current) return;
      if (outcome.ok) {
        rememberSignIn(outcome.value);
        setAnnouncement(`Signed in to ${host} as ${outcome.value.login}.`);
        focusSearch.current = true;
        setSearched("");
        setQuery("");
        setOwner(null);
        listFromTop(host, "");
      } else {
        setProblem({ kind: "host", error: outcome.error });
        setAnnouncement("");
      }
    } catch (failure) {
      if (ask === asked.current) setProblem({ kind: "failed", message: describeFailure(failure) });
    } finally {
      // Only one sign-in runs at a time, and listing after it asks again.
      setSigningIn(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const words = query.trim();
    setSearched(words);
    listFromTop(host, words, owner);
  }

  /** Lists only the repositories `by` owns, or every owner's with `null`, as searched already. */
  function chooseOwner(by: string | null) {
    setOwner(by);
    listFromTop(host, searched, by);
  }

  function choose(repository: HostRepository) {
    onChoose(over === "ssh" && repository.sshUrl !== null ? repository.sshUrl : repository.cloneUrl);
    onClose();
  }

  const choices = [
    ...BROWSABLE_HOSTS.map((each) => each.host),
    ...(organizationHost === null ? [] : [organizationHost]),
    ...enterpriseHosts,
  ];
  const help = problem?.kind === "host" ? explainHostError(problem.error) : null;
  const missingScopes = listing?.missingScopes.length ? listing.missingScopes : (signed?.missingScopes ?? []);

  return (
    <div className="host-browse">
      <div className="branch-field">
        <label htmlFor={hostId}>Host</label>
        <select
          id={hostId}
          value={host}
          onChange={(event) => {
            chosen.current = true;
            showHost(event.target.value);
          }}
          aria-describedby={`${hostId}-note`}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {hostLabel(choice)}
            </option>
          ))}
        </select>
        <p id={`${hostId}-note`} className="surface-note">
          Add a GitHub Enterprise Server in Settings.
        </p>
      </div>
      {signed === null ? (
        <div className="host-sign-in">
          <p>
            Lanewise signs in to {host} with Git's credential helper, such as Git Credential Manager, which may open
            your browser to sign you in. Lanewise never sees your password, and doesn't keep the token.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              data-autofocus
              aria-disabled={signingIn || undefined}
              onClick={() => void signIn(false)}
            >
              <LogIn aria-hidden="true" className="button-icon" />
              Sign in to {host}
            </button>
          </div>
          {signingIn && <p className="surface-note">Finish signing in in your browser, if a window opened there.</p>}
        </div>
      ) : (
        <div className="host-signed-in">
          <p>
            Signed in to {host} as <strong>{signed.login}</strong>
            {signed.name === null ? "" : ` (${signed.name})`}.
          </p>
          {missingScopes.length > 0 && (
            <div className="host-note">
              <HostHelp help={explainMissingScopes(host, missingScopes)} onOpenLink={onOpenLink} />
              <SignInAgain signingIn={signingIn} onSignIn={() => void signIn(true)} />
            </div>
          )}
          {listing?.ssoLeftOut && (
            <div className="host-note">
              <HostHelp help={explainSsoLeftOut(host)} onOpenLink={onOpenLink} />
            </div>
          )}
          <form role="search" className="host-search" onSubmit={search}>
            <label htmlFor={searchId}>Search repositories</label>
            <div className="clone-folder">
              <input
                ref={searchField}
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-autofocus
              />
              <button type="submit" className="button">
                <Search aria-hidden="true" className="button-icon" />
                Search
              </button>
            </div>
          </form>
          {owners.length > 1 && (
            <div className="host-owners" role="group" aria-labelledby={ownersId}>
              <span id={ownersId} className="host-owners-label">
                Owner
              </span>
              {[null, ...owners].map((each) => (
                <button
                  key={each ?? ""}
                  type="button"
                  className="host-owner"
                  aria-pressed={owner === each}
                  onClick={() => chooseOwner(each)}
                >
                  {each === null ? "Everyone" : each === signed.login ? `${each} (you)` : each}
                </button>
              ))}
            </div>
          )}
          <fieldset className="host-over">
            <legend>Clone over</legend>
            {(["https", "ssh"] as const).map((each) => (
              <label key={each}>
                <input
                  type="radio"
                  name={overName}
                  value={each}
                  checked={over === each}
                  onChange={() => setOver(each)}
                />
                {each === "https" ? "HTTPS, with your credential helper" : "SSH, with your SSH key"}
              </label>
            ))}
          </fieldset>
          {listing !== null && (
            <>
              {listing.items.length === 0 ? (
                <p className="surface-note">{listed(0, listing.next !== null, searched, owner)}</p>
              ) : (
                <ul ref={listElement} id={listId} className="host-repositories" aria-label={`Repositories on ${host}`}>
                  {listing.items.map((repository) => (
                    <RepositoryEntry
                      key={repository.fullName}
                      repository={repository}
                      onChoose={choose}
                      onOpenLink={onOpenLink}
                    />
                  ))}
                </ul>
              )}
              {listing.next !== null && (
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button"
                    aria-disabled={loading || undefined}
                    onClick={() => {
                      if (loading) return;
                      setLoading(true);
                      void fetchPage(host, listing.next, searched, owner);
                    }}
                  >
                    {listing.items.length === 0 ? "Look further" : "Show more"}
                  </button>
                </div>
              )}
            </>
          )}
          {loading && <p className="surface-note">Listing repositories…</p>}
        </div>
      )}
      {problem?.kind === "failed" && (
        <p role="alert" className="problem problem-output">
          {problem.message}
        </p>
      )}
      {problem?.kind === "host" && help !== null && (
        <div role="alert" className="problem">
          <HostHelp
            help={help}
            message={problem.error.kind === "noCredential" ? problem.error.message : ""}
            onOpenLink={onOpenLink}
          />
          {help.signInAgain && <SignInAgain signingIn={signingIn} onSignIn={() => void signIn(true)} />}
        </div>
      )}
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </div>
  );
}

/** How many repositories are listed, as said and announced. */
function listed(count: number, more: boolean, search: string, owner: string | null = null): string {
  const matching = `${owner === null ? "" : ` owned by ${owner}`}${search === "" ? "" : ` matching “${search}”`}`;
  if (count === 0) {
    return more
      ? `No repositories${matching} yet. Look further to search more of them.`
      : `No repositories${matching}.`;
  }
  const repositories = count === 1 ? "1 repository" : `${count} repositories`;
  return `${repositories}${matching} listed${more ? ", with more to show" : ""}.`;
}

function SignInAgain({ signingIn, onSignIn }: { signingIn: boolean; onSignIn(): void }) {
  return (
    <div className="dialog-actions">
      <button type="button" className="button" aria-disabled={signingIn || undefined} onClick={onSignIn}>
        <RefreshCw aria-hidden="true" className="button-icon" />
        Forget this token and sign in again
      </button>
    </div>
  );
}

function RepositoryEntry({
  repository,
  onChoose,
  onOpenLink,
}: {
  repository: HostRepository;
  onChoose(repository: HostRepository): void;
  onOpenLink?: (url: string) => void;
}) {
  const noteId = useId();
  const page = webPageOf(repository.cloneUrl);
  const marks = [
    repository.private ? "Private" : "Public",
    ...(repository.fork ? ["Fork"] : []),
    ...(repository.archived ? ["Archived"] : []),
  ];
  return (
    <li className="host-repository">
      <button
        type="button"
        className="host-repository-choose"
        aria-describedby={noteId}
        onClick={() => onChoose(repository)}
      >
        {repository.fullName}
      </button>
      {page !== null && onOpenLink && <OpenOnHost page={page} name={repository.fullName} onOpenLink={onOpenLink} />}
      <p id={noteId} className="host-repository-note">
        {marks.join(" · ")}
        {repository.description === null ? "" : `. ${repository.description}`}
      </p>
    </li>
  );
}
