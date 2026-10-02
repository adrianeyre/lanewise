#!/usr/bin/env bash
# Makes the demo repository the README's and the website's screenshots are taken of, in $1
# (default /tmp/demo): a small weather station, `station`, with a branch merged and two open,
# tags, a remote, a stash and changes in the working tree, and `merging`, a clone of it partway
# through merging origin/feature/units, conflicted in src/format.ts. Its authors are made up,
# with example.com emails, so no one's picture is fetched (website/README.md, "Screenshots").
set -euo pipefail
demo="${1:-/tmp/demo}"
rm -rf "$demo" && mkdir -p "$demo" && cd "$demo"
git init -q -b main station && cd station
git config commit.gpgsign false; git config tag.gpgsign false
# 18:43, `$1` days ago: by GNU date, or BSD date on macOS.
day() {
  date -d "$1 days ago 18:43" +"%Y-%m-%dT%H:%M:%S" 2>/dev/null ||
    date -v-"$1"d -v18H -v43M -v0S +"%Y-%m-%dT%H:%M:%S"
}
as() { # as <name> <email> <days ago> <message>
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
  GIT_AUTHOR_DATE="$(day "$3")" GIT_COMMITTER_DATE="$(day "$3")" git commit -q -m "$4"; }
ada() { as "Ada Lovelace" ada@example.com "$@"; }
grace() { as "Grace Hopper" grace@example.com "$@"; }
margaret() { as "Margaret Hamilton" margaret@example.com "$@"; }
katherine() { as "Katherine Johnson" katherine@example.com "$@"; }
mkdir -p src
cat > README.md <<'X'
# Station

The display for a small weather station: the temperature and humidity, refreshed every minute.
X
cat > src/display.ts <<'X'
import { formatTemperature } from "./format";

export function show(celsius: number): string {
  return `Temperature: ${formatTemperature(celsius)}`;
}
X
cat > src/format.ts <<'X'
export function formatTemperature(celsius: number): string {
  return `${celsius} °C`;
}
X
git add -A; ada 16 "Start the station's display"
cat > src/sensor.ts <<'X'
export interface Reading {
  celsius: number;
  humidity: number;
}

export function read(): Reading {
  return { celsius: 21.46, humidity: 0.482 };
}
X
git add -A; grace 16 "Read temperature and humidity"
cat > src/refresh.ts <<'X'
export const REFRESH_MS = 60_000;

export function every(run: () => void): number {
  return setInterval(run, REFRESH_MS) as unknown as number;
}
X
git add -A; margaret 15 "Refresh the display every minute"
git tag v0.1.0
cat > CHANGELOG.md <<'X'
# Changelog

## 0.1.0

- The temperature, refreshed every minute.
X
git add -A; ada 15 "Keep a changelog"
git checkout -q -b feature/humidity
cat >> src/format.ts <<'X'

export function formatHumidity(humidity: number): string {
  return `${Math.round(humidity * 100)}%`;
}
X
git add -A; katherine 14 "Format humidity as a whole percentage"
cat > src/display.ts <<'X'
import { formatHumidity, formatTemperature } from "./format";

export function show(celsius: number, humidity: number): string {
  return `Temperature: ${formatTemperature(celsius)}, humidity: ${formatHumidity(humidity)}`;
}
X
git add -A; katherine 14 "Show humidity beside the temperature"
git checkout -q main
GIT_AUTHOR_NAME="Grace Hopper" GIT_AUTHOR_EMAIL=grace@example.com GIT_COMMITTER_NAME="Grace Hopper" GIT_COMMITTER_EMAIL=grace@example.com \
  GIT_AUTHOR_DATE="$(day 6)" GIT_COMMITTER_DATE="$(day 6)" git merge -q --no-ff -m "Merge branch 'feature/humidity'" feature/humidity
git tag v0.2.0
git checkout -q -b feature/units
cat > src/format.ts <<'X'
export function formatTemperature(celsius: number): string {
  const fahrenheit = (celsius * 9) / 5 + 32;
  const both = `${celsius} °C`;
  const also = ` (${fahrenheit} °F)`;
  return both + also;
}

export function formatHumidity(humidity: number): string {
  return `${Math.round(humidity * 100)}%`;
}
X
git add -A; margaret 14 "Show the temperature in Fahrenheit too"
cat > src/config.ts <<'X'
export type Unit = "celsius" | "fahrenheit" | "both";

export const unit: Unit = "both";
X
git add -A; margaret 14 "Choose the unit in the config"
git checkout -q main
git checkout -q -b feature/alerts
cat > src/alerts.ts <<'X'
export function frost(celsius: number): string | null {
  return celsius < 0 ? "Frost: below zero." : null;
}
X
git add -A; grace 14 "Warn of frost below zero"
git checkout -q main
cat > src/format.ts <<'X'
export function formatTemperature(celsius: number): string {
  return `${Math.round(celsius * 10) / 10} °C`;
}

export function formatHumidity(humidity: number): string {
  return `${Math.round(humidity * 100)}%`;
}
X
git add -A; ada 13 "Round temperatures to a tenth before showing them"
cat >> README.md <<'X'

Readings refresh every minute.
X
git add -A; katherine 13 "Say how often readings refresh"
git init -q --bare -b main ../origin.git
git remote add origin ../origin.git
git push -q origin main feature/humidity feature/units feature/alerts --tags
git branch -q -u origin/main main
# A stash, then changes in the working tree.
sed -i 's/Temperature: /Temperature now: /' src/display.ts
GIT_COMMITTER_NAME="Ada Lovelace" GIT_COMMITTER_EMAIL=ada@example.com git stash push -q -m "Try a larger font"
echo "- Humidity beside the temperature." >> CHANGELOG.md
printf 'export const SCREEN = { columns: 20, rows: 4 };\n' > src/screen.ts
# A clone partway through merging origin/feature/units, conflicted in src/format.ts.
cd .. && git clone -q origin.git merging && cd merging
git config commit.gpgsign false
GIT_COMMITTER_NAME="Ada Lovelace" GIT_COMMITTER_EMAIL=ada@example.com git merge origin/feature/units >/dev/null 2>&1 || true
