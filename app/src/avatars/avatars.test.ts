import { expect, test } from "vitest";

import { AVATAR_HOST, avatarUrl, isGitHubRemote } from "./avatars";

test("a picture comes from GitHub's avatars, by user ID for a no-reply address, or else by email", () => {
  expect(avatarUrl("21265837+adrianeyre@users.noreply.github.com")).toBe(`${AVATAR_HOST}/u/21265837?s=64`);
  expect(avatarUrl(" Adrian.Eyre@Hotmail.co.uk ")).toBe(`${AVATAR_HOST}/u/e?email=adrian.eyre%40hotmail.co.uk&s=64`);
  expect(avatarUrl("a+b@example.com")).toBe(`${AVATAR_HOST}/u/e?email=a%2Bb%40example.com&s=64`);
});

test("only a remote on GitHub.com, by HTTPS or SSH, is a GitHub repository", () => {
  expect(isGitHubRemote("https://github.com/adrianeyre/lanewise.git")).toBe(true);
  expect(isGitHubRemote("git@github.com:adrianeyre/lanewise.git")).toBe(true);
  expect(isGitHubRemote("ssh://git@github.com/adrianeyre/lanewise")).toBe(true);
  expect(isGitHubRemote("https://github.example.com/team/repo")).toBe(false);
  expect(isGitHubRemote("https://gitlab.com/github.com/repo")).toBe(false);
  expect(isGitHubRemote(null)).toBe(false);
});
