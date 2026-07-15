# Common compose experience with network-specific delivery

SocialDeck will treat composing a post as a shared user experience while keeping final delivery network-specific. X and Bluesky have different authentication, limits, media handling, and send mechanisms, so a single universal post payload would hide important differences; however, users should still experience posting as one coherent SocialDeck workflow.

Each Network Adapter's Compose capability owns delivery preparation, execution, and completion planning. The application shell may inject environment operations such as Electron IPC, WebView access, token refresh, or HTTP transport, but network-specific DOM automation and post record construction remain behind the Adapter interface.

The Compose Coordinator owns orchestration across those deliveries: single-network and cross-network attempt state, retained requests, retry eligibility, and successful completion dispatch. UI handlers own presentation and confirmation only; they do not coordinate attempt, cross-post, or completion runtimes directly.
