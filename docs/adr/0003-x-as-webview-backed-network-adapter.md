# X as a WebView-backed network adapter

SocialDeck will model X as a Network Adapter, but specifically as a WebView-backed Network Adapter. This keeps X inside the same capability boundary as other networks while making its real constraints explicit: DOM automation, Electron partition sessions, page lifecycle behavior, and sensitivity to X website changes.

The X WebView Runtime owns the host-side page lifecycle for both visible Columns and hidden notification readers: account-to-partition resolution, login gating, readiness, navigation, refresh queuing during Compose delivery, and failure recovery. X page DOM behavior is installed by the WebView preload rather than repeatedly injected from the application renderer. Network Adapter callers request Compose, Column refresh, or notification operations without coordinating WebView events themselves.

Hidden notification readers are transient for Notification Center reads and remain mounted only while desktop notification polling is enabled. They use background throttling, are replaced by a visible Notifications Column whenever possible, and are disposed when desktop notifications are disabled or their Network Account disappears. Silent fallback reloads use a lightweight solid overlay instead of retaining a Base64 page capture.
