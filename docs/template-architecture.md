# Project Context Analysis

## Analysis Purpose

将 Shirone 博客、独立内容后台及 SQLite 发布链路整理为可开源复用的源码模板。

## Codebase Structure

`src/` 是静态博客，`services/authoring/` 是独立运行的 Node 应用，`deploy/` 保存生产部署参考。前台不直接打开数据库。

## Dependencies

前台使用 Astro、Svelte、Tailwind、Swup；后台使用 Express、Node 内置 SQLite、openid-client、Sharp 和 CodeMirror。前后台各保留 pnpm 锁文件。

## Connections

浏览器后台通过同源 API 读写 SQLite。发布 API 将批准的版本写入私有队列，worker 导出到源码副本并运行 Astro 和 Pagefind。只有构建完成后才切换公开文件目录。

## Architecture Patterns

公开博客采用静态生成；内容服务独立部署。草稿、批准版本和发布结果分开保存。日记使用独立数据库与 AES-256-GCM 数据密钥，不进入发布队列；它是服务端加密，并非端到端加密。

## Codebase Conventions

沿用主题 token、组件分层与十语言文案体系。保留主题源码和 npm 集成；本模板的后台和演示运行器只针对源码模式，不包含在主题 npm 使用流程中。

## Dependency Graph

```text
编辑器 → Express API → SQLite
                         ↓ 获准发布的快照
                    私有发布队列
                         ↓
                内容导出 → Astro + Pagefind
                         ↓ 构建成功后切换
                      静态博客
```

## Component Relationships

博客使用既有组件层级；后台的 `public/app.js` 驱动编辑器，`app.mjs` 负责路由，`storage.mjs` 负责版本与数据库，`export.mjs` 负责导出白名单内容。本机 `demo/start.mjs` 组合既有接口，不改变生产认证入口。

## Key Insights

“保存”只改变后台草稿，“发布”经过构建才改变博客。源码和后台同时修改同一篇文章会触发来源冲突；需要人工合并，不应删除数据库解决。演示构建副本保留在 `.demo/`，便于排错，需要定期清理。
