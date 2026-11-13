import { App } from "../../src/App";
import type { CheckedGitSetup } from "../../src/commands/api";
import { checksGitSetup, fakeKeyStore, fakePlatform, gitSetup } from "../../src/test/fakePlatform";

export const APP_SCENES = {
  "git-setup-windows": gitSetup({
    operatingSystem: "windows",
    git: { kind: "missing" },
    credentialManager: { kind: "unchecked" },
  }),
  "git-setup-macos": gitSetup({
    operatingSystem: "macos",
    git: { kind: "tooOld", path: "/usr/bin/git", version: "2.39.5" },
    credentialManager: { kind: "notConfigured", helpers: ["osxkeychain"] },
  }),
  "git-setup-linux": gitSetup({
    operatingSystem: "linux",
    git: { kind: "supported", path: "/usr/bin/git", version: "2.43.0" },
    credentialManager: { kind: "notConfigured", helpers: [] },
  }),
  welcome: gitSetup({
    operatingSystem: "macos",
    git: { kind: "supported", path: "/opt/homebrew/bin/git", version: "2.52.0" },
    credentialManager: { kind: "configured", helper: "/usr/local/bin/git-credential-manager" },
  }),
} satisfies Record<string, CheckedGitSetup>;

export type AppSceneName = keyof typeof APP_SCENES;

export function isAppScene(name: string): name is AppSceneName {
  return Object.hasOwn(APP_SCENES, name);
}

export function AppScene({ name }: { name: AppSceneName }) {
  const { platform } = fakePlatform({
    commands: {
      checkGitSetup: checksGitSetup(APP_SCENES[name]),
      ...fakeKeyStore().commands,
      issueTrackerAccount: () => ({ ok: true, value: null }),
    },
  });
  return <App platform={platform} />;
}
