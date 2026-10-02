import { expect, test } from "vitest";

import { parseEnterpriseHost, parseEnterpriseHosts } from "./enterpriseHosts";

test("a GitHub Enterprise Server is added by its address, with or without https://, and a page on it", () => {
  const addresses = [
    "https://github.example.com",
    "github.example.com",
    "  HTTPS://GitHub.Example.com/  ",
    "https://github.example.com/octo-org/octo-repo",
    "https://github.example.com:443",
    "github.example.com.",
  ];
  expect(addresses.map((address) => parseEnterpriseHost(address))).toEqual(
    addresses.map(() => ({ ok: true, host: "github.example.com" })),
  );
  expect(parseEnterpriseHost("https://ghe.example.com:8443/")).toEqual({ ok: true, host: "ghe.example.com:8443" });
});

function problem(address: string, added: string[] = []): string | null {
  const parsed = parseEnterpriseHost(address, added);
  return parsed.ok ? null : parsed.problem;
}

test("an address that isn't a GitHub Enterprise Server's says why", () => {
  expect(problem("  ")).toMatch(/^Enter the address/);
  expect(problem("http://github.example.com")).toMatch(/over HTTPS only/);
  expect(problem("ssh://git@github.example.com")).toMatch(/over HTTPS only/);
  expect(problem("https://me:secret@github.example.com")).toMatch(/Leave the user name and password out/);
  expect(problem("https://github.com")).toMatch(/GitHub\.com is always there/);
  expect(problem("api.github.com")).toMatch(/GitHub\.com is always there/);
  expect(problem("https://[::1]")).toMatch(/isn't an address/);
  expect(problem("github example com")).toMatch(/isn't an address/);
  expect(problem("github.example.com", ["github.example.com"])).toBe("github.example.com has been added already.");
});

test("the Hosts kept are read back, and anything else kept is left out", () => {
  expect(parseEnterpriseHosts(null)).toEqual([]);
  expect(parseEnterpriseHosts("not json")).toEqual([]);
  expect(parseEnterpriseHosts('{"host": "github.example.com"}')).toEqual([]);
  expect(
    parseEnterpriseHosts(
      JSON.stringify(["github.example.com", "ghe.example.com:8443", 7, "http://x", "github.com", "github.example.com"]),
    ),
  ).toEqual(["github.example.com", "ghe.example.com:8443"]);
});
