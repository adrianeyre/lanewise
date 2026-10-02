import { expect, test } from "vitest";

import { checkLatestVersion, compareVersions, LATEST_PACKAGE_URL } from "./latestVersion";

const answering = (body: unknown, status = 200) => {
  const asked: string[] = [];
  return {
    asked,
    platform: {
      fetch: async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify(body), { status });
      },
    },
  };
};

test("versions compare part by part, a pre-release before its release", () => {
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("1.2.3", "1.10.0")).toBe(-1);
  expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  expect(compareVersions("1.1.0-rc.1", "1.1.0")).toBe(-1);
  expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
});

test("the version running is compared with main's package.json, asked for alone", async () => {
  const older = answering({ name: "lanewise", version: "1.4.0" });
  expect(await checkLatestVersion(older.platform, "1.3.2")).toEqual({ kind: "outOfDate", running: "1.3.2", latest: "1.4.0" });
  expect(older.asked).toEqual([LATEST_PACKAGE_URL]);

  const same = answering({ version: "1.4.0" });
  expect(await checkLatestVersion(same.platform, "1.4.0")).toEqual({ kind: "current", running: "1.4.0", latest: "1.4.0" });
});

test("an answer that isn't a version, or no answer, says why", async () => {
  expect(await checkLatestVersion(answering({}, 200).platform, "1.0.0")).toMatchObject({
    kind: "failed",
    problem: "Its package.json has no version.",
  });
  expect(await checkLatestVersion(answering({}, 404).platform, "1.0.0")).toMatchObject({
    kind: "failed",
    problem: "GitHub answered 404.",
  });
  const offline = { fetch: () => Promise.reject(new TypeError("offline")) };
  expect(await checkLatestVersion(offline, "1.0.0")).toMatchObject({ kind: "failed" });
});
