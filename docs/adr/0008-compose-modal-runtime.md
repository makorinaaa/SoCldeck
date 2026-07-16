# Compose Modal Runtime owns Compose presentation state

SocialDeck places X and Bluesky Compose modal presentation behind `Compose Modal Runtime`. The Runtime owns opening and closing, selected accounts, text, reply context, cross-post preferences, preview visibility, busy and retry presentation, and attachment interactions.

The Runtime exposes `open`, `close`, `setBusy`, `getSnapshot`, and `dispose`. Its DOM view renders snapshots and translates delegated DOM events into semantic handlers. Compose markup therefore has no inline handlers, while attachment inputs keep focus because unchanged media lists are not rebuilt during ALT text edits.

Network delivery remains outside this Runtime. `renderer.js` is the composition root and connects submit intents to the existing Compose Coordinator and Network Adapters. Media validation and mutation remain owned by the network Media Drafts.

Unit tests cover the public lifecycle, account and cross-post state, replies, media actions, video trimming, busy state, disposal, and delegated DOM rendering. A source-layout guard keeps modal event and presentation code from returning to `renderer.js` or `index.html`.
