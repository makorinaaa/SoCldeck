# Notification Center Runtime owns the unified notification experience

SocialDeck places unified X and Bluesky notification state behind `Notification Center Runtime`. The Runtime owns parallel loading, normalization, sorting, network and reason filters, unread filtering, partial source failures, activation, mark-all-read behavior, stale-response protection, and disposal.

The Runtime receives notification sources and semantic navigation intents. It does not receive Bluesky tokens, inspect Column DOM, or create application Columns itself. Its DOM view renders immutable snapshots and handles the modal through delegated events, so notification markup does not depend on global functions or inline event handlers.

`renderer.js` remains the composition root. It connects the authenticated Bluesky adapter, the X WebView reader, account state, toast output, and application navigation intents. Opening a Bluesky post or profile and reusing an X Notifications Column remain application-level decisions outside the Runtime.

Public-interface tests cover loading both networks, filtering without refetching, semantic activation, mark-all-read, and DOM rendering. A source-layout guard prevents notification state arrays and rendering functions from returning to `renderer.js`.
