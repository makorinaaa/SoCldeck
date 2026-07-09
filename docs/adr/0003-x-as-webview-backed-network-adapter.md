# X as a WebView-backed network adapter

SocialDeck will model X as a Network Adapter, but specifically as a WebView-backed Network Adapter. This keeps X inside the same capability boundary as other networks while making its real constraints explicit: DOM automation, Electron partition sessions, page lifecycle behavior, and sensitivity to X website changes.
