# Desktop Notification Runtime owns notification rules and delivery decisions

SocialDeck places desktop notification preferences, polling, rule matching, baselining, and deduplication behind `Desktop Notification Runtime`. Rules can select X or Bluesky, notification reasons, specific users, keywords, and whether notifications are limited to times when the application is not focused.

The Runtime reuses normalized items from `Notification Center Runtime`. Its first successful read establishes a baseline and never emits old notifications. Every later item is recorded as known even when it does not match the current rules, preventing old items from replaying after a rule change. Account changes explicitly request a new baseline so adding an account cannot display its notification history in bulk.

Native operating system delivery remains in the Electron main process behind `Desktop Notification Service`. IPC payloads contain only a bounded key, title, and body. Clicking a native notification restores and focuses the main window, then returns the opaque key to the renderer. The Runtime maps that key back to the normalized item and uses the existing notification navigation intents.

Rules and deduplication state use their own local storage record and survive application restarts independently from account logout. Desktop notifications are disabled by default.

Unit tests cover normalization, all rule dimensions, focus behavior, baseline and replay prevention, persistence, account rebaselining, activation, native payload validation, and window restoration. Electron E2E covers settings interaction and persistence. A source-layout guard keeps rule state and settings events out of `renderer.js` and inline markup.
