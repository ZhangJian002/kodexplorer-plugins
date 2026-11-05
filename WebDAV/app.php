<?php
/**
 * KodExplorer WebDAV plugin
 *
 * The WebDAV protocol endpoint is webdav.php (direct access, Basic Auth).
 * This file only provides the plugin registration and the help/status page.
 */
class WebDAVPlugin extends PluginBase {
	function __construct(){
		parent::__construct();
	}

	public function regiest(){
		$this->hookRegiest(array(
			'templateCommonHeader' => 'WebDAVPlugin.addMenu'
		));
	}

	public function addMenu(){
		navbar_menu_add(array(
			'name'     => 'WebDAV',
			'icon'     => $this->appIcon(),
			'url'      => $this->pluginApi,
			'target'   => '_blank',
			'use'      => '1',
			'subMenu'  => array()
		));
	}

	public function index(){
		$cfg    = $this->getConfig();
		$url    = rtrim($this->pluginHost, '/') . '/webdav.php/';

		/* Reverse proxy sub-path, e.g. /yunpan/plugins/WebDAV/webdav.php/ */
		$prefix = isset($_SERVER['HTTP_X_FORWARDED_PREFIX']) ? trim($_SERVER['HTTP_X_FORWARDED_PREFIX']) : '';
		if ($prefix !== '' && $prefix[0] !== '/') $prefix = '/' . $prefix;
		$prefix = rtrim($prefix, '/');
		if ($prefix !== '') {
			$parts = parse_url($url);
			$path = isset($parts['path']) ? $parts['path'] : '';
			if ($path !== '' && strpos($path, $prefix . '/') !== 0) {
				$path = $prefix . '/' . ltrim($path, '/');
				$url = (isset($parts['scheme']) ? $parts['scheme'] . '://' : '') .
					(isset($parts['host']) ? $parts['host'] : '') .
					(isset($parts['port']) ? ':' . $parts['port'] : '') .
					$path;
			}
		}

		$user   = isset($_SESSION['kodUser']) && is_array($_SESSION['kodUser']) ? $_SESSION['kodUser'] : array();
		$name   = isset($user['name']) ? $user['name'] : '';
		$scheme = function_exists('http_type') ? http_type() : 'http';
		$https  = ($scheme === 'https');
		$readonly  = isset($cfg['readonly']) && $cfg['readonly'] == '1';
		$recycle   = !isset($cfg['recycle']) || $cfg['recycle'] != '0';
		$forceHttps= isset($cfg['forceHttps']) && $cfg['forceHttps'] == '1';
		$maxDepth  = isset($cfg['maxDepth']) ? intval($cfg['maxDepth']) : 3;
		$maxItems  = isset($cfg['maxItems']) ? intval($cfg['maxItems']) : 5000;
		$version   = $this->packageVersion();

		header('Content-Type: text/html; charset=utf-8');
		header('Cache-Control: no-store, no-cache, must-revalidate');
		$e = function($v){ return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); };
		$icon = $this->appIcon();
		$safeUrl = $e($url);
		$safeName = $e($name);
		$safeVersion = $e($version);
		?>
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WebDAV 网络磁盘</title>
<style>
	*{box-sizing:border-box}
	html,body{margin:0;padding:0;background:#eef2f8;color:#1c2434;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;font-size:14px;line-height:1.65}
	body{padding:36px 18px 60px;background:radial-gradient(circle at 15% 0%,#dceeff 0,transparent 42%),radial-gradient(circle at 90% 20%,#ffe6ef 0,transparent 38%),#eef2f8}
	.wrap{max-width:880px;margin:0 auto}
	.card{background:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.8);border-radius:18px;box-shadow:0 18px 50px rgba(44,70,120,.14);padding:30px 32px 32px;backdrop-filter:blur(10px)}
	.head{display:flex;align-items:center;gap:14px;margin-bottom:6px}
	.head .icon{width:44px;height:44px;border-radius:14px;flex:0 0 auto;box-shadow:0 8px 20px rgba(45,120,255,.22)}
	.head .icon img{width:100%;height:100%;display:block;border-radius:14px}
	h1{font-size:22px;line-height:1.25;margin:0;letter-spacing:-.02em}
	.sub{color:#6b7a90;font-size:12.5px;margin-top:2px}
	.badges{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 22px}
	.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid transparent}
	.badge.ok{background:#e7f8ef;color:#137a46;border-color:#c8efd9}
	.badge.warn{background:#fff5e6;color:#a35b00;border-color:#ffe3b5}
	.badge.info{background:#eaf2ff;color:#245ec7;border-color:#d3e4ff}
	.badge.bad{background:#ffecec;color:#b42323;border-color:#ffd1d1}
	.box{background:#f7faff;border:1px solid #e3ebf7;border-radius:13px;padding:13px;margin:16px 0}
	.urlrow{display:flex;gap:8px;align-items:stretch}
	.urlrow input{flex:1;min-width:0;height:42px;padding:0 12px;border:1px solid #d7e2f2;border-radius:9px;background:#fff;color:#1c2434;font:12.5px/42px Menlo,Consolas,monospace;outline:none}
	.urlrow input:focus{border-color:#7aa7f5;box-shadow:0 0 0 3px rgba(80,140,255,.13)}
	button{height:42px;padding:0 18px;border:0;border-radius:9px;background:#2f6fed;color:#fff;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:.18s}
	button:hover{background:#1f5fd8}
	button.secondary{background:#e8effb;color:#245ec7}
	button.secondary:hover{background:#dbe8fc}
	.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #edf1f8}
	.row:last-child{border-bottom:0}
	.row .k{color:#65748a;font-size:12.5px}
	.row .v{font-weight:600;text-align:right;word-break:break-all}
	.note{font-size:12.5px;color:#65748a;margin:9px 0 0}
	.warn{background:#fff6e8;border:1px solid #ffe3b5;color:#8a5200;border-radius:12px;padding:12px 14px;font-size:12.5px;margin:16px 0}
	.danger{background:#fff0f0;border-color:#ffd2d2;color:#a02020}
	.steps{margin:8px 0 0;padding-left:20px}
	.steps li{margin:7px 0}
	.steps code,code{background:#eef3fb;border:1px solid #e1e9f6;border-radius:5px;padding:1px 5px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#2858a8}
	details{margin-top:14px;border-top:1px solid #edf1f8;padding-top:13px}
	summary{cursor:pointer;color:#245ec7;font-weight:600;font-size:13px}
	pre{background:#0f172a;color:#cfe0ff;border-radius:10px;padding:14px;font:12px/1.6 Menlo,Consolas,monospace;overflow:auto;margin:10px 0 0}
	.foot{margin-top:18px;color:#93a0b4;font-size:11px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
	.tabs{display:flex;gap:8px;margin:22px 0 8px;flex-wrap:wrap}
	.tab{padding:7px 13px;border-radius:8px;border:1px solid #dfe8f6;background:#f4f8ff;color:#50627c;font-size:12.5px;cursor:pointer}
	.tab.active{background:#2f6fed;color:#fff;border-color:#2f6fed}
	.panel{display:none}.panel.active{display:block}
	@media (max-width:620px){
		body{padding:14px 10px 32px}
		.card{padding:20px 16px 22px;border-radius:15px}
		h1{font-size:19px}
		.urlrow{flex-direction:column}
		.urlrow button{width:100%}
		.row{flex-direction:column;align-items:flex-start;gap:2px}
		.row .v{text-align:left}
	}
</style>
</head>
<body>
<div class="wrap">
	<div class="card">
		<div class="head">
			<div class="icon"><?php echo $icon; ?></div>
			<div>
				<h1>WebDAV 网络磁盘</h1>
				<div class="sub">把个人空间映射到 Windows、macOS、手机或支持 WebDAV 的软件</div>
			</div>
		</div>

		<div class="badges">
			<span class="badge <?php echo $readonly ? 'warn' : 'ok'; ?>"><?php echo $readonly ? '只读模式' : '可读写'; ?></span>
			<span class="badge <?php echo $recycle ? 'info' : 'warn'; ?>"><?php echo $recycle ? '删除到回收站' : '直接删除'; ?></span>
			<span class="badge <?php echo $https ? 'ok' : 'bad'; ?>"><?php echo $https ? 'HTTPS' : 'HTTP（不安全）'; ?></span>
			<?php if($forceHttps): ?><span class="badge info">强制 HTTPS</span><?php endif; ?>
		</div>

		<?php if(!$https): ?>
		<div class="warn <?php echo $forceHttps ? 'danger' : ''; ?>">
			<?php if($forceHttps): ?>
			<b>当前 HTTP 请求会被 WebDAV 拒绝。</b>请先给站点配置 HTTPS，再使用 WebDAV。
			<?php else: ?>
			WebDAV 使用 Basic Auth 传递账号密码，HTTP 下密码是明文传输。公网使用请务必配置 HTTPS，并在插件配置中开启“强制 HTTPS”。
			<?php endif; ?>
		</div>
		<?php endif; ?>

		<div class="box">
			<div class="urlrow">
				<input id="dav-url" readonly value="<?php echo $safeUrl; ?>" onclick="this.select()">
				<button type="button" onclick="copyDav(this)">复制地址</button>
			</div>
			<div class="note">URL 必须包含末尾的 <code>/</code>。客户端会先请求 <code>OPTIONS</code> 和 <code>PROPFIND</code>，然后使用下面的账号密码登录。</div>
		</div>

		<div class="box">
			<div class="row"><span class="k">登录账号</span><span class="v"><?php echo $safeName; ?></span></div>
			<div class="row"><span class="k">登录密码</span><span class="v">当前 KodExplorer 账号密码</span></div>
			<div class="row"><span class="k">挂载根目录</span><span class="v">个人空间</span></div>
			<div class="row"><span class="k">协议 / 认证</span><span class="v">WebDAV · Basic Auth</span></div>
			<div class="row"><span class="k">列目录深度</span><span class="v"><?php echo intval($maxDepth); ?> 层 · 最多 <?php echo intval($maxItems); ?> 项</span></div>
		</div>

		<div class="tabs">
			<button type="button" class="tab active" onclick="showTab(this,'win')">Windows</button>
			<button type="button" class="tab" onclick="showTab(this,'mac')">macOS</button>
			<button type="button" class="tab" onclick="showTab(this,'phone')">手机 / 其他</button>
		</div>

		<div id="panel-win" class="panel active">
			<ol class="steps">
				<li>打开「此电脑」，右键选择「映射网络驱动器」。</li>
				<li>文件夹填写上面的 WebDAV 地址（必须以 <code>/</code> 结尾）。</li>
				<li>勾选「使用其他凭据」，输入 KodExplorer 的用户名和密码。</li>
				<li>如果 Windows 提示 HTTP 下不允许 Basic Auth，请改用 HTTPS，或在客户端系统中调整 BasicAuthLevel。</li>
				<li>连接成功后，个人空间会显示为一个网络磁盘。</li>
			</ol>
		</div>
		<div id="panel-mac" class="panel">
			<ol class="steps">
				<li>Finder → 前往 → 连接服务器（<code>⌘K</code>）。</li>
				<li>服务器地址填写上面的 WebDAV 地址。</li>
				<li>选择「注册用户」，输入 KodExplorer 用户名和密码。</li>
				<li>挂载后可在 Finder 侧边栏直接访问个人空间。</li>
			</ol>
		</div>
		<div id="panel-phone" class="panel">
			<ol class="steps">
				<li>ES 文件浏览器、RaiDrive、Documents、Solid Explorer 等支持 WebDAV 的客户端都可以。</li>
				<li>新建 WebDAV 连接，地址填上面的 URL，账号密码与网页端一致。</li>
				<li>部分客户端需要你手动选择 <code>WebDAV</code> 协议，而不是 SMB/FTP。</li>
			</ol>
		</div>

		<details>
			<summary>访问 404 或无法列目录？检查 PATH_INFO / 伪静态</summary>
			<div class="note">WebDAV 使用 <code>webdav.php/路径</code> 形式，服务器需要把 <code>/webdav.php/...</code> 交给 PHP，并传递 <code>PATH_INFO</code>。</div>
			<pre># Nginx
location ~ \.php(/|$) {
    fastcgi_split_path_info ^(.+?\.php)(/.*)$;
    fastcgi_param PATH_INFO $fastcgi_path_info;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;
    # 你的其他 fastcgi_param / fastcgi_pass 配置
}
</pre>
			<div class="note">Apache 一般默认支持 <code>AcceptPathInfo</code>。如果站点开了严格的安全规则，请允许访问 <code>/plugins/WebDAV/webdav.php</code>。</div>
		</details>

		<details>
			<summary>安全与范围说明</summary>
			<div class="note">
				当前版本挂载的是<b>个人空间</b>，不会暴露服务器根目录，也不会暴露群组共享目录。<br>
				删除操作在开启“删除到回收站”时会移动到 KodExplorer 回收站；关闭后为直接删除。<br>
				WebDAV 与网页端共用账号和文件权限；只读模式会禁止所有写入操作。
			</div>
		</details>

		<div class="foot">
			<span>KodExplorer WebDAV · v<?php echo $safeVersion; ?></span>
			<span>Basic Auth · WebDAV Class 2（含锁）</span>
		</div>
	</div>
</div>
<script>
function copyDav(btn){
	var input = document.getElementById('dav-url');
	if(!input) return;
	input.select();
	input.setSelectionRange(0, input.value.length);
	var done = function(){
		if(btn){ var old = btn.innerHTML; btn.innerHTML = '已复制'; setTimeout(function(){ btn.innerHTML = old; }, 1200); }
	};
	if(navigator.clipboard && navigator.clipboard.writeText){
		navigator.clipboard.writeText(input.value).then(done).catch(function(){
			try{ document.execCommand('copy'); done(); }catch(e){}
		});
	}else{
		try{ document.execCommand('copy'); done(); }catch(e){}
	}
}
function showTab(btn,id){
	var tabs = document.querySelectorAll('.tab');
	for(var i=0;i<tabs.length;i++) tabs[i].className = 'tab';
	btn.className = 'tab active';
	var panels = document.querySelectorAll('.panel');
	for(var j=0;j<panels.length;j++) panels[j].className = 'panel';
	var panel = document.getElementById('panel-' + id);
	if(panel) panel.className = 'panel active';
}
</script>
</body>
</html>
		<?php
		exit;
	}
}
