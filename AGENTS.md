# Agent notes: maintaining the Pump.fun GrayJay plugin

This file summarizes what matters when
**[pump.fun/live](https://pump.fun/live)** or upstream APIs change. For
GrayJay’s plugin model (config, `http`, signing, content types, examples), use
**[plugin-development.md](https://gitlab.futo.org/videostreaming/grayjay/-/blob/master/plugin-development.md)**
and the docs it links from there.

## What the plugin does

- **Home / search / searchChannels:** driven by HTML from `GET
  https://pump.fun/live`. Live rows are **not** from a stable public JSON API;
  they are embedded in the page (Next.js / RSC-style payloads with escaped
  quotes).
- **Video details:** `GET https://frontend-api-v3.pump.fun/coins/<mint>` plus
  `GET https://pump.fun/coin/<mint>` HTML to resolve **HLS** URLs
  (`clips.pump.fun`, `master_playlist_*.m3u8`, fallbacks `*_N_live.m3u8`).
- **Channels:** `https://pump.fun/profile/<wallet>` → user API
  `.../users/<address>`; channel feed uses `.../coins?creator=<address>`
  filtered by **`is_currently_live`**, enriched from cached `/live` rows when
  mints match.

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

1. **`/live` HTML shape** — If the embedded JSON no longer contains
   `\"isLive\":true` (or equivalent) or objects no longer include `mint`,
   `title`, `playlistUrl`, `creator`, etc., update
   **`extractLivestreamsFromHtml`** (and keep dedupe by `mint`). Re-test using
   saved HTML samples and GrayJay’s plugin **Testing** tab where possible.
2. **Coin page HLS** — If playlist URLs move hosts or filename patterns change,
   update **`extractHlsUrlsFromCoinHtml`** regexes and fallbacks.
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

Use the **`http`** package (**`http.GET`**, **`http.batch()`**) as described
there. For **`PlatformVideoDetails`**, live HLS, and `VideoSourceDescriptor`,
follow the **Content types** (and related) documentation linked from that guide.

## Regression checks

- In GrayJay: load the plugin, open home, open a coin, confirm HLS playback;
  try a profile URL and search while streams are live.
- After parser changes, compare behavior against freshly saved `/live` and
  `/coin/<mint>` HTML if needed.

## Product scope (do not “fix” as bugs)

- Search / channel search only see **currently live** creators and tokens (no
  global user index in this plugin).
- No VODs, no comments/chat unless you add WebSocket support and GrayJay support
  for it.

When extending scope, prefer explicit product decisions over silently widening
what the plugin claims to support.
