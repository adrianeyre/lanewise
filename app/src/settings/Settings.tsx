import { Monitor, Moon, Plus, Settings as SettingsIcon, Sun, Trash2 } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";

import type { CatalogSource } from "../ai/modelCatalog";
import type { ModelProvider } from "../ai/modelProvider";
import type { AiSettingsState } from "../ai/useAiSettings";
import type { OpenedRepository } from "../commands/api";
import { parseEnterpriseHost } from "../hosts/enterpriseHosts";
import type { HostsState } from "../hosts/useHosts";
import { IssueTrackerSettings } from "../issues/IssueTrackerSettings";
import type { LinkOpener } from "../legal/ExternalLink";
import type { Platform } from "../platform/platform";
import { Dialog } from "../ui/Dialog";
import { UpdateSettings } from "../updates/UpdateSettings";
import type { Updates } from "../updates/useUpdates";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import type { JevSettings } from "../ai/jevSettings";
import { JevSettingsSection } from "./JevSettingsSection";
import { ModelProviderSettings } from "./ModelProviderSettings";
import { type Palette, PALETTES } from "./palette";
import type { RepositorySettings } from "./repositorySettings";
import { RepositorySettingsSection } from "./RepositorySettingsSection";
import { THEME_PREFERENCES, type ThemePreference } from "./theme";

const THEME_ICONS: Record<ThemePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

interface ThemeProps {
  theme: ThemePreference;
  onChooseTheme(theme: ThemePreference): void;
}

interface Props extends ThemeProps, LinkOpener {
  /** The GitHub Enterprise Server Hosts, which Settings adds and removes. */
  hosts: HostsState;
  /** AI's settings, which Settings changes. */
  ai: AiSettingsState;
  /** The Model Providers there are adapters for. */
  modelProviders: readonly ModelProvider[];
  /** Keeps API keys, lists models, copies diagnostics and asks for the base folder through it. */
  platform: Pick<Platform, "commands" | "fetch" | "copyText" | "openLink"> & Partial<Pick<Platform, "chooseFolder">>;
  /** The model catalog for the run, which Refresh models fetches again. */
  catalogs: CatalogSource;
  /** The repository shown, if one is, which AI's choice can be set apart for. */
  repository: OpenedRepository | null;
  /** Updates, which Settings checks for and installs, in the Desktop App. */
  updates: Updates;
  /** Which decisions Jev makes (ADR 0036). */
  jev: JevSettings;
  onChangeJev(change: Partial<JevSettings>): void;
  /** Whether authors' pictures come from GitHub, for a repository there. */
  avatars: boolean;
  onChooseAvatars(on: boolean): void;
  /** Whether a Host's pages open in Tabs here, or `null` where the shell can't show them, as in Web Mode. */
  hostPagesInTabs?: boolean | null;
  onChooseHostPagesInTabs?(on: boolean): void;
  /** The palette, which Settings' swatches choose. */
  palette: Palette;
  onChoosePalette(palette: Palette): void;
  /** The base folder, and whether switching Tabs fetches, which Settings changes. */
  repositorySettings?: RepositorySettings;
  /** Whether Settings is open: opened by its button or the File menu. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// TODO: the diff size limit (PRD §7.4) joins the Theme here.
/**
 * The Settings button in the title bar, and Settings, in a dialog it opens.
 * Each change is made, and kept, as
 * it is chosen, so there is nothing to save.
 */
export function Settings({
  theme,
  onChooseTheme,
  hosts,
  ai,
  modelProviders,
  platform,
  catalogs,
  repository,
  updates,
  onOpenLink,
  open,
  onOpenChange: setOpen,
  palette,
  onChoosePalette,
  avatars,
  onChooseAvatars,
  hostPagesInTabs = null,
  onChooseHostPagesInTabs = () => {},
  jev,
  onChangeJev,
  repositorySettings,
}: Props) {
  const [jevSaid, setJevSaid] = useState("");
  return (
    <>
      <button
        type="button"
        className="icon-button app-header-button"
        aria-haspopup="dialog"
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon aria-hidden="true" className="button-icon" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Settings" closeLabel="Close settings">
        <div className="settings">
          <ThemeChoice theme={theme} onChooseTheme={onChooseTheme} />
          <PaletteChoice palette={palette} onChoose={onChoosePalette} />
          <AvatarChoice on={avatars} onChoose={onChooseAvatars} />
          {hostPagesInTabs !== null && <HostPagesChoice on={hostPagesInTabs} onChoose={onChooseHostPagesInTabs} />}
          {repositorySettings && platform.chooseFolder && (
            <RepositorySettingsSection settings={repositorySettings} chooseFolder={platform.chooseFolder} />
          )}
          <EnterpriseHosts hosts={hosts} />
          <IssueTrackerSettings commands={platform.commands} onOpenLink={onOpenLink} />
          <ModelProviderSettings
            ai={ai}
            providers={modelProviders}
            platform={platform}
            catalogs={catalogs}
            repository={repository}
            onOpenLink={onOpenLink}
          />
          <JevSettingsSection
            jev={jev}
            onChange={onChangeJev}
            platform={platform}
            onAnnounce={setJevSaid}
            onOpenLink={onOpenLink}
          />
          <p role="status" className="visually-hidden">
            {jevSaid}
          </p>
          <UpdateSettings updates={updates} onOpenLink={onOpenLink} />
          <DiagnosticsSettings platform={platform} version={import.meta.env.VITE_APP_VERSION} />
        </div>
      </Dialog>
    </>
  );
}

/**
 * The palette, as swatches that are radio buttons, so the arrow keys move
 * between them: each shows its page and its accent in the Theme shown.
 */
function PaletteChoice({ palette, onChoose }: { palette: Palette; onChoose(palette: Palette): void }) {
  const name = useId();
  return (
    <fieldset className="settings-group">
      <legend className="settings-legend">Palette</legend>
      <div className="palette-choices">
        {PALETTES.map(({ id, label, note }) => (
          <label key={id} className="palette-choice">
            <span className="palette-choice-top">
              <input
                type="radio"
                name={name}
                value={id}
                checked={palette === id}
                aria-labelledby={`${name}-${id}-label`}
                aria-describedby={`${name}-${id}`}
                onChange={() => onChoose(id)}
              />
              <span id={`${name}-${id}-label`}>{label}</span>
            </span>
            <span className="palette-swatch" data-swatch={id} aria-hidden="true" />
            <span id={`${name}-${id}`} className="palette-choice-note">
              {note}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Whether authors' pictures come from GitHub, and what that sends. */
function AvatarChoice({ on, onChoose }: { on: boolean; onChoose(on: boolean): void }) {
  const noteId = useId();
  return (
    <fieldset className="settings-group">
      <legend className="settings-legend">Authors&apos; pictures</legend>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={on}
          aria-describedby={noteId}
          onChange={(event) => onChoose(event.target.checked)}
        />
        Show authors&apos; pictures from GitHub
      </label>
      <p id={noteId} className="settings-choice-note">
        For a repository whose remote is on GitHub.com, Lanewise asks GitHub for the picture of each author whose
        commits it shows, by the email in the commit. Off, it shows their initials, and asks nothing.
      </p>
    </fieldset>
  );
}

/** Whether a Host's pages open in Tabs here or in the browser (ADR 0042). */
function HostPagesChoice({ on, onChoose }: { on: boolean; onChoose(on: boolean): void }) {
  const noteId = useId();
  return (
    <fieldset className="settings-group">
      <legend className="settings-legend">Host pages</legend>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={on}
          aria-describedby={noteId}
          onChange={(event) => onChoose(event.target.checked)}
        />
        Open GitHub, GitLab, Bitbucket and Azure DevOps pages in Tabs here
      </label>
      <p id={noteId} className="settings-choice-note">
        A repository or Pull Request opens in a Tab beside your repositories, signed in as you sign in there. Off,
        they open in your browser. Other links always do.
      </p>
    </fieldset>
  );
}

/** The Theme: System, Light or Dark, as radio buttons, so the arrow keys move between them. */
function ThemeChoice({ theme, onChooseTheme }: ThemeProps) {
  const name = useId();
  return (
    <fieldset className="settings-group">
      <legend className="settings-legend">Theme</legend>
      {THEME_PREFERENCES.map(({ id, label, note }) => {
        const Icon = THEME_ICONS[id];
        const labelId = `${name}-${id}`;
        const noteId = `${labelId}-note`;
        return (
          <label key={id} className="settings-choice">
            <input
              type="radio"
              name={name}
              value={id}
              checked={theme === id}
              aria-labelledby={labelId}
              aria-describedby={noteId}
              onChange={() => onChooseTheme(id)}
            />
            <Icon aria-hidden="true" className="button-icon" />
            <span className="settings-choice-text">
              <span id={labelId} className="settings-choice-label">
                {label}
              </span>
              <span id={noteId} className="settings-choice-note">
                {note}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The GitHub Enterprise Server Hosts (PRD §9.1): each one added, with a
 * button that removes it, and a form that adds one by its address. Clone's
 * Browse repositories signs in to them as it does to GitHub.com.
 */
function EnterpriseHosts({ hosts: { enterpriseHosts, addEnterpriseHost, removeEnterpriseHost } }: { hosts: HostsState }) {
  const headingId = useId();
  const noteId = useId();
  const addressId = useId();
  const problemId = useId();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const addressField = useRef<HTMLInputElement>(null);

  function add(event: FormEvent) {
    event.preventDefault();
    const parsed = parseEnterpriseHost(address, enterpriseHosts);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      addressField.current?.focus();
      return;
    }
    addEnterpriseHost(parsed.host);
    setAddress("");
    setProblem(null);
    setAnnouncement(`Added ${parsed.host}.`);
  }

  function remove(host: string) {
    removeEnterpriseHost(host);
    setAnnouncement(`Removed ${host}.`);
    // Focus goes to the address field, not to the body with the button.
    addressField.current?.focus();
  }

  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-legend">
        GitHub Enterprise Server
      </h3>
      <p id={noteId} className="settings-choice-note">
        Add your company's GitHub Enterprise Server by its address, such as https://github.example.com, and Clone
        can browse your repositories there, signing in with Git's credential helper. GitHub.com is always there, as
        are GitLab.com, Bitbucket and Azure DevOps.
      </p>
      {enterpriseHosts.length > 0 && (
        <ul className="settings-hosts" aria-label="GitHub Enterprise Servers">
          {enterpriseHosts.map((host) => (
            <li key={host} className="settings-host">
              <span className="settings-host-name">{host}</span>
              <button
                type="button"
                className="button button-small"
                aria-label={`Remove ${host}`}
                onClick={() => remove(host)}
              >
                <Trash2 aria-hidden="true" className="button-icon" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="settings-host-form" noValidate onSubmit={add}>
        <div className="branch-field">
          <label htmlFor={addressId}>Address</label>
          <div className="clone-folder">
            <input
              ref={addressField}
              id={addressId}
              type="text"
              inputMode="url"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setProblem(null);
              }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={problem !== null || undefined}
              aria-describedby={[noteId, problem === null ? undefined : problemId].filter(Boolean).join(" ")}
            />
            <button type="submit" className="button">
              <Plus aria-hidden="true" className="button-icon" />
              Add
            </button>
          </div>
        </div>
        {problem !== null && (
          <p id={problemId} role="alert" className="problem">
            {problem}
          </p>
        )}
      </form>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </section>
  );
}
