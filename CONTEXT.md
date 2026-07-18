# SocialDeck

SocialDeck is a desktop app for operating multiple social media accounts and columns across networks from one workspace. Its language centers on social operations: accounts, columns, posting, notifications, and cross-network workflows.

## Language

**SocialDeck**:
A multi-account, multi-column desktop app for operating social media across supported networks.
_Avoid_: TweetDeck clone, posting tool, viewer

**Column**:
A workspace unit that presents one stream, tool, or network view inside SocialDeck. Columns are common user-facing units even when their underlying network integration differs.
_Avoid_: Panel, webview, feed container

**Network Account**:
An operating identity on a supported social network. A Network Account owns posting, notifications, and account-scoped columns inside SocialDeck, regardless of how that network authenticates.
_Avoid_: Session, profile, login

**Compose Experience**:
The shared user-facing flow for preparing a post: choosing a Network Account, writing text, attaching media, and sending. Media selections, alt text, and video trim settings are Runtime State owned by the Compose Experience. The Compose Experience is common across networks, while delivery rules and payloads remain network-specific.
_Avoid_: Universal post model, X post modal, Bluesky post modal

**Compose Request**:
The posting intent confirmed by a user at send time, including the target Network Account, text, attachments, and optional reply context. It excludes network payloads, credentials, and delivery mechanics.
_Avoid_: Draft, API payload, modal state, post form

**Compose Attempt**:
The Runtime State for submitting one Compose Request, including whether delivery is idle, sending, failed, unknown, or succeeded. A failed or unconfirmed Compose Attempt retains its Compose Request; a successful or explicitly cancelled attempt releases it.
_Avoid_: Workspace State, saved draft, network payload, delivery queue

**Compose Coordinator**:
The Compose Experience boundary that owns single-network and cross-network submission state, retry eligibility, retained Compose Requests, and successful completion dispatch. UI callers ask for status and submit intents without coordinating Compose Attempts, cross-post state, and completion runtimes directly.
_Avoid_: Modal submit handler, attempt globals, posting state manager

**Network Adapter**:
A boundary that exposes one social network's capabilities to SocialDeck. A Network Adapter hides authentication and integration mechanics while presenting network capabilities such as columns, posting, notifications, search, and profile display.
_Avoid_: API client, webview helper, platform module

**Capability**:
A named ability exposed by a Network Adapter, such as Columns, Compose, Notifications, Profile, or Search. SocialDeck calls only capabilities that an adapter declares.
_Avoid_: Required method, feature flag, optional helper

**WebView-backed Network Adapter**:
A Network Adapter whose capabilities depend on an embedded network website rather than a public API. It may rely on DOM automation, Electron partitions, and page lifecycle handling, so those constraints are part of its design.
_Avoid_: Normal adapter, browser hack, X exception

**X WebView Runtime**:
The Runtime State and page lifecycle implementation behind X's WebView-backed Network Adapter. It owns visible and hidden X WebViews, account-to-partition resolution, login gating, readiness, navigation, refresh queuing during Compose delivery, and notification extraction; callers express X intents without coordinating WebView events directly.
_Avoid_: WebView helper, renderer script injection, X page globals

**Column Type**:
A named kind of Column, such as Timeline, Notifications, Search, List, Settings, or Feed. Network Adapters declare which Column Types they support.
_Avoid_: Type string, view mode, tab kind

**Column Definition**:
A Network Adapter's declaration of a Column Type it can provide, including user-facing labels and the minimum metadata needed to create that Column. The initial minimum fields are id, columnType, label, description, icon, requiresAccount, and defaultParams; rendering and refresh behavior can remain in existing implementation until later refactors.
_Avoid_: Render config, saved column, modal option

**Column Instance**:
A concrete Column in a user's workspace, created from a Column Definition and bound to any required Network Account or parameters.
_Avoid_: Column definition, modal option, DOM column

**Column Lifecycle**:
The life of a Column Instance from creation or workspace restoration through refresh and workspace changes to removal.
_Avoid_: Feed lifecycle, DOM lifecycle, render cycle

**Column Shell Runtime**:
The presentation boundary that materializes a Column Instance as common workspace DOM. It owns the Column root, header, shared controls, content hosts, refresh presentation, collapse presentation, and translation of shell interactions into semantic intents; it does not own Column identity, persistence, refresh scheduling, or network content.
_Avoid_: Column Lifecycle, Network Adapter, feed renderer, DOM column

**Workspace State**:
The durable state needed to restore a user's SocialDeck workspace, such as Network Accounts, Column layout, and user preferences.
_Avoid_: Runtime state, localStorage blob, session

**Runtime State**:
The temporary state that only exists while SocialDeck is running, such as timers, queues, hover cards, in-progress posting, and DOM coordination.
_Avoid_: Workspace state, saved state, preferences

**Mute Rules**:
User-managed words and Network Account handles that suppress matching posts and notifications. Mute Rules own persistence and matching across original posts, repost attribution, quoted posts, and notification authors; their settings UI only edits the rules through this interface.
_Avoid_: NG data, filter arrays, renderer globals
