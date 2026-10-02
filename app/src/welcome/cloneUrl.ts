/**
 * The folder name `git clone` would give a clone of `url`, as a default
 * for the user to change: the URL's last part, without `.git`. That's
 * `lanewise` for `https://github.com/adrianeyre/lanewise.git`,
 * `git@github.com:adrianeyre/lanewise.git` and `/work/lanewise/`, or `""`
 * if there's none.
 */
export function repositoryName(url: string): string {
  const path = url
    .trim()
    // An HTTPS URL's query or fragment isn't part of its path.
    .replace(/[?#].*$/, "")
    .replace(/[/\\]+$/, "")
    .replace(/\.git$/i, "")
    .replace(/[/\\]+$/, "");
  // After the last `/`, or the `:` of an SSH URL such as `host:lanewise`.
  const name = path.split(/[/\\:]/).at(-1) ?? "";
  return name === "." || name === ".." ? "" : name;
}
