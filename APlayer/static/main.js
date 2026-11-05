kodReady.push(function(){
	var extList = String("{{config.fileExt}}").split(',');
	var audioExts = [];
	for(var i = 0; i < extList.length; i++){
		var ext = $.trim(extList[i]).toLowerCase();
		if(ext) audioExts.push(ext);
	}

	var settings = {
		autoplay: parseInt("{{config.autoplay}}", 10) || 0,
		lyric: parseInt("{{config.lyric}}", 10) || 0,
		cover: parseInt("{{config.cover}}", 10) || 0
	};

	var appStatic = "{{pluginHost}}static/";
	var frameTop = ShareData.frameTop();
	var playerApp = null;
	var playerLoading = false;
	var playerQueue = [];
	var playerTimer = null;
	var playerWanted = false;

	/*
	 * Keep player.js ready before the user taps a song. Calling play() inside the
	 * original tap event is what lets iOS/Android start audio without an extra tap.
	 */
	var getPlayer = function(callback, quiet){
		if(playerApp){
			callback(playerApp);
			return;
		}
		if(!quiet) playerWanted = true;
		playerQueue.push(callback);
		if(playerLoading) return;
		playerLoading = true;
		playerTimer = setTimeout(function(){
			if(playerLoading && !playerApp){
				playerLoading = false;
				playerQueue = [];
				if(playerWanted){
					try{ Tips.tips('播放器加载超时，请重试', false); }catch(err){}
				}
			}
		}, 8000);
		try{
			frameTop.require.async(appStatic + 'player.js', function(app){
				if(playerTimer){ clearTimeout(playerTimer); playerTimer = null; }
				playerApp = app;
				playerLoading = false;
				playerWanted = false;
				var queue = playerQueue;
				playerQueue = [];
				for(var i = 0; i < queue.length; i++) queue[i](app);
			});
		}catch(e){
			if(playerTimer){ clearTimeout(playerTimer); playerTimer = null; }
			var wanted = playerWanted;
			playerLoading = false;
			playerWanted = false;
			playerQueue = [];
			if(wanted){
				try{ Tips.tips('APlayer 加载失败', false); }catch(err){}
			}
		}
	};

	var warmCss = function(){
		try{
			var doc = frameTop.document;
			if(doc.getElementById('aplayer-plugin-css')) return;
			var link = doc.createElement('link');
			link.id = 'aplayer-plugin-css';
			link.rel = 'stylesheet';
			link.href = appStatic + 'player.css?v=1.1.1';
			link.onload = function(){ link.setAttribute('data-ready', '1'); };
			var head = doc.head || doc.getElementsByTagName('head')[0];
			if(head) head.appendChild(link);
		}catch(e){}
	};

	var warmPlayer = function(){
		warmCss();
		getPlayer(function(){}, true);
	};

	/* 350ms after the file manager is ready: player.js is cached before the first tap. */
	setTimeout(warmPlayer, 350);

	var openPlayer = function(list){
		if(!list || !list.length) return;
		getPlayer(function(app){
			app.play(appStatic, list, settings);
		});
	};

	var makeItem = function(path, ext, name){
		return {
			path: path,
			ext: String(ext || core.pathExt(path)).toLowerCase(),
			name: name || urlDecode(core.pathThis(path))
		};
	};

	kodApp.add({
		name: "APlayer",
		title: (window.LNG && window.LNG['Plugin.default.APlayer']) || 'APlayer音乐播放器',
		ext: "{{config.fileExt}}",
		sort: "{{config.fileSort}}",
		icon: '{{pluginHost}}static/images/icon.png',
		callback: function(path, ext){
			openPlayer([makeItem(path, ext)]);
		}
	});

	if($.contextMenu && $.contextMenu.menuAdd){
		var menuOpt = {
			'aplayer-play': {
				name: '用 APlayer 播放',
				className: 'aplayer-play hidden',
				icon: 'x-item-file x-mp3',
				accesskey: 'p',
				callback: function(){
					var selected = ui.fileLight.fileListSelect();
					if(selected.length < 1) return;
					var list = [];
					selected.each(function(){
						var $item = $(this);
						var ext = String(ui.fileLight.type($item) || '').toLowerCase();
						if($.inArray(ext, audioExts) === -1) return;
						var path = ui.fileLight.path($item);
						if(!path) return;
						list.push(makeItem(path, ext));
					});
					if(!list.length){
						Tips.tips('请选择音频文件', false);
						return;
					}
					openPlayer(list);
				}
			}
		};
		$.contextMenu.menuAdd(menuOpt, '.menu-more', false, '.clone');

		if(window.Hook && Hook.bind){
			Hook.bind('rightMenu.show.menu-more', function($menuAt, $theMenu){
				var needMenu = 0;
				ui.fileLight.fileListSelect().each(function(){
					var ext = String(ui.fileLight.type($(this)) || '').toLowerCase();
					if($.inArray(ext, audioExts) !== -1) needMenu++;
				});
				var $item = $theMenu.find('.aplayer-play');
				if(needMenu === 0) $item.addClass('hidden');
				else $item.removeClass('hidden');
			});
		}
	}
});
