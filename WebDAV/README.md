# KodExplorer WebDAV 网络磁盘

把 KodExplorer 的**个人空间**映射成 WebDAV 网络磁盘，供 Windows、macOS、手机和第三方客户端使用。

## 功能

- HTTP Basic Auth，账号密码与 KodExplorer 一致
- 个人空间挂载（不暴露服务器根目录）
- 读写：`OPTIONS / PROPFIND / GET / HEAD / PUT / DELETE / MKCOL / COPY / MOVE / LOCK / UNLOCK / PROPPATCH`
- `Range` 断点下载、大文件流式上传
- 文件锁（WebDAV Class 2）
- 删除到 KodExplorer 回收站（可关闭）
- 用户空间配额校验
- 只读模式、强制 HTTPS
- 插件菜单内置连接地址与 Windows/macOS/手机使用说明

## 安装

1. 把整个 `WebDAV` 目录放到 KodExplorer 的 `plugins/` 下。
2. 登录 KodExplorer，打开插件中心，启用 **WebDAV 网络磁盘**。
3. 顶部菜单会出现 `WebDAV`，打开后复制 WebDAV 地址。
4. 客户端地址形如：

```text
https://your-domain/plugins/WebDAV/webdav.php/
```

账号密码使用当前 KodExplorer 账号。

## Nginx

### 情况一：直接由 Nginx + PHP-FPM 提供服务

WebDAV 地址使用 `webdav.php/路径` 形式，需要把 `PATH_INFO` 和 `Authorization` 传给 PHP：

```nginx
location ~ \.php(/|$) {
    fastcgi_split_path_info ^(.+?\.php)(/.*)$;
    fastcgi_param PATH_INFO $fastcgi_path_info;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;
    # 其他 fastcgi_param / fastcgi_pass 配置
}
```

Apache 一般默认支持 `AcceptPathInfo`。

### 情况二：外面还有一层 Nginx 反代到 8899

如果你的 KodExplorer 是通过 `/yunpan` 反代到 `127.0.0.1:8899`，不需要新增 location；在现有 `/yunpan` 里补上反向代理前缀和超时即可：

```nginx
location /yunpan {
    client_max_body_size 10240m;

    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /yunpan;
    proxy_set_header Authorization $http_authorization;

    client_body_timeout 3600s;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    proxy_pass http://127.0.0.1:8899/;
}
```

`X-Forwarded-Prefix` 很关键：插件用它生成 `PROPFIND` 里的 `href`，否则客户端会拿到 `/plugins/...` 而不是 `/yunpan/plugins/...`。

后端 8899 如果是 Nginx + PHP-FPM，仍然要确认它能处理 `webdav.php/路径` 并传递 `PATH_INFO`；如果是 Apache 或 PHP 内置服务器，一般默认支持。

也可以改用独立的 WebDAV 子域名（直接反代到 8899 根路径），这样就不需要 `X-Forwarded-Prefix`。

## 说明

- 挂载的是**个人空间**（用户目录下的 `home`），不是服务器根目录，也不包含群组共享目录。
- 删除默认移动到 KodExplorer 回收站；关闭插件配置中的“删除到回收站”后为永久删除。
- WebDAV 使用 Basic Auth，公网环境请使用 HTTPS；可在插件配置中开启“强制 HTTPS”。
- 非管理员用户受 KodExplorer 角色权限和扩展名限制；`php/html/svg` 等危险扩展名默认禁止写入。
- 当前版本面向个人空间；外部 WebDAV 挂载（把别的 WebDAV 挂进 KodExplorer）不在本插件范围内。
