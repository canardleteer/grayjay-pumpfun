# Agent notes: maintaining the Pump.fun GrayJay plugin

This file summarizes what matters when
**[pump.fun](https://pump.fun)** live APIs or upstream HTML change. For
GrayJay’s plugin model (config, `http`, signing, content types, examples), use
**[plugin-development.md](https://gitlab.futo.org/videostreaming/grayjay/-/blob/master/plugin-development.md)**
and the docs it links from there.

**Unofficial API catalog:** [BankkRoll/pumpfun-apis](https://github.com/BankkRoll/pumpfun-apis)
(at commit [`65bc328c8c94399eda7a9d578070c3429c57e715`](https://github.com/BankkRoll/pumpfun-apis/commit/65bc328c8c94399eda7a9d578070c3429c57e715))
can be **useful orientation** (paths, field names, OpenAPI sketches). It is
**not authoritative**, is unrelated to this plugin’s maintainers, and **must
not** be used to justify new network targets: only adopt hosts that match
**`*.pump.fun`** or **`pump.fun`** (same rule as `allowUrls` and any `http` /
`http.socket` URLs). Ignore or strip example URLs, “discovered” hosts, and
README links that fall outside those domains.

## Product philosophy (GrayJay vs implementation)

The **feature set we want from GrayJay** (home feed, coin playback, live chat,
comments, channels, search, and any future surfaces the app exposes) is the
**primary product goal**. The **current implementation**—which public
`*.pump.fun` endpoints we call, HTML we scrape, Socket.IO wiring, and which
`source.*` hooks we implement—is **deliberately provisional**: expect to
**replace or refine** it when a **better** path delivers the **same** (or better)
user-visible behavior. When reviewing changes or the unofficial API
catalog, judge ideas by **fit to GrayJay outcomes first**, then by whether they
simplify or harden the plumbing.

## What the plugin does

- **Home / search / searchChannels:** driven by `GET
  https://frontend-api-v3.pump.fun/coins/currently-live` (JSON). The
  **[`/live`](https://pump.fun/live)** page is **not** treated as the source of
  truth for “who is live”: it can surface **clips / promos** and other UI rows
  that are not the same set as **`is_currently_live`** on the API.
- **Video details:** `GET https://frontend-api-v3.pump.fun/coins/<mint>` plus
  `GET https://pump.fun/coin/<mint>` HTML to resolve **HLS** URLs
  (`clips.pump.fun`, `master_playlist_*.m3u8`, fallbacks `*_N_live.m3u8`).
- **Channels:** `https://pump.fun/profile/<wallet>` → user API
  `.../users/<address>`; **`getChannelVideos`** lists **all** coins from
  `.../coins?creator=<address>&limit=50&offset=…` (paginated `VideoPager`), sorted
  **live first** then by `created_timestamp`, enriched from the cached
  **`/coins/currently-live`** row when the mint is live. **`getUserSubscriptions`**
  returns `[]` (no pump.fun auth).

## Where to edit

- **All runtime logic:** [`PumpFunScript.js`](PumpFunScript.js) (repo root)
- **Branding assets:** [`images/pumpfun-icon.png`](images/pumpfun-icon.png) (site
  icon) and [`images/qrcode.png`](images/qrcode.png) — keep in sync with
  [`PumpFunConfig.json`](PumpFunConfig.json) `iconUrl` and the install URL you
  encode in the QR.
- **Network allowlist:** [`PumpFunConfig.json`](PumpFunConfig.json) `allowUrls`
  — GrayJay matches **hostnames** (e.g. `pump.fun`, `clips.pump.fun`), not
  `https://host/path/*`. Add entries if assets move to new hosts (IPFS gateways,
  CDNs, etc.).

## Likely breakage when pump.fun evolves

1. **`/coins/currently-live`** — If the route, array shape, or field names change
   (`mint`, `is_currently_live`, `livestream_title`, `num_participants`, etc.),
   update **`getLiveBundle`** / **`mapLiveRowToPlatformVideo`** / search string
   matching. Re-test with GrayJay’s plugin **Testing** tab and a saved JSON
   sample if needed.
2. **Coin page HLS** — If playlist URLs move hosts or filename patterns change,
   update **`extractHlsUrlsFromCoinHtml`** (live `_N_live`, `master_playlist`, and
   any other `clips.pump.fun` `.m3u8` treated as a recorded fallback) and
   **`pickLiveHlsPlaylist` / `pickRecordedHlsPlaylist`**. On **GrayJay
   Desktop**, **`SourceAuto`** may use **`VideoSourceDescriptor`** and/or
   **`PlatformVideoDetails.Live`**. The **YouTube** plugin sets **`hls`**,
   **`live`**, and **`video: VideoSourceDescriptor([HLSSource])`** together for
   live HLS. This script mirrors that for all pump.fun HLS; **`isLive`** still
   reflects the API for UI/chat.
3. **`frontend-api-v3`** — Field renames (`creator`, `image_uri`,
   `is_currently_live`, timestamps) or path changes require updates in mapping
   helpers and URLs. Prefer **`encodeURIComponent`** on path segments for mints
   and wallet addresses.
4. **New asset domains** — Thumbnails or metadata may reference hosts not in
   `allowUrls`; extend the manifest and retest in GrayJay.

## GrayJay API surface (naming)

The script defines **both** the current-style methods (`isVideoDetailsUrl`,
`getVideoDetails`, `getChannelVideos`, `searchChannelVideos`,
`getSearchChannelVideoCapabilities`) **and** legacy aliases
(`isContentDetailsUrl`, `getContentDetails`, `getChannelContents`,
`searchChannelContents`, `getSearchChannelContentsCapabilities`). Many builds
still invoke the legacy names; without aliases, the app can show **“No source
enabled to support this video”** for pump.fun URLs. Align any new `source.*`
methods with the **Source** interface described in GrayJay’s docs from
[plugin-development.md](https://gitlab.futo.org/videostreaming/grayjay/-/blob/master/plugin-development.md).
On **GrayJay Desktop**, built-in pagers such as **`LiveEventPager`**,
**`CommentPager`**, and **`VideoPager`** are **ES6 classes**: do **not**
subclass them with `Parent.call(this, …)` or `Object.create(Parent.prototype)`
— use **`new Parent(…)`** and assign **`nextPage`** on the instance (see
**`makePumpFunLiveEventPager`** / **`makePumpFunCommentPager`** /
**`makePumpFunChannelCoinsPager`** in the script).

Use the **`http`** package (**`http.GET`**, **`http.batch()`**) as described
there. For **`PlatformVideoDetails`**, live HLS, and `VideoSourceDescriptor`,
follow the **Content types** (and related) documentation linked from that guide.

## Bearer-free API spike (maintenance)

Occasionally re-check candidate **`*.pump.fun`** GETs **without** `Authorization`
before adding hosts or calls. Use **~10 s between probes** with **random ±5 s**
jitter so traffic stays light. **Do not** treat the unofficial catalog or
`advanced-api-v2` “Hello World” roots as product APIs without a real path and
response body check.

**Snapshot (no Bearer, `User-Agent: GrayJay-PumpFun/1`):** `GET
…/coins/currently-live`, `…/coins/<mint>`, `…/users/<wallet>`,
`…/coins?creator=<wallet>&limit=…` → **200** JSON. Probed **`profile-api`** and
**`livestream-api`** guess paths → **404** JSON (not used). **`market-api`** may
fail DNS from some networks. **`volatility-api-v2`** root returned **530**
(ignore). **`advanced-api-v2`** `/` returned **200** text `Hello World!` (no
plugin use until a real public JSON path is confirmed the same way).

## Regression checks

- In GrayJay: load the plugin, open home, open a coin, confirm HLS playback;
  try a profile URL and search while streams are live.
- **Live chat:** on a **live** coin, confirm the live-chat overlay receives
  messages; optionally open the comments tab for the same coin (both paths
  share one Socket.IO engine per mint). With GrayJay’s **embedded chat window**
  enabled, confirm **`getLiveChatWindow`** loads the coin page. Re-test on
  **Android** if possible (WebSocket behavior can differ by build).
- **Recommendations:** on a coin with a creator who has multiple coins,
  confirm **`getContentRecommendations`** shows other mints from
  **`…/coins?creator=…`**.
- **Offline VOD:** spot-check `/coin/<mint>` HTML for non-live coins: some have
  **no** `clips.pump.fun` `.m3u8` in the page (plugin will show the existing “no
  recorded stream URL” copy); others expose `master_playlist` or non-live
  `.m3u8` and should play as recorded.
- After live-list changes, compare against a freshly saved
  **`/coins/currently-live`** response; for playback, keep checking
  **`/coin/<mint>`** HTML when HLS extraction changes.

## Product scope (do not “fix” as bugs)

- **Search / searchChannels** only see **currently live** creators from
  **`/coins/currently-live`** (no global user index).
- **Recorded clips** only appear when URLs exist in **public coin HTML**; there
  is no dependency on a separate clips API unless you add one that is public
  and stable.
- **Live chat (live coins only):** `source.getLiveEvents` and
  `source.getComments` share a per-mint **`PumpFunChatEngine`** (`chatEngines`
  map) using **`http.socket`** to
  `wss://livechat.pump.fun/socket.io/?EIO=4&transport=websocket` with Engine.IO
  / Socket.IO text frames (`40`, `42["joinRoom",…]`,
  `420["getMessageHistory",…]`, etc.). Incoming `newMessage` and
  `viewerCount` map to **`LiveEventComment`** / **`LiveEventViewCount`** and
  **`PlatformComment`**. **`source.disable`** calls **`disposeAllChatEngines()`**
  to close sockets. **`allowUrls`** must include **`livechat.pump.fun`**. If
  pump.fun changes packet shapes, update **`handleEngineText`** /
  **`parseSocketIOPayload`**. **`source.getLiveChatWindow`** returns the coin
  **`https://pump.fun/coin/<mint>`** URL for GrayJay’s embedded WebView when the
  user enables that mode (optional alternative to overlay chat).
- **Recommendations:** **`source.getContentRecommendations`** uses **`GET
  …/coins?creator=<wallet>`** (same creator as the open coin) and maps rows to
  **`PlatformVideo`**; it is not a global discovery feed.

When extending scope, prefer explicit product decisions over silently widening
what the plugin claims to support.
