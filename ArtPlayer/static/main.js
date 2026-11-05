kodReady.push(function(){
	kodApp.add({
		name:"ArtPlayer",
		title:(window.LNG && window.LNG['Plugin.default.ArtPlayer']) || 'ArtPlayer播放器',
		ext:"{{config.fileExt}}",
		sort:"{{config.fileSort}}",
		icon:'{{pluginHost}}static/images/icon.png',
		callback:function(path,ext){
			ext = String(ext || '').toLowerCase();
			if(isWap() && G.ACT != 'file'){
				return window.open(core.path2url(path));
			}
			var video = {
				url:core.path2url(path),
				name:urlDecode(core.pathThis(path)),
				path:path,
				ext:ext
			};
			var appStatic = "{{pluginHost}}static/";
			var top = ShareData.frameTop();
			top.require.async(appStatic + 'page.js', function(app){
				app.play(appStatic, video);
			});
		}
	});

	window.ArtPlayerAutoplay = parseInt("{{config.autoplay}}", 10) || 0;
	window.ArtPlayerSubtitle = parseInt("{{config.subtitle}}", 10) || 0;
	window.ArtPlayerDanmaku  = parseInt("{{config.danmaku}}", 10) || 0;
});
