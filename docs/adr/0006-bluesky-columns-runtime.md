# Bluesky Columns Runtime owns API-backed Column behavior

SocialDeck places Timeline, custom Feed, Search, and Notifications Column behavior behind `Bluesky Columns Runtime`. The Runtime owns authenticated reads, rendering, delegated DOM events, pagination, differential refresh, optimistic reaction updates, rollback, post detail overlays, profile previews, and disposal.

The Runtime receives an authenticated Bluesky adapter instead of access or refresh tokens. The adapter owns token refresh and Network Account identity for writes. Runtime methods and intents use semantic objects, so rendered elements and callers never handle JWT values.

`renderer.js` remains the composition root. It mounts and refreshes Columns through the Runtime, translates semantic outcomes into toasts, and handles application-level intents such as opening Compose, the lightbox, a reusable Profile WebView, and the post context menu. Column Lifecycle remains responsible for Column identity, refresh scheduling, workspace persistence, and teardown orchestration.

Profile and Post WebView Columns are outside this Runtime because they are browser-backed navigation surfaces. The notification center modal and Compose Experience are also separate application features, even when they use the same authenticated Bluesky client.

Timeline, Feed, and Notifications Columns retain at most 300 rendered post or notification elements. Prepending new items removes the oldest elements from the end; appending older pages removes elements from the start and compensates the scroll position. This bounds long-session DOM and media retention without interrupting the currently viewed region.

The migration used Timeline as the tracer, followed by Feed, Search, Notifications, and interactions. Public-interface tests cover mount, refresh modes, disposal, stale responses, delegated events, optimistic rollback, and authenticated adapter calls. A source-layout guard prevents the removed renderer implementations from returning.
