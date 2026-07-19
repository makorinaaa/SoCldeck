# Compose Modal Runtime owns Compose presentation state

SocialDeck places X and Bluesky Compose modal presentation behind `Compose Modal Runtime`. The Runtime owns opening and closing, selected accounts, text, reply context, cross-post preferences, preview visibility, busy and retry presentation, and attachment interactions.

The Runtime exposes `open`, `close`, `setBusy`, `getSnapshot`, and `dispose`. Its DOM view renders snapshots and translates delegated DOM events into semantic handlers. Compose markup therefore has no inline handlers, while attachment inputs keep focus because unchanged media lists are not rebuilt during ALT text edits.

Network delivery remains outside this Runtime. `renderer.js` is the composition root and connects submit intents to `Compose Submission`, which owns submit orchestration for single posts and cross-posts: request construction, video length gates, unknown-outcome retry confirmation, busy and retry presentation transitions, and target wiring into the Compose Coordinator and Network Adapters. Media validation and mutation remain owned by the network Media Drafts.

Video trimming uses one shared timeline presentation for both networks. The Media Draft owns precise IN and OUT values, while the DOM View owns seeking, selected-range preview, frame thumbnails, and direct time editing. Cross-network attachment mapping is isolated behind `Compose Cross-post Plan`, which derives both network deliveries and preserves one selected video range without moving delivery mechanics into the modal.

Unit tests cover the public lifecycle, account and cross-post state, replies, media actions, video trimming, busy state, disposal, and delegated DOM rendering. A source-layout guard keeps modal event and presentation code from returning to `renderer.js` or `index.html`.
