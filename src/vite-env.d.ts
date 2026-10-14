/// <reference types="vite/client" />

declare module "*.txt?raw" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** Commit SHA the bundle was built from; injected by CI, absent locally. */
  readonly VITE_BUILD_COMMIT?: string;
  /** ISO timestamp of the build; injected by CI, absent locally. */
  readonly VITE_BUILD_TIME?: string;
}
