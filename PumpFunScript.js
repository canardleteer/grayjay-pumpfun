const PLATFORM = "PumpFun";

var config = {};
var BASE_URL = "https://pump.fun";
var API_URL = "https://frontend-api-v3.pump.fun";
var CLIPS_CDN = "https://clips.pump.fun";

var liveCache = { t: 0, rows: null, byMint: null };
var LIVE_CACHE_TTL_MS = 45000;

// --- pump.fun live chat (Socket.IO / Engine.IO over WebSocket, same as pump.fun web) ---
var LIVECHAT_WS =
	"wss://livechat.pump.fun/socket.io/?EIO=4&transport=websocket";
var CHAT_MAX_QUEUE = 400;
var chatEngines = {};

function parseIsoMs(iso) {
	try {
		var t = Date.parse(iso);
		return isNaN(t) ? -1 : t;
	} catch (e) {
		return -1;
	}
}

function parseSocketIOPayload(data) {
	var c = data.charAt(0);
	if (c === "0") {
		return { kind: "ns", data: JSON.parse(data.substring(1)) };
	}
	if (c === "2") {
		var i = 1;
		while (
			i < data.length &&
			data.charCodeAt(i) >= 48 &&
			data.charCodeAt(i) <= 57
		) {
			i++;
		}
		var jsonStr = data.substring(i);
		var arr = JSON.parse(jsonStr);
		return { kind: "event", name: arr[0], args: arr.slice(1) };
	}
	if (c === "3") {
		var j = 1;
		while (
			j < data.length &&
			data.charCodeAt(j) >= 48 &&
			data.charCodeAt(j) <= 57
		) {
			j++;
		}
		var ackId = parseInt(data.substring(1, j), 10);
		var body = JSON.parse(data.substring(j));
		return { kind: "ack", ackId: ackId, data: body };
	}
	return null;
}

function handleEngineText(state, raw) {
	var t = raw.charAt(0);
	var rest = raw.substring(1);
	if (t === "2") {
		if (state.sock) state.sock.send("3");
		return;
	}
	if (t === "3") return;
	if (t === "0") {
		if (state.sock && !state.sent40) {
			state.sock.send("40");
			state.sent40 = true;
		}
		return;
	}
	if (t !== "4") return;
	var inner = rest;
	var p = parseSocketIOPayload(inner);
	if (!p) return;
	if (p.kind === "ns") {
		if (!state.nsReady) {
			state.nsReady = true;
			state.emitJoinAndHistory();
		}
		return;
	}
	if (p.kind === "ack") {
		if (p.ackId === 0 && Array.isArray(p.data) && p.data.length) {
			var hist = p.data[0];
			if (Array.isArray(hist)) state.applyHistoryRows(hist);
		}
		return;
	}
	if (p.kind === "event") {
		state.onSocketEvent(p.name, p.args);
	}
}

function PumpFunChatEngine(roomId, coinUrl) {
	this.roomId = roomId;
	this.coinUrl = coinUrl;
	this.sock = null;
	this.sent40 = false;
	this.nsReady = false;
	this.joined = false;
	this.liveOut = [];
	this.commentOut = [];
	this.lastViewerCount = null;
	this.err = null;
}
PumpFunChatEngine.prototype.trimQueues = function () {
	while (this.liveOut.length > CHAT_MAX_QUEUE) this.liveOut.shift();
	while (this.commentOut.length > CHAT_MAX_QUEUE) this.commentOut.shift();
};
PumpFunChatEngine.prototype.applyHistoryRows = function (rows) {
	for (var i = 0; i < rows.length; i++) {
		this.pushOneMessageRow(rows[i], true);
	}
	this.trimQueues();
};
PumpFunChatEngine.prototype.pushOneMessageRow = function (row, isHistory) {
	if (!row || row.messageType === "SYSTEM") return;
	var name = row.username || "anon";
	var msg = row.message || "";
	var thumb = row.profile_image || "";
	var t = parseIsoMs(row.timestamp);
	var ev = new LiveEventComment(name, msg, thumb, "", []);
	if (t > 0) ev.time = t;
	this.liveOut.push(ev);
	var authorId = new PlatformID(
		PLATFORM,
		row.userAddress || name,
		pluginId()
	);
	var prof = row.userAddress
		? BASE_URL + "/profile/" + row.userAddress
		: this.coinUrl;
	this.commentOut.push(
		new PlatformComment({
			contextUrl: this.coinUrl,
			author: new PlatformAuthorLink(
				authorId,
				name,
				prof,
				thumb,
				null
			),
			message: msg,
			date:
				t > 0
					? Math.floor(t / 1000)
					: Math.floor(Date.now() / 1000),
			rating: new RatingLikes(0),
			replyCount: 0,
			context: { history: !!isHistory },
		})
	);
	this.trimQueues();
};
PumpFunChatEngine.prototype.onSocketEvent = function (name, args) {
	if (name === "newMessage" && args.length) {
		var payload = args[0];
		var rows = Array.isArray(payload) ? payload : [payload];
		for (var i = 0; i < rows.length; i++) {
			this.pushOneMessageRow(rows[i], false);
		}
		return;
	}
	if (name === "viewerCount" && args[0] && args[0].count != null) {
		var c = args[0].count;
		if (this.lastViewerCount !== c) {
			this.lastViewerCount = c;
			this.liveOut.push(new LiveEventViewCount(c));
		}
	}
};
PumpFunChatEngine.prototype.emitJoinAndHistory = function () {
	if (!this.sock || !this.nsReady || this.joined) return;
	this.joined = true;
	this.sock.send(
		'42["joinRoom",' + JSON.stringify({ roomId: this.roomId }) + "]"
	);
	this.sock.send(
		'420["getMessageHistory",' +
			JSON.stringify({
				roomId: this.roomId,
				before: null,
				limit: 50,
			}) +
			"]"
	);
};
PumpFunChatEngine.prototype.attachSocket = function () {
	var self = this;
	if (this.sock) return;
	this.sent40 = false;
	this.nsReady = false;
	this.joined = false;
	var sk = http.socket(
		LIVECHAT_WS,
		{
			Origin: BASE_URL,
			"User-Agent": "GrayJay-PumpFun/1",
		},
		false
	);
	this.sock = sk;
	sk.connect({
		open: function () {},
		message: function (msg) {
			try {
				handleEngineText(self, String(msg || ""));
			} catch (e) {
				log("PumpFun chat parse: " + e);
			}
		},
		closing: function () {},
		closed: function () {
			self.sock = null;
			self.sent40 = false;
			self.nsReady = false;
			self.joined = false;
		},
		failure: function (m) {
			self.err = m || "websocket failure";
			self.sock = null;
			self.sent40 = false;
			self.nsReady = false;
			self.joined = false;
		},
	});
};
PumpFunChatEngine.prototype.shutdown = function () {
	try {
		if (this.sock) this.sock.close();
	} catch (e) {}
	this.sock = null;
	this.sent40 = false;
	this.nsReady = false;
	this.joined = false;
};
PumpFunChatEngine.prototype.drainLive = function (maxN) {
	var n = maxN || 80;
	var out = this.liveOut.splice(0, n);
	return out;
};
PumpFunChatEngine.prototype.drainComments = function (maxN) {
	var n = maxN || 80;
	return this.commentOut.splice(0, n);
};

function getOrCreateChatEngine(roomId, coinUrl) {
	if (!chatEngines[roomId]) {
		chatEngines[roomId] = new PumpFunChatEngine(roomId, coinUrl);
	}
	return chatEngines[roomId];
}

function disposeAllChatEngines() {
	var k = Object.keys(chatEngines);
	for (var i = 0; i < k.length; i++) {
		chatEngines[k[i]].shutdown();
		delete chatEngines[k[i]];
	}
}

function PumpFunLiveEventPager(results, hasMore, context) {
	LiveEventPager.call(this, results, hasMore, context);
	this.nextRequest = context.nextRequest != null ? context.nextRequest : 1200;
}
PumpFunLiveEventPager.prototype = Object.create(LiveEventPager.prototype);
PumpFunLiveEventPager.prototype.constructor = PumpFunLiveEventPager;
PumpFunLiveEventPager.prototype.nextPage = function () {
	var ctx = this.context;
	var eng = ctx.engine;
	if (!eng) {
		return new PumpFunLiveEventPager([], false, ctx);
	}
	if (!eng.sock) eng.attachSocket();
	var batch = eng.drainLive(100);
	var errLine = eng.err
		? [
				new LiveEventComment(
					"PumpFun",
					String(eng.err),
					"",
					"",
					[]
				),
		  ]
		: [];
	eng.err = null;
	var combined = errLine.concat(batch);
	return new PumpFunLiveEventPager(combined, true, ctx);
};

function PumpFunCommentPager(results, hasMore, context) {
	CommentPager.call(this, results, hasMore, context);
}
PumpFunCommentPager.prototype = Object.create(CommentPager.prototype);
PumpFunCommentPager.prototype.constructor = PumpFunCommentPager;
PumpFunCommentPager.prototype.nextPage = function () {
	var ctx = this.context;
	var eng = ctx.engine;
	if (!eng) return new PumpFunCommentPager([], false, ctx);
	if (!eng.sock) eng.attachSocket();
	var batch = eng.drainComments(100);
	return new PumpFunCommentPager(batch, true, ctx);
};

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

// Coin pages embed clips.pump.fun playlists (live `_N_live`, adaptive `master_playlist`, or other VOD `.m3u8`).
function extractHlsUrlsFromCoinHtml(html) {
	var h = unescapeJsonString(html);
	var anyRe = /https?:\/\/clips\.pump\.fun[^\s"'<>]+\.m3u8/gi;
	var raw = h.match(anyRe) || [];
	var seen = {};
	var unique = [];
	for (var i = 0; i < raw.length; i++) {
		var u = raw[i];
		if (!seen[u]) {
			seen[u] = true;
			unique.push(u);
		}
	}
	var master = null;
	var vod = null;
	var byQ = { 0: null, 1: null, 2: null };
	for (var j = 0; j < unique.length; j++) {
		var url = unique[j];
		if (/master_playlist/i.test(url)) {
			if (!master) master = url;
			continue;
		}
		var lm = url.match(/_([0-2])_live\.m3u8$/i);
		if (lm) {
			byQ[parseInt(lm[1], 10)] = url;
			continue;
		}
		if (!vod) vod = url;
	}
	return {
		master: master,
		vod: vod,
		low: byQ[0],
		medium: byQ[1],
		high: byQ[2],
	};
}

function pickLiveHlsPlaylist(ex) {
	if (ex.master) return ex.master;
	if (ex.high) return ex.high;
	if (ex.medium) return ex.medium;
	if (ex.low) return ex.low;
	return null;
}

function pickRecordedHlsPlaylist(ex) {
	if (ex.master) return ex.master;
	if (ex.vod) return ex.vod;
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
	var raw = httpGetJson(API_URL + "/coins/currently-live");
	var rows = [];
	if (Array.isArray(raw)) {
		var seen = {};
		for (var i = 0; i < raw.length; i++) {
			var c = raw[i];
			if (!c || !c.mint || seen[c.mint]) continue;
			if (c.is_currently_live === false) continue;
			seen[c.mint] = true;
			rows.push(c);
		}
	} else {
		log("PumpFun: /coins/currently-live returned non-array");
	}
	var byMint = {};
	for (var j = 0; j < rows.length; j++) {
		var r = rows[j];
		if (r.mint) byMint[r.mint] = r;
	}
	liveCache = { t: now, rows: rows, byMint: byMint };
	return liveCache;
}

function mapLiveRowToPlatformVideo(row) {
	var mint = row.mint || "";
	var title =
		row.livestream_title || row.name || row.title || mint;
	var symbol = row.symbol || "";
	var thumb = row.thumbnail || row.image_uri || "";
	var avatar = row.avatarUri || row.avatar_uri || "";
	var creator = creatorWalletFromRow(row);
	var viewers = 0;
	if (row.viewerCount != null) viewers = row.viewerCount;
	else if (row.num_participants != null) viewers = row.num_participants;
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

function mapLiveCoinFallbackVideo(coin, user) {
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

function mapCoinToOfflineVideo(coin, user) {
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
		duration: 0,
		viewCount: 0,
		isLive: false,
	});
}

function mapCreatorCoinToVideo(coin, user, liveRow) {
	if (coin.is_currently_live && liveRow) {
		return mapLiveRowToPlatformVideo(liveRow);
	}
	if (coin.is_currently_live) {
		return mapLiveCoinFallbackVideo(coin, user);
	}
	return mapCoinToOfflineVideo(coin, user);
}

function compareChannelVideosOrder(a, b) {
	if (a.isLive !== b.isLive) {
		return a.isLive ? -1 : 1;
	}
	return (b.uploadDate || 0) - (a.uploadDate || 0);
}

function parseMintFromCoinUrl(url) {
	var m = String(url || "").match(/pump\.fun\/coin\/([^\/\?#]+)/i);
	return m ? m[1] : null;
}

function parseWalletFromProfileUrl(url) {
	var m = String(url || "").match(/pump\.fun\/profile\/([^\/\?#]+)/i);
	return m ? m[1] : null;
}

function fetchCreatorCoinsPage(wallet, offset, limit) {
	var lim = limit || 50;
	var off = offset || 0;
	var u =
		API_URL +
		"/coins?creator=" +
		encodeURIComponent(wallet) +
		"&limit=" +
		lim +
		"&offset=" +
		off;
	return httpGetJson(u);
}

function PumpFunChannelCoinsPager(context) {
	var wallet = context.wallet;
	var pageSize = context.pageSize || 50;
	var offset = context.offset || 0;
	var coins = fetchCreatorCoinsPage(wallet, offset, pageSize);
	var b = getLiveBundle();
	var user = httpGetJson(API_URL + "/users/" + encodeURIComponent(wallet));
	var vids = [];
	for (var i = 0; i < coins.length; i++) {
		var c = coins[i];
		vids.push(mapCreatorCoinToVideo(c, user, b.byMint[c.mint]));
	}
	vids.sort(compareChannelVideosOrder);
	var hasMore = coins.length >= pageSize;
	VideoPager.call(this, vids, hasMore, {
		wallet: wallet,
		offset: offset,
		pageSize: pageSize,
	});
}
PumpFunChannelCoinsPager.prototype = Object.create(VideoPager.prototype);
PumpFunChannelCoinsPager.prototype.constructor = PumpFunChannelCoinsPager;
PumpFunChannelCoinsPager.prototype.nextPage = function () {
	var ctx = this.context;
	return new PumpFunChannelCoinsPager({
		wallet: ctx.wallet,
		offset: (ctx.offset || 0) + (ctx.pageSize || 50),
		pageSize: ctx.pageSize || 50,
	});
};

source.enable = function (conf, settings, savedState) {
	config = conf ?? {};
	BASE_URL = "https://pump.fun";
	API_URL = "https://frontend-api-v3.pump.fun";
	CLIPS_CDN = "https://clips.pump.fun";
};

source.disable = function () {
	disposeAllChatEngines();
};

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
	var isLive = !!coin.is_currently_live;
	var playlist = isLive
		? pickLiveHlsPlaylist(hls)
		: pickRecordedHlsPlaylist(hls);
	var mod = {
		headers: {
			Referer: BASE_URL + "/",
			Origin: BASE_URL,
		},
	};
	if (!playlist) {
		var noPlay =
			desc +
			(isLive
				? "\n\nNo live HLS playlist was found for this coin."
				: "\n\nNo recorded stream URL was found on this coin page (clips are only available when pump.fun exposes them in public HTML).");
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
			duration: isLive ? -1 : 0,
			viewCount: 0,
			isLive: isLive,
			description: noPlay.trim(),
			video: new VideoSourceDescriptor([]),
			live: null,
			subtitles: [],
		});
	}
	var hlsSource = new HLSSource({
		name: isLive ? "Live" : "Recorded",
		duration: -1,
		url: playlist,
		priority: true,
		requestModifier: mod,
	});
	if (isLive) {
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
	}
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
		isLive: false,
		description: desc,
		video: new VideoSourceDescriptor([hlsSource]),
		live: null,
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
	return new PumpFunChannelCoinsPager({
		wallet: w,
		offset: 0,
		pageSize: 50,
	});
};

source.getUserSubscriptions = function () {
	return [];
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
		var title = (row.livestream_title || row.name || row.title || "")
			.toLowerCase();
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
	var mint = parseMintFromCoinUrl(url);
	if (!mint) return new CommentPager([], false, null);
	var coin;
	try {
		coin = httpGetJson(API_URL + "/coins/" + encodeURIComponent(mint));
	} catch (e) {
		return new CommentPager([], false, null);
	}
	if (!coin.is_currently_live) return new CommentPager([], false, null);
	var cu = BASE_URL + "/coin/" + mint;
	var eng = getOrCreateChatEngine(mint, cu);
	eng.attachSocket();
	return new PumpFunCommentPager([], true, { engine: eng, url: cu });
};

source.getSubComments = function (comment) {
	return new CommentPager([], false, null);
};

source.getLiveEvents = function (url) {
	var dead = { engine: null, nextRequest: 4000 };
	var mint = parseMintFromCoinUrl(url);
	if (!mint) return new PumpFunLiveEventPager([], false, dead);
	var coin;
	try {
		coin = httpGetJson(API_URL + "/coins/" + encodeURIComponent(mint));
	} catch (e) {
		return new PumpFunLiveEventPager([], false, dead);
	}
	if (!coin.is_currently_live) {
		return new PumpFunLiveEventPager([], false, dead);
	}
	var cu = BASE_URL + "/coin/" + mint;
	var eng = getOrCreateChatEngine(mint, cu);
	eng.attachSocket();
	return new PumpFunLiveEventPager([], true, {
		engine: eng,
		nextRequest: 1200,
	});
};

// WebView chat: GrayJay when "Live chat window" / embedded chat is enabled (no extra auth).
source.getLiveChatWindow = function (url) {
	var mint = parseMintFromCoinUrl(url);
	if (!mint) return null;
	return {
		url: BASE_URL + "/coin/" + mint,
		removeElements: [],
		removeElementsInterval: [],
	};
};

// "Related" shelf: other coins from the same creator (public …/coins?creator=…); excludes current mint.
source.getContentRecommendations = function (url) {
	var mint = parseMintFromCoinUrl(url);
	if (!mint) return new ContentPager([], false, null);
	var coin;
	try {
		coin = httpGetJson(API_URL + "/coins/" + encodeURIComponent(mint));
	} catch (e) {
		return new ContentPager([], false, null);
	}
	var creator = coin.creator || "";
	if (!creator) return new ContentPager([], false, null);
	var user = httpGetJson(API_URL + "/users/" + encodeURIComponent(creator));
	var b = getLiveBundle();
	var raw = httpGetJson(
		API_URL +
			"/coins?creator=" +
			encodeURIComponent(creator) +
			"&limit=24&offset=0"
	);
	if (!Array.isArray(raw)) return new ContentPager([], false, null);
	var items = [];
	for (var i = 0; i < raw.length; i++) {
		var c = raw[i];
		if (!c || !c.mint || c.mint === mint) continue;
		items.push(mapCreatorCoinToVideo(c, user, b.byMint[c.mint]));
		if (items.length >= 12) break;
	}
	return new ContentPager(items, false, null);
};

// Official Example Plugin.md still uses these names; many GrayJay builds call them instead of
// isVideoDetailsUrl / getVideoDetails / getChannelVideos / searchChannelVideos (see plugin.d.ts).
source.isContentDetailsUrl = source.isVideoDetailsUrl;
source.getContentDetails = source.getVideoDetails;
source.getChannelContents = source.getChannelVideos;
source.searchChannelContents = source.searchChannelVideos;
source.getSearchChannelContentsCapabilities = source.getSearchChannelVideoCapabilities;

log("LOADED");
