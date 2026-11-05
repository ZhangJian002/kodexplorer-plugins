define(function(require, exports) {
	'use strict';

	var CSS_ID = 'aplayer-plugin-css';
	var ASSET_VERSION = '1.1.1';
	var STORAGE_VOLUME = 'kod-aplayer-volume';
	var STORAGE_ORDER = 'kod-aplayer-order';
	var STORAGE_LOOP = 'kod-aplayer-loop';
	var BLOB_MIME = {
		flac: 'audio/flac',
		m4a: 'audio/mp4',
		aac: 'audio/aac',
		opus: 'audio/ogg'
	};
	var FALLBACK_GRADIENTS = [
		['#ff8a4c', '#ff3d81'],
		['#7c5cff', '#3b82f6'],
		['#f59e0b', '#ef4444'],
		['#06b6d4', '#6366f1'],
		['#ec4899', '#8b5cf6'],
		['#14b8a6', '#0ea5e9']
	];

	var ICONS = {
		note: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
		play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.7c0-.9 1-1.4 1.7-.9l9 5.8c.6.4.6 1.3 0 1.7l-9 5.8c-.7.5-1.7 0-1.7-.9V5.7z"/></svg>',
		pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.2"/></svg>',
		prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M19 5v14"/><path d="M16 6.6v10.8L6.3 12 16 6.6z" fill="currentColor" stroke="none"/></svg>',
		next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M5 5v14"/><path d="M8 6.6v10.8L17.7 12 8 6.6z" fill="currentColor" stroke="none"/></svg>',
		shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
		repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
		volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
		mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M16 9l5 6"/><path d="M21 9l-5 6"/></svg>',
		list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',
		close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
		search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
	};

	var active = null;

	function tips(message) {
		try {
			if (window.Tips && Tips.tips) return Tips.tips(message, false);
			if (window.parent && window.parent.Tips && window.parent.Tips.tips) {
				return window.parent.Tips.tips(message, false);
			}
		} catch (e) {}
		try { console.warn('[APlayer] ' + message); } catch (e) {}
	}

	function esc(value) {
		return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
		});
	}

	function pad(value) {
		return value < 10 ? '0' + value : String(value);
	}

	function formatTime(seconds) {
		seconds = Math.max(0, Number(seconds) || 0);
		var hours = Math.floor(seconds / 3600);
		var minutes = Math.floor((seconds % 3600) / 60);
		var secs = Math.floor(seconds % 60);
		if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(secs);
		return pad(minutes) + ':' + pad(secs);
	}

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function storageGet(key, fallback) {
		try {
			var value = window.localStorage.getItem(key);
			return value === null ? fallback : value;
		} catch (e) {
			return fallback;
		}
	}

	function storageSet(key, value) {
		try { window.localStorage.setItem(key, value); } catch (e) {}
	}

	function decodeName(value) {
		var text = String(value == null ? '' : value);
		try {
			return typeof urlDecode === 'function' ? urlDecode(text) : decodeURIComponent(text);
		} catch (e) {
			return text;
		}
	}

	function pathUrl(path) {
		try {
			if (typeof core !== 'undefined' && core.path2url) return core.path2url(path);
		} catch (e) {}
		return String(path || '');
	}

	function pathExt(path) {
		try {
			if (typeof core !== 'undefined' && core.pathExt) return core.pathExt(path);
		} catch (e) {}
		var text = String(path || '');
		var index = text.lastIndexOf('.');
		return index >= 0 ? text.substring(index + 1) : '';
	}

	function pathThis(path) {
		try {
			if (typeof core !== 'undefined' && core.pathThis) return core.pathThis(path);
		} catch (e) {}
		var text = String(path || '').replace(/\\/g, '/');
		var index = text.lastIndexOf('/');
		return index >= 0 ? text.substring(index + 1) : text;
	}

	function basePath(path) {
		return String(path || '').replace(/\.[^.\/\\]+$/, '');
	}

	function cssUrl(url) {
		return 'url("' + String(url || '').replace(/\\/g, '\\\\').replace(/"/g, '%22') + '")';
	}

	function hashHue(text) {
		var hash = 0;
		var value = String(text || '');
		for (var i = 0; i < value.length; i++) {
			hash = (hash * 31 + value.charCodeAt(i)) % 360;
		}
		return hash;
	}

	function ensureCss(appStatic, done) {
		var existing = document.getElementById(CSS_ID);
		var finish = function() {
			if (done) {
				var callback = done;
				done = null;
				callback();
			}
		};
		if (existing) {
			if (existing.getAttribute('data-ready') === '1') {
				finish();
			} else {
				existing.addEventListener('load', function() {
					existing.setAttribute('data-ready', '1');
					finish();
				});
				existing.addEventListener('error', finish);
				setTimeout(finish, 800);
			}
			return;
		}
		var link = document.createElement('link');
		link.id = CSS_ID;
		link.rel = 'stylesheet';
		link.href = appStatic + 'player.css?v=' + ASSET_VERSION;
		link.onload = function() {
			link.setAttribute('data-ready', '1');
			finish();
		};
		link.onerror = finish;
		var head = document.head || document.getElementsByTagName('head')[0];
		if (head) head.appendChild(link);
		setTimeout(finish, 900);
	}

	function resolveSettings(settings) {
		settings = settings || {};
		return {
			autoplay: settings.autoplay !== undefined ? !!settings.autoplay : !!window.APlayerAutoplay,
			lyric: settings.lyric !== undefined ? !!settings.lyric : !!window.APlayerLyric,
			cover: settings.cover !== undefined ? !!settings.cover : !!window.APlayerCover
		};
	}

	function normalizeList(list, settings) {
		var result = [];
		var seen = Object.create(null);
		for (var i = 0; i < (list || []).length; i++) {
			var item = list[i] || {};
			var path = String(item.path || '').replace(/\\/g, '/');
			if (!path || seen[path]) continue;
			seen[path] = 1;

			var ext = String(item.ext || pathExt(path) || '').toLowerCase().replace(/^\./, '');
			if (!ext) continue;

			var name = item.name ? String(item.name) : decodeName(pathThis(path));
			name = name.replace(/\.[^.\/\\]+$/, '');
			if (!name) name = decodeName(pathThis(path));

			var slash = path.lastIndexOf('/');
			var folder = slash >= 0 ? path.substring(0, slash) : '';
			var artist = folder ? decodeName(pathThis(folder)) : '';
			if (!artist) artist = '未知艺术家';

			var audio = {
				name: name,
				artist: artist,
				url: item.url ? String(item.url) : pathUrl(path),
				path: path,
				folder: folder,
				ext: ext,
				cover: '',
				coverFallback: ''
			};

			if (settings.cover) {
				audio.cover = pathUrl(basePath(path) + '.jpg');
				if (folder) audio.coverFallback = pathUrl(folder + '/cover.jpg');
			}

			result.push(audio);
		}
		return result;
	}

	function parseLrc(text) {
		text = String(text || '').replace(/^\uFEFF/, '');
		var offset = 0;
		var offsetMatch = /\[offset:\s*(-?\d+)\s*\]/i.exec(text);
		if (offsetMatch) offset = parseInt(offsetMatch[1], 10) / 1000;

		var rows = text.split(/\r?\n/);
		var merged = {};
		var order = [];

		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			var stamps = [];
			var stampRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
			var match;
			while ((match = stampRe.exec(row))) {
				var fraction = match[3] ? parseInt(match[3], 10) : 0;
				if (match[3] && match[3].length === 2) fraction = fraction / 100;
				else if (match[3] && match[3].length === 3) fraction = fraction / 1000;
				else if (match[3] && match[3].length === 1) fraction = fraction / 10;
				stamps.push(parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + fraction);
			}
			if (!stamps.length) continue;
			stampRe.lastIndex = 0;
			var content = row.replace(stampRe, '')
				.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
				.replace(/^\s+|\s+$/g, '');
			if (!content) continue;

			for (var s = 0; s < stamps.length; s++) {
				var time = Math.max(0, stamps[s] + offset);
				var key = time.toFixed(3);
				if (merged[key]) {
					merged[key].text += '\n' + content;
				} else {
					merged[key] = { time: time, text: content };
					order.push(key);
				}
			}
		}

		var lines = [];
		for (var k = 0; k < order.length; k++) lines.push(merged[order[k]]);
		lines.sort(function(a, b) { return a.time - b.time; });
		return lines;
	}

	function Player(appStatic, items, settings) {
		this.appStatic = appStatic;
		this.items = items;
		this.settings = settings;
		this.index = 0;
		this.closed = false;
		this.el = null;
		this.refs = {};
		this.keyHandler = null;

		this.audio = new Audio();
		this.audio.preload = 'metadata';
		this.audio.className = 'ap-audio';
		var volume = parseFloat(storageGet(STORAGE_VOLUME, '0.8'));
		this.audio.volume = isNaN(volume) ? 0.8 : clamp(volume, 0, 1);
		this.lastVolume = this.audio.volume;

		this.order = storageGet(STORAGE_ORDER, 'list') === 'random' ? 'random' : 'list';
		var loop = storageGet(STORAGE_LOOP, 'all');
		this.loop = (loop === 'one' || loop === 'none') ? loop : 'all';

		this.shuffleBag = [];
		this.blobCache = Object.create(null);
		this.blobOrder = [];
		this.blobXhr = null;
		this.lyricXhr = null;
		this.lyricCache = Object.create(null);
		this.lyricToken = 0;
		this.lyricLines = [];
		this.lineTimes = [];
		this.lyricIndex = -1;
		this.lyricHoldUntil = 0;
		this.lyricHoldTimer = null;
		this.coverToken = 0;
		this.coverFolderCache = Object.create(null);
		this.currentCover = '';
		this.duration = 0;
		this.expectedSrc = '';
		this.dragging = false;
		this.dragRatio = 0;
		this.wantPlay = false;
		this.pendingBlobPlay = false;
		this.ignoreAudioError = false;
		this.loading = false;
		this.blocked = false;
		this.toastTimer = null;
		this.mediaHandlers = false;
		this.lastPositionUpdate = 0;
		this.rowNodes = null;
		this.listOpen = false;
		this.resizeHandler = null;

		this.render();
		this.bindEvents();
		this.load(0, this.settings.autoplay);
	}

	Player.prototype.buildTemplate = function() {
		return [
			'<div class="ap-bg">',
				'<div class="ap-bg-image"></div>',
				'<div class="ap-bg-veil"></div>',
				'<span class="ap-orb ap-orb-1"></span>',
				'<span class="ap-orb ap-orb-2"></span>',
			'</div>',
			'<div class="ap-frame">',
				'<header class="ap-header">',
					'<div class="ap-brand">',
						'<span class="ap-logo">' + ICONS.note + '</span>',
						'<span class="ap-brand-text">',
							'<span class="ap-brand-name">APlayer</span>',
							'<span class="ap-brand-sub">音乐播放器</span>',
						'</span>',
					'</div>',
					'<div class="ap-head-actions">',
						'<button type="button" class="ap-head-btn ap-open-list" aria-expanded="false" aria-label="播放列表" title="播放列表（L）">' + ICONS.list + '<span class="ap-head-btn-text">列表</span></button>',
						'<button type="button" class="ap-head-btn ap-close" aria-label="关闭播放器" title="关闭（Esc）">' + ICONS.close + '</button>',
					'</div>',
				'</header>',
				'<main class="ap-main">',
					'<section class="ap-art-col">',
						'<div class="ap-art-wrap">',
							'<div class="ap-vinyl"><span class="ap-vinyl-label"></span></div>',
							'<div class="ap-art" role="button" tabindex="0" aria-label="播放或暂停">',
								'<div class="ap-art-img"></div>',
								'<div class="ap-art-fallback">' + ICONS.note + '</div>',
								'<div class="ap-art-shine"></div>',
								'<div class="ap-art-blocked"><span class="ap-art-blocked-icon">' + ICONS.play + '</span><span class="ap-art-blocked-text">轻触播放</span></div>',
								'<div class="ap-art-badge"><span class="ap-eq"><i></i><i></i><i></i><i></i></span><span>播放中</span></div>',
							'</div>',
						'</div>',
						'<div class="ap-track">',
							'<div class="ap-track-kicker"><span class="ap-live-dot"></span><span class="ap-kicker-text">正在播放</span></div>',
							'<h1 class="ap-track-title">未在播放</h1>',
							'<div class="ap-track-artist"><span class="ap-track-artist-name">未知艺术家</span><span class="ap-track-format"></span></div>',
						'</div>',
					'</section>',
					'<section class="ap-lyric-col">',
						'<div class="ap-lyric-head"><span class="ap-lyric-title">歌词</span><span class="ap-lyric-hint">点击歌词可跳转</span></div>',
						'<div class="ap-lyric-scroll"><div class="ap-lyric-list"></div></div>',
						'<div class="ap-lyric-empty">',
							'<span class="ap-lyric-empty-ring">' + ICONS.note + '</span>',
							'<div class="ap-lyric-empty-title">暂无歌词</div>',
							'<div class="ap-lyric-empty-sub">把注意力交给旋律</div>',
						'</div>',
					'</section>',
				'</main>',
				'<footer class="ap-controls">',
					'<div class="ap-download"><div class="ap-download-track"><div class="ap-download-bar"></div></div><span class="ap-download-text"></span></div>',
					'<div class="ap-progress">',
						'<span class="ap-time ap-time-cur">00:00</span>',
						'<div class="ap-seek" role="slider" aria-label="播放进度" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" tabindex="0">',
							'<div class="ap-seek-track"><div class="ap-seek-buffer"></div><div class="ap-seek-played"><span class="ap-seek-thumb"></span></div></div>',
						'</div>',
						'<span class="ap-time ap-time-dur">00:00</span>',
					'</div>',
					'<div class="ap-buttons">',
						'<div class="ap-actions ap-actions-left">',
							'<button type="button" class="ap-icon-btn ap-shuffle" aria-label="随机播放" title="随机播放">' + ICONS.shuffle + '</button>',
							'<button type="button" class="ap-icon-btn ap-repeat" aria-label="循环模式" title="列表循环">' + ICONS.repeat + '</button>',
						'</div>',
						'<div class="ap-actions ap-actions-center">',
							'<button type="button" class="ap-icon-btn ap-round ap-prev" aria-label="上一首" title="上一首">' + ICONS.prev + '</button>',
							'<button type="button" class="ap-play-btn" aria-label="播放或暂停" title="播放 / 暂停（空格）"><span class="ap-play-icon">' + ICONS.play + '</span><span class="ap-play-spinner"></span></button>',
							'<button type="button" class="ap-icon-btn ap-round ap-next" aria-label="下一首" title="下一首">' + ICONS.next + '</button>',
						'</div>',
						'<div class="ap-actions ap-actions-right">',
							'<button type="button" class="ap-icon-btn ap-mute" aria-label="静音" title="静音">' + ICONS.volume + '</button>',
							'<div class="ap-volume" role="slider" aria-label="音量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80" tabindex="0"><div class="ap-volume-track"><div class="ap-volume-fill"></div></div></div>',
							'<button type="button" class="ap-icon-btn ap-list-btn" aria-expanded="false" aria-label="播放列表" title="播放列表">' + ICONS.list + '</button>',
						'</div>',
					'</div>',
				'</footer>',
			'</div>',
			'<div class="ap-drawer-mask"></div>',
			'<aside class="ap-drawer" aria-hidden="true">',
				'<div class="ap-drawer-head">',
					'<div class="ap-drawer-heading">',
						'<div class="ap-drawer-title">播放列表</div>',
						'<div class="ap-drawer-sub"><span class="ap-count">0</span> 首歌曲</div>',
					'</div>',
					'<button type="button" class="ap-icon-btn ap-drawer-close" aria-label="关闭播放列表" title="关闭列表">' + ICONS.close + '</button>',
				'</div>',
				'<div class="ap-search"><span class="ap-search-icon">' + ICONS.search + '</span><input type="text" class="ap-search-input" aria-label="搜索歌曲或歌手" placeholder="搜索歌曲或歌手" autocomplete="off" spellcheck="false"><button type="button" class="ap-search-clear" title="清除搜索" aria-label="清除搜索">' + ICONS.close + '</button></div>',
				'<div class="ap-list" role="list"></div>',
				'<div class="ap-list-empty">没有找到匹配的歌曲</div>',
			'</aside>',
			'<div class="ap-toast" role="status"></div>'
		].join('');
	};

	Player.prototype.render = function() {
		var self = this;
		if (active && active !== this) active.close();

		var el = document.createElement('div');
		el.className = 'ap-overlay';
		el.id = 'ap-overlay-' + new Date().getTime();
		el.setAttribute('tabindex', '-1');
		el.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:#0b0d17;opacity:0;';
		el.innerHTML = this.buildTemplate();
		document.body.appendChild(el);
		this.el = el;
		el.appendChild(this.audio);

		this.refs = {
			overlay: el,
			bgImage: el.querySelector('.ap-bg-image'),
			bgVeil: el.querySelector('.ap-bg-veil'),
			art: el.querySelector('.ap-art'),
			artImg: el.querySelector('.ap-art-img'),
			artFallback: el.querySelector('.ap-art-fallback'),
			vinylLabel: el.querySelector('.ap-vinyl-label'),
			title: el.querySelector('.ap-track-title'),
			kickerText: el.querySelector('.ap-kicker-text'),
			artist: el.querySelector('.ap-track-artist-name'),
			format: el.querySelector('.ap-track-format'),
			seek: el.querySelector('.ap-seek'),
			seekBuffer: el.querySelector('.ap-seek-buffer'),
			seekPlayed: el.querySelector('.ap-seek-played'),
			timeCur: el.querySelector('.ap-time-cur'),
			timeDur: el.querySelector('.ap-time-dur'),
			playBtn: el.querySelector('.ap-play-btn'),
			playIcon: el.querySelector('.ap-play-icon'),
			prev: el.querySelector('.ap-prev'),
			next: el.querySelector('.ap-next'),
			shuffle: el.querySelector('.ap-shuffle'),
			repeat: el.querySelector('.ap-repeat'),
			mute: el.querySelector('.ap-mute'),
			volume: el.querySelector('.ap-volume'),
			volumeFill: el.querySelector('.ap-volume-fill'),
			openList: el.querySelector('.ap-open-list'),
			listBtn: el.querySelector('.ap-list-btn'),
			close: el.querySelector('.ap-close'),
			drawer: el.querySelector('.ap-drawer'),
			drawerMask: el.querySelector('.ap-drawer-mask'),
			drawerClose: el.querySelector('.ap-drawer-close'),
			count: el.querySelector('.ap-count'),
			search: el.querySelector('.ap-search-input'),
			searchClear: el.querySelector('.ap-search-clear'),
			list: el.querySelector('.ap-list'),
			listEmpty: el.querySelector('.ap-list-empty'),
			lyricScroll: el.querySelector('.ap-lyric-scroll'),
			lyricList: el.querySelector('.ap-lyric-list'),
			lyricEmpty: el.querySelector('.ap-lyric-empty'),
			lyricEmptyTitle: el.querySelector('.ap-lyric-empty-title'),
			lyricEmptySub: el.querySelector('.ap-lyric-empty-sub'),
			lyricHint: el.querySelector('.ap-lyric-hint'),
			lyricHead: el.querySelector('.ap-lyric-head'),
			download: el.querySelector('.ap-download'),
			downloadBar: el.querySelector('.ap-download-bar'),
			downloadText: el.querySelector('.ap-download-text'),
			toast: el.querySelector('.ap-toast')
		};

		this.previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		this.applyModes();
		this.updateVolumeUI();
		this.renderPlaylist();
		if (this.items.length <= 1) el.classList.add('is-single');

		active = this;

		el.addEventListener('keydown', function(e) {
			if (e.keyCode === 27) {
				e.preventDefault();
				self.close();
			}
		});

		var shown = false;
		var show = function() {
			if (shown || self.closed) return;
			shown = true;
			el.style.opacity = '';
			el.classList.add('is-open');
			try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (err) {} }
			self.updateLyricPadding();
			self.syncLyrics(self.audio.currentTime, true);
		};
		ensureCss(this.appStatic, show);
		setTimeout(show, 1000);

		this.resizeHandler = function() { self.updateLyricPadding(); };
		window.addEventListener('resize', this.resizeHandler, false);
	};

	Player.prototype.bindEvents = function() {
		var self = this;
		var refs = this.refs;

		refs.playBtn.addEventListener('click', function() { self.toggle(); });
		refs.art.addEventListener('click', function() { self.toggle(); });
		refs.art.addEventListener('keydown', function(e) {
			if (e.keyCode === 13 || e.keyCode === 32) {
				e.preventDefault();
				e.stopPropagation();
				self.toggle();
			}
		});
		refs.prev.addEventListener('click', function() { self.prev(); });
		refs.next.addEventListener('click', function() { self.next(); });
		refs.shuffle.addEventListener('click', function() { self.toggleOrder(); });
		refs.repeat.addEventListener('click', function() { self.toggleLoop(); });
		refs.mute.addEventListener('click', function() { self.toggleMute(); });
		refs.close.addEventListener('click', function() { self.close(); });
		refs.openList.addEventListener('click', function() { self.toggleList(); });
		refs.listBtn.addEventListener('click', function() { self.toggleList(); });
		refs.drawerClose.addEventListener('click', function() { self.setListOpen(false); });
		refs.drawerMask.addEventListener('click', function() { self.setListOpen(false); });

		refs.list.addEventListener('click', function(e) {
			var target = e.target;
			while (target && target !== refs.list && !target.getAttribute('data-index')) {
				target = target.parentNode;
			}
			if (!target || target === refs.list) return;
			var index = parseInt(target.getAttribute('data-index'), 10);
			if (isNaN(index)) return;
			self.setListOpen(false);
			if (index === self.index) {
				self.toggle();
			} else {
				self.load(index, true);
			}
		});

		refs.search.addEventListener('input', function() { self.filterList(); });
		refs.searchClear.addEventListener('click', function() {
			refs.search.value = '';
			self.filterList();
			try { refs.search.focus(); } catch (e) {}
		});

		refs.lyricList.addEventListener('click', function(e) {
			var target = e.target;
			while (target && target !== refs.lyricList && !target.getAttribute('data-time')) {
				target = target.parentNode;
			}
			if (!target || target === refs.lyricList) return;
			var time = parseFloat(target.getAttribute('data-time'));
			if (isNaN(time)) return;
			if (!self.duration) return;
			self.audio.currentTime = clamp(time, 0, self.duration);
			self.paintProgress();
			self.syncLyrics(self.audio.currentTime, true);
		});

		var lyricHold = function() {
			self.lyricHoldUntil = new Date().getTime() + 4000;
			if (self.lyricHoldTimer) clearTimeout(self.lyricHoldTimer);
			self.lyricHoldTimer = setTimeout(function() {
				self.lyricHoldUntil = 0;
				self.syncLyrics(self.audio.currentTime, true);
			}, 4100);
		};
		refs.lyricScroll.addEventListener('wheel', lyricHold, { passive: true });
		refs.lyricScroll.addEventListener('touchmove', lyricHold, { passive: true });
		refs.lyricScroll.addEventListener('mousedown', lyricHold);

		this.bindSeek();
		this.bindVolume();

		this.keyHandler = function(e) {
			if (self.closed) return;
			var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
			if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
			if (e.keyCode === 27) {
				e.preventDefault();
				self.close();
				return;
			}
			if (e.keyCode === 32) {
				if (tag === 'BUTTON' || tag === 'A') return;
				e.preventDefault();
				self.toggle();
			} else if (e.keyCode === 37) {
				e.preventDefault();
				self.seekBy(-5);
			} else if (e.keyCode === 39) {
				e.preventDefault();
				self.seekBy(5);
			} else if (e.keyCode === 38) {
				e.preventDefault();
				self.setVolume(clamp(self.audio.volume + 0.05, 0, 1));
			} else if (e.keyCode === 40) {
				e.preventDefault();
				self.setVolume(clamp(self.audio.volume - 0.05, 0, 1));
			} else if (e.keyCode === 76) {
				e.preventDefault();
				self.toggleList();
			} else if (e.keyCode === 77) {
				e.preventDefault();
				self.toggleMute();
			}
		};
		document.addEventListener('keydown', this.keyHandler, false);

		this.audio.addEventListener('loadstart', function() {
			if (self.closed) return;
			self.setLoading(true);
		});
		this.audio.addEventListener('waiting', function() {
			if (self.closed) return;
			self.setLoading(true);
		});
		this.audio.addEventListener('canplay', function() {
			if (self.closed) return;
			self.setLoading(false);
		});
		this.audio.addEventListener('playing', function() {
			if (self.closed) return;
			var item = self.items[self.index];
			if (item) item.needsBlob = false;
			self.setLoading(false);
			self.setPlayingUI(true);
		});
		this.audio.addEventListener('play', function() {
			if (self.closed) return;
			self.setPlayingUI(true);
		});
		this.audio.addEventListener('pause', function() {
			if (self.closed) return;
			if (!self.wantPlay) {
				self.setPlayingUI(false);
				self.setLoading(false);
			}
		});
		this.audio.addEventListener('timeupdate', function() {
			if (self.closed) return;
			self.paintProgress();
			self.syncLyrics(self.audio.currentTime, false);
			self.updatePositionState();
		});
		this.audio.addEventListener('durationchange', function() {
			if (self.closed) return;
			self.duration = isNaN(self.audio.duration) ? 0 : self.audio.duration;
			refs.timeDur.textContent = formatTime(self.duration);
			refs.seek.setAttribute('aria-valuemax', String(Math.round(self.duration)));
			self.paintProgress();
			self.syncLyrics(self.audio.currentTime, true);
		});
		this.audio.addEventListener('loadedmetadata', function() {
			if (self.closed) return;
			self.duration = isNaN(self.audio.duration) ? 0 : self.audio.duration;
			refs.timeDur.textContent = formatTime(self.duration);
			var item = self.items[self.index];
			if (item) {
				item.duration = self.duration;
				self.updateRowDuration(self.index);
			}
		});
		this.audio.addEventListener('progress', function() {
			if (self.closed) return;
			var ratio = 0;
			try {
				if (self.audio.buffered.length && self.duration) {
					ratio = self.audio.buffered.end(self.audio.buffered.length - 1) / self.duration;
				}
			} catch (e) {}
			refs.seekBuffer.style.width = clamp(ratio, 0, 1) * 100 + '%';
		});
		this.audio.addEventListener('ended', function() {
			if (self.closed) return;
			self.onEnded();
		});
		this.audio.addEventListener('error', function() {
			if (self.closed || self.ignoreAudioError) return;
			self.onAudioError();
		});
		this.audio.addEventListener('volumechange', function() {
			if (self.closed) return;
			self.updateVolumeUI();
		});
	};

	Player.prototype.bindSeek = function() {
		var self = this;
		var bar = this.refs.seek;
		var update = function(e) {
			var touch = e.touches && e.touches[0] ? e.touches[0] : e;
			var rect = bar.getBoundingClientRect();
			var ratio = clamp((touch.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
			self.dragRatio = ratio;
			self.refs.seekPlayed.style.width = ratio * 100 + '%';
			self.refs.timeCur.textContent = formatTime(ratio * self.duration);
		};
		var stop = function() {
			if (!self.dragging) return;
			self.dragging = false;
			bar.classList.remove('is-dragging');
			document.removeEventListener('mousemove', onMove, false);
			document.removeEventListener('mouseup', onUp, false);
			document.removeEventListener('touchmove', onTouchMove, false);
			document.removeEventListener('touchend', onUp, false);
			if (self.duration) {
				self.audio.currentTime = clamp(self.dragRatio * self.duration, 0, self.duration);
				self.paintProgress();
				self.syncLyrics(self.audio.currentTime, true);
			}
		};
		var start = function(e) {
			if (e.type === 'mousedown') e.preventDefault();
			self.dragging = true;
			bar.classList.add('is-dragging');
			update(e);
			document.addEventListener('mousemove', onMove, false);
			document.addEventListener('mouseup', onUp, false);
			document.addEventListener('touchmove', onTouchMove, { passive: false });
			document.addEventListener('touchend', onUp, false);
		};
		var onMove = function(e) { update(e); };
		var onTouchMove = function(e) { if (e.cancelable) e.preventDefault(); update(e); };
		var onUp = function() { stop(); };

		bar.addEventListener('mousedown', start, false);
		bar.addEventListener('touchstart', function(e) { if (e.cancelable) e.preventDefault(); start(e); }, { passive: false });
		bar.addEventListener('keydown', function(e) {
			if (e.keyCode === 37) { e.preventDefault(); e.stopPropagation(); self.seekBy(-5); }
			else if (e.keyCode === 39) { e.preventDefault(); e.stopPropagation(); self.seekBy(5); }
		});
	};

	Player.prototype.bindVolume = function() {
		var self = this;
		var bar = this.refs.volume;
		var update = function(e) {
			var touch = e.touches && e.touches[0] ? e.touches[0] : e;
			var rect = bar.getBoundingClientRect();
			var ratio = clamp((touch.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
			self.setVolume(ratio);
		};
		var dragging = false;
		var stop = function() {
			dragging = false;
			document.removeEventListener('mousemove', update, false);
			document.removeEventListener('mouseup', stop, false);
			document.removeEventListener('touchmove', update, false);
			document.removeEventListener('touchend', stop, false);
		};
		bar.addEventListener('mousedown', function(e) {
			e.preventDefault();
			dragging = true;
			update(e);
			document.addEventListener('mousemove', update, false);
			document.addEventListener('mouseup', stop, false);
		});
		bar.addEventListener('touchstart', function(e) {
			if (e.cancelable) e.preventDefault();
			dragging = true;
			update(e);
			document.addEventListener('touchmove', update, false);
			document.addEventListener('touchend', stop, false);
		}, { passive: false });
		bar.addEventListener('keydown', function(e) {
			if (e.keyCode === 37) { e.preventDefault(); e.stopPropagation(); self.setVolume(clamp(self.audio.volume - 0.05, 0, 1)); }
			else if (e.keyCode === 39) { e.preventDefault(); e.stopPropagation(); self.setVolume(clamp(self.audio.volume + 0.05, 0, 1)); }
			else if (e.keyCode === 38) { e.preventDefault(); e.stopPropagation(); self.setVolume(clamp(self.audio.volume + 0.05, 0, 1)); }
			else if (e.keyCode === 40) { e.preventDefault(); e.stopPropagation(); self.setVolume(clamp(self.audio.volume - 0.05, 0, 1)); }
		});
	};

	Player.prototype.load = function(index, autoplay) {
		if (this.closed || !this.items[index]) return;
		var item = this.items[index];
		var self = this;

		this.index = index;
		this.wantPlay = !!autoplay;
		this.pendingBlobPlay = false;
		this.duration = 0;
		this.lastPositionUpdate = 0;
		this.lyricToken++;
		this.coverToken++;
		this.lyricLines = [];
		this.lineTimes = [];
		this.lyricIndex = -1;
		this.lyricHoldUntil = 0;

		this.abortBlob();
		this.abortLyric();

		try { this.audio.pause(); } catch (e) {}
		this.setPlayingUI(false);
		this.setBlocked(false);
		this.refs.kickerText.textContent = autoplay ? '正在加载歌曲' : '已暂停';

		var bagPosition = this.shuffleBag.indexOf(index);
		if (bagPosition >= 0) this.shuffleBag.splice(bagPosition, 1);

		this.refs.timeCur.textContent = '00:00';
		this.refs.timeDur.textContent = '00:00';
		this.refs.seekPlayed.style.width = '0%';
		this.refs.seekBuffer.style.width = '0%';
		this.refs.seek.setAttribute('aria-valuenow', '0');
		this.setLoading(true);
		this.showDownload(false);

		this.setTrack(item);
		this.updatePlaylistActive();

		/* Start the audio first: cover and lyric requests must never delay playback. */
		var src = this.blobCache[item.path];
		if (src) {
			this.audio.src = src;
			this.expectedSrc = this.audio.src;
			this.audio.load();
			if (autoplay) this.playAudio();
		} else {
			/* Fast path: let the browser stream the original file with range requests. */
			this.audio.src = item.url;
			this.expectedSrc = this.audio.src;
			this.audio.load();
			if (autoplay) this.playAudio();
		}

		this.loadCover(item, true);
		if (this.settings.lyric) {
			if (Object.prototype.hasOwnProperty.call(this.lyricCache, item.path)) {
				this.applyLyrics(this.lyricCache[item.path], item, index);
			} else {
				this.showLyricEmpty('正在加载歌词…', '让旋律先响起来');
				setTimeout(function() {
					if (self.closed || self.index !== index) return;
					self.fetchLyrics(item, index);
				}, 180);
			}
		} else {
			this.showLyricEmpty('歌词功能已关闭', '可在插件设置中开启自动加载歌词');
		}
		this.updateMediaSession(item);
	};

	Player.prototype.setTrack = function(item) {
		var refs = this.refs;
		refs.title.textContent = item.name;
		refs.title.title = item.name;
		refs.artist.textContent = item.artist;
		refs.format.textContent = item.ext ? item.ext.toUpperCase() : '';
		refs.format.style.display = item.ext ? '' : 'none';
	};

	Player.prototype.loadCover = function(item, delay) {
		var self = this;
		var token = ++this.coverToken;
		var pair = FALLBACK_GRADIENTS[hashHue(item.name + '|' + item.artist) % FALLBACK_GRADIENTS.length];
		var fallback = 'linear-gradient(135deg, ' + pair[0] + ', ' + pair[1] + ')';

		this.currentCover = '';
		this.refs.art.style.background = fallback;
		this.refs.vinylLabel.style.background = fallback;
		this.refs.artFallback.style.opacity = '1';
		this.refs.art.classList.remove('has-cover');
		this.refs.bgImage.classList.remove('is-on');
		this.refs.bgImage.style.backgroundImage = '';
		this.refs.bgVeil.style.background = 'linear-gradient(180deg, rgba(7,9,18,.3), rgba(7,9,18,.94)), radial-gradient(circle at 24% 18%, rgba(255,138,76,.16), transparent 46%), radial-gradient(circle at 82% 78%, rgba(124,92,255,.12), transparent 46%)';

		if (!this.settings.cover) return;

		var start = function() {
			if (token !== self.coverToken || self.closed) return;

			var folderKey = item.folder || '';
			var cachedFolder = self.coverFolderCache[folderKey];
			var candidates = [];
			if (item.cover) candidates.push(item.cover);
			if (cachedFolder) {
				if (cachedFolder !== item.cover) candidates.push(cachedFolder);
			} else if (cachedFolder === undefined && item.coverFallback && item.coverFallback !== item.cover) {
				candidates.push(item.coverFallback);
			}
			if (!candidates.length) return;

			var tryNext = function() {
				if (token !== self.coverToken || self.closed) return;
				var url = candidates.shift();
				if (!url) return;
				var img = new Image();
				img.onload = function() {
					if (token !== self.coverToken || self.closed) return;
					if (url === item.coverFallback) self.coverFolderCache[folderKey] = url;
					self.currentCover = url;
					self.refs.artImg.style.backgroundImage = cssUrl(url);
					self.refs.art.classList.add('has-cover');
					self.refs.artFallback.style.opacity = '0';
					self.refs.bgImage.style.backgroundImage = cssUrl(url);
					self.refs.bgImage.classList.add('is-on');
					self.updateMediaSession(self.items[self.index]);
				};
				img.onerror = function() {
					if (url === item.coverFallback) self.coverFolderCache[folderKey] = '';
					tryNext();
				};
				img.src = url;
			};
			tryNext();
		};

		if (delay) setTimeout(start, 160);
		else start();
	};

	Player.prototype.fetchLyrics = function(item, index) {
		var self = this;
		var key = item.path;

		if (Object.prototype.hasOwnProperty.call(this.lyricCache, key)) {
			this.applyLyrics(this.lyricCache[key], item, index);
			return;
		}

		this.lyricToken++;
		var token = this.lyricToken;
		this.showLyricEmpty('正在加载歌词…', '让旋律先响起来');

		var xhr = new XMLHttpRequest();
		this.lyricXhr = xhr;
		var finish = function(text, failed) {
			if (self.closed) return;
			var lines = failed ? [] : parseLrc(text);
			self.lyricCache[key] = lines;
			if (token !== self.lyricToken || self.index !== index) return;
			self.applyLyrics(lines, item, index);
		};

		try {
			xhr.open('GET', pathUrl(basePath(item.path) + '.lrc'), true);
		} catch (e) {
			finish('', true);
			return;
		}
		xhr.timeout = 6000;
		xhr.onload = function() {
			if (xhr.status >= 200 && xhr.status < 300) finish(xhr.responseText || '', false);
			else finish('', true);
		};
		xhr.onerror = function() { finish('', true); };
		xhr.ontimeout = function() { finish('', true); };
		xhr.onabort = function() {};
		try { xhr.send(null); } catch (e) { finish('', true); }
	};

	Player.prototype.applyLyrics = function(lines, item, index) {
		if (this.closed || this.index !== index) return;
		this.lyricLines = lines || [];
		this.lineTimes = [];
		this.lyricIndex = -1;

		if (!lines || !lines.length) {
			this.showLyricEmpty('暂无歌词', '把注意力交给旋律');
			return;
		}

		var fragment = document.createDocumentFragment();
		for (var i = 0; i < lines.length; i++) {
			this.lineTimes.push(lines[i].time);
			var line = document.createElement('button');
			line.type = 'button';
			line.className = 'ap-lyric-line';
			line.setAttribute('data-time', String(lines[i].time));
			line.textContent = lines[i].text;
			fragment.appendChild(line);
		}

		this.refs.lyricList.innerHTML = '';
		this.refs.lyricList.appendChild(fragment);
		this.refs.lyricEmpty.classList.remove('is-visible');
		this.refs.lyricHint.style.visibility = 'visible';
		this.updateLyricPadding();
		this.refs.lyricScroll.scrollTop = 0;
		this.lyricIndex = -1;
		this.syncLyrics(this.audio.currentTime, true);
	};

	Player.prototype.updateLyricPadding = function() {
		var scroll = this.refs.lyricScroll;
		if (!scroll) return;
		var height = scroll.clientHeight || 0;
		var padding = Math.max(18, Math.round(height / 2 - 28));
		scroll.style.paddingTop = padding + 'px';
		scroll.style.paddingBottom = padding + 'px';
	};

	Player.prototype.showLyricEmpty = function(title, sub) {
		this.refs.lyricEmptyTitle.textContent = title;
		this.refs.lyricEmptySub.textContent = sub;
		this.refs.lyricEmpty.classList.add('is-visible');
		this.refs.lyricHint.style.visibility = 'hidden';
		this.refs.lyricList.innerHTML = '';
		this.lyricLines = [];
		this.lineTimes = [];
		this.lyricIndex = -1;
	};

	Player.prototype.syncLyrics = function(time, force) {
		if (!this.lineTimes.length) return;
		if (!force && new Date().getTime() < this.lyricHoldUntil) return;

		var index = -1;
		if (time >= this.lineTimes[0]) {
			var low = 0;
			var high = this.lineTimes.length - 1;
			while (low <= high) {
				var mid = (low + high) >> 1;
				if (this.lineTimes[mid] <= time) {
					index = mid;
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
		}

		if (index === this.lyricIndex && !force) return;
		var nodes = this.refs.lyricList.children;
		if (this.lyricIndex >= 0 && nodes[this.lyricIndex]) {
			nodes[this.lyricIndex].classList.remove('is-current');
		}
		this.lyricIndex = index;
		if (index >= 0 && nodes[index]) {
			nodes[index].classList.add('is-current');
			if (new Date().getTime() >= this.lyricHoldUntil) this.scrollLyricTo(nodes[index]);
		}
	};

	Player.prototype.scrollLyricTo = function(node) {
		if (!node) return;
		var scroll = this.refs.lyricScroll;
		var top = node.offsetTop - scroll.clientHeight / 2 + node.offsetHeight / 2;
		try {
			scroll.scrollTo({ top: top, behavior: 'smooth' });
		} catch (e) {
			scroll.scrollTop = top;
		}
	};

	Player.prototype.playAudio = function() {
		if (this.closed) return;
		this.wantPlay = true;
		var item = this.items[this.index];
		if (item && item.blobLoading) return;
		if (item && item.needsBlob) {
			item.needsBlob = false;
			this.loadBlob(item, true, '正在切换兼容播放模式');
			return;
		}
		var self = this;
		var promise = this.audio.play();
		if (promise && promise['catch']) {
			promise['catch'](function(error) {
				if (!error || self.closed) return;
				if (error.name === 'NotAllowedError') {
					self.wantPlay = false;
					self.setLoading(false);
					self.setPlayingUI(false);
					self.setBlocked(true);
					self.toast('轻触封面开始播放');
				} else if (error.name !== 'AbortError') {
					self.wantPlay = false;
					self.setLoading(false);
					self.setPlayingUI(false);
				}
			});
		}
	};

	Player.prototype.toggle = function() {
		if (this.closed) return;
		var item = this.items[this.index];
		if (item && item.blobLoading) {
			this.toast('正在加载音频，请稍候');
			return;
		}
		if (item && item.needsBlob) {
			item.needsBlob = false;
			this.wantPlay = true;
			this.loadBlob(item, true, '正在切换兼容播放模式');
			return;
		}
		if (!this.audio.src) {
			this.load(this.index, true);
			return;
		}
		if (this.audio.ended) {
			this.audio.currentTime = 0;
		}
		if (this.audio.paused) {
			this.playAudio();
		} else {
			this.wantPlay = false;
			this.audio.pause();
		}
	};

	Player.prototype.onEnded = function() {
		if (this.loop === 'one') {
			this.audio.currentTime = 0;
			this.playAudio();
			return;
		}
		var last = this.items.length - 1;
		if (this.order === 'list' && this.loop === 'none' && this.index >= last) {
			this.wantPlay = false;
			this.setPlayingUI(false);
			return;
		}
		if (this.items.length <= 1) {
			this.audio.currentTime = 0;
			this.playAudio();
			return;
		}
		if (this.order === 'random' && this.loop === 'none' && !this.shuffleBag.length) {
			this.wantPlay = false;
			this.setPlayingUI(false);
			return;
		}
		this.next();
	};

	Player.prototype.next = function() {
		if (this.items.length <= 1) {
			this.audio.currentTime = 0;
			return;
		}
		var index;
		if (this.order === 'random') {
			if (!this.shuffleBag.length) this.refillShuffle();
			index = this.shuffleBag.pop();
			if (index === undefined) index = (this.index + 1) % this.items.length;
		} else {
			index = (this.index + 1) % this.items.length;
		}
		this.load(index, true);
	};

	Player.prototype.prev = function() {
		if (this.items.length <= 1) {
			this.audio.currentTime = 0;
			return;
		}
		if (this.audio.currentTime > 4) {
			this.audio.currentTime = 0;
			return;
		}
		var index;
		if (this.order === 'random') {
			if (!this.shuffleBag.length) this.refillShuffle();
			index = this.shuffleBag.pop();
			if (index === undefined) index = (this.index - 1 + this.items.length) % this.items.length;
		} else {
			index = (this.index - 1 + this.items.length) % this.items.length;
		}
		this.load(index, true);
	};

	Player.prototype.refillShuffle = function() {
		var bag = [];
		for (var i = 0; i < this.items.length; i++) {
			if (i !== this.index) bag.push(i);
		}
		for (var j = bag.length - 1; j > 0; j--) {
			var k = Math.floor(Math.random() * (j + 1));
			var temp = bag[j];
			bag[j] = bag[k];
			bag[k] = temp;
		}
		this.shuffleBag = bag;
	};

	Player.prototype.toggleOrder = function() {
		this.order = this.order === 'list' ? 'random' : 'list';
		this.shuffleBag = [];
		storageSet(STORAGE_ORDER, this.order);
		this.applyModes();
		this.toast(this.order === 'random' ? '随机播放' : '列表顺序播放');
	};

	Player.prototype.toggleLoop = function() {
		this.loop = this.loop === 'all' ? 'one' : (this.loop === 'one' ? 'none' : 'all');
		storageSet(STORAGE_LOOP, this.loop);
		this.applyModes();
		this.toast(this.loop === 'all' ? '列表循环' : (this.loop === 'one' ? '单曲循环' : '关闭循环'));
	};

	Player.prototype.applyModes = function() {
		var refs = this.refs;
		if (!refs || !refs.shuffle) return;
		refs.shuffle.classList.toggle('is-active', this.order === 'random');
		refs.shuffle.title = this.order === 'random' ? '随机播放：开' : '随机播放：关';
		refs.repeat.classList.toggle('is-active', this.loop !== 'none');
		refs.repeat.classList.toggle('is-one', this.loop === 'one');
		refs.repeat.innerHTML = ICONS.repeat + (this.loop === 'one' ? '<span class="ap-repeat-one">1</span>' : '');
		refs.repeat.title = this.loop === 'all' ? '列表循环' : (this.loop === 'one' ? '单曲循环' : '关闭循环');
	};

	Player.prototype.seekBy = function(seconds) {
		if (!this.duration) return;
		this.audio.currentTime = clamp(this.audio.currentTime + seconds, 0, this.duration);
		this.paintProgress();
		this.syncLyrics(this.audio.currentTime, true);
	};

	Player.prototype.paintProgress = function() {
		var duration = this.duration || (isNaN(this.audio.duration) ? 0 : this.audio.duration);
		var ratio = duration ? clamp(this.audio.currentTime / duration, 0, 1) : 0;
		if (!this.dragging) {
			this.refs.seekPlayed.style.width = ratio * 100 + '%';
			this.refs.timeCur.textContent = formatTime(this.audio.currentTime);
		}
		this.refs.seek.setAttribute('aria-valuenow', String(Math.round(this.audio.currentTime)));
		this.refs.seek.setAttribute('aria-valuemax', String(Math.round(duration)));
	};

	Player.prototype.setLoading = function(on) {
		this.loading = !!on;
		var show = !!on && (this.wantPlay || !this.audio.paused);
		this.refs.overlay.classList.toggle('is-loading', show);
		this.refs.playBtn.classList.toggle('is-loading', show);
	};

	Player.prototype.setBlocked = function(blocked) {
		this.blocked = !!blocked;
		this.refs.overlay.classList.toggle('is-blocked', this.blocked);
		if (this.blocked) this.refs.kickerText.textContent = '轻触封面开始播放';
	};

	Player.prototype.setPlayingUI = function(playing) {
		this.refs.overlay.classList.toggle('is-playing', !!playing);
		this.refs.playIcon.innerHTML = playing ? ICONS.pause : ICONS.play;
		this.refs.playBtn.title = playing ? '暂停（空格）' : '播放（空格）';
		if (playing) {
			this.setBlocked(false);
			this.refs.kickerText.textContent = '正在播放';
		} else if (!this.blocked) {
			this.refs.kickerText.textContent = '已暂停';
		}
		if (playing) this.setLoading(false);
		if ('mediaSession' in navigator) {
			try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) {}
		}
	};

	Player.prototype.setVolume = function(value) {
		value = clamp(value, 0, 1);
		this.audio.muted = false;
		this.audio.volume = value;
		this.lastVolume = value;
		storageSet(STORAGE_VOLUME, String(value));
		this.updateVolumeUI();
	};

	Player.prototype.toggleMute = function() {
		if (this.audio.muted) {
			this.audio.muted = false;
			if (this.audio.volume === 0) this.audio.volume = this.lastVolume || 0.8;
		} else {
			this.lastVolume = this.audio.volume || this.lastVolume || 0.8;
			this.audio.muted = true;
		}
		this.updateVolumeUI();
	};

	Player.prototype.updateVolumeUI = function() {
		var value = this.audio.muted ? 0 : this.audio.volume;
		this.refs.volumeFill.style.width = clamp(value, 0, 1) * 100 + '%';
		this.refs.volume.setAttribute('aria-valuenow', String(Math.round(value * 100)));
		this.refs.mute.innerHTML = value > 0 ? ICONS.volume : ICONS.mute;
		this.refs.mute.classList.toggle('is-active', this.audio.muted);
		this.refs.mute.title = this.audio.muted ? '取消静音' : '静音';
	};

	Player.prototype.showDownload = function(visible, text, percent) {
		var refs = this.refs;
		if (!visible) {
			refs.overlay.classList.remove('is-downloading');
			refs.downloadText.textContent = '';
			refs.downloadBar.style.width = '0%';
			refs.download.classList.remove('is-indeterminate');
			return;
		}
		refs.overlay.classList.add('is-downloading');
		refs.downloadText.textContent = text || '正在加载音频';
		if (percent === undefined || percent === null || percent < 0) {
			refs.download.classList.add('is-indeterminate');
			refs.downloadBar.style.width = '38%';
		} else {
			refs.download.classList.remove('is-indeterminate');
			refs.downloadBar.style.width = clamp(percent, 0, 100) + '%';
		}
	};

	Player.prototype.onAudioError = function() {
		if (this.expectedSrc && this.audio.currentSrc && this.audio.currentSrc !== this.expectedSrc) return;
		var item = this.items[this.index];
		if (!item) return;
		var error = this.audio.error;
		if (error && error.code === 1) return;

		if (!item.blobTried) {
			item.blobTried = true;
			if (!this.wantPlay) {
				item.needsBlob = true;
				this.setLoading(false);
				this.setPlayingUI(false);
				return;
			}
			this.toast('正在切换兼容播放模式…');
			this.loadBlob(item, true, '正在切换兼容播放模式');
			return;
		}

		this.setLoading(false);
		this.setPlayingUI(false);
		this.toast('无法播放这首歌曲' + (error && error.code === 4 ? '：浏览器不支持该格式' : '：文件加载失败'));
	};

	Player.prototype.loadBlob = function(item, autoplay, reason) {
		var self = this;
		var index = this.index;
		if (this.blobCache[item.path]) {
			this.audio.src = this.blobCache[item.path];
			this.expectedSrc = this.audio.src;
			this.audio.load();
			if (autoplay) this.playAudio();
			return;
		}
		if (item.blobLoading) return;

		item.blobLoading = true;
		this.pendingBlobPlay = !!autoplay;
		this.showDownload(true, reason || '正在加载音频', 0);
		this.setLoading(true);

		var xhr = new XMLHttpRequest();
		this.blobXhr = xhr;
		var finish = function(failed, errorText) {
			item.blobLoading = false;
			if (self.closed) return;
			if (self.blobXhr === xhr) self.blobXhr = null;
			if (failed) {
				self.showDownload(false);
				self.setLoading(false);
				self.setPlayingUI(false);
				self.toast(errorText || '音频加载失败');
			}
		};

		try {
			xhr.open('GET', item.url, true);
		} catch (e) {
			finish(true, '音频地址无效');
			return;
		}
		xhr.responseType = 'blob';
		xhr.timeout = 0;
		xhr.onprogress = function(event) {
			if (self.closed || self.index !== index) return;
			if (event.lengthComputable && event.total) {
				self.showDownload(true, '正在转换为兼容播放 ' + Math.round(event.loaded / event.total * 100) + '%', event.loaded / event.total * 100);
			} else {
				self.showDownload(true, '正在加载音频', -1);
			}
		};
		xhr.onload = function() {
			if (self.closed) return;
			if (xhr.status < 200 || xhr.status >= 300) {
				finish(true, '音频加载失败：HTTP ' + xhr.status);
				return;
			}
			var blob = xhr.response;
			try {
				blob = new Blob([blob], { type: BLOB_MIME[item.ext] || 'application/octet-stream' });
			} catch (e) {}
			var url;
			try {
				url = URL.createObjectURL(blob);
			} catch (e) {
				finish(true, '浏览器不支持兼容播放');
				return;
			}
			item.blobLoading = false;
			if (self.blobXhr === xhr) self.blobXhr = null;
			self.cacheBlob(item.path, url);
			if (self.closed) {
				URL.revokeObjectURL(url);
				return;
			}
			self.showDownload(false);
			if (self.index !== index) return;
			self.audio.src = url;
			self.expectedSrc = self.audio.src;
			self.audio.load();
			if (self.pendingBlobPlay) self.playAudio();
		};
		xhr.onerror = function() { finish(true, '音频加载失败'); };
		xhr.ontimeout = function() { finish(true, '音频加载超时'); };
		xhr.onabort = function() { item.blobLoading = false; };
		try { xhr.send(null); } catch (e) { finish(true, '音频加载失败'); }
	};

	Player.prototype.cacheBlob = function(path, url) {
		if (this.blobCache[path]) {
			try { URL.revokeObjectURL(this.blobCache[path]); } catch (e) {}
		}
		this.blobCache[path] = url;
		var existing = this.blobOrder.indexOf(path);
		if (existing >= 0) this.blobOrder.splice(existing, 1);
		this.blobOrder.push(path);
		while (this.blobOrder.length > 2) {
			var old = this.blobOrder[0];
			if (old === path || !this.blobCache[old]) {
				this.blobOrder.shift();
				continue;
			}
			if (this.audio.src === this.blobCache[old]) break;
			this.blobOrder.shift();
			try { URL.revokeObjectURL(this.blobCache[old]); } catch (e) {}
			delete this.blobCache[old];
		}
	};

	Player.prototype.abortBlob = function() {
		if (this.blobXhr) {
			try { this.blobXhr.abort(); } catch (e) {}
			this.blobXhr = null;
		}
	};

	Player.prototype.abortLyric = function() {
		if (this.lyricXhr) {
			try { this.lyricXhr.abort(); } catch (e) {}
			this.lyricXhr = null;
		}
	};

	Player.prototype.renderPlaylist = function() {
		var html = '';
		for (var i = 0; i < this.items.length; i++) {
			var item = this.items[i];
			var search = (item.name + ' ' + item.artist + ' ' + item.ext).toLowerCase();
			html += '<button type="button" class="ap-row" role="listitem" data-index="' + i + '" data-search="' + esc(search) + '">' +
				'<span class="ap-row-index">' + (i + 1) + '</span>' +
				'<span class="ap-row-eq"><i></i><i></i><i></i></span>' +
				'<span class="ap-row-main"><span class="ap-row-title">' + esc(item.name) + '</span><span class="ap-row-artist">' + esc(item.artist) + '</span></span>' +
				'<span class="ap-row-dur">' + (item.duration ? formatTime(item.duration) : '') + '</span>' +
				'<span class="ap-row-ext">' + esc(item.ext ? item.ext.toUpperCase() : '') + '</span>' +
			'</button>';
		}
		this.refs.list.innerHTML = html;
		this.rowNodes = this.refs.list.children;
		this.refs.count.textContent = String(this.items.length);
		this.refs.listEmpty.classList.remove('is-visible');
		this.updatePlaylistActive();
	};

	Player.prototype.updatePlaylistActive = function() {
		if (!this.rowNodes) return;
		for (var i = 0; i < this.rowNodes.length; i++) {
			this.rowNodes[i].classList.toggle('is-active', i === this.index);
			if (i === this.index) this.rowNodes[i].setAttribute('aria-current', 'true');
			else this.rowNodes[i].removeAttribute('aria-current');
		}
	};

	Player.prototype.updateRowDuration = function(index) {
		if (!this.rowNodes || !this.rowNodes[index]) return;
		var item = this.items[index];
		var node = this.rowNodes[index].querySelector('.ap-row-dur');
		if (node && item) node.textContent = item.duration ? formatTime(item.duration) : '';
	};

	Player.prototype.filterList = function() {
		var query = String(this.refs.search.value || '').replace(/^\s+|\s+$/g, '').toLowerCase();
		var visible = 0;
		for (var i = 0; i < this.rowNodes.length; i++) {
			var row = this.rowNodes[i];
			var matched = !query || String(row.getAttribute('data-search') || '').indexOf(query) >= 0;
			row.hidden = !matched;
			if (matched) visible++;
		}
		this.refs.listEmpty.classList.toggle('is-visible', visible === 0);
		this.refs.count.textContent = String(query ? visible : this.items.length);
	};

	Player.prototype.toggleList = function() {
		this.setListOpen(!this.listOpen);
	};

	Player.prototype.setListOpen = function(open) {
		this.listOpen = !!open;
		this.refs.overlay.classList.toggle('is-list-open', this.listOpen);
		this.refs.drawer.setAttribute('aria-hidden', this.listOpen ? 'false' : 'true');
		this.refs.openList.setAttribute('aria-expanded', this.listOpen ? 'true' : 'false');
		this.refs.listBtn.setAttribute('aria-expanded', this.listOpen ? 'true' : 'false');
		if (this.listOpen) {
			this.filterList();
			var self = this;
			setTimeout(function() {
				if (self.closed || !self.listOpen) return;
				var row = self.rowNodes && self.rowNodes[self.index];
				if (row) {
					var top = row.offsetTop - self.refs.list.clientHeight / 2 + row.offsetHeight / 2;
					self.refs.list.scrollTop = Math.max(0, top);
				}
			}, 120);
		}
	};

	Player.prototype.toast = function(message, duration) {
		var self = this;
		var node = this.refs.toast;
		node.textContent = message;
		node.classList.add('is-visible');
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(function() {
			node.classList.remove('is-visible');
		}, duration || 2600);
	};

	Player.prototype.updateMediaSession = function(item) {
		if (!('mediaSession' in navigator)) return;
		if (window.MediaMetadata) {
			try {
				var artwork = [];
				if (this.currentCover) {
					artwork.push({ src: this.currentCover, type: 'image/jpeg' });
				}
				navigator.mediaSession.metadata = new MediaMetadata({
					title: item.name,
					artist: item.artist,
					album: item.artist,
					artwork: artwork
				});
			} catch (e) {}
		}

		if (this.mediaHandlers) return;
		this.mediaHandlers = true;
		var self = this;
		try {
			navigator.mediaSession.setActionHandler('play', function() { self.playAudio(); });
			navigator.mediaSession.setActionHandler('pause', function() { self.audio.pause(); });
			navigator.mediaSession.setActionHandler('previoustrack', function() { self.prev(); });
			navigator.mediaSession.setActionHandler('nexttrack', function() { self.next(); });
			navigator.mediaSession.setActionHandler('seekbackward', function() { self.seekBy(-10); });
			navigator.mediaSession.setActionHandler('seekforward', function() { self.seekBy(10); });
			navigator.mediaSession.setActionHandler('seekto', function(details) {
				if (details && details.seekTime !== undefined) self.audio.currentTime = details.seekTime;
			});
		} catch (e) {}
	};

	Player.prototype.updatePositionState = function() {
		if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
		if (!this.duration || isNaN(this.duration)) return;
		var now = new Date().getTime();
		if (now - this.lastPositionUpdate < 900) return;
		this.lastPositionUpdate = now;
		try {
			navigator.mediaSession.setPositionState({
				duration: this.duration,
				playbackRate: this.audio.playbackRate || 1,
				position: clamp(this.audio.currentTime, 0, this.duration)
			});
		} catch (e) {}
	};

	Player.prototype.close = function() {
		if (this.closed) return;
		this.closed = true;
		this.abortBlob();
		this.abortLyric();
		try {
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
		} catch (e) {}
		for (var path in this.blobCache) {
			if (Object.prototype.hasOwnProperty.call(this.blobCache, path)) {
				try { URL.revokeObjectURL(this.blobCache[path]); } catch (e) {}
			}
		}
		this.blobCache = Object.create(null);
		this.blobOrder = [];
		if (this.keyHandler) {
			document.removeEventListener('keydown', this.keyHandler, false);
			this.keyHandler = null;
		}
		if (this.resizeHandler) {
			window.removeEventListener('resize', this.resizeHandler, false);
			this.resizeHandler = null;
		}
		if (this.toastTimer) clearTimeout(this.toastTimer);
		if (this.lyricHoldTimer) clearTimeout(this.lyricHoldTimer);
		document.body.style.overflow = this.previousOverflow || '';
		var el = this.el;
		if (el) {
			el.classList.remove('is-open');
			setTimeout(function() {
				if (el && el.parentNode) el.parentNode.removeChild(el);
			}, 260);
		}
		if ('mediaSession' in navigator) {
			var actions = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'];
			for (var a = 0; a < actions.length; a++) {
				try { navigator.mediaSession.setActionHandler(actions[a], null); } catch (e) {}
			}
			try { navigator.mediaSession.metadata = null; } catch (e) {}
		}
		if (active === this) active = null;
	};

	function play(appStatic, list, settings) {
		settings = resolveSettings(settings);
		var items = normalizeList(list, settings);
		if (!items.length) {
			tips('没有可播放的音频文件');
			return;
		}
		ensureCss(appStatic);
		if (active) active.close();
		active = new Player(appStatic, items, settings);
	}

	return {
		play: play
	};
});
