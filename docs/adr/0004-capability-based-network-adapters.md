# Capability-based network adapters

SocialDeck will model Network Adapters as capability-based rather than requiring every adapter to implement the same fixed interface. This lets X and Bluesky expose different abilities without filling the codebase with no-op methods or unsupported-operation errors, while still giving SocialDeck a common way to discover and call adapter features.
