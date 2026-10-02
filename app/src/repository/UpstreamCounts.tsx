import { ArrowDown, ArrowUp, CircleSlash } from "lucide-react";

import type { Upstream } from "../commands/api";
import { describeUpstream } from "./remoteWords";

/**
 * How far a branch is from its Upstream: arrows up and down with the counts
 * ahead and behind, and the Upstream's name if `named`, all with a text
 * alternative in words. One that's gone from the remote says so.
 */
export function UpstreamCounts({ upstream, named }: { upstream: Upstream; named: boolean }) {
  return (
    <span className="upstream">
      <span aria-hidden="true" className="upstream-shown">
        {named && <span className="upstream-name">{upstream.name}</span>}
        {upstream.gone ? (
          <span className="upstream-count">
            <CircleSlash className="upstream-icon" />
            gone
          </span>
        ) : (
          <>
            <span className="upstream-count">
              <ArrowUp className="upstream-icon" />
              {upstream.ahead}
            </span>
            <span className="upstream-count">
              <ArrowDown className="upstream-icon" />
              {upstream.behind}
            </span>
          </>
        )}
      </span>
      <span className="visually-hidden">{describeUpstream(upstream)}</span>
    </span>
  );
}
