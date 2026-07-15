# Common compose experience with network-specific delivery

SocialDeck will treat composing a post as a shared user experience while keeping final delivery network-specific. X and Bluesky have different authentication, limits, media handling, and send mechanisms, so a single universal post payload would hide important differences; however, users should still experience posting as one coherent SocialDeck workflow.

Each Network Adapter's Compose capability owns delivery preparation, execution, and completion planning. The application shell may inject environment operations such as Electron IPC, WebView access, token refresh, or HTTP transport, but network-specific DOM automation and post record construction remain behind the Adapter interface.
