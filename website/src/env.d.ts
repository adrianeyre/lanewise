interface ImportMetaEnv {
  /**
   * The latest Release's downloads, which the deploy job hands the build
   * (`vite.config.ts`), or null before the first Release and in development.
   */
  readonly VITE_DOWNLOADS: import("./downloads.ts").Downloads | null;
}
