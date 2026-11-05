define(function(require, exports) {
	var HLS_MIME = 'application/vnd.apple.mpegurl';
	var DANMAKU_STORAGE_PREFIX = 'kodArtPlayerDanmaku:';
	var DANMAKU_MAX = 1000;

	var tips = function(message) {
		try {
			if (window.Tips && Tips.tips) return Tips.tips(message, false);
			if (window.parent && window.parent.Tips && window.parent.Tips.tips) {
				return window.parent.Tips.tips(message, false);
			}
		} catch (e) {}
		try { console.warn('[ArtPlayer] ' + message); } catch (e) {}
	};

	var pageLang = function() {
		var lang = String((navigator.language || navigator.userLanguage || 'en')).toLowerCase();
		return lang.indexOf('zh') === 0 ? 'zh-cn' : 'en';
	};

	var joinPath = function(basePath, relative) {
		relative = String(relative || '').replace(/\\/g, '/');
		basePath = String(basePath || '').replace(/\\/g, '/');
		var index = basePath.lastIndexOf('/');
		var baseDir = index >= 0 ? basePath.substring(0, index + 1) : '';
		var combined = baseDir + relative;
		var leading = combined.charAt(0) === '/' ? '/' : '';
		var parts = combined.split('/');
		var output = [];
		for (var i = 0; i < parts.length; i++) {
			var part = parts[i];
			if (!part || part === '.') continue;
			if (part === '..') {
				if (output.length) output.pop();
				continue;
			}
			output.push(part);
		}
		return leading + output.join('/');
	};

	var splitUriSuffix = function(uri) {
		var hash = '';
		var query = '';
		var hashIndex = uri.indexOf('#');
		if (hashIndex >= 0) {
			hash = uri.substring(hashIndex);
			uri = uri.substring(0, hashIndex);
		}
		var queryIndex = uri.indexOf('?');
		if (queryIndex >= 0) {
			query = uri.substring(queryIndex);
			uri = uri.substring(0, queryIndex);
		}
		return { value: uri, query: query, hash: hash };
	};

	var decodePath = function(value) {
		try { return decodeURIComponent(value); } catch (e) { return value; }
	};

	var appendSuffix = function(url, parts) {
		if (parts.query) {
			url += (url.indexOf('?') >= 0 ? '&' : '?') + parts.query.substring(1);
		}
		return url + parts.hash;
	};

	var resolveUri = function(basePath, uri) {
		uri = String(uri || '').trim();
		if (!uri) return uri;
		if (/^(https?:)?\/\//i.test(uri) || /^(data|blob):/i.test(uri)) return uri;
		if (uri.charAt(0) === '/') return uri;

		var parts = splitUriSuffix(uri);
		return appendSuffix(core.path2url(joinPath(basePath, decodePath(parts.value))), parts);
	};

	var rewritePlaylist = function(text, basePath) {
		var lines = String(text || '').split(/\r?\n/);
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			var trimmed = line.trim();
			if (!trimmed) continue;
			if (trimmed.charAt(0) === '#') {
				lines[i] = line.replace(/URI="([^"]*)"/g, function(match, uri) {
					return 'URI="' + resolveUri(basePath, uri) + '"';
				});
			} else {
				lines[i] = resolveUri(basePath, trimmed);
			}
		}
		return lines.join('\n');
	};

	var pickVariant = function(text) {
		var lines = String(text || '').split(/\r?\n/);
		var best = null;
		var bestBandwidth = -1;
		for (var i = 0; i < lines.length; i++) {
			if (!/^#EXT-X-STREAM-INF:/i.test(lines[i])) continue;
			var bandwidth = 0;
			var match = /BANDWIDTH=(\d+)/i.exec(lines[i]);
			if (match) bandwidth = parseInt(match[1], 10) || 0;
			var j = i + 1;
			while (j < lines.length && (!lines[j].trim() || lines[j].trim().charAt(0) === '#')) j++;
			if (j < lines.length && bandwidth >= bestBandwidth) {
				best = lines[j].trim();
				bestBandwidth = bandwidth;
			}
		}
		return best;
	};

	var fetchPlaylist = function(url, path, depth) {
		depth = depth || 0;
		if (!window.fetch || !window.Promise) {
			return Promise.reject(new Error('fetch is not supported'));
		}
		return fetch(url, {
			credentials: 'same-origin',
			cache: 'no-cache'
		}).then(function(response) {
			if (!response.ok) throw new Error('HTTP ' + response.status);
			return response.text();
		}).then(function(text) {
			text = String(text || '').replace(/^\uFEFF/, '');
			if (depth < 3 && /#EXT-X-STREAM-INF/i.test(text)) {
				var variant = pickVariant(text);
				if (variant) {
					var variantParts = splitUriSuffix(variant);
					var variantPath = joinPath(path, decodePath(variantParts.value));
					return fetchPlaylist(appendSuffix(core.path2url(variantPath), variantParts), variantPath, depth + 1);
				}
			}
			var rewritten = rewritePlaylist(text, path);
			return URL.createObjectURL(new Blob([rewritten], {
				type: 'application/vnd.apple.mpegurl'
			}));
		});
	};

	var createHls = function(video, url, path, art) {
		var destroyed = false;
		var objectUrl = null;
		var hls = null;

		var cleanup = function() {
			destroyed = true;
			if (objectUrl) {
				try { URL.revokeObjectURL(objectUrl); } catch (e) {}
				objectUrl = null;
			}
			if (hls) {
				try { hls.destroy(); } catch (e) {}
				hls = null;
			}
		};

		art.on('destroy', cleanup);

		var useNative = function() {
			if (!video.canPlayType(HLS_MIME)) {
				art.notice.show = '当前浏览器不支持 HLS 播放';
				return;
			}
			video.addEventListener('error', function() {
				if (!objectUrl || destroyed) return;
				try { URL.revokeObjectURL(objectUrl); } catch (e) {}
				objectUrl = null;
				video.src = url;
			}, false);
			fetchPlaylist(core.path2url(path), path).then(function(playlistUrl) {
				if (destroyed) {
					try { URL.revokeObjectURL(playlistUrl); } catch (e) {}
					return;
				}
				objectUrl = playlistUrl;
				video.src = objectUrl;
			}).catch(function() {
				if (!destroyed) video.src = url;
			});
		};

		if (!window.Hls || !Hls.isSupported()) {
			useNative();
			return;
		}

		hls = new Hls({
			enableWorker: false,
			lowLatencyMode: false
		});

		hls.on(Hls.Events.ERROR, function(event, data) {
			if (!data || !data.fatal) return;
			if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
				try { hls.startLoad(); return; } catch (e) {}
			}
			if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
				try { hls.recoverMediaError(); return; } catch (e) {}
			}
			art.notice.show = 'HLS 加载失败: ' + (data.details || '');
		});

		fetchPlaylist(core.path2url(path), path).then(function(playlistUrl) {
			if (destroyed) {
				try { URL.revokeObjectURL(playlistUrl); } catch (e) {}
				return;
			}
			objectUrl = playlistUrl;
			hls.loadSource(objectUrl);
			hls.attachMedia(video);
		}).catch(function() {
			if (destroyed || !hls) return;
			hls.loadSource(url);
			hls.attachMedia(video);
		});
	};

	var createFlv = function(video, url, art) {
		if (!window.flvjs || !flvjs.isSupported()) {
			art.notice.show = '当前浏览器不支持 FLV 播放';
			return;
		}

		var player = flvjs.createPlayer({
			type: 'flv',
			url: url,
			isLive: false,
			hasAudio: true,
			hasVideo: true
		}, {
			enableStashBuffer: false,
			stashInitialSize: 128,
			lazyLoad: false
		});

		player.on(flvjs.Events.ERROR, function(errorType, errorDetail) {
			art.notice.show = 'FLV 加载失败: ' + (errorDetail || errorType || '');
		});
		player.attachMediaElement(video);
		player.load();

		art.on('destroy', function() {
			try {
				player.pause();
				player.unload();
				player.detachMediaElement();
				player.destroy();
			} catch (e) {}
		});
	};

	var danmakuKey = function(path) {
		return DANMAKU_STORAGE_PREFIX + String(path || '');
	};

	var loadDanmaku = function(path) {
		try {
			var raw = localStorage.getItem(danmakuKey(path));
			var list = raw ? JSON.parse(raw) : [];
			return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
		} catch (e) {
			return [];
		}
	};

	var saveDanmaku = function(path, item) {
		if (!item || !item.text) return;
		var list = loadDanmaku(path);
		list.push({
			text: String(item.text),
			mode: item.mode,
			color: item.color,
			time: item.time,
			border: true
		});
		if (list.length > DANMAKU_MAX) list = list.slice(list.length - DANMAKU_MAX);
		list.sort(function(a, b) {
			return (a.time || 0) - (b.time || 0);
		});
		try {
			localStorage.setItem(danmakuKey(path), JSON.stringify(list));
		} catch (e) {}
	};

	var createDialog = function(title, onClose) {
		var dialog = $.dialog({
			simple: true,
			ico: core.icon('mp4'),
			title: title,
			width: '70%',
			height: '60%',
			content: '<div class="artplayer-app" style="width:100%;height:100%;background:#000;"></div>',
			resize: true,
			padding: 0,
			fixed: true,
			close: function() {
				if (onClose) onClose();
			}
		});
		dialog.DOM.wrap.addClass('artplayer-dialog');
		return dialog.DOM.wrap.find('.artplayer-app');
	};

	var fitDialog = function(art, $target) {
		var video = art.video;
		var width = video.videoWidth || 16;
		var height = video.videoHeight || 9;
		if (!width || !height) return;

		var maxWidth = $(window).width() * 0.9;
		var maxHeight = $(window).height() * 0.9;
		var ratio = width / height;
		var playerWidth = maxWidth;
		var playerHeight = playerWidth / ratio;
		if (playerHeight > maxHeight) {
			playerHeight = maxHeight;
			playerWidth = playerHeight * ratio;
		}

		var dialog = $target.parents('.artplayer-dialog').data('artDialog');
		if (!dialog) return;
		dialog.size(playerWidth, playerHeight).position(
			($(window).width() - playerWidth) / 2,
			($(window).height() - playerHeight) / 2
		);
		setTimeout(function() {
			try { art.emit('resize'); } catch (e) {}
		}, 0);
	};

	var playStart = function(appStatic, videoInfo) {
		if (!window.Artplayer) {
			tips('ArtPlayer 加载失败');
			return;
		}

		var art = null;
		var $target = createDialog(videoInfo.name, function() {
			if (art) {
				try { art.destroy(); } catch (e) {}
				art = null;
			}
		});

		var type = videoInfo.ext;
		if (type === 'm3u8') {
			type = 'm3u8';
		} else if (type === 'flv' || type === 'f4v') {
			type = 'flv';
		}

		var options = {
			container: $target.get(0),
			url: videoInfo.url,
			type: type,
			theme: '#f60',
			lang: pageLang(),
			autoplay: !!window.ArtPlayerAutoplay,
			autoSize: true,
			autoMini: false,
			loop: false,
			flip: true,
			playbackRate: true,
			aspectRatio: true,
			setting: true,
			hotkey: true,
			pip: true,
			mutex: true,
			fullscreen: true,
			fullscreenWeb: true,
			miniProgressBar: true,
			subtitleOffset: true,
			playsInline: true,
			customType: {
				m3u8: function(video, url, player) {
					createHls(video, url, videoInfo.path, player);
				},
				flv: function(video, url, player) {
					createFlv(video, url, player);
				}
			}
		};

		if (window.ArtPlayerSubtitle) {
			options.subtitle = {
				url: core.path2url(videoInfo.path + '.vtt'),
				type: 'vtt',
				name: '字幕'
			};
		}

		if (window.ArtPlayerDanmaku && window.artplayerPluginDanmuku) {
			options.plugins = [window.artplayerPluginDanmuku({
				danmuku: loadDanmaku(videoInfo.path),
				speed: 5,
				margin: [10, '25%'],
				opacity: 1,
				color: '#FFFFFF',
				mode: 0,
				modes: [0, 1, 2],
				fontSize: 25,
				antiOverlap: true,
				synchronousPlayback: false,
				emitter: true,
				maxLength: 200,
				lockTime: 5,
				theme: 'dark',
				beforeEmit: function(danmu) {
					saveDanmaku(videoInfo.path, danmu);
					return true;
				}
			})];
		}

		try {
			art = new Artplayer(options);
		} catch (error) {
			tips('ArtPlayer 初始化失败: ' + (error && error.message ? error.message : error));
			try {
				var dialog = $target.parents('.artplayer-dialog').data('artDialog');
				if (dialog && dialog.close) dialog.close();
			} catch (e) {}
			return;
		}

		art.on('video:loadedmetadata', function() {
			fitDialog(art, $target);
		});
	};

	var playReady = function(appStatic, videoInfo) {
		require.async([
			appStatic + 'ArtPlayer/artplayer.js',
			appStatic + 'ArtPlayer/artplayer-plugin-danmuku.js',
			appStatic + 'ArtPlayer/lib/hls.min.js',
			appStatic + 'ArtPlayer/lib/flv.min.js'
		], function() {
			playStart(appStatic, videoInfo);
		});
	};

	return {
		play: playReady
	};
});
