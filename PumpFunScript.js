const PLATFORM = "PumpFun";

var config = {};
var BASE_URL = "https://pump.fun";
var API_URL = "https://frontend-api-v3.pump.fun";
var CLIPS_CDN = "https://clips.pump.fun";

var liveCache = { t: 0, rows: null, byMint: null };
var LIVE_CACHE_TTL_MS = 45000;

function pluginId() {
	return config && config.id ? config.id : "";
}

function httpGet(url) {
	var resp = http.GET(url, { "User-Agent": "GrayJay-PumpFun/1" }, false);
	if (!resp || !resp.isOk) {
		throw new ScriptException("HttpError", "GET failed: " + url);
	}
	return resp.body;
}

function httpGetJson(url) {
	return JSON.parse(httpGet(url));
}

function unescapeJsonString(str) {
	if (!str) return "";
	return str
		.replace(/\\"/g, '"')
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\r/g, "\r")
		.replace(/\\\\/g, "\\");
}

function extractJsonObjectAtIsLive(unescapedHtml, posIsLive) {
	var depth = 0;
	var i = posIsLive;
	for (; i >= 0; i--) {
		var ch = unescapedHtml.charAt(i);
		if (ch === "}") depth++;
		else if (ch === "{") {
			if (depth === 0) {
				var start = i;
				depth = 0;
				for (var k = start; k < unescapedHtml.length; k++) {
					var c2 = unescapedHtml.charAt(k);
					if (c2 === "{") depth++;
					else if (c2 === "}") {
						depth--;
						if (depth === 0) {
							return unescapedHtml.substring(start, k + 1);
						}
					}
				}
				return null;
			}
			depth--;
		}
	}
	return null;
}

function extractLivestreamsFromHtml(html) {
	var u = html.replace(/\\"/g, '"');
	var needle = '"isLive":true';
	var out = [];
	var seen = {};
	var start = 0;
	while (true) {
		var idx = u.indexOf(needle, start);
		if (idx < 0) break;
		var raw = extractJsonObjectAtIsLive(u, idx);
		if (raw) {
			try {
				var obj = JSON.parse(raw);
				var mint = obj.mint;
				if (mint && !seen[mint]) {
					seen[mint] = true;
					out.push(obj);
				}
			} catch (e) {
				log("PumpFun: skip live JSON: " + e);
			}
		}
		start = idx + needle.length;
	}
	return out;
}

// Coin pages embed absolute clips.pump.fun URLs (often escaped in Next.js payloads).
function extractHlsUrlsFromCoinHtml(html) {
	var h = unescapeJsonString(html);
	var masterRe = /https:\/\/clips\.pump\.fun[^\s"'<>]+master_playlist[^\s"'<>]*\.m3u8/g;
	var liveRe = /https:\/\/clips\.pump\.fun[^\s"'<>]+playlist_[^\s"'<>]+_[0-2]_live\.m3u8/g;
	var masters = h.match(masterRe) || [];
	var lives = h.match(liveRe) || [];
	var byQ = { 0: null, 1: null, 2: null };
	for (var i = 0; i < lives.length; i++) {
		var u = lives[i];
		var m = u.match(/_([0-2])_live\.m3u8$/);
		if (m) byQ[parseInt(m[1], 10)] = u;
	}
	return {
		master: masters.length ? masters[0] : null,
		low: byQ[0],
		medium: byQ[1],
		high: byQ[2],
	};
}

function pickHlsPlaylist(ex) {
	if (ex.master) return ex.master;
	if (ex.high) return ex.high;
	if (ex.medium) return ex.medium;
	if (ex.low) return ex.low;
	return null;
}

function creatorWalletFromRow(row) {
	if (!row || !row.creator) return "";
	if (typeof row.creator === "string") return row.creator;
	return row.creator.address || "";
}

function getLiveBundle() {
	var now = Date.now();
	if (liveCache.rows && liveCache.byMint && (now - liveCache.t) < LIVE_CACHE_TTL_MS) {
		return liveCache;
	}
	var html = httpGet(BASE_URL + "/live");
	var rows = extractLivestreamsFromHtml(html);
	var byMint = {};
	for (var i = 0; i < rows.length; i++) {
		var r = rows[i];
		if (r.mint) byMint[r.mint] = r;
	}
	liveCache = { t: now, rows: rows, byMint: byMint };
	return liveCache;
}

function mapLiveRowToPlatformVideo(row) {
	var mint = row.mint || "";
	var title = row.name || row.title || mint;
	var symbol = row.symbol || "";
	var thumb = row.thumbnail || row.image_uri || "";
	var avatar = row.avatarUri || row.avatar_uri || "";
	var creator = creatorWalletFromRow(row);
	var viewers = row.viewerCount != null ? row.viewerCount : 0;
	var ts = row.coinCreatedTimestamp != null ? row.coinCreatedTimestamp : row.created_timestamp;
	var uploadDate = ts ? Math.floor(ts / 1000) : Math.floor(Date.now() / 1000);
	var authorId = new PlatformID(PLATFORM, creator || mint, pluginId());
	return new PlatformVideo({
		id: new PlatformID(PLATFORM, mint, pluginId()),
		name: title,
		thumbnails: new Thumbnails([new Thumbnail(thumb || "", 0)]),
		author: new PlatformAuthorLink(
			authorId,
			symbol || title,
			BASE_URL + "/coin/" + mint,
			avatar || "",
			null
		),
		uploadDate: uploadDate,
		url: BASE_URL + "/coin/" + mint,
		duration: -1,
		viewCount: viewers,
		isLive: true,
	});
}

function mapCoinAndUserToPlatformVideo(coin, user) {
	var mint = coin.mint || "";
	var creator = coin.creator || "";
	var title = coin.name || mint;
	var symbol = coin.symbol || "";
	var thumb = coin.image_uri || "";
	var avatar = user && user.profile_image ? user.profile_image : "";
	var uname = user && user.username ? user.username : symbol;
	var uploadDate = coin.created_timestamp
		? Math.floor(coin.created_timestamp / 1000)
		: Math.floor(Date.now() / 1000);
	var authorId = new PlatformID(PLATFORM, creator || mint, pluginId());
	return new PlatformVideo({
		id: new PlatformID(PLATFORM, mint, pluginId()),
		name: title,
		thumbnails: new Thumbnails([new Thumbnail(thumb || "", 0)]),
		author: new PlatformAuthorLink(
			authorId,
			uname || symbol,
			BASE_URL + "/profile/" + creator,
			avatar || "",
			user && user.followers != null ? user.followers : null
		),
		uploadDate: uploadDate,
		url: BASE_URL + "/coin/" + mint,
		duration: -1,
		viewCount: 0,
		isLive: true,
	});
}

function parseMintFromCoinUrl(url) {
	var m = String(url || "").match(/pump\.fun\/coin\/([^\/\?#]+)/i);
	return m ? m[1] : null;
}

function parseWalletFromProfileUrl(url) {
	var m = String(url || "").match(/pump\.fun\/profile\/([^\/\?#]+)/i);
	return m ? m[1] : null;
}

source.enable = function (conf, settings, savedState) {
	config = conf ?? {};
	BASE_URL = "https://pump.fun";
	API_URL = "https://frontend-api-v3.pump.fun";
	CLIPS_CDN = "https://clips.pump.fun";
};

source.disable = function () {};

source.getHome = function () {
	var b = getLiveBundle();
	var vids = [];
	for (var i = 0; i < b.rows.length; i++) {
		vids.push(mapLiveRowToPlatformVideo(b.rows[i]));
	}
	return new VideoPager(vids, false, null);
};

source.isVideoDetailsUrl = function (url) {
	return /^https?:\/\/(www\.)?pump\.fun\/coin\//i.test(String(url || ""));
};

source.getVideoDetails = function (url) {
	var mint = parseMintFromCoinUrl(url);
	if (!mint) throw new ScriptException("PumpFun", "Invalid coin URL");
	var coin = httpGetJson(API_URL + "/coins/" + encodeURIComponent(mint));
	var coinHtml = httpGet(BASE_URL + "/coin/" + mint);
	var hls = extractHlsUrlsFromCoinHtml(coinHtml);
	var playlist = pickHlsPlaylist(hls);
	if (!playlist) {
		throw new ScriptException("PumpFun", "No live HLS playlist for this coin");
	}
	var creator = coin.creator || "";
	var user = creator
		? httpGetJson(API_URL + "/users/" + encodeURIComponent(creator))
		: {};
	var title = coin.name || mint;
	var symbol = coin.symbol || "";
	var thumb = coin.image_uri || "";
	var avatar = user.profile_image || "";
	var uname = user.username || symbol;
	var desc = coin.description || "";
	var uploadDate = coin.created_timestamp
		? Math.floor(coin.created_timestamp / 1000)
		: Math.floor(Date.now() / 1000);
	var authorId = new PlatformID(PLATFORM, creator || mint, pluginId());
	var hlsSource = new HLSSource({
		name: "Live",
		duration: -1,
		url: playlist,
		priority: true,
		requestModifier: {
			headers: {
				Referer: BASE_URL + "/",
				Origin: BASE_URL,
			},
		},
	});
	return new PlatformVideoDetails({
		id: new PlatformID(PLATFORM, mint, pluginId()),
		name: title,
		thumbnails: new Thumbnails([new Thumbnail(thumb || "", 0)]),
		author: new PlatformAuthorLink(
			authorId,
			uname || symbol,
			BASE_URL + "/coin/" + mint,
			avatar || "",
			user.followers != null ? user.followers : null
		),
		uploadDate: uploadDate,
		url: BASE_URL + "/coin/" + mint,
		duration: -1,
		viewCount: 0,
		isLive: true,
		description: desc,
		video: new VideoSourceDescriptor([]),
		live: hlsSource,
		subtitles: [],
	});
};

source.isChannelUrl = function (url) {
	return /^https?:\/\/(www\.)?pump\.fun\/profile\//i.test(String(url || ""));
};

source.getChannel = function (url) {
	var w = parseWalletFromProfileUrl(url);
	if (!w) throw new ScriptException("PumpFun", "Invalid profile URL");
	var user = httpGetJson(API_URL + "/users/" + encodeURIComponent(w));
	return new PlatformChannel({
		id: w,
		name: user.username || w,
		thumbnail: user.profile_image || "",
		banner: "",
		subscribers: user.followers != null ? user.followers : 0,
		description: user.bio || "",
		url: BASE_URL + "/profile/" + w,
		links: {},
	});
};

source.getChannelVideos = function (url, type, order, filters) {
	var w = parseWalletFromProfileUrl(url);
	if (!w) return new VideoPager([], false, null);
	var b = getLiveBundle();
	var coins = httpGetJson(API_URL + "/coins?creator=" + encodeURIComponent(w));
	var user = httpGetJson(API_URL + "/users/" + encodeURIComponent(w));
	var vids = [];
	for (var i = 0; i < coins.length; i++) {
		var c = coins[i];
		if (!c.is_currently_live) continue;
		var row = b.byMint[c.mint];
		if (row) {
			vids.push(mapLiveRowToPlatformVideo(row));
		} else {
			vids.push(mapCoinAndUserToPlatformVideo(c, user));
		}
	}
	return new VideoPager(vids, false, null);
};

source.getChannelCapabilities = function () {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: [],
	};
};

source.getSearchCapabilities = function () {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: [],
	};
};

source.search = function (query, type, order, filters) {
	var q = (query || "").toLowerCase().trim();
	var b = getLiveBundle();
	var vids = [];
	for (var i = 0; i < b.rows.length; i++) {
		var row = b.rows[i];
		var title = (row.name || row.title || "").toLowerCase();
		var symbol = (row.symbol || "").toLowerCase();
		var creator = creatorWalletFromRow(row).toLowerCase();
		if (
			!q ||
			title.indexOf(q) >= 0 ||
			symbol.indexOf(q) >= 0 ||
			creator.indexOf(q) >= 0
		) {
			vids.push(mapLiveRowToPlatformVideo(row));
		}
	}
	return new VideoPager(vids, false, null);
};

source.searchSuggestions = function (query) {
	return [];
};

source.getSearchChannelVideoCapabilities = function () {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: [],
	};
};

source.searchChannelVideos = function (channelUrl, query, type, order, filters) {
	throw new ScriptException("PumpFun", "Search within channel is not supported");
};

source.searchChannels = function (query) {
	var q = (query || "").toLowerCase().trim();
	var b = getLiveBundle();
	var uniq = {};
	var order = [];
	for (var i = 0; i < b.rows.length; i++) {
		var a = creatorWalletFromRow(b.rows[i]);
		if (a && !uniq[a]) {
			uniq[a] = true;
			order.push(a);
		}
	}
	var channels = [];
	if (order.length === 0) {
		return new ChannelPager(channels, false, null);
	}
	var bb = http.batch();
	for (var j = 0; j < order.length; j++) {
		bb.GET(API_URL + "/users/" + encodeURIComponent(order[j]), { "User-Agent": "GrayJay-PumpFun/1" }, false);
	}
	var responses = bb.execute();
	for (var k = 0; k < order.length; k++) {
		var addr = order[k];
		var resp = responses[k];
		if (!resp || !resp.isOk) continue;
		var user = {};
		try {
			user = JSON.parse(resp.body);
		} catch (e) {
			continue;
		}
		var uname = (user.username || "").toLowerCase();
		var addrL = addr.toLowerCase();
		if (!q || uname.indexOf(q) >= 0 || addrL.indexOf(q) >= 0) {
			channels.push(
				new PlatformChannel({
					id: addr,
					name: user.username || addr,
					thumbnail: user.profile_image || "",
					banner: "",
					subscribers: user.followers != null ? user.followers : 0,
					description: user.bio || "",
					url: BASE_URL + "/profile/" + addr,
					links: {},
				})
			);
		}
	}
	return new ChannelPager(channels, false, null);
};

source.getComments = function (url) {
	throw new ScriptException("PumpFun", "Comments are not supported");
};

source.getSubComments = function (comment) {
	throw new ScriptException("PumpFun", "Sub-comments are not supported");
};

// Official Example Plugin.md still uses these names; many GrayJay builds call them instead of
// isVideoDetailsUrl / getVideoDetails / getChannelVideos / searchChannelVideos (see plugin.d.ts).
source.isContentDetailsUrl = source.isVideoDetailsUrl;
source.getContentDetails = source.getVideoDetails;
source.getChannelContents = source.getChannelVideos;
source.searchChannelContents = source.searchChannelVideos;
source.getSearchChannelContentsCapabilities = source.getSearchChannelVideoCapabilities;

log("LOADED");
