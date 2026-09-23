// Single source of truth for the app version shown in the UI (login screen,
// Settings, Settings > About). Previously three separate hardcoded literals
// existed and drifted out of sync (v1.0.0 on the login screen vs v1.1.0 in
// Settings) — bump this one constant instead of hunting for each usage.
export const APP_VERSION = '3.0.0'
