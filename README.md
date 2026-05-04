# grayjay-pumpfun

GrayJay source plugin for **live** token streams on
**[pump.fun/live](https://pump.fun/live)**.

**Read-only:** public HTML and REST APIs plus HLS from `clips.pump.fun` (no wallet,
no trading).

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

## Limitations

Search and channel discovery only cover **currently live** streams from `/live`.
No VODs, no live chat in this plugin.

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
