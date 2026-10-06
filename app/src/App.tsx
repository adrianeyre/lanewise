import { BadgeCheck, Copy, FolderOpen, Keyboard, Menu as MenuIcon, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { catalogSource } from "./ai/modelCatalog";
import type { ModelProvider } from "./ai/modelProvider";
import { MODEL_PROVIDERS } from "./ai/modelProviders";
import type { AiAccess } from "./ai/requests";
import { useJevSettings } from "./ai/jevSettings";
import { useAiSettings } from "./ai/useAiSettings";
import type { CommandClient, OpenedRepository, Path, RepositoryError } from "./commands/api";
import { logUncaught } from "./diagnostics/log";
import type { DiffSubject } from "./diff/DiffWidget";
import { useHosts } from "./hosts/useHosts";
import { Footer, type Policy } from "./legal/Footer";
import { ISSUES_URL, REPOSITORY_URL } from "./legal/links";
import type { Platform } from "./platform/platform";
import { describeFailure, describeRepositoryError } from "./repository/problems";
import { RepositoryPage } from "./repository/RepositoryPage";
import { OPEN_REPOSITORIES_KEY, readLocal, writeLocal } from "./settings/localSettings";
import { useAvatarSetting } from "./settings/avatarSetting";
import { useHostPagesSetting } from "./settings/hostPagesSetting";
import { HostPageView } from "./hostPages/HostPageView";
import { isHostPage } from "./hosts/webPage";
import { useRepositorySettings } from "./settings/repositorySettings";
import { usePalette } from "./settings/palette";
import { Settings } from "./settings/Settings";
import { type Theme, useTheme } from "./settings/theme";
import { GitSetupScreen } from "./setup/GitSetupScreen";
import { useGitSetup } from "./setup/useGitSetup";
import { RepositoryTabs, TAB_PANEL_ID, tabElementId, tabName } from "./tabs/RepositoryTabs";
import {
  activateTab,
  activeTab,
  closeTab,
  moveTab,
  NO_TABS,
  openHostPageTab,
  openRepositoryTab,
  openWelcomeTab,
  parseSavedTabs,
  type RepositoryTab,
  restoredTabs,
  type SavedTabs,
  savedTabs,
  serialiseSavedTabs,
  type Tabs,
  updateHostPageTab,
  updateRepositoryTab,
} from "./tabs/tabs";
import { ActivityIndicator } from "./ui/ActivityIndicator";
import { trackCommands } from "./ui/commandActivity";
import { KeyboardShortcuts } from "./ui/KeyboardShortcuts";
import { Menu, type MenuItem } from "./ui/Menu";
import { ariaShortcut, matches, type ShortcutName, SHORTCUTS, shortcutLabel } from "./ui/shortcuts";
import { UpdateNotice } from "./updates/UpdateNotice";
import { VersionCheckDialog } from "./updates/VersionCheckDialog";
import { useUpdates } from "./updates/useUpdates";
import { whyNotInstall } from "./updates/whyNotInstall";
import { useClone } from "./welcome/useClone";
import { useRecentRepositories } from "./welcome/useRecentRepositories";
import { WelcomeScreen } from "./welcome/WelcomeScreen";

interface Props {
  /** The shell the UI runs in: the Desktop App, or Web Mode later. */
  platform: Platform;
  /** The Model Providers Settings offers: those there are adapters for, unless a test gives its own. */
  modelProviders?: readonly ModelProvider[];
}

/** A menu item's shortcut, as the menu shows and names it. */
function keys(name: ShortcutName) {
  return { label: shortcutLabel(SHORTCUTS[name]), aria: ariaShortcut(SHORTCUTS[name]) };
}

/** The Tabs kept from the last launch, if any. */
function savedOnLaunch(): SavedTabs {
  return parseSavedTabs(readLocal(OPEN_REPOSITORIES_KEY));
}

/**
 * The repositories in `saved`, opened again, and what to tell the user about
 * any that didn't open. Those stay on the Recent Repositories, marked there.
 */
async function reopen(
  commands: CommandClient,
  saved: SavedTabs,
): Promise<{ opened: OpenedRepository[]; problems: string[] }> {
  const opened: OpenedRepository[] = [];
  const problems = new Set<string>();
  await Promise.all(
    saved.repositories.map(async (path, index) => {
      try {
        const outcome = await commands.call("openRepository", { path });
        if (outcome.ok) opened[index] = outcome.value;
        else problems.add(describeRepositoryError(outcome.error));
      } catch (failure) {
        problems.add(describeFailure(failure));
      }
    }),
  );
  // In the order they were kept, whichever answered first.
  return { opened: opened.filter(Boolean), problems: [...problems] };
}

/**
 * The file whose diff a Tab's Diff Widget shows: a change chosen in the
 * Working tree, a file chosen in Commit details if it was chosen in the
 * commit selected now, or one chosen in the Stashes Widget if it was chosen
 * in the stash selected now.
 */
function fileChosenIn(tab: RepositoryTab): DiffSubject | null {
  const { chosenFile, selectedCommit, selectedStash } = tab;
  if (chosenFile?.kind === "commit" && chosenFile.commit !== selectedCommit) return null;
  if (chosenFile?.kind === "stash" && chosenFile.stash !== selectedStash) return null;
  return chosenFile;
}

// TODO(#50): shortcuts to switch and close Tabs from anywhere, such as Ctrl+Tab,
// with the other keyboard shortcuts (PRD §7.9, P1).
/**
 * The whole UI. It checks the Git Setup first, and shows what's missing, if
 * anything, until it's fixed or the user carries on without it. Each open
 * repository is a Tab (PRD §7.1) with its own Repository page, or the
 * Conflicts page in its place while an In-Progress Operation is (PRD §7.7),
 * each laid out as GitKraken's is (ADR 0032), above the footer (PRD §7.11).
 * With no repository open, the Welcome screen is, in a Tab of its own. The title bar has the
 * app's menu at the left, its File menu opening, cloning and closing
 * repositories and Tabs, its name in the middle, and Settings, such as the
 * Theme, at the right, open at any time. The Tabs and the Recent
 * Repositories are kept for the next launch. An Update found is offered
 * under the Tabs, except on a Conflicts page (ADR 0030).
 */
export function App({ platform: shell, modelProviders = MODEL_PROVIDERS }: Props) {
  // Every command shows in the Activity indicator while it takes time.
  const platform = useMemo<Platform>(() => ({ ...shell, commands: trackCommands(shell.commands) }), [shell]);
  const [tabs, setTabs] = useState<Tabs>(NO_TABS);
  // Reopening the Tabs kept from the last launch, which aren't saved over until they're back.
  const [restoring, setRestoring] = useState(() => savedOnLaunch().repositories.length > 0);
  const recent = useRecentRepositories();
  // With nothing open, the Welcome screen has a Tab of its own, as when it's opened beside others.
  const drawnTabs = useMemo(() => (tabs.tabs.length === 0 ? openWelcomeTab(tabs) : tabs), [tabs]);
  const shown = activeTab(drawnTabs);
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const gitSetup = useGitSetup(platform.commands, setProblem);
  const [continued, setContinued] = useState(false);
  const { check } = gitSetup;
  const settingUp = check.kind === "checked" && !check.setup.complete && !continued;
  const ready = check.kind !== "checking" && !settingUp && !restoring;
  // The Welcome screen's Open repository, where focus goes once what had it has gone.
  const openButton = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The Cookie Policy, Accessibility or Credits dialog, from the footer or the App menu.
  const [policy, setPolicy] = useState<Policy | null>(null);
  // Counts "Clone repository…" chosen, each putting focus in the Welcome screen's Clone.
  const [cloneRequest, setCloneRequest] = useState(0);
  const wasSettingUp = useRef(false);
  const lastTabClosed = useRef(false);
  const showWindowTheme = useCallback(
    (theme: Theme | null) => {
      platform.showTheme(theme).catch((failure: unknown) => setProblem(describeFailure(failure)));
    },
    [platform],
  );
  const theme = useTheme({ onChosen: showWindowTheme });
  const palette = usePalette();
  const avatars = useAvatarSetting();
  const hostPagesSetting = useHostPagesSetting();
  // Host pages open in Tabs where the shell can show them, unless Settings says the browser.
  const hostPages = hostPagesSetting.on ? platform.hostPages : null;
  // The toolbar a Host page's F6 hands focus back to.
  const hostPageToolbar = useRef<HTMLButtonElement>(null);
  const repositorySettings = useRepositorySettings();
  const hosts = useHosts();
  const ai = useAiSettings();
  const jev = useJevSettings();
  // The model catalog is fetched once for the run, and again on Refresh models.
  const [catalogs] = useState(() => catalogSource(platform));
  const aiAccess = useMemo<AiAccess>(
    () => ({ platform, providers: modelProviders, settings: ai.settings, catalogs, jev: jev.jev }),
    [platform, modelProviders, ai.settings, catalogs, jev.jev],
  );
  const { remember } = recent;
  const clone = useClone(
    platform.commands,
    useCallback(
      (repository: OpenedRepository) => {
        setTabs((state) => openRepositoryTab(state, repository));
        remember(repository);
        setProblem(null);
      },
      [remember],
    ),
  );

  const updates = useUpdates(platform.updater, {
    whyNotInstall: () =>
      whyNotInstall(
        platform.commands,
        tabs.tabs.flatMap((tab) => (tab.kind === "repository" ? [tab.repository] : [])),
        clone.status.kind === "running",
      ),
  });

  // The shortcuts work from anywhere in the window, but not from inside a dialog, which is modal.
  const latestShortcuts = useRef<Partial<Record<ShortcutName, () => void>>>({});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest("dialog[open]")) return;
      const name = (Object.keys(SHORTCUTS) as ShortcutName[]).find((each) => matches(event, SHORTCUTS[each]));
      if (name === undefined) return;
      event.preventDefault();
      latestShortcuts.current[name]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Whatever the UI doesn't catch goes in Lanewise's logs, without its message.
  useEffect(() => logUncaught(platform.commands, window), [platform.commands]);

  // The setup screen, and the button that was focused on it, have gone.
  useEffect(() => {
    if (wasSettingUp.current && !settingUp) openButton.current?.focus();
    wasSettingUp.current = settingUp;
  }, [settingUp]);

  useEffect(() => {
    const saved = savedOnLaunch();
    if (saved.repositories.length === 0) return;
    let current = true;
    void reopen(platform.commands, saved).then(({ opened, problems }) => {
      if (!current) return;
      setTabs(restoredTabs(opened, saved.active));
      if (problems.length > 0) {
        setProblem(`Lanewise couldn't reopen every repository you had open. ${problems.join(" ")}`);
      }
      setRestoring(false);
    });
    return () => {
      current = false;
    };
  }, [platform.commands]);

  useEffect(() => {
    if (!restoring) writeLocal(OPEN_REPOSITORIES_KEY, serialiseSavedTabs(savedTabs(tabs)));
  }, [tabs, restoring]);

  // The last Tab, and whatever in it had focus, have gone.
  useEffect(() => {
    if (lastTabClosed.current && tabs.tabs.length === 0) openButton.current?.focus();
    lastTabClosed.current = false;
  }, [tabs]);

  /** Opens `url`: a Host's page in a Tab of its own, where it can be (ADR 0042), anything else in the browser. */
  function openLink(url: string) {
    if (hostPages !== null && isHostPage(url, hosts.enterpriseHosts)) {
      // From the Welcome screen with nothing open, it keeps its Tab, beside the page.
      setTabs((state) => openHostPageTab(state.tabs.length === 0 ? openWelcomeTab(state) : state, url));
      return;
    }
    openInBrowser(url);
  }

  function openInBrowser(url: string) {
    platform.openLink(url).catch((failure: unknown) => setProblem(describeFailure(failure)));
  }

  // What each Host page says: its title, where it has gone, a new window for a new Tab, and its keys.
  const latestOpenLink = useRef(openLink);
  useLayoutEffect(() => {
    latestOpenLink.current = openLink;
  });
  useEffect(() => {
    if (platform.hostPages === null) return;
    return platform.hostPages.listen((news) => {
      switch (news.kind) {
        case "title":
          setTabs((state) => updateHostPageTab(state, news.page, { title: news.title }));
          break;
        case "loading":
          setTabs((state) => updateHostPageTab(state, news.page, { url: news.url, loading: !news.done }));
          break;
        case "newTab":
          latestOpenLink.current(news.url);
          break;
        case "focus":
          hostPageToolbar.current?.focus();
          break;
        case "close":
          lastTabClosed.current = true;
          setTabs((state) => closeTab(state, news.page));
          break;
      }
    });
  }, [platform.hostPages]);

  // A Host page goes with its Tab: whichever way the Tab closes.
  const hostPageKeys = useRef(new Set<number>());
  useEffect(() => {
    const open = new Set(tabs.tabs.flatMap((tab) => (tab.kind === "hostPage" ? [tab.key] : [])));
    for (const key of hostPageKeys.current) {
      if (!open.has(key)) platform.hostPages?.close(key).catch(() => {});
    }
    hostPageKeys.current = open;
  }, [tabs, platform.hostPages]);

  /** Runs `work` unless something is already opening, saying so if it fails to run at all. */
  async function whileOpening<T>(work: () => Promise<T>, otherwise: T): Promise<T> {
    if (opening.current) return otherwise;
    opening.current = true;
    setBusy(true);
    try {
      return await work();
    } catch (failure) {
      setProblem(describeFailure(failure));
      return otherwise;
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  /**
   * Opens the repository `path` is in, in its Tab: switching to it if it's
   * open already. Resolves with why it didn't open, if it didn't.
   */
  async function openAt(path: Path): Promise<RepositoryError | null> {
    const outcome = await platform.commands.call("openRepository", { path });
    if (!outcome.ok) {
      setProblem(describeRepositoryError(outcome.error));
      return outcome.error;
    }
    setTabs((state) => openRepositoryTab(state, outcome.value));
    recent.remember(outcome.value);
    setProblem(null);
    return null;
  }

  function openRepository() {
    void whileOpening(async () => {
      const folder = await platform.chooseFolder("Open repository", repositorySettings.baseFolder);
      if (folder !== null) await openAt(folder);
    }, undefined);
  }

  function openRecent(root: Path): Promise<RepositoryError | null | undefined> {
    return whileOpening(() => openAt(root), undefined);
  }

  function closeTabKeyed(key: number) {
    lastTabClosed.current = true;
    setTabs((state) => closeTab(state, key));
  }

  /** Shows the Welcome screen, in a Tab of its own if any are open, with focus in its Clone. */
  function cloneRepository() {
    setTabs(openWelcomeTab);
    setCloneRequest((n) => n + 1);
  }

  const recentItems: MenuItem[] = recent.recent.slice(0, 10).map((entry) => ({
    kind: "action",
    id: `recent:${entry.root}`,
    label: entry.name,
    onSelect: () => void openRecent(entry.root),
  }));
  /** The Tab after the one shown, or `step` -1 for the one before, going round at the ends. */
  const switchTab = (step: 1 | -1) =>
    setTabs((state) => {
      const at = state.tabs.findIndex((tab) => tab.key === state.active);
      const next = state.tabs[(at + step + state.tabs.length) % state.tabs.length];
      return next === undefined ? state : activateTab(state, next.key);
    });
  const closeShown = () => {
    if (shown !== null && tabs.tabs.length > 0) closeTabKeyed(shown.key);
  };
  const shortcutActions: Record<ShortcutName, () => void> = {
    openRepository,
    cloneRepository,
    newTab: () => setTabs(openWelcomeTab),
    closeTab: closeShown,
    nextTab: () => switchTab(1),
    previousTab: () => switchTab(-1),
    settings: () => setSettingsOpen(true),
    shortcuts: () => setShortcutsOpen(true),
  };
  useLayoutEffect(() => {
    latestShortcuts.current = shortcutActions;
  });

  const appMenu: MenuItem[] = [
    {
      kind: "submenu",
      id: "file",
      label: "File",
      items: [
        {
          kind: "action",
          id: "open",
          label: "Open repository…",
          icon: <FolderOpen className="menu-icon-glyph" />,
          shortcut: keys("openRepository"),
          onSelect: openRepository,
        },
        {
          kind: "action",
          id: "clone",
          label: "Clone repository…",
          icon: <Copy className="menu-icon-glyph" />,
          shortcut: keys("cloneRepository"),
          onSelect: cloneRepository,
        },
        ...(recentItems.length > 0
          ? [{ kind: "submenu", id: "recent", label: "Open recent", items: recentItems } as const]
          : []),
        { kind: "separator", id: "tabs" },
        {
          kind: "action",
          id: "newTab",
          label: "New tab",
          icon: <Plus className="menu-icon-glyph" />,
          shortcut: keys("newTab"),
          onSelect: () => setTabs(openWelcomeTab),
        },
        ...(shown !== null && tabs.tabs.length > 0
          ? [
              {
                kind: "action",
                id: "closeTab",
                label: shown.kind === "welcome" ? "Close tab" : `Close “${tabName(shown)}”`,
                icon: <X className="menu-icon-glyph" />,
                shortcut: keys("closeTab"),
                onSelect: closeShown,
              } as const,
            ]
          : []),
        { kind: "separator", id: "beforeSettings" },
        {
          kind: "action",
          id: "settings",
          label: "Settings…",
          icon: <SettingsIcon className="menu-icon-glyph" />,
          shortcut: keys("settings"),
          onSelect: () => setSettingsOpen(true),
        },
      ],
    },
    {
      kind: "submenu",
      id: "help",
      label: "Help",
      items: [
        {
          kind: "action",
          id: "version",
          label: "Check for the latest version…",
          icon: <BadgeCheck className="menu-icon-glyph" />,
          onSelect: () => setVersionOpen(true),
        },
        {
          kind: "action",
          id: "shortcuts",
          label: "Keyboard shortcuts",
          icon: <Keyboard className="menu-icon-glyph" />,
          shortcut: keys("shortcuts"),
          onSelect: () => setShortcutsOpen(true),
        },
        { kind: "separator", id: "links" },
        { kind: "action", id: "github", label: "Lanewise on GitHub", onSelect: () => openLink(REPOSITORY_URL) },
        { kind: "action", id: "issue", label: "Report a problem", onSelect: () => openLink(ISSUES_URL) },
      ],
    },
    { kind: "separator", id: "about" },
    { kind: "action", id: "privacy", label: "Privacy Policy", onSelect: () => setPolicy("privacy") },
    { kind: "action", id: "terms", label: "Terms and Conditions", onSelect: () => setPolicy("terms") },
    { kind: "action", id: "cookies", label: "Cookie Policy", onSelect: () => setPolicy("cookies") },
    { kind: "action", id: "accessibility", label: "Accessibility", onSelect: () => setPolicy("accessibility") },
    { kind: "action", id: "credits", label: "Credits", onSelect: () => setPolicy("credits") },
    { kind: "separator", id: "version" },
    { kind: "note", id: "appVersion", label: `Version: ${import.meta.env.VITE_APP_VERSION}` },
  ];

  const welcome = (
    <WelcomeScreen
      commands={platform.commands}
      recent={recent.recent}
      onOpen={openRecent}
      onRemove={recent.forget}
      clone={clone}
      hosts={hosts}
      chooseFolder={(title) => platform.chooseFolder(title, repositorySettings.baseFolder)}
      baseFolder={repositorySettings.baseFolder}
      onOpenLink={openLink}
      onOpenFolder={openRepository}
      cloneRequest={cloneRequest}
      openButton={openButton}
    />
  );

  return (
    <div className="app-window">
      <main className="app">
        <header className="app-header">
          <div className="app-header-start">
            <Menu
              label={<MenuIcon aria-hidden="true" className="button-icon" />}
              ariaLabel="Menu"
              chevron={false}
              buttonClassName="icon-button app-header-button"
              align="start"
              items={appMenu}
            />
          </div>
          <h1 className="app-name">
            <img className="app-name-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="22" height="22" />
            Lanewise
          </h1>
          <div className="app-actions">
            {busy && (
              <span role="status" className="visually-hidden">
                Opening…
              </span>
            )}
            <Settings
              theme={theme.preference}
              onChooseTheme={theme.choose}
              hosts={hosts}
              ai={ai}
              modelProviders={modelProviders}
              platform={platform}
              catalogs={catalogs}
              repository={shown?.kind === "repository" ? shown.repository : null}
              updates={updates}
              onOpenLink={openLink}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              palette={palette.palette}
              onChoosePalette={palette.choose}
              avatars={avatars.on}
              onChooseAvatars={avatars.choose}
              hostPagesInTabs={platform.hostPages === null ? null : hostPagesSetting.on}
              onChooseHostPagesInTabs={hostPagesSetting.choose}
              jev={jev.jev}
              onChangeJev={jev.change}
              repositorySettings={repositorySettings}
            />
          </div>
        </header>
        {ready && (
          <RepositoryTabs
            state={drawnTabs}
            onActivate={(key) => setTabs((state) => activateTab(state, key))}
            onClose={closeTabKeyed}
            onMove={(key, index) => setTabs((state) => moveTab(state, key, index))}
            onNewTab={() => setTabs(openWelcomeTab)}
          />
        )}
        {problem !== null && (
          <p role="alert" className="problem">
            {problem}
          </p>
        )}
        {/* Never on a Conflicts page, between the user and an In-Progress Operation. */}
        {!(shown?.kind === "repository" && shown.page.name === "conflicts") && <UpdateNotice updates={updates} />}
        <div className="app-page">
          {check.kind === "checking" ? (
            <p role="status" className="app-intro">
              Checking the Git Setup…
            </p>
          ) : settingUp ? (
            <GitSetupScreen
              setup={check.setup}
              rechecking={gitSetup.rechecking}
              rechecked={gitSetup.answers > 1}
              onCheckAgain={gitSetup.checkAgain}
              onContinue={() => setContinued(true)}
              onOpenLink={openLink}
            />
          ) : restoring ? (
            <p role="status" className="app-intro">
              Reopening your repositories…
            </p>
          ) : shown === null ? (
            welcome
          ) : (
            <div
              role="tabpanel"
              id={TAB_PANEL_ID}
              aria-labelledby={tabElementId(shown.key)}
              className="tab-panel"
            >
              {shown.kind === "welcome" ? (
                welcome
              ) : shown.kind === "hostPage" ? (
                platform.hostPages !== null && (
                  <HostPageView
                    key={shown.key}
                    tab={shown}
                    hostPages={platform.hostPages}
                    onOpenInBrowser={openInBrowser}
                    toolbar={hostPageToolbar}
                    onProblem={setProblem}
                  />
                )
              ) : (
                <RepositoryPage
                  // Each Tab's page is its own: only the one shown is drawn.
                  key={shown.key}
                  commands={platform.commands}
                  repository={shown.repository}
                  ai={aiAccess}
                  opening={shown.opening}
                  onOpenLink={openLink}
                  enterpriseHosts={hosts.enterpriseHosts}
                  avatars={avatars.on}
                  fetchOnShow={repositorySettings.fetchOnShow}
                  copyText={(text) => platform.copyText(text)}
                  onPage={(page) => setTabs((state) => updateRepositoryTab(state, shown.key, () => ({ page })))}
                  selectedCommit={shown.selectedCommit}
                  onSelectCommit={(commit) =>
                    setTabs((state) =>
                      updateRepositoryTab(state, shown.key, () => ({ selectedCommit: commit })),
                    )
                  }
                  chosenFile={fileChosenIn(shown)}
                  onSelectFile={(file) =>
                    setTabs((state) =>
                      updateRepositoryTab(state, shown.key, (tab) =>
                        tab.selectedCommit === null
                          ? {}
                          : { chosenFile: { kind: "commit", commit: tab.selectedCommit, file } },
                      ),
                    )
                  }
                  onCloseFile={() =>
                    setTabs((state) => updateRepositoryTab(state, shown.key, () => ({ chosenFile: null })))
                  }
                  onSelectChange={(entry) =>
                    setTabs((state) =>
                      updateRepositoryTab(state, shown.key, (tab) =>
                        entry !== null
                          ? { chosenFile: { kind: "workingTree", entry } }
                          : // Only a change that has gone is let go of, not a commit's file chosen since.
                            tab.chosenFile?.kind === "workingTree"
                            ? { chosenFile: null }
                            : {},
                      ),
                    )
                  }
                  selectedStash={shown.selectedStash}
                  onSelectStash={(stash) =>
                    setTabs((state) =>
                      updateRepositoryTab(state, shown.key, () => ({ selectedStash: stash })),
                    )
                  }
                  onSelectStashFile={(stash, file) =>
                    setTabs((state) =>
                      updateRepositoryTab(state, shown.key, (tab) =>
                        tab.selectedStash === stash ? { chosenFile: { kind: "stash", stash, file } } : {},
                      ),
                    )
                  }
                />
              )}
            </div>
          )}
        </div>
      </main>
      {/* The Release is downloaded, which the browser does, not a Host page; its page opens as any other. */}
      <VersionCheckDialog
        platform={platform}
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        onOpenLink={openInBrowser}
        onOpenReleasePage={openLink}
      />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ActivityIndicator />
      <Footer onOpenLink={openLink} policy={policy} onPolicy={setPolicy} />
    </div>
  );
}
