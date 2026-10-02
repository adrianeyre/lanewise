import { expect, test } from "vitest";

import type { CommandClient, GatewayRequestRequest } from "../commands/api";
import { gatewayFetch } from "./gateway";

function core(answer = { status: 200, headers: [{ name: "content-type", value: "application/json" }], body: '{"ok":true}' }) {
  const sent: GatewayRequestRequest[] = [];
  const commands = {
    call: async (name: string, request: GatewayRequestRequest) => {
      expect(name).toBe("gatewayRequest");
      sent.push(request);
      return { ok: true, value: answer };
    },
  } as unknown as CommandClient;
  return { commands, sent };
}

const anthropic = { id: "anthropic", host: "api.anthropic.com" };

test("a request to the Model Provider's API is sent by the core to its gateway, its path, headers and body kept", async () => {
  const { commands, sent } = core();
  const fetch = gatewayFetch(commands, anthropic);

  const response = await fetch("https://api.anthropic.com/v1/messages?beta=true", {
    method: "POST",
    headers: { "x-api-key": "key", "anthropic-version": "2023-06-01" },
    body: '{"model":"m"}',
  });

  expect(sent).toEqual([
    {
      provider: "anthropic",
      path: "/v1/messages?beta=true",
      method: "POST",
      headers: [
        { name: "anthropic-version", value: "2023-06-01" },
        { name: "x-api-key", value: "key" },
      ],
      body: '{"model":"m"}',
    },
  ]);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual({ ok: true });
});

test("a request anywhere else, or of another method, is never sent", async () => {
  const { commands, sent } = core();
  const fetch = gatewayFetch(commands, anthropic);

  await expect(fetch("https://api.anthropic.com.evil.example/v1/messages")).rejects.toThrow(/went elsewhere/);
  await expect(fetch("https://api.anthropic.com/v1/x", { method: "DELETE" })).rejects.toThrow(/GET and POST/);
  expect(sent).toEqual([]);
});
