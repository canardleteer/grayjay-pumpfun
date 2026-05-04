# grayjay-pumpfun (experimental)

GrayJay source plugin for **live** token streams on **[pump.fun](https://pump.fun)**.

**Read-only:** public HTML (coin pages for HLS where needed) and REST APIs plus
HLS from `clips.pump.fun` (no wallet, no trading).

**Disclaimer:** This plugin is **not affiliated with, endorsed by, or sponsored
by** [pump.fun](https://pump.fun) or its operators. It is an independent GrayJay
source that reads their public pages and APIs only.

## Install

1. Install **GrayJay** from [grayjay.app](https://grayjay.app/).
2. Open **Sources** (or your app’s equivalent) and **add a new source**.
3. Paste the **HTTPS URL to the published `PumpFunConfig.json`**, or scan a **QR
   code** from the maintainer that points at that same URL. GrayJay fetches the
   manifest, then loads the script and icon from the URLs in `scriptUrl` and
   `iconUrl`.

For installs from **raw.githubusercontent.com**, this repo uses **absolute**
`scriptUrl` / `iconUrl` / `sourceUrl` in [`PumpFunConfig.json`](PumpFunConfig.json)
so GrayJay does not depend on resolving `./`-relative paths against the config
URL (which can trigger a **“script not available” / 404** on some builds).
`repositoryUrl` remains the GitHub repo page for humans.

How distribution and QR codes work in GrayJay is described under **Plugin
Deployment** in
[plugin-development.md](https://gitlab.futo.org/videostreaming/grayjay/-/blob/master/plugin-development.md#plugin-deployment).

**Install QR** (encodes the published manifest URL on the default branch):

`https://raw.githubusercontent.com/canardleteer/grayjay-pumpfun/main/PumpFunConfig.json`

![QR code to add this source in GrayJay](images/qrcode.png)

## Subscriptions and channel feeds

You can **subscribe** to a creator in GrayJay using their
**`https://pump.fun/profile/<wallet>`** URL. The channel feed lists **all** of
that wallet’s coins from the public API (live first, then newest by creation
time), with **pagination** (`limit` / `offset`), so the feed stays useful even
when nothing is live.

## Recorded / historical video

If pump.fun leaves **non-live** HLS manifests on a coin page (e.g.
`master_playlist` or other `.m3u8` under `clips.pump.fun` that are not `_live`
playlists), the plugin will try to play them as **recorded** streams.
**Recorded VOD only exists when those playlist URLs appear in the public coin HTML**
the app fetches; there is no separate authenticated clips API in this plugin.
There is **no** separate public `clips-api` host in use (it did not resolve in
testing).

## Limitations

- **Search** and **search channels** still only reflect **currently live** rows
  from **`GET https://frontend-api-v3.pump.fun/coins/currently-live`** (no global
  pump.fun user index).
- **Live chat** for **live** coins uses GrayJay’s live-event overlay
  (`getLiveEvents`): Socket.IO to `livechat.pump.fun` (same protocol as the
  website).
- **`getComments`** also receives a live stream of `PlatformComment` rows for
  live coins (shared backend with the overlay). If GrayJay’s **embedded live chat
  window** is enabled, **`getLiveChatWindow`** loads the same coin page in a
  WebView (native pump.fun UI).
- **`getContentRecommendations`** lists other coins from the **same creator**
  (public `…/coins?creator=…`). Chat is read-only and may break if pump.fun
  changes their socket protocol.
- **`getUserSubscriptions`** returns an empty list — pump.fun login is not part
  of this plugin; subscriptions are whatever channel URLs GrayJay stores when you
  add or subscribe to a profile.

## Links

- **GrayJay plugin authoring** —
  [plugin-development.md](https://gitlab.futo.org/videostreaming/grayjay/-/blob/master/plugin-development.md)
  (config, packages, signing, deployment; links to related docs)
- **GrayJay app** — [https://grayjay.app/](https://grayjay.app/)
- **Live directory** — [https://pump.fun/live](https://pump.fun/live)

## Layout

| File | Purpose |
|------|---------|
| [`PumpFunConfig.json`](PumpFunConfig.json) | Plugin manifest (`allowUrls`, `packages`, `id`, `version`, `iconUrl`, signing fields) |
| [`PumpFunScript.js`](PumpFunScript.js) | `source.*` implementation |
| [`images/pumpfun-icon.png`](images/pumpfun-icon.png) | Source icon (from pump.fun site artwork; see disclaimer above) |
| [`images/qrcode.png`](images/qrcode.png) | QR for the default raw GitHub manifest URL |
| [`AGENTS.md`](AGENTS.md) | Maintainer notes when pump.fun or GrayJay behavior changes |
