interface ImportMetaEnv {
  /** The build's version, from the repository's `package.json`. */
  readonly VITE_APP_VERSION: string;
  /** Lanewise's author, from the repository's `package.json`. */
  readonly VITE_APP_AUTHOR: string;
}

/** The bundled npm packages and crates and their licences, collected when the UI is built (`scripts/credits.ts`). */
declare module "virtual:credits" {
  const credits: import("../scripts/credits.ts").Credits;
  export default credits;
}
