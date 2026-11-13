export type PictureStep =
  | { click: string }
  | { fill: { label: string; text: string } }
  | { show: string };

export interface Picture {
  file: string;
  scene: string;
  width: number;
  height: number;
  steps: PictureStep[];
}

export const APP_SCENE_NAMES = ["git-setup-windows", "git-setup-macos", "git-setup-linux", "welcome"];

export const DRAWING_NAMES = [
  "windows-version",
  "windows-terminal",
  "windows-git",
  "windows-git-check",
  "windows-download",
  "windows-download-terminal",
  "windows-smartscreen",
  "windows-smartscreen-run",
  "windows-unblock",
  "windows-installer",
  "windows-installer-finish",
  "windows-start",
  "windows-uninstall",
  "windows-build-tools",
  "windows-workload",
  "windows-webview2",
  "windows-rust",
  "windows-node",
  "windows-corepack",
  "windows-clone",
  "windows-dev",
  "windows-checks",
  "windows-build",
  "macos-version",
  "macos-homebrew",
  "macos-git",
  "macos-git-check",
  "macos-download",
  "macos-download-terminal",
  "macos-disk-image",
  "macos-disk-image-terminal",
  "macos-blocked",
  "macos-privacy",
  "macos-open-anyway",
  "macos-password",
  "macos-quarantine",
  "macos-quarantine-more",
  "macos-damaged",
  "macos-damaged-fix",
  "macos-uninstall",
  "macos-xcode",
  "macos-xcode-check",
  "macos-node",
  "macos-corepack",
  "macos-rust",
  "macos-clone",
  "macos-dev",
  "macos-checks",
  "macos-build",
  "linux-version",
  "linux-packages",
  "linux-git-ppa",
  "linux-credential-manager",
  "linux-node",
  "linux-corepack",
  "linux-rust",
  "linux-clone",
  "linux-dev",
  "linux-checks",
  "linux-build",
  "linux-launcher",
  "linux-desktop-entry",
];

const APP_SIZE = { width: 1280, height: 800 };
const DRAWING_SIZE = { width: 960, height: 600 };

function buildAppPicture(file: string, scene: string, steps: PictureStep[] = []): Picture {
  return { file, scene, ...APP_SIZE, steps };
}

export const PICTURES: Picture[] = [
  ...APP_SCENE_NAMES.map((scene) => buildAppPicture(`app-${scene}.png`, scene)),
  buildAppPicture("app-clone.png", "welcome", [
    { fill: { label: "Repository URL", text: "https://github.com/adrianeyre/lanewise.git" } },
    { show: "Clone a repository" },
  ]),
  buildAppPicture("app-settings-ai.png", "welcome", [{ click: "Settings" }, { show: "AI" }]),
  ...DRAWING_NAMES.map((scene) => ({ file: `${scene}.png`, scene, ...DRAWING_SIZE, steps: [] })),
];

export const PICTURES_FOLDER = "docs/setup/pictures";
