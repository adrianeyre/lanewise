import type { ReactNode } from "react";

import appIcon from "../../../desktop/icons/128x128.png";

export type System = "windows" | "macos" | "linux";

const SYSTEM_NAMES: Record<System, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export function Desk({ system, label, children }: { system: System; label?: string; children: ReactNode }) {
  return (
    <div className={`drawing-desk drawing-desk-${system}`}>
      {children}
      <p className="drawing-label">{label ?? `A drawing of what ${SYSTEM_NAMES[system]} shows`}</p>
    </div>
  );
}

export function Window({
  system,
  title,
  width = 760,
  dark = false,
  children,
}: {
  system: System;
  title: string;
  width?: number;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`drawing-window drawing-window-${system}${dark ? " drawing-window-dark" : ""}`}
      style={{ width }}
    >
      <header className="drawing-titlebar">
        {system === "macos" && (
          <span className="drawing-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <span className="drawing-title">{title}</span>
        {system !== "macos" && (
          <span className="drawing-controls" aria-hidden="true">
            <i>–</i>
            <i>□</i>
            <i>×</i>
          </span>
        )}
      </header>
      <div className="drawing-body">{children}</div>
    </section>
  );
}

export interface Line {
  command?: string;
  output?: string;
  note?: string;
}

const PROMPTS: Record<System, string> = {
  windows: "PS C:\\Users\\you>",
  macos: "you@mac ~ %",
  linux: "you@ubuntu:~$",
};

const SHELLS: Record<System, string> = {
  windows: "Windows PowerShell",
  macos: "Terminal — zsh",
  linux: "Terminal — bash",
};

export function Terminal({
  system,
  lines,
  prompt,
  label,
}: {
  system: System;
  lines: Line[];
  prompt?: string;
  label?: string;
}) {
  return (
    <Desk system={system} label={label}>
      <Window system={system} title={SHELLS[system]} width={860} dark>
        <pre className="drawing-terminal">
          {lines.map((line, index) => (
            <span key={index} className="drawing-line">
              {line.note !== undefined && <span className="drawing-note">{line.note}</span>}
              {line.command !== undefined && (
                <>
                  <span className="drawing-prompt">{prompt ?? PROMPTS[system]}</span> {line.command}
                </>
              )}
              {line.output !== undefined && <span className="drawing-output">{line.output}</span>}
            </span>
          ))}
        </pre>
      </Window>
    </Desk>
  );
}

export interface Button {
  label: string;
  chosen?: boolean;
  primary?: boolean;
}

export function Buttons({ buttons, stacked = false }: { buttons: Button[]; stacked?: boolean }) {
  return (
    <div className={`drawing-buttons${stacked ? " drawing-buttons-stacked" : ""}`}>
      {buttons.map((button) => (
        <span
          key={button.label}
          className={`drawing-button${button.primary ? " drawing-button-primary" : ""}${button.chosen ? " drawing-chosen" : ""}`}
        >
          {button.label}
        </span>
      ))}
    </div>
  );
}

export function AppIcon({ size = 64 }: { size?: number }) {
  return <img className="drawing-app-icon" src={appIcon} width={size} height={size} alt="" />;
}

export function MacAlert({
  heading,
  text,
  buttons,
  icon = <AppIcon />,
}: {
  heading: string;
  text: string[];
  buttons: Button[];
  icon?: ReactNode;
}) {
  return (
    <Desk system="macos">
      <section className="drawing-alert">
        {icon}
        <h1>{heading}</h1>
        {text.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <Buttons buttons={buttons} stacked />
      </section>
    </Desk>
  );
}

export function Browser({
  system,
  address,
  children,
}: {
  system: System;
  address: string;
  children: ReactNode;
}) {
  return (
    <Desk system={system}>
      <Window system={system} title="Lanewise — a free Git client with a visual commit graph" width={880}>
        <p className="drawing-address">{address}</p>
        <div className="drawing-page">{children}</div>
      </Window>
    </Desk>
  );
}

export function Checkbox({ label, checked = true, chosen = false }: { label: string; checked?: boolean; chosen?: boolean }) {
  return (
    <p className={`drawing-checkbox${chosen ? " drawing-chosen" : ""}`}>
      <span className="drawing-box" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      {label}
    </p>
  );
}
