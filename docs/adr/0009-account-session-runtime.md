# Account Session Runtime owns authentication lifecycle and account presentation

SocialDeck places X and Bluesky account authentication, persisted account state transitions, and account presentation behind `Account Session Runtime`. The Runtime owns login, per-account logout, logout-all state reset, session synchronization, settings visibility, busy and error state, and snapshots used by the login screen, navigation chips, sidebar avatars, and account menu.

The Runtime exposes `start`, `openSettings`, `refresh`, `getSnapshot`, `login`, `logout`, `logoutAll`, and `dispose`. Its delegated DOM view translates account actions into semantic handlers and renders account snapshots without inline event handlers. Overlapping mutations and mutations after disposal are ignored so one user action cannot create duplicate accounts or race session cleanup.

Electron session primitives, Bluesky API calls, state persistence, and host application effects are injected dependencies. `renderer.js` remains the composition root and handles only application-level intents such as entering the workspace, rebuilding columns after an account change, clearing notification state, and resetting the workspace after logout-all.

X WebView login parking and Electron partition ownership remain in their existing runtimes. They are lower-level session mechanisms and do not own account state or account UI.

Unit tests cover the public lifecycle, persisted startup, X and Bluesky login, validation, profile enrichment, per-network logout, logout-all preservation rules, concurrent-operation guards, disposal, and delegated DOM rendering. A source-layout guard keeps authentication lifecycle and account presentation from returning to `renderer.js` or inline login markup.
