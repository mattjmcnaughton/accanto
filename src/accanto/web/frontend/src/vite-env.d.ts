/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The deployed commit, set by scripts/box-build.sh; "dev" without it. */
  readonly VITE_BUILD_SHA?: string;
}
