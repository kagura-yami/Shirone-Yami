# 生产部署参考

本机演示已经串联数据库和前台；`deploy/` 是 Linux 宿主机部署参考，不是免配置的一键公网部署。所有域名为 `example.com`，没有附带真实 OIDC 配置或凭据。

## 固定目录约定

源码放 `/srv/blog/project`，公开构建放 `/srv/blog/releases`；admin/vault 数据分别放 `/srv/blog/data/admin`、`/srv/blog/data/vault`，队列和结果放 `/srv/blog/queue`、`/srv/blog/results`。`/etc/blog/` 存放仅服务用户可读的运行配置与密钥，永远不放在源码或公开目录里。

现有 Compose 使用 UID 1002、GID 1003；部署前应建立专用服务用户并配置目录权限，或统一修改 Compose 与 systemd 的用户设置。不要复用其他项目的身份或 Docker 网络。

## 配置步骤

1. 完成本地 `pnpm bootstrap`、检查和构建，确认后台生成资源齐全。
2. 替换 `src/config/siteConfig.ts` 与 `deploy/edge-*.caddy`、`deploy/authelia.yaml` 中的示例域名。
3. 自行配置 Authelia 的用户密码哈希、TOTP、签名密钥、OIDC 客户端与回调地址。`identity.compose.yaml` 指定的 `oidc.yml` 和 `users.yml` 必须在私有目录提供；模板不生成共享密码。
4. 将 `deploy/config.admin.example.json` 复制到私有配置目录，设置真实 issuer、clientId、clientSecret、subject 和随机 sessionSecret。OIDC token 必须有 `pwd` 和 `otp` AMR 声明；不满足时应用拒绝登录。
5. 日记配置将 mode 改为 `vault`、origin 改为日记 HTTPS 地址，并使用独立客户端和 sessionSecret。另提供 32 字节随机密钥的 64 位十六进制文本 `/etc/blog/vault/data-key`。
6. 宿主机 Caddy 将 HTTPS 请求代理到 Compose 的 loopback 端口。`proxy` 仅设为实际代理来源 IP；容器内 Caddy 需要自行配置专属网络，不能照搬宿主机 loopback 地址。
7. 构建 `deploy/Dockerfile.authoring`（上下文 `services/authoring`），依次启动 identity、公开 web、authoring；配置 `blog-publisher.service` 和备份 timer。先阅读各脚本的路径约定再启用。

常用命令入口：

```sh
docker build -t blog-authoring:1 -f deploy/Dockerfile.authoring services/authoring
docker compose -p blog-auth -f deploy/identity.compose.yaml up -d --wait
docker compose -p blog-workspace -f deploy/authoring.compose.yaml up -d --wait
bash deploy/blogctl publish
bash deploy/blogctl status
bash deploy/blogctl stop
bash deploy/blogctl start
```

首次运行 `blogctl publish` 之前需创建 releases/builds/logs 等工作目录，并准备 worker、备份脚本使用的目录。生产部署需要 Docker、Python 3、Bash、systemd、Caddy 和 TLS；Windows 本机演示不依赖这些工具。

## 数据边界

前台静态服务只暴露构建产物。数据库、WAL/SHM、备份、媒体原图、发布清单和密钥不应放在公开目录。数据库备份与日记密钥分别保存，建议加密异地备份。身份服务的数据也需要单独备份。

生产镜像不复制 demo/ 或 test/，且 server.mjs 强制 HTTPS 配置；不要将本机演示用作公网服务。模板的验证不代表已验证任意身份服务或生产环境。
