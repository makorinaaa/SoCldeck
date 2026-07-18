# Column Shell Runtime owns common Column presentation

SocialDeck will place the common DOM representation of every Column Instance behind `Column Shell Runtime`. The Runtime owns the Column root and header, shared controls, content hosts, refresh and collapse presentation, width application, restore-error presentation, and translation of shell interactions into semantic intents. Network-specific runtimes receive content hosts from the shell and mount only their own WebView, feed, search, or schedule content.

This decision refines ADR 0005 rather than replacing it. `Column Lifecycle` continues to own Column identity, duplicate prevention, creation and restoration orchestration, refresh plans and schedules, Workspace State persistence, and teardown orchestration. It asks `Column Shell Runtime` to materialize or update presentation and remains the authoritative source for durable Column Instance state. The shell does not inspect Network Accounts, call Network Adapters, schedule refreshes, or write storage.

`renderer.js` remains the composition root. It connects shell intents such as refresh, remove, collapse, settings changes, scroll-to-top, and network-specific navigation to `Column Lifecycle` or the appropriate network runtime. Shell configuration uses explicit capabilities and slots rather than branching on X, Bluesky, or anime types. User-controlled labels and metadata are assigned as text, while only trusted application icon markup may be rendered as markup.

The public interface will center on `mount`, `update`, `setRefreshState`, `setCollapsed`, `applyWidth`, `remove`, `listIds`, and `dispose`. `mount` returns stable references to the root and declared content hosts so network runtimes do not rediscover common Column DOM by global selectors. Disposal removes shell-owned listeners and DOM but delegates network resource cleanup to `Column Lifecycle`.

Migration will start with restore-error and anime schedule Columns, continue with Bluesky Columns, and move X WebView Columns last because their back navigation and loading overlays require additional slots. Common header markup, refresh-state rendering, collapse behavior, element lookup/removal, and settings presentation will leave `renderer.js` incrementally. Unit tests will cover capability-driven controls, escaped metadata, stable hosts, state updates, intent dispatch, and disposal; a source-layout guard will prevent common shell construction from returning to `renderer.js`.

## Considered options

Keeping shell creation in `renderer.js` preserves fewer modules but leaves three duplicated headers and makes each new Column Type edit the composition root. Moving shell DOM into `Column Lifecycle` would reduce callbacks, but it would couple lifecycle state to browser presentation and make lifecycle tests require DOM behavior. Letting each Network Adapter render its whole Column keeps network code locally complete but duplicates workspace behavior and weakens the shared Column model.

## Consequences

Adding a Column Type will require a lifecycle plan, a capability-based shell description, and a network content mount instead of another complete Column template. Shell changes can be tested without authentication or network fixtures, while lifecycle tests can continue to use a fake shell. During migration, old insertion functions and the new Runtime will coexist briefly, so each migrated Column kind must have a source-layout assertion before the next kind moves.
