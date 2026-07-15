# Column Lifecycle owns Column Instance state

SocialDeck will place creation, workspace restoration, refresh registration, layout restoration, workspace persistence, and removal cleanup behind a Column Lifecycle module. The module owns the common Column shell and lifecycle state, while Network Adapters render network-specific content and execute network-specific refresh behavior.

Every Column Instance, including parameterized dynamic columns, will be created from a Column Definition. Known legacy Workspace State will be normalized during restoration and saved only after every Column restores successfully. A failed Column will show an isolated error while the remaining Columns continue restoring, and the original Workspace State will remain unchanged.

The migration will begin with workspace restoration as a tracer, followed by creation, removal, persistence, and finally the remaining X and Bluesky-specific paths. Tests will exercise the public Column Lifecycle interface with fake Network Adapters.

Column Lifecycle also owns Column identity, duplicate prevention, refresh-all selection, and teardown of registered refresh and Runtime State. A Network Adapter's runtime mounts and refreshes network-specific content, while UI commands call the lifecycle interface instead of discovering Column buttons or reloading embedded pages directly.
