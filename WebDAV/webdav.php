<?php
/**
 * KodExplorer WebDAV server (lightweight)
 *
 * Endpoint: https://your-kod/plugins/WebDAV/webdav.php/
 * Auth:     HTTP Basic, KodExplorer account
 * Root:     current user's personal space (home)
 *
 * Supported: OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL,
 *            COPY, MOVE, LOCK, UNLOCK; Range; recycle bin; quota; locks.
 *
 * Requires PHP 5.3+ and the KodExplorer code base.
 */

if (!defined('KOD_WEBDAV_BOOTSTRAP')) {
	$kodRoot = dirname(dirname(__DIR__));
	require $kodRoot . '/config/config.php';
}

function kodWebdavCleanupTemp() {
	if (!empty($GLOBALS['kodWebdavTempFile']) && @file_exists($GLOBALS['kodWebdavTempFile'])) {
		@unlink($GLOBALS['kodWebdavTempFile']);
	}
}
register_shutdown_function('kodWebdavCleanupTemp');

function kodWebdavException($e) {
	if (!headers_sent()) {
		header('HTTP/1.1 500 Internal Server Error');
		header('Content-Type: text/plain; charset=utf-8');
	}
	$message = method_exists($e, 'getMessage') ? $e->getMessage() : 'Internal error';
	echo 'WebDAV error: ' . $message;
	exit;
}
set_exception_handler('kodWebdavException');

class KodWebDAV {
	public $method;
	public $script;
	public $cfg = array();
	public $user = null;
	public $userID = '';
	public $userConfig = array();
	public $auth = array();
	public $root = '';
	public $rootDisplay = '';
	public $basePrefix = '';
	public $path = '/';
	public $fsPath = '';
	public $locksFile = '';
	public $locks = array();
	public $lockCache = null;
	public $quota = null;
	public $readonly = false;
	public $recycle = true;
	public $maxDepth = 3;
	public $maxItems = 5000;
	public $forceHttps = false;

	function __construct() {
		$this->method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
		$this->script = isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/plugins/WebDAV/webdav.php';

		/* Reverse proxy sub-path, e.g. https://host/yunpan/plugins/WebDAV/webdav.php/ */
		$prefix = isset($_SERVER['HTTP_X_FORWARDED_PREFIX']) ? trim($_SERVER['HTTP_X_FORWARDED_PREFIX']) : '';
		if ($prefix !== '' && $prefix[0] !== '/') $prefix = '/' . $prefix;
		$this->basePrefix = rtrim($prefix, '/');
		if ($this->basePrefix !== '' && strpos($this->script, $this->basePrefix . '/') === 0) {
			$this->basePrefix = '';
		}

		$this->cfg = array(
			'readonly' => '0',
			'recycle' => '1',
			'maxDepth' => '3',
			'maxItems' => '5000',
			'forceHttps' => '0',
			'pluginAuth' => 'all:1'
		);
	}

	public function run() {
		$this->sendCors();
		$this->loadConfig();
		$this->checkHttps();
		if ($this->method === 'OPTIONS') {
			$this->options();
			return;
		}

		$this->authenticate();
		$this->setupUser();
		$this->checkPluginAuth();

		$this->path = $this->requestPath();
		$this->fsPath = $this->resolvePath($this->path);
		if ($this->fsPath === false) {
			$this->fail(403, 'Invalid path');
		}

		$this->loadLocks();
		$this->dispatch();
	}

	/* ------------------------------------------------------------------ */
	/* configuration / authentication                                      */
	/* ------------------------------------------------------------------ */

	private function loadConfig() {
		$settings = false;
		if (class_exists('FileCache')) {
			$settings = @FileCache::load(USER_SYSTEM . 'system_setting.php');
		}
		if (!is_array($settings)) $settings = array();
		$GLOBALS['config']['settingSystem'] = $settings;

		$plugin = isset($settings['pluginList']['WebDAV']) ? $settings['pluginList']['WebDAV'] : null;
		if (!is_array($plugin) || empty($plugin['status'])) {
			$this->fail(403, 'WebDAV plugin is disabled.');
		}

		$config = isset($plugin['config']) && is_array($plugin['config']) ? $plugin['config'] : array();
		$this->cfg = array_merge($this->cfg, $config);
		$this->readonly = $this->isOn($this->cfg['readonly']);
		$this->recycle = $this->isOn($this->cfg['recycle']);
		$this->forceHttps = $this->isOn($this->cfg['forceHttps']);
		$this->maxDepth = intval($this->cfg['maxDepth']);
		if ($this->maxDepth < 0) $this->maxDepth = 0;
		if ($this->maxDepth > 10) $this->maxDepth = 10;
		$this->maxItems = intval($this->cfg['maxItems']);
		if ($this->maxItems < 100) $this->maxItems = 100;
		if ($this->maxItems > 50000) $this->maxItems = 50000;
	}

	private function isOn($value) {
		return $value === 1 || $value === '1' || $value === true || $value === 'true';
	}

	private function sendCors() {
		header('Access-Control-Allow-Origin: *');
		header('Access-Control-Allow-Methods: OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK');
		header('Access-Control-Allow-Headers: Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, Timeout, Range, If-Match, If-None-Match');
		header('Access-Control-Expose-Headers: DAV, Content-Length, Content-Range, ETag, Last-Modified, Lock-Token');
	}

	private function authenticate() {
		$credentials = $this->basicCredentials();
		if (!$credentials) {
			$this->needAuth();
		}

		$username = $credentials[0];
		$password = $credentials[1];

		$members = $this->loadDataFile('system_member.php');
		$user = $this->findUserByName($members, $username);
		if (!$user && rawurldecode($username) !== $username) {
			$user = $this->findUserByName($members, rawurldecode($username));
		}
		if (!is_array($user) || empty($user['password'])) {
			$this->authFailed();
		}
		if (!$this->hashEquals($user['password'], md5($password))) {
			$this->authFailed();
		}
		if (isset($user['status']) && $user['status'] == 0) {
			$this->authFailed();
		}
		if (!isset($user['role']) || $user['role'] === '' || empty($user['path'])) {
			$this->authFailed();
		}
		$this->user = $user;
	}

	private function loadDataFile($name) {
		if (!class_exists('FileCache')) return array();
		$data = @FileCache::load(USER_SYSTEM . $name);
		return is_array($data) ? $data : array();
	}

	private function findUserByName($members, $username) {
		foreach ($members as $user) {
			if (is_array($user) && isset($user['name']) && $user['name'] === $username) {
				return $user;
			}
		}
		return false;
	}

	private function basicCredentials() {
		if (isset($_SERVER['PHP_AUTH_USER']) && $_SERVER['PHP_AUTH_USER'] !== '') {
			return array($_SERVER['PHP_AUTH_USER'], isset($_SERVER['PHP_AUTH_PW']) ? $_SERVER['PHP_AUTH_PW'] : '');
		}

		$header = $this->headerValue('Authorization');
		if (!$header) return false;
		if (stripos($header, 'Basic ') !== 0) return false;
		$decoded = base64_decode(trim(substr($header, 6)), true);
		if ($decoded === false) return false;
		$pos = strpos($decoded, ':');
		if ($pos === false) return false;
		return array(substr($decoded, 0, $pos), substr($decoded, $pos + 1));
	}

	private function hashEquals($known, $given) {
		if (function_exists('hash_equals')) return hash_equals($known, $given);
		if (strlen($known) !== strlen($given)) return false;
		$result = 0;
		for ($i = 0; $i < strlen($known); $i++) {
			$result |= ord($known[$i]) ^ ord($given[$i]);
		}
		return $result === 0;
	}

	private function authFailed() {
		usleep(300000);
		$this->needAuth();
	}

	private function needAuth() {
		header('WWW-Authenticate: Basic realm="KodExplorer WebDAV"');
		$this->fail(401, 'Authentication required');
	}

	private function setupUser() {
		$user = $this->user;
		$this->userID = $user['userID'];

		if (!defined('USER')) define('USER', USER_PATH . $user['path'] . '/');
		if (!defined('USER_TEMP')) define('USER_TEMP', USER . 'data/temp/');
		if (!defined('USER_RECYCLE')) define('USER_RECYCLE', USER . 'recycle_kod/');

		$home = '';
		if (!empty($user['homePath'])) {
			$candidate = @iconv_system($user['homePath']);
			if ($candidate && @is_dir($candidate)) $home = rtrim($user['homePath'], '/\\') . '/';
		}
		if ($home === '') {
			$home = USER_PATH . $user['path'] . '/home/';
		}

		$rootReal = @realpath(@iconv_system($home));
		if ($rootReal === false || !@is_dir($rootReal)) {
			$this->fail(500, 'User home directory not found');
		}
		$this->root = rtrim($rootReal, '/\\') . DIRECTORY_SEPARATOR;
		$this->rootDisplay = $home;

		$GLOBALS['isRoot'] = ($user['role'] == '1') ? 1 : 0;

		$roles = $this->loadDataFile('system_role.php');
		$role = isset($roles[$user['role']]) ? $roles[$user['role']] : array();
		$auth = is_array($role) ? $role : array();
		if (!isset($auth['explorer.fileDownload'])) $auth['explorer.fileDownload'] = 1;
		if (!isset($auth['explorer.fileProxy'])) $auth['explorer.fileProxy'] = 1;
		if (!isset($auth['editor.fileGet'])) $auth['editor.fileGet'] = 1;
		if (!isset($auth['extNotAllow'])) $auth['extNotAllow'] = '';
		$auth['explorer.pathList'] = 1;
		$this->auth = $auth;
		$GLOBALS['auth'] = $auth;

		$userConfig = @FileCache::load(USER . 'data/config.php');
		$this->userConfig = is_array($userConfig) ? $userConfig : array();
		$GLOBALS['config']['user'] = $this->userConfig;

		$this->locksFile = TEMP_PATH . 'webdav/' . md5($user['userID']) . '.php';
		$lockDir = dirname($this->locksFile);
		if (!is_dir($lockDir)) @mk_dir($lockDir, DEFAULT_PERRMISSIONS);
	}

	private function checkPluginAuth() {
		if (!empty($GLOBALS['isRoot'])) return;
		$info = isset($this->cfg['pluginAuth']) ? $this->cfg['pluginAuth'] : '';
		if (!is_string($info) || trim($info) === '') return;

		$all = '0';
		$users = array();
		$roles = array();
		$groups = array();
		$parts = explode(';', $info);
		foreach ($parts as $part) {
			$kv = explode(':', $part, 2);
			if (count($kv) < 2) continue;
			$key = trim($kv[0]);
			$val = trim($kv[1]);
			if ($key === 'all') {
				$all = $val;
			} else if ($key === 'user') {
				$users = $this->splitIds($val);
			} else if ($key === 'role') {
				$roles = $this->splitIds($val);
			} else if ($key === 'group') {
				$groups = $this->splitIds($val);
			}
		}
		if ($all === '1') return;
		if (empty($users) && empty($roles) && empty($groups)) return;
		if (in_array($this->user['userID'], $users)) return;
		if (in_array($this->user['role'], $roles)) return;
		if (!empty($this->user['groupInfo']) && is_array($this->user['groupInfo'])) {
			foreach (array_keys($this->user['groupInfo']) as $groupID) {
				if (in_array($groupID, $groups)) return;
			}
		}
		$this->fail(403, 'No permission to use WebDAV.');
	}

	private function splitIds($value) {
		$result = array();
		$parts = explode(',', $value);
		foreach ($parts as $part) {
			$part = trim($part);
			if ($part !== '') $result[] = $part;
		}
		return $result;
	}

	private function checkHttps() {
		if (!$this->forceHttps) return;
		$scheme = function_exists('http_type') ? http_type() : 'http';
		if (strtolower($scheme) !== 'https') {
			$this->fail(403, 'HTTPS is required. Enable HTTPS or turn off "Force HTTPS" in the plugin settings.');
		}
	}

	/* ------------------------------------------------------------------ */
	/* paths                                                              */
	/* ------------------------------------------------------------------ */

	private function requestPath() {
		$uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
		if ($uri === '*' || $uri === '') return '/';

		$path = parse_url($uri, PHP_URL_PATH);
		if ($path === false || $path === null) $path = $uri;
		$path = rawurldecode($path);

		$pos = strpos($path, $this->script);
		if ($pos !== false) {
			$path = substr($path, $pos + strlen($this->script));
		} else if (!empty($_SERVER['PATH_INFO'])) {
			$path = rawurldecode($_SERVER['PATH_INFO']);
			$pos = strpos($path, $this->script);
			if ($pos !== false) $path = substr($path, $pos + strlen($this->script));
		} else {
			$path = '';
		}
		return $this->cleanPath($path);
	}

	private function destinationPath($destination) {
		$path = parse_url($destination, PHP_URL_PATH);
		if ($path === false || $path === null) $path = $destination;
		$path = rawurldecode($path);
		$pos = strpos($path, $this->script);
		if ($pos !== false) {
			$path = substr($path, $pos + strlen($this->script));
		} else {
			$pos = strpos($path, '/webdav.php');
			if ($pos !== false) $path = substr($path, $pos + strlen('/webdav.php'));
		}
		return $this->cleanPath($path);
	}

	private function cleanPath($path) {
		if (strpos($path, "\0") !== false) $this->fail(400, 'Invalid path');
		$path = str_replace('\\', '/', $path);
		$parts = explode('/', $path);
		$out = array();
		foreach ($parts as $part) {
			if ($part === '' || $part === '.') continue;
			if ($part === '..') {
				if (empty($out)) $this->fail(403, 'Invalid path');
				array_pop($out);
				continue;
			}
			if (strpos($part, "\0") !== false) $this->fail(400, 'Invalid path');
			$out[] = $part;
		}
		return '/' . implode('/', $out);
	}

	private function resolvePath($relative) {
		$segments = ($relative === '/') ? array() : explode('/', trim($relative, '/'));
		$fs = rtrim($this->root, '/\\');
		foreach ($segments as $segment) {
			$system = @iconv_system($segment);
			if ($system === false || $system === '' ||
				strpos($system, '/') !== false || strpos($system, '\\') !== false) {
				return false;
			}
			if (DIRECTORY_SEPARATOR === '\\' && strpos($system, ':') !== false) return false;
			$fs .= DIRECTORY_SEPARATOR . $system;
		}
		$fs = rtrim($fs, '/\\');
		if ($fs === '') $fs = rtrim($this->root, '/\\');

		$probe = $fs;
		$rootLen = strlen(rtrim($this->root, '/\\'));
		while (!@file_exists($probe) && strlen($probe) > $rootLen) {
			$parent = dirname($probe);
			if ($parent === $probe) break;
			$probe = $parent;
		}
		$real = @realpath($probe);
		if ($real === false || !$this->isInsideRoot($real)) return false;
		return $fs;
	}

	private function isInsideRoot($real) {
		$root = rtrim($this->root, '/\\') . DIRECTORY_SEPARATOR;
		$real = rtrim($real, '/\\') . DIRECTORY_SEPARATOR;
		if (DIRECTORY_SEPARATOR === '\\') {
			$root = strtolower($root);
			$real = strtolower($real);
		}
		return strpos($real, $root) === 0;
	}

	private function href($relative, $isDir) {
		$base = rtrim($this->script, '/');
		$tail = '';
		if ($relative !== '/' && $relative !== '') {
			$segments = explode('/', trim($relative, '/'));
			$encoded = array();
			foreach ($segments as $segment) $encoded[] = rawurlencode($segment);
			$tail = implode('/', $encoded);
		}
		$url = $base . '/';
		if ($tail !== '') $url .= $tail;
		if ($isDir && substr($url, -1) !== '/') $url .= '/';
		return $this->basePrefix . $url;
	}

	private function displayName($relative, $fs) {
		if ($relative === '/') {
			$name = isset($GLOBALS['config']['settingSystem']['systemName']) ? $GLOBALS['config']['settingSystem']['systemName'] : 'KodExplorer';
			return $name . ' WebDAV';
		}
		$name = @iconv_app(get_path_this($fs));
		if ($name === false || $name === '') $name = get_path_this($relative);
		return $name;
	}

	/* ------------------------------------------------------------------ */
	/* request dispatch                                                   */
	/* ------------------------------------------------------------------ */

	private function dispatch() {
		$writeMethods = array('PUT', 'DELETE', 'MKCOL', 'COPY', 'MOVE', 'PROPPATCH');
		if ($this->readonly && in_array($this->method, $writeMethods)) {
			$this->fail(403, 'WebDAV is read-only.');
		}

		switch ($this->method) {
			case 'PROPFIND':
				$this->propfind();
				break;
			case 'GET':
				$this->getFile(false);
				break;
			case 'HEAD':
				$this->getFile(true);
				break;
			case 'PUT':
				$this->putFile();
				break;
			case 'DELETE':
				$this->deletePath();
				break;
			case 'MKCOL':
				$this->makeCollection();
				break;
			case 'COPY':
				$this->copyOrMove(false);
				break;
			case 'MOVE':
				$this->copyOrMove(true);
				break;
			case 'LOCK':
				$this->lock();
				break;
			case 'UNLOCK':
				$this->unlock();
				break;
			case 'PROPPATCH':
				$this->proppatch();
				break;
			case 'OPTIONS':
				$this->options();
				break;
			default:
				header('Allow: OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK');
				$this->fail(405, 'Method not allowed');
				break;
		}
	}

	private function options() {
		header('DAV: 1, 2');
		header('MS-Author-Via: DAV');
		header('Allow: OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK');
		header('Accept-Ranges: bytes');
		header('Content-Length: 0');
		$this->status(200);
	}

	/* ------------------------------------------------------------------ */
	/* PROPFIND                                                           */
	/* ------------------------------------------------------------------ */

	private function propfind() {
		if (!$this->can('explorer.pathList')) $this->fail(403, 'No permission to list files.');
		if (!@file_exists($this->fsPath)) $this->fail(404, 'Not found');

		$depth = strtolower($this->headerValue('Depth'));
		if ($depth === '0') {
			$maxDepth = 0;
		} else if ($depth === 'infinity') {
			$maxDepth = $this->maxDepth;
		} else {
			$maxDepth = 1;
		}

		$items = array();
		$this->collectProps($this->path, $this->fsPath, 0, $maxDepth, $items);
		$xml = '<?xml version="1.0" encoding="utf-8"?>' . "\n" .
			'<D:multistatus xmlns:D="DAV:">' . implode('', $items) . '</D:multistatus>';
		header('Content-Type: application/xml; charset=utf-8');
		header('HTTP/1.1 207 Multi-Status');
		echo $xml;
		exit;
	}

	private function collectProps($relative, $fs, $level, $maxDepth, &$items) {
		if (count($items) >= $this->maxItems) return;
		$items[] = $this->propXml($relative, $fs);
		if (!@is_dir($fs) || $level >= $maxDepth) return;
		if (@is_link($fs)) return;

		$children = $this->listChildren($relative, $fs);
		foreach ($children as $child) {
			if (count($items) >= $this->maxItems) break;
			$this->collectProps($child[0], $child[1], $level + 1, $maxDepth, $items);
		}
	}

	private function listChildren($relative, $fs) {
		$entries = @scandir($fs);
		if (!is_array($entries)) return array();

		$hidden = array('.', '..', 'Thumb.db', '.DS_Store');
		if (isset($GLOBALS['config']['settingSystem']['pathHidden'])) {
			$extra = explode(',', $GLOBALS['config']['settingSystem']['pathHidden']);
			foreach ($extra as $name) {
				$name = trim($name);
				if ($name !== '') $hidden[] = $name;
			}
		}

		$folders = array();
		$files = array();
		foreach ($entries as $name) {
			if (in_array($name, $hidden, true)) continue;
			$childFs = rtrim($fs, '/\\') . DIRECTORY_SEPARATOR . $name;
			if (@is_link($childFs)) {
				$real = @realpath($childFs);
				if ($real === false || !$this->isInsideRoot($real)) continue;
			}
			$nameUtf8 = @iconv_app($name);
			if ($nameUtf8 === false || $nameUtf8 === '') $nameUtf8 = $name;
			$childRel = ($relative === '/' ? '/' : rtrim($relative, '/') . '/') . $nameUtf8;
			$item = array($childRel, $childFs, $nameUtf8);
			if (@is_dir($childFs)) {
				$folders[] = $item;
			} else if (@is_file($childFs)) {
				$files[] = $item;
			}
		}

		usort($folders, array($this, 'sortItems'));
		usort($files, array($this, 'sortItems'));
		return array_merge($folders, $files);
	}

	public function sortItems($a, $b) {
		return strnatcasecmp($a[2], $b[2]);
	}

	private function propXml($relative, $fs) {
		$isDir = @is_dir($fs);
		$href = $this->href($relative, $isDir);
		$name = $this->displayName($relative, $fs);
		$mtime = @filemtime($fs);
		if (!$mtime) $mtime = time();
		$ctime = @filectime($fs);
		if (!$ctime) $ctime = $mtime;
		$size = 0;
		$etag = '';
		if (!$isDir) {
			$size = $this->fileSize($fs);
			$etag = '"' . md5($mtime . '-' . $size) . '"';
		}

		$xml = '<D:response>';
		$xml .= '<D:href>' . $this->esc($href) . '</D:href>';
		$xml .= '<D:propstat><D:prop>';
		$xml .= '<D:displayname>' . $this->esc($name) . '</D:displayname>';
		$xml .= $isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
		$xml .= '<D:getlastmodified>' . $this->esc(gmdate('D, d M Y H:i:s', $mtime) . ' GMT') . '</D:getlastmodified>';
		$xml .= '<D:creationdate>' . $this->esc(gmdate('Y-m-d\TH:i:s\Z', $ctime)) . '</D:creationdate>';
		if ($isDir) {
			$xml .= '<D:getcontenttype>httpd/unix-directory</D:getcontenttype>';
		} else {
			$mime = function_exists('get_file_mime') ? get_file_mime(get_path_ext($fs)) : 'application/octet-stream';
			$xml .= '<D:getcontentlength>' . $this->esc(sprintf('%.0f', $size)) . '</D:getcontentlength>';
			$xml .= '<D:getcontenttype>' . $this->esc($mime) . '</D:getcontenttype>';
			$xml .= '<D:getetag>' . $this->esc($etag) . '</D:getetag>';
		}
		$xml .= $this->supportedLockXml();
		$xml .= '<D:lockdiscovery>';
		$locks = $this->findLocksFor($relative);
		foreach ($locks as $lock) $xml .= $this->activeLockXml($lock);
		$xml .= '</D:lockdiscovery>';

		if ($relative === '/') {
			$quota = $this->quotaInfo();
			if (is_array($quota) && !empty($quota['config'])) {
				$max = floatval($quota['config']['sizeMax']) * 1073741824;
				$use = floatval($quota['config']['sizeUse']);
				if ($max > 0) {
					$xml .= '<D:quota-available-bytes>' . $this->esc(sprintf('%.0f', max(0, $max - $use))) . '</D:quota-available-bytes>';
					$xml .= '<D:quota-used-bytes>' . $this->esc(sprintf('%.0f', $use)) . '</D:quota-used-bytes>';
				}
			}
		}

		$xml .= '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
		return $xml;
	}

	/* ------------------------------------------------------------------ */
	/* GET / HEAD                                                          */
	/* ------------------------------------------------------------------ */

	private function getFile($headOnly) {
		if (!$this->can('explorer.fileDownload')) $this->fail(403, 'No permission to download.');
		if (@is_dir($this->fsPath)) $this->fail(405, 'This is a collection.');
		if (!@is_file($this->fsPath)) $this->fail(404, 'Not found');

		$size = $this->fileSize($this->fsPath);
		$mtime = @filemtime($this->fsPath);
		if (!$mtime) $mtime = time();
		$etag = '"' . md5($mtime . '-' . $size) . '"';
		$lastModified = gmdate('D, d M Y H:i:s', $mtime) . ' GMT';

		$ifNone = trim($this->headerValue('If-None-Match'));
		if ($ifNone !== '' && ($ifNone === '*' || strpos($ifNone, $etag) !== false)) {
			header('ETag: ' . $etag);
			header('Last-Modified: ' . $lastModified);
			$this->status(304);
		}
		$ifModified = trim($this->headerValue('If-Modified-Since'));
		if ($ifModified !== '') {
			$since = @strtotime($ifModified);
			if ($since !== false && $since >= $mtime) {
				header('ETag: ' . $etag);
				header('Last-Modified: ' . $lastModified);
				$this->status(304);
			}
		}

		$mime = function_exists('get_file_mime') ? get_file_mime(get_path_ext($this->fsPath)) : 'application/octet-stream';
		$ext = strtolower(get_path_ext($this->fsPath));
		if (empty($GLOBALS['isRoot']) && in_array($ext, array('svg', 'html', 'htm', 'xhtml'))) {
			$mime = 'application/octet-stream';
		}

		$start = 0;
		$end = $size - 1;
		$partial = false;

		$range = trim($this->headerValue('Range'));
		if (!$headOnly && $range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/i', $range, $matches)) {
			$sendRange = true;
			$ifRange = trim($this->headerValue('If-Range'));
			if ($ifRange !== '' && $ifRange !== $etag && $ifRange !== $lastModified) $sendRange = false;
			if ($sendRange) {
				$from = $matches[1];
				$to = $matches[2];
				if ($from === '' && $to !== '') {
					$suffix = intval($to);
					$start = max(0, $size - $suffix);
					$end = $size - 1;
				} else if ($from !== '' && $to === '') {
					$start = intval($from);
					$end = $size - 1;
				} else if ($from !== '' && $to !== '') {
					$start = intval($from);
					$end = min(intval($to), $size - 1);
				}
				if ($size <= 0 || $start >= $size || $start > $end) {
					header('Content-Range: bytes */' . sprintf('%.0f', $size));
					$this->fail(416, 'Range not satisfiable');
				}
				$partial = true;
			}
		}

		header('Content-Type: ' . $mime);
		header('Accept-Ranges: bytes');
		header('ETag: ' . $etag);
		header('Last-Modified: ' . $lastModified);
		header('Cache-Control: no-cache');
		header('X-Content-Type-Options: nosniff');
		if ($partial) {
			header('HTTP/1.1 206 Partial Content');
			header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
			header('Content-Length: ' . sprintf('%.0f', max(0, $end - $start + 1)));
		} else {
			header('Content-Length: ' . sprintf('%.0f', max(0, $size)));
		}
		if ($headOnly) {
			exit;
		}

		while (ob_get_level() > 0) @ob_end_clean();
		@set_time_limit(0);
		$fp = @fopen($this->fsPath, 'rb');
		if (!$fp) $this->fail(500, 'Unable to open file');
		if ($start > 0) @fseek($fp, $start);
		$position = $start;
		while (!feof($fp) && $position <= $end && !connection_aborted()) {
			$length = min(262144, $end - $position + 1);
			$buffer = @fread($fp, $length);
			if ($buffer === false || $buffer === '') break;
			echo $buffer;
			flush();
			$position += strlen($buffer);
		}
		@fclose($fp);
		exit;
	}

	/* ------------------------------------------------------------------ */
	/* PUT                                                                */
	/* ------------------------------------------------------------------ */

	private function putFile() {
		if (@is_dir($this->fsPath)) $this->fail(405, 'Cannot PUT a collection.');
		$exists = @file_exists($this->fsPath);
		if (!$this->canPut($exists)) $this->fail(403, 'No permission to write.');
		if (!$this->checkName($this->fsPath)) $this->fail(403, 'File name or extension is not allowed.');
		$this->checkLock($this->path);

		if ($this->headerValue('Content-Range') !== '') {
			$this->fail(501, 'Partial PUT is not supported.');
		}

		$ifNone = trim($this->headerValue('If-None-Match'));
		$ifMatch = trim($this->headerValue('If-Match'));
		if ($ifNone === '*' && $exists) $this->fail(412, 'Resource already exists.');
		if ($ifMatch !== '' && $ifMatch !== '*') {
			$etag = $exists ? '"' . md5(@filemtime($this->fsPath) . '-' . $this->fileSize($this->fsPath)) . '"' : '';
			if ($exists && strpos($ifMatch, $etag) === false) $this->fail(412, 'ETag mismatch.');
		}
		if ($ifMatch === '*' && !$exists) $this->fail(412, 'Resource does not exist.');

		$parent = dirname($this->fsPath);
		if (!$this->ensureParent($parent)) $this->fail(409, 'Parent collection does not exist.');

		$oldSize = $exists ? $this->fileSize($this->fsPath) : 0;
		$contentLength = trim($this->headerValue('Content-Length'));
		if ($contentLength !== '' && $this->isDigits($contentLength)) {
			$expected = floatval($contentLength);
			if (!$this->quotaCheck($expected - $oldSize)) $this->fail(507, 'Insufficient storage.');
		}

		$temp = $parent . DIRECTORY_SEPARATOR . '.webdav-' . getmypid() . '-' . mt_rand(1000, 999999) . '.part';
		$GLOBALS['kodWebdavTempFile'] = $temp;

		$input = @fopen('php://input', 'rb');
		$output = @fopen($temp, 'wb');
		if (!$input || !$output) {
			if ($output) @fclose($output);
			@unlink($temp);
			$this->fail(500, 'Unable to create temporary file.');
		}

		@set_time_limit(0);
		@ignore_user_abort(true);
		$bytes = 0;
		while (!feof($input)) {
			if (connection_aborted()) break;
			$chunk = @fread($input, 262144);
			if ($chunk === false) break;
			if ($chunk === '') {
				if (feof($input)) break;
				continue;
			}
			$written = @fwrite($output, $chunk);
			if ($written === false || $written === 0) {
				@fclose($input);
				@fclose($output);
				@unlink($temp);
				$this->fail(507, 'Insufficient storage.');
			}
			$bytes += $written;
			if ($written < strlen($chunk)) {
				$rest = substr($chunk, $written);
				while ($rest !== '') {
					$more = @fwrite($output, $rest);
					if ($more === false || $more === 0) {
						@fclose($input); @fclose($output); @unlink($temp);
						$this->fail(507, 'Insufficient storage.');
					}
					$bytes += $more;
					$rest = substr($rest, $more);
				}
			}
		}
		@fflush($output);
		@fclose($output);
		@fclose($input);
		if (connection_aborted()) {
			@unlink($temp);
			$GLOBALS['kodWebdavTempFile'] = '';
			exit;
		}
		if ($contentLength !== '' && $this->isDigits($contentLength) && $bytes < intval($contentLength)) {
			@unlink($temp);
			$this->fail(400, 'Incomplete request body.');
		}

		if (!$this->quotaCheck($bytes - $oldSize)) {
			@unlink($temp);
			$this->fail(507, 'Insufficient storage.');
		}
		if (@is_link($this->fsPath)) @unlink($this->fsPath);
		$backup = '';
		if (DIRECTORY_SEPARATOR === '\\' && @file_exists($this->fsPath) && !@is_dir($this->fsPath)) {
			$backup = $this->fsPath . '.webdav-old-' . mt_rand(1000, 999999);
			@rename($this->fsPath, $backup);
		}
		if (!@rename($temp, $this->fsPath)) {
			if ($backup !== '' && @file_exists($backup)) @rename($backup, $this->fsPath);
			@unlink($temp);
			$this->fail(500, 'Unable to save file.');
		}
		if ($backup !== '') @unlink($backup);
		$GLOBALS['kodWebdavTempFile'] = '';
		@chmod($this->fsPath, DEFAULT_PERRMISSIONS);
		$this->quotaChange($bytes - $oldSize);
		$this->status($exists ? 204 : 201);
	}

	private function isDigits($value) {
		return $value !== '' && preg_match('/^\d+$/', $value);
	}

	private function canPut($exists) {
		if (!empty($GLOBALS['isRoot'])) return true;
		if (!$exists) return $this->can('explorer.fileUpload');
		return $this->can('editor.fileSave') || $this->can('explorer.fileUpload') || $this->can('explorer.fileSave');
	}

	/* ------------------------------------------------------------------ */
	/* DELETE / MKCOL                                                     */
	/* ------------------------------------------------------------------ */

	private function deletePath() {
		if (!$this->can('explorer.pathDelete')) $this->fail(403, 'No permission to delete.');
		if ($this->path === '/') $this->fail(403, 'Cannot delete the WebDAV root.');
		if (!@file_exists($this->fsPath) && !@is_link($this->fsPath)) $this->fail(404, 'Not found');
		$this->checkLock($this->path);
		$this->checkLocksUnder($this->path);

		if ($this->recycleEnabled()) {
			if (!$this->moveToRecycle($this->fsPath)) $this->fail(500, 'Unable to move to recycle bin.');
		} else {
			$size = $this->sizeOf($this->fsPath);
			if (!$this->deleteTree($this->fsPath)) $this->fail(500, 'Unable to delete.');
			$this->quotaChange(-$size);
		}
		$this->status(204);
	}

	private function makeCollection() {
		if (!$this->can('explorer.mkdir')) $this->fail(403, 'No permission to create folders.');
		if (@file_exists($this->fsPath) || @is_link($this->fsPath)) $this->fail(405, 'Resource already exists.');
		$this->checkLock($this->path);
		if (!$this->checkName($this->fsPath)) $this->fail(403, 'Folder name is not allowed.');
		$parent = dirname($this->fsPath);
		if (!$this->ensureParent($parent)) $this->fail(409, 'Parent collection does not exist.');
		if (!@mkdir($this->fsPath, DEFAULT_PERRMISSIONS)) $this->fail(500, 'Unable to create folder.');
		@chmod_path($this->fsPath, DEFAULT_PERRMISSIONS);
		$this->status(201);
	}

	/* ------------------------------------------------------------------ */
	/* COPY / MOVE                                                        */
	/* ------------------------------------------------------------------ */

	private function copyOrMove($isMove) {
		if ($this->path === '/') $this->fail(403, 'Cannot copy or move the WebDAV root.');
		if (!@file_exists($this->fsPath) && !@is_link($this->fsPath)) $this->fail(404, 'Source not found.');
		if (@is_link($this->fsPath)) $this->fail(403, 'Symbolic links cannot be copied or moved.');
		$permission = $isMove
			? ($this->can('explorer.pathRname') || $this->can('explorer.pathCuteDrag'))
			: $this->can('explorer.pathCopyDrag');
		if (!$permission) $this->fail(403, 'No permission for this operation.');

		$destination = trim($this->headerValue('Destination'));
		if ($destination === '') $this->fail(400, 'Destination header is required.');
		$destinationPath = $this->destinationPath($destination);
		$destinationFs = $this->resolvePath($destinationPath);
		if ($destinationFs === false) $this->fail(403, 'Invalid destination path.');
		if ($destinationPath === '/' || rtrim($destinationFs, '/\\') === rtrim($this->root, '/\\')) {
			$this->fail(403, 'Cannot overwrite the WebDAV root.');
		}
		if ($destinationFs === $this->fsPath) $this->fail(403, 'Source and destination are the same.');
		$sourceCmp = rtrim($this->fsPath, '/\\') . DIRECTORY_SEPARATOR;
		$destinationCmp = rtrim($destinationFs, '/\\') . DIRECTORY_SEPARATOR;
		if (DIRECTORY_SEPARATOR === '\\') {
			$sourceCmp = strtolower($sourceCmp);
			$destinationCmp = strtolower($destinationCmp);
		}
		if (@is_dir($this->fsPath) && strpos($destinationCmp, $sourceCmp) === 0) {
			$this->fail(409, 'Cannot copy or move a folder into itself.');
		}
		if (strpos($sourceCmp, $destinationCmp) === 0) {
			$this->fail(409, 'Cannot overwrite a parent of the source.');
		}
		$this->checkLock($this->path);
		$this->checkLock($destinationPath);
		if (@is_dir($this->fsPath)) $this->checkLocksUnder($this->path);

		if (!$this->checkName($destinationFs)) $this->fail(403, 'Destination name or extension is not allowed.');

		$overwrite = strtoupper(trim($this->headerValue('Overwrite')));
		$overwrite = ($overwrite === 'F') ? false : true;
		$destinationExists = @file_exists($destinationFs) || @is_link($destinationFs);
		if ($destinationExists && !$overwrite) $this->fail(412, 'Destination already exists.');

		$parent = dirname($destinationFs);
		if (!$this->ensureParent($parent)) $this->fail(409, 'Destination parent does not exist.');

		$destinationSize = $destinationExists ? $this->sizeOf($destinationFs) : 0;
		if ($destinationExists) {
			if (@is_dir($destinationFs)) $this->checkLocksUnder($destinationPath);
			if (!$this->deleteTree($destinationFs)) $this->fail(500, 'Unable to replace destination.');
		}

		if ($isMove) {
			$ok = @rename($this->fsPath, $destinationFs);
			if (!$ok) $ok = $this->moveTree($this->fsPath, $destinationFs);
			if (!$ok) $this->fail(500, 'Unable to move resource.');
			if ($destinationExists) $this->quotaChange(-$destinationSize);
		} else {
			$sourceSize = $this->sizeOf($this->fsPath);
			if (!$this->quotaCheck($sourceSize - $destinationSize)) $this->fail(507, 'Insufficient storage.');
			$depth = strtolower(trim($this->headerValue('Depth')));
			if (@is_dir($this->fsPath) && $depth === '0') {
				$ok = @mkdir($destinationFs, DEFAULT_PERRMISSIONS);
				if ($ok) @chmod_path($destinationFs, DEFAULT_PERRMISSIONS);
			} else {
				$ok = $this->copyTree($this->fsPath, $destinationFs);
			}
			if (!$ok) {
				$this->deleteTree($destinationFs);
				$this->fail(500, 'Unable to copy resource.');
			}
			$this->quotaChange($sourceSize - $destinationSize);
		}
		$this->status($destinationExists ? 204 : 201);
	}

	/* ------------------------------------------------------------------ */
	/* PROPPATCH                                                          */
	/* ------------------------------------------------------------------ */

	private function proppatch() {
		if (empty($GLOBALS['isRoot'])) {
			$canWrite = $this->can('editor.fileSave') || $this->can('explorer.fileUpload') || $this->can('explorer.fileSave');
			if (!$canWrite) $this->fail(403, 'No permission to change properties.');
		}
		$this->checkLock($this->path);
		$body = @file_get_contents('php://input');
		if ($body === false) $body = '';
		if (strlen($body) > 1048576) $body = substr($body, 0, 1048576);

		$props = array();
		if (preg_match('/<(?:D|d):prop[^>]*>(.*?)<\/(?:D|d):prop>/s', $body, $match)) {
			preg_match_all('/<([A-Za-z0-9_]+:[A-Za-z0-9_]+)[^>]*\/?>/', $match[1], $matches);
			foreach ($matches[1] as $tag) {
				$lower = strtolower($tag);
				if (in_array($lower, array('d:set', 'd:remove', 'd:prop'))) continue;
				if (!in_array($tag, $props)) $props[] = $tag;
			}
		}

		$xml = '<?xml version="1.0" encoding="utf-8"?>' .
			'<D:multistatus xmlns:D="DAV:" xmlns:Win32="urn:schemas-microsoft-com:" xmlns:Z="urn:schemas-microsoft-com:">' .
			'<D:response><D:href>' . $this->esc($this->href($this->path, @is_dir($this->fsPath))) . '</D:href>' .
			'<D:propstat><D:prop>';
		foreach ($props as $prop) $xml .= '<' . $prop . '/>';
		$xml .= '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';

		header('Content-Type: application/xml; charset=utf-8');
		header('HTTP/1.1 207 Multi-Status');
		echo $xml;
		exit;
	}

	/* ------------------------------------------------------------------ */
	/* locks                                                              */
	/* ------------------------------------------------------------------ */

	private function loadLocks() {
		$this->locks = array();
		$this->lockCache = null;
		if (!class_exists('FileCache') || !$this->locksFile) return;
		$dir = dirname($this->locksFile);
		if (!is_dir($dir) || !function_exists('path_writeable') || !path_writeable($dir)) return;

		$cache = new FileCache($this->locksFile);
		$locks = $cache->get();
		if (!is_array($locks)) $locks = array();
		$now = time();
		$changed = false;
		foreach ($locks as $token => $lock) {
			if (!is_array($lock) || !isset($lock['expires']) || intval($lock['expires']) < $now) {
				unset($locks[$token]);
				$changed = true;
			}
		}
		if ($changed) $cache->reset($locks);
		$this->locks = $locks;
		$this->lockCache = $cache;
	}

	private function saveLocks() {
		if (!$this->lockCache) return;
		if (function_exists('path_writeable') && !path_writeable($this->locksFile)) return;
		$this->lockCache->reset($this->locks);
	}

	private function findExactLock($relative) {
		foreach ($this->locks as $lock) {
			if (isset($lock['path']) && $lock['path'] === $relative) return $lock;
		}
		return null;
	}

	private function findLock($relative) {
		foreach ($this->locks as $lock) {
			if (!isset($lock['path'])) continue;
			if ($lock['path'] === $relative) return $lock;
			if (isset($lock['depth']) && $lock['depth'] === 'infinity') {
				$prefix = rtrim($lock['path'], '/') . '/';
				if ($lock['path'] === '/' || strpos($relative, $prefix) === 0) return $lock;
			}
		}
		return null;
	}

	private function findLocksFor($relative) {
		$result = array();
		foreach ($this->locks as $lock) {
			if (!isset($lock['path'])) continue;
			if ($lock['path'] === $relative) {
				$result[] = $lock;
				continue;
			}
			if (isset($lock['depth']) && $lock['depth'] === 'infinity') {
				$prefix = rtrim($lock['path'], '/') . '/';
				if ($lock['path'] === '/' || strpos($relative, $prefix) === 0) $result[] = $lock;
			}
		}
		return $result;
	}

	private function lockTokenMatches($lock) {
		if (empty($lock['token'])) return false;
		$if = $this->headerValue('If');
		$lockToken = $this->headerValue('Lock-Token');
		return strpos($if . ' ' . $lockToken, $lock['token']) !== false;
	}

	private function checkLock($relative) {
		$lock = $this->findLock($relative);
		if (!$lock) return;
		if ($this->lockTokenMatches($lock)) return;
		$this->fail(423, 'Resource is locked.');
	}

	private function checkLocksUnder($relative) {
		$prefix = rtrim($relative, '/') . '/';
		foreach ($this->locks as $lock) {
			if (!isset($lock['path'])) continue;
			if ($lock['path'] === $relative || strpos($lock['path'], $prefix) === 0) {
				if (!$this->lockTokenMatches($lock)) $this->fail(423, 'A resource inside is locked.');
			}
		}
	}

	private function lock() {
		if (!$this->can('explorer.pathList')) $this->fail(403, 'No permission to lock.');
		if (!$this->lockCache) $this->fail(500, 'Lock store is not writable.');
		$depth = strtolower(trim($this->headerValue('Depth')));
		$depth = ($depth === '0') ? '0' : 'infinity';
		$timeout = 1800;
		$timeoutHeader = $this->headerValue('Timeout');
		if ($timeoutHeader !== '') {
			if (stripos($timeoutHeader, 'Infinite') !== false) {
				$timeout = 3600;
			} else if (preg_match('/Second-(\d+)/i', $timeoutHeader, $match)) {
				$timeout = intval($match[1]);
			}
		}
		if ($timeout < 60) $timeout = 60;
		if ($timeout > 86400) $timeout = 86400;

		$exact = $this->findExactLock($this->path);
		if ($exact && $this->lockTokenMatches($exact)) {
			$this->locks[$exact['token']]['expires'] = time() + $timeout;
			$this->saveLocks();
			header('Lock-Token: <' . $exact['token'] . '>');
			$this->lockResponse($exact, 200);
		}
		if ($exact) $this->fail(423, 'Resource is locked.');
		$ancestor = $this->findLock($this->path);
		if ($ancestor && !$this->lockTokenMatches($ancestor)) $this->fail(423, 'Parent collection is locked.');

		$body = @file_get_contents('php://input');
		if ($body === false) $body = '';
		$owner = '';
		if (preg_match('/<(?:D|d):owner[^>]*>(.*?)<\/(?:D|d):owner>/is', $body, $match)) {
			$owner = trim(strip_tags($match[1]));
		}
		if ($owner === '') $owner = $this->user['name'];
		if (function_exists('msubstr')) {
			$owner = msubstr($owner, 0, 200, 'utf-8', false);
		} else if (strlen($owner) > 600) {
			$owner = substr($owner, 0, 600);
		}

		$token = 'opaquelocktoken:' . md5(uniqid('', true) . mt_rand() . $this->userID);
		$lock = array(
			'path' => $this->path,
			'token' => $token,
			'depth' => $depth,
			'owner' => $owner,
			'expires' => time() + $timeout,
			'created' => time(),
			'dir' => @is_dir($this->fsPath) ? 1 : 0
		);
		$this->locks[$token] = $lock;
		$this->saveLocks();
		header('Lock-Token: <' . $token . '>');
		$this->lockResponse($lock, @file_exists($this->fsPath) ? 200 : 201);
	}

	private function unlock() {
		$token = trim($this->headerValue('Lock-Token'));
		$token = trim($token, '<> ');
		if ($token === '') $this->fail(400, 'Lock-Token header is required.');
		if (!isset($this->locks[$token])) $this->fail(409, 'Lock token not found.');
		unset($this->locks[$token]);
		$this->saveLocks();
		$this->status(204);
	}

	private function lockResponse($lock, $status) {
		$xml = '<?xml version="1.0" encoding="utf-8"?>' .
			'<D:prop xmlns:D="DAV:"><D:lockdiscovery>' . $this->activeLockXml($lock) . '</D:lockdiscovery></D:prop>';
		header('Content-Type: application/xml; charset=utf-8');
		header('HTTP/1.1 ' . $status . ' ' . $this->statusText($status));
		echo $xml;
		exit;
	}

	private function activeLockXml($lock) {
		$remaining = max(0, intval($lock['expires']) - time());
		$depth = isset($lock['depth']) ? $lock['depth'] : 'infinity';
		$owner = isset($lock['owner']) ? $lock['owner'] : '';
		$href = $this->href($lock['path'], !empty($lock['dir']));
		return '<D:activelock>' .
			'<D:locktype><D:write/></D:locktype>' .
			'<D:lockscope><D:exclusive/></D:lockscope>' .
			'<D:depth>' . $this->esc($depth) . '</D:depth>' .
			'<D:owner>' . $this->esc($owner) . '</D:owner>' .
			'<D:timeout>Second-' . $remaining . '</D:timeout>' .
			'<D:locktoken><D:href>' . $this->esc($lock['token']) . '</D:href></D:locktoken>' .
			'<D:lockroot><D:href>' . $this->esc($href) . '</D:href></D:lockroot>' .
			'</D:activelock>';
	}

	private function supportedLockXml() {
		return '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>';
	}

	/* ------------------------------------------------------------------ */
	/* filesystem helpers / limits                                        */
	/* ------------------------------------------------------------------ */

	private function checkName($fs) {
		$name = get_path_this($fs);
		if ($name === '' || $name === '.' || $name === '..' || strpos($name, "\0") !== false) return false;
		$lowerName = strtolower($name);
		if (in_array($lowerName, array('.htaccess', '.user.ini', 'web.config'))) return false;
		if (function_exists('checkExt') && !checkExt($name)) return false;
		if (empty($GLOBALS['isRoot'])) {
			$lower = strtolower($name);
			$ext = strtolower(pathinfo($lower, PATHINFO_EXTENSION));
			$blockedExt = array(
				'php', 'php3', 'php4', 'php5', 'php6', 'php7', 'php8', 'phps', 'phtml', 'phtm', 'phar',
				'cgi', 'pl', 'py', 'jsp', 'asp', 'aspx', 'ascx', 'exe', 'dll',
				'html', 'htm', 'xhtml', 'svg', 'htaccess', 'user.ini'
			);
			if (in_array($ext, $blockedExt)) return false;
			$blockedName = array('.htaccess', '.user.ini', 'web.config');
			if (in_array($lower, $blockedName)) return false;
		}
		return true;
	}

	private function ensureParent($parent) {
		if (@is_dir($parent)) return true;
		if (!$this->can('explorer.mkdir')) return false;

		$missing = array();
		$probe = $parent;
		$root = rtrim($this->root, '/\\');
		while (!@is_dir($probe) && strlen($probe) > strlen($root)) {
			array_unshift($missing, $probe);
			$next = dirname($probe);
			if ($next === $probe) break;
			$probe = $next;
		}
		foreach ($missing as $folder) {
			if (!$this->checkName($folder)) return false;
			if (!@mk_dir($folder, DEFAULT_PERRMISSIONS)) return false;
			@chmod_path($folder, DEFAULT_PERRMISSIONS);
		}
		return @is_dir($parent);
	}

	private function moveToRecycle($fs) {
		$recycle = @iconv_system(USER_RECYCLE);
		if (!$recycle) return false;
		if (!@is_dir($recycle)) @mk_dir($recycle, DEFAULT_PERRMISSIONS);
		if (!@is_dir($recycle) || (function_exists('path_writeable') && !path_writeable($recycle))) return false;
		$name = get_path_this($fs);
		$target = @get_filename_auto(rtrim($recycle, '/\\') . DIRECTORY_SEPARATOR . $name, date('_H-i-s'), 'folder_rename');
		if (!$target) return false;
		return $this->moveTree($fs, $target);
	}

	private function recycleEnabled() {
		if (!$this->recycle) return false;
		if (isset($this->userConfig['recycleOpen']) && $this->userConfig['recycleOpen'] == '0') return false;
		return true;
	}

	private function fileSize($fs) {
		if (function_exists('get_filesize')) return get_filesize($fs);
		return @filesize($fs);
	}

	private function sizeOf($fs) {
		if (@is_link($fs)) return 0;
		if (@is_file($fs)) return $this->fileSize($fs);
		if (!@is_dir($fs)) return 0;
		return $this->dirSize($fs);
	}

	private function deleteTree($fs) {
		if (@is_link($fs) || @is_file($fs)) {
			if (@unlink($fs)) return true;
			@chmod($fs, 0777);
			return @unlink($fs);
		}
		if (!@is_dir($fs)) return false;
		$entries = @scandir($fs);
		if (!is_array($entries)) return false;
		$ok = true;
		foreach ($entries as $name) {
			if ($name === '.' || $name === '..') continue;
			if (!$this->deleteTree(rtrim($fs, '/\\') . DIRECTORY_SEPARATOR . $name)) $ok = false;
		}
		if (@rmdir($fs)) return $ok;
		@chmod($fs, 0777);
		return @rmdir($fs) && $ok;
	}

	private function copyTree($source, $destination) {
		if (@is_link($source)) return true; // never follow symbolic links
		if (@is_file($source)) {
			$parent = dirname($destination);
			if (!@is_dir($parent)) {
				if (!@mk_dir($parent, DEFAULT_PERRMISSIONS)) return false;
			}
			if (!@copy($source, $destination)) return false;
			@chmod($destination, DEFAULT_PERRMISSIONS);
			return true;
		}
		if (!@is_dir($source)) return false;
		if (!@is_dir($destination)) {
			if (!@mkdir($destination, DEFAULT_PERRMISSIONS)) return false;
			@chmod_path($destination, DEFAULT_PERRMISSIONS);
		}
		$entries = @scandir($source);
		if (!is_array($entries)) return false;
		foreach ($entries as $name) {
			if ($name === '.' || $name === '..') continue;
			if (@is_link(rtrim($source, '/\\') . DIRECTORY_SEPARATOR . $name)) continue;
			if (!$this->copyTree(
				rtrim($source, '/\\') . DIRECTORY_SEPARATOR . $name,
				rtrim($destination, '/\\') . DIRECTORY_SEPARATOR . $name
			)) return false;
		}
		return true;
	}

	private function moveTree($source, $destination) {
		if (@rename($source, $destination)) return true;
		if (!$this->copyTree($source, $destination)) {
			$this->deleteTree($destination);
			return false;
		}
		return $this->deleteTree($source);
	}

	private function dirSize($fs) {
		$total = 0;
		$entries = @scandir($fs);
		if (!is_array($entries)) return 0;
		foreach ($entries as $name) {
			if ($name === '.' || $name === '..') continue;
			$child = rtrim($fs, '/\\') . DIRECTORY_SEPARATOR . $name;
			if (@is_link($child)) continue;
			if (@is_dir($child)) $total += $this->dirSize($child);
			else if (@is_file($child)) $total += $this->fileSize($child);
		}
		return $total;
	}

	private function quotaInfo() {
		if ($this->quota === null) {
			$members = $this->loadDataFile('system_member.php');
			$this->quota = isset($members[$this->userID]) ? $members[$this->userID] : array();
		}
		return $this->quota;
	}

	private function quotaCheck($delta) {
		$info = $this->quotaInfo();
		if (empty($info['config'])) return true;
		$max = floatval($info['config']['sizeMax']) * 1073741824;
		if ($max <= 0) return true;
		$use = floatval(isset($info['config']['sizeUse']) ? $info['config']['sizeUse'] : 0);
		return ($use + floatval($delta)) <= $max;
	}

	private function quotaChange($delta) {
		if ($delta == 0) return;
		$members = $this->loadDataFile('system_member.php');
		if (!isset($members[$this->userID])) return;
		if (!isset($members[$this->userID]['config']) || !is_array($members[$this->userID]['config'])) {
			$members[$this->userID]['config'] = array();
		}
		$use = floatval(isset($members[$this->userID]['config']['sizeUse']) ? $members[$this->userID]['config']['sizeUse'] : 0);
		$use += floatval($delta);
		if ($use < 0) $use = 0;
		$members[$this->userID]['config']['sizeUse'] = $use;
		$file = USER_SYSTEM . 'system_member.php';
		if (function_exists('path_writeable') && !path_writeable($file)) return;
		@FileCache::save($file, $members);
		$this->quota = $members[$this->userID];
	}

	private function can($key) {
		if (!empty($GLOBALS['isRoot'])) return true;
		return !empty($GLOBALS['auth'][$key]);
	}

	/* ------------------------------------------------------------------ */
	/* HTTP helpers                                                       */
	/* ------------------------------------------------------------------ */

	private function headerValue($name) {
		$key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
		if (isset($_SERVER[$key])) return trim($_SERVER[$key]);
		if ($name === 'Content-Length' && isset($_SERVER['CONTENT_LENGTH'])) return trim($_SERVER['CONTENT_LENGTH']);
		if ($name === 'Content-Range' && isset($_SERVER['CONTENT_RANGE'])) return trim($_SERVER['CONTENT_RANGE']);

		if (function_exists('apache_request_headers')) {
			$headers = @apache_request_headers();
			if (is_array($headers)) {
				foreach ($headers as $k => $v) {
					if (strcasecmp($k, $name) === 0) return trim($v);
				}
			}
		}
		if (function_exists('getallheaders')) {
			$headers = @getallheaders();
			if (is_array($headers)) {
				foreach ($headers as $k => $v) {
					if (strcasecmp($k, $name) === 0) return trim($v);
				}
			}
		}
		return '';
	}

	private function esc($value) {
		$value = $value === null ? '' : (string)$value;
		$result = htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
		if ($result === '' && $value !== '' && function_exists('iconv')) {
			$clean = @iconv('UTF-8', 'UTF-8//IGNORE', $value);
			if ($clean !== false) $result = htmlspecialchars($clean, ENT_QUOTES, 'UTF-8');
		}
		return $result;
	}

	private function statusText($code) {
		$text = array(
			200 => 'OK', 201 => 'Created', 204 => 'No Content', 206 => 'Partial Content',
			207 => 'Multi-Status', 304 => 'Not Modified', 400 => 'Bad Request',
			401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not Found',
			405 => 'Method Not Allowed', 409 => 'Conflict', 412 => 'Precondition Failed',
			416 => 'Requested Range Not Satisfiable', 423 => 'Locked',
			500 => 'Internal Server Error', 501 => 'Not Implemented',
			507 => 'Insufficient Storage'
		);
		return isset($text[$code]) ? $text[$code] : 'Status';
	}

	private function status($code) {
		if (!headers_sent()) {
			header('HTTP/1.1 ' . $code . ' ' . $this->statusText($code));
		}
		exit;
	}

	private function fail($code, $message) {
		if (!headers_sent()) {
			header('HTTP/1.1 ' . $code . ' ' . $this->statusText($code));
			header('Content-Type: text/plain; charset=utf-8');
		}
		if ($this->method !== 'HEAD' && $message !== '') echo $message;
		exit;
	}
}

$kodWebdav = new KodWebDAV();
$kodWebdav->run();
