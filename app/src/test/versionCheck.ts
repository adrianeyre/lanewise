import { LATEST_PACKAGE_URL } from "../updates/latestVersion";

/** Whether a request is Lanewise asking GitHub for the latest version, as it does as it starts. */
export const isVersionCheck = (url: string) => url === LATEST_PACKAGE_URL;

/** GitHub's answer that the version running is the latest. */
export const upToDate = () => new Response(JSON.stringify({ version: import.meta.env.VITE_APP_VERSION }));

/** The requests made, but for the version check at start, which is not about what's being tested. */
export const besidesVersionCheck = <T extends { url: string }>(requests: readonly T[]) =>
  requests.filter(({ url }) => !isVersionCheck(url));
