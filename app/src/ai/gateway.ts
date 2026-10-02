import type { CommandClient, Header } from "../commands/api";
import type { ModelProvider } from "./modelProvider";

/**
 * A `fetch` for a Model Provider with a gateway (ADR 0035): each request its
 * adapter makes to the Model Provider's own API, `https://<host>`, is made
 * by the core instead, to the gateway alone, the path kept and the gateway's
 * own headers added. The page never has the headers' values, and the
 * Desktop App's HTTP allow-list stays as it is.
 */
export function gatewayFetch(
  commands: CommandClient,
  provider: Pick<ModelProvider, "id" | "host">,
): (url: string, init?: RequestInit) => Promise<Response> {
  const origin = `https://${provider.host}`;
  return async (url, init = {}) => {
    if (url !== origin && !url.startsWith(`${origin}/`)) {
      throw new TypeError(`A request for ${provider.id} went elsewhere than its API, so it wasn't sent to its gateway.`);
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") throw new TypeError(`A gateway takes GET and POST, not ${method}.`);
    if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
      throw new TypeError("A gateway request's body is text.");
    }
    const headers: Header[] = [];
    new Headers(init.headers).forEach((value, name) => headers.push({ name, value }));
    const asking = commands.call("gatewayRequest", {
      provider: provider.id,
      path: url.slice(origin.length) || "/",
      method,
      headers,
      body: init.body ?? null,
    });
    // The core's request can't be stopped, but what it answers is let go of.
    const outcome = await (init.signal
      ? Promise.race([
          asking,
          new Promise<never>((_, reject) =>
            init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
              once: true,
            }),
          ),
        ])
      : asking);
    if (!outcome.ok) {
      const { error } = outcome;
      throw new TypeError(
        error.kind === "unreachable" ? error.message : `The gateway for ${provider.id} couldn't be used (${error.kind}).`,
      );
    }
    const answer = outcome.value;
    return new Response(answer.status === 204 ? null : answer.body, {
      status: answer.status,
      headers: answer.headers.map(({ name, value }): [string, string] => [name, value]),
    });
  };
}
