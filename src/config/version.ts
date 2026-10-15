export const APP_VERSION = "2.16.0";
export const APP_SPRINT = "26.1";
export const APP_BUILD = "2026";
export const RELEASE_YEAR = "2026";
export const APP_RELEASE_LABEL = `Version ${APP_VERSION} · Sprint ${APP_SPRINT} · Build ${APP_BUILD}`;

// Injected at build time by CI (see .github/workflows/deploy-pages.yml). Showing
// the commit in the running app is what keeps the published site from drifting
// away from the repository state without anyone noticing: the label above is a
// hand-maintained string, these two values are not.
export const APP_COMMIT = import.meta.env.VITE_BUILD_COMMIT || "local";
export const APP_COMMIT_SHORT = APP_COMMIT.slice(0, 7);
export const APP_BUILD_TIME = import.meta.env.VITE_BUILD_TIME || "";
export const APP_BUILD_DATE = APP_BUILD_TIME.slice(0, 10);
