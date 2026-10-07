# OIE Web Client

基于 Web 的 **[Open Integration Engine](https://github.com/openintegrationengine)**（OIE / Mirth Connect）管理员 —— 浏览器端替代 Swing 管理员客户端。可作为独立 Node.js 应用运行，使用发布的 Docker 镜像，或将可选的 WAR 直接部署到现有 OIE 服务器。它通过 REST API 与引擎通信，并且**可插件化**：扩展开发者只需将文件夹放入 `plugins/` 即可添加功能（这是引擎 `plugin.xml` 扩展模型的 Web 等价物）。

两个管理员可以并排针对同一引擎使用 —— 本应用通过 Swing 客户端使用的相同 `/api` 接口进行读写。可选的 **[Web Support 插件](#环境要求)** 添加了消息树序列化、引擎端 JavaScript 验证、引擎服务的插件 UI 以及嵌入式 WAR；其余管理员功能在没有它的情况下仍可正常工作。

```
┌─────────────┐   http :3030    ┌──────────────────┐   https :8443/api   ┌────────────┐
│   浏览器    │ ──────────────▶ │   Web 客户端     │ ──────────────────▶ │   引擎     │
│  (本 SPA)   │                 │  (Node/Express)  │   反向代理          │ (OIE/Mirth)│
└─────────────┘                 └──────────────────┘                     └────────────┘
                                   │  plugins/  (服务端 + 浏览器扩展)
```

## 仓库结构

npm workspaces 单仓多包结构：应用程序 plus 插件作者构建所依赖的 `@oie/*` 框架包。

```
oie-web-client/
├── LICENSE
├── README.md                 ← 你在这里
├── package.json              workspaces + lint / typecheck / e2e 脚本
├── e2e/                       Playwright 端到端测试（默认 mock；`npm run e2e`）
├── type-tests/                TypeScript 类型检查（`npm run typecheck`）
├── packages/                 @oie/* 框架库（供插件作者使用）
│   ├── web-api/              引擎 REST 客户端 + 模型辅助
│   ├── web-ui/               DOM 工具集、表格、表单、代码编辑器、连接器面板
│   ├── web-shell/            平台扩展点
│   └── eslint-config/        共享 lint 配置，强制执行 @oie/* 边界
└── web-administrator/        ← 应用程序
    ├── client/               浏览器 SPA（ES modules；Vite 构建，开发时直接服务源码）
    ├── server/               Node/Express 服务器，/api 反向代理，插件安装
    ├── plugins/              内置 Web 插件（服务端 + 浏览器扩展）
    ├── PLUGINS.md            插件开发指南（含完整示例）
    ├── RBAC.md               基于角色的访问控制钩子 + 权限目录
    ├── docs/                 功能对等 / 反馈笔记
    ├── config.example.json   复制为 config.json 并编辑
    └── package.json
```

## 环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| **Node.js** | **22.18+；已在 22.22.3 测试** | 源码构建、测试和打包的 Node 运行时请使用固定的 `.nvmrc`。 |
| **npm** | 随 Node 22 附带 | 在仓库根目录运行 `npm ci`；这是 npm-**workspaces** 单仓多包结构。不使用 Yarn/pnpm。 |
| **JDK** | **17+**（仅 WAR 构建需要） | 提供 `npm run build:war` 使用的标准 `jar` 工具；Node/Docker 部署运行不需要。 |
| **OIE / Mirth Connect 引擎** | **4.6.0** | 本应用是**运行中**引擎的*客户端* —— 它既不打包也不启动引擎。默认 `https://127.0.0.1:8443`。此发布版本针对 OIE 4.6.0。 |
| **OIE Web Support 插件** | 单独获取 | **基础管理员可选；需要以下功能时必需**：精确字节的消息树序列化、引擎端 JavaScript 验证、引擎服务的插件 UI，以及插件管理的嵌入式 WAR。下载地址：**[gibson9583/oie-web-support-plugin](https://github.com/gibson9583/oie-web-support-plugin)**。 |
| **现代浏览器** | 当前版本 Chrome / Edge / Firefox / Safari | ES-module SPA；Monaco 脚本编辑器打包并在本地服务（支持离线环境），并有纯文本编辑器回退。 |

贡献者运行端到端测试还需安装 Playwright 浏览器：`npx playwright install chromium firefox webkit`。

## 从源码快速启动

> **可选 Web Support 插件。** 基础管理员可在没有 Web Support 的情况下启动。当你需要消息树、引擎端脚本验证、引擎服务的插件 UI 或插件管理的 WAR 安装时，从 **[gibson9583/oie-web-support-plugin](https://github.com/gibson9583/oie-web-support-plugin)** 安装插件。

> ⚠️ 在**仓库根目录**运行 `npm install`。这是 npm-workspaces 单仓多包结构 —— 在 `web-administrator/` 内安装不会链接 `@oie/*` 包，应用无法启动。

```bash
# 1) 从仓库根目录 —— 安装所有工作区（root, packages/*, web-administrator）：
npm install

# 2) 配置引擎地址：
cd web-administrator
cp config.example.json config.json        # 然后编辑 "engine.url" 为你的 OIE/Mirth REST URL

# 3) 运行：
npm run dev                               # dev：文件监听 + Vite，无构建步骤（开发时推荐）
#   —— 或 ——
npm run build && npm start                # 优化的生产构建 + 服务器

# 打开 http://localhost:3030 并使用引擎凭据登录。
```

引擎必须在登录前**运行并可访问**（`engine.url`）。默认启用引擎证书验证。对于私有 CA 或自签名引擎，启动 Node 时使用 [`NODE_EXTRA_CA_CERTS=/path/to/engine-ca.pem`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile) 信任其 PEM 证书，并使用与证书主机名匹配的引擎 URL。Docker 中挂载 PEM 并设置相同变量。`OIE_VERIFY_TLS=false` 仅用于隔离的本地开发环境。

`npm run dev` 动态服务和转换 `client/` 源码 —— 开发时无需手动构建。`npm run build` 输出 `npm start` 所需的优化 `client/dist`；未构建的 TypeScript/Tailwind 源码无法在没有 Vite 的浏览器中启动。两种支持路径保持框架为单一共享实例，因此运行时加载的插件解析到同一副本。

## 部署到现有 OIE 服务器（WAR）

WAR 是最小的生产部署：OIE 内嵌的 Jetty 已加载其 `webapps/` 目录中的每个 `*.war`，因此无需 Node 进程、反向代理或额外端口。

从 [Web Support 发布页](https://github.com/gibson9583/oie-web-support-plugin/releases) 下载 `websupport-<version>.zip`，通过 Swing 管理员安装，然后重启 OIE。插件同时安装额外 API 及其内嵌的 `oie-webadmin.war`。

或自行构建并复制 WAR：

```bash
# 从仓库根目录（npm install 后）：
npm run build:war

# 停止 OIE，复制产物，然后重新启动 OIE：
cp web-administrator/dist/oie-webadmin.war /path/to/OIE/webapps/
```

打开 `https://<oie-host>:8443/oie-webadmin/`。OIE 从文件名派生 URL 上下文，因此将产物重命名为 `admin.war` 会部署到 `/admin/`。生成的 JSP 在运行时发现该名称和非根 OIE `http.contextpath`；WAR 不硬编码服务器 URL。使用 HTTPS 监听器 —— 引擎 API 仅支持 HTTPS，除非明确启用 `server.api.allowhttp`。

WAR 模式有意绑定到托管它的 OIE 服务器。本地登录/MFA、引擎扩展安装/卸载和内置插件直接针对该服务器工作；引擎服务的插件 UI 还需要原生 web-support 端点或 Web Support 扩展。需要 Node 服务器的功能 —— 多引擎目标、用户输入的引擎 URL、`pluginDirs` 和 Node 管理的 TLS —— 仍可通过源码或 Docker 模式使用。

Web Support 包安装其内嵌 WAR。你仍可改用 Node.js 或 Docker 部署；内嵌副本仅作为 `/oie-webadmin/` 的可用选项。

## Docker 运行

预构建镜像发布到 Docker Hub：[`gibson9583/oie-web-client`](https://hub.docker.com/r/gibson9583/oie-web-client)：`latest` 为最新发布版，`X.Y.Z` / `X.Y` 固定特定发布版，`main` 为 `main` 分支顶端的滚动构建，`pr-N` 预览未关闭的拉取请求（PR 关闭时删除）。

```bash
docker run --rm -p 127.0.0.1:3030:3030 \
  -e OIE_URL=https://host.docker.internal:8443 \
  gibson9583/oie-web-client:latest
```

容器内 `localhost` 是容器本身 —— 使用 `host.docker.internal` 访问 Docker 主机上运行的引擎（Docker Desktop），或使用引擎的实际主机名。

镜像**不内置配置** —— 它读取与源码安装相同的设置（参见 [Node/Docker 配置](#nodedocker-配置)）。环境变量覆盖每个设置；完整配置文档 —— `allowedUrls`、`tls`、`pluginDirs`、插件设置 —— 挂载文件或内联传递 JSON：

```bash
# 挂载配置文档（通过绝对路径引用 PEM）：
docker run --rm -p 127.0.0.1:3030:3030 \
  -v ./my-config:/config:ro -e WEBADMIN_CONFIG=/config/config.json \
  gibson9583/oie-web-client:latest

# ……或直接注入文档（例如从编排器密钥）：
docker run --rm -p 127.0.0.1:3030:3030 \
  -e WEBADMIN_CONFIG_JSON='{"allowedUrls":[{"name":"Prod","url":"https://oie-prod:8443"}]}' \
  gibson9583/oie-web-client:latest
```

示例仅在主机回环地址发布纯 HTTP。容器以非 root `node` 用户运行并监听 `3030`；对于可路由访问，在前端终止 TLS 或配置[内建 TLS](#通过-https-服务)并挂载 PEM 后再发布非回环主机地址。在 Docker 中启用内建 TLS 时，将镜像默认的纯 HTTP 健康检查替换为 HTTPS 感知探针。从仓库根目录使用 `docker build -t oie-web-client .` 自行构建镜像。

## Node/Docker 配置

设置从单个 JSON **配置文档**加载，然后是每个设置的环境变量覆盖。配置文档来自以下来源（优先级从高到低）：`WEBADMIN_CONFIG_JSON`（JSON 本身，内联）、`WEBADMIN_CONFIG` 命名的文件（可在容器中任意位置挂载）、或 `web-administrator/config.json`（gitignore —— 保存机器特定路径）。明确命名但缺失或无法解析的来源会在启动时失败，而不是静默使用默认值启动。从 [`config.example.json`](web-administrator/config.example.json) 开始：

| 设置 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `port` | `WEBADMIN_PORT` | `3030` | Web UI 监听端口 |
| `host` | `WEBADMIN_HOST` | `127.0.0.1` | 绑定地址（Docker 明确绑定所有容器接口） |
| `engine.url` | `OIE_URL` | `https://127.0.0.1:8443` | 引擎基础 URL |
| `engine.verifyTls` | `OIE_VERIFY_TLS` | `true` | 验证引擎 TLS 证书 |
| `allowedUrls` | — | `[]` | 多引擎模式：`[{ "name", "url", "verifyTls"? }, …]` 在登录界面显示引擎选择器。空 → 单引擎模式（仅 `engine.url`，无选择器） |
| `devMode` | `WEBADMIN_DEV_MODE` | `false` | 在登录界面添加自由格式的引擎 URL 字段。代理转发到输入的任何地址，因此仅用于受信任/开发环境。（区别于 `npm run dev`，即 Vite 开发服务器） |
| `pluginDirs` | `WEBADMIN_PLUGIN_DIRS` | `[]` | 与内置 `./plugins` 一起扫描的额外**本地**插件目录（例如用于本地开发）。引擎安装的扩展由引擎服务，不存储于此。环境变量使用平台路径分隔符（Unix 为 `:`，Windows 为 `;`） |
| `trustedProxies` | `WEBADMIN_TRUSTED_PROXIES` | `[]` | 信任设置 `X-Forwarded-For` 的对端 IP（前端 TLS 终止器 / 反向代理）。回环始终受信任。环境变量中用逗号分隔 |
| `codeTemplateCompletions` | `WEBADMIN_CODE_TEMPLATE_COMPLELTIONS` | `true` | 将通道自身的代码模板函数作为脚本编辑器自动补全提供；禁用可避免获取过大的目录 |
| `tls` | `WEBADMIN_TLS_KEY` / `WEBADMIN_TLS_CERT` / `WEBADMIN_TLS_PASSPHRASE` | `null`（HTTP） | 直接通过 **HTTPS** 服务 UI —— 设置 `{ "key", "cert", "passphrase"? }` 为 PEM 文件路径（key 和 cert 都需要）。默认关闭；参见[通过 HTTPS 服务](#通过-https-服务) |

### OpenID Connect 登录

SSO 完全在引擎端配置，位于 **设置 → OIDC 认证**（`oie-oidc-auth` 扩展）：发现 URL、客户端 ID 和密钥、Web 管理员自身的 URL、配置和角色映射。本服务器不保留任何内容 —— 没有提供者条目、没有密钥 —— 登录卡片向引擎查询是否提供 SSO。扩展的 README 包含提供者配置指南。

### 引擎路由模式

- **单引擎**（默认）：设置 `engine.url`；所有登录都指向该引擎。
- **多引擎**：在 `allowedUrls` 中列出 —— 登录界面显示选择器，代理将每个会话路由到登录时选择的引擎：

  ```json
  {
      "allowedUrls": [
          { "name": "Production", "url": "https://oie-prod:8443", "verifyTls": true },
          { "name": "Test", "url": "https://oie-test:8443" }
      ]
  }
  ```

- **开放引擎 URL**（`devMode: true`）：登录界面接受用户输入的任何引擎 URL。代理转发到输入的主机 —— 仅在受信任网络 / 开发机器上使用。

`engine` 和 `allowedUrls` 的关系：非空的 `allowedUrls` **替换**引擎列表 —— `engine.url` 不会自动添加到选择器，因此如果需要可选择，请将其作为条目包含。`engine.verifyTls` 仍然是任何省略自身 `verifyTls` 的条目的回退。`OIE_URL` / `OIE_VERIFY_TLS` 环境变量仅覆盖 `engine`，从不过 `allowedUrls`。

引擎的**名称即其标识**：用户记住的登录选择以名称为键，而非条目位置，因此可以自由添加、删除或重新排序条目，而不会重定向任何人的已保存选择。因此名称必须唯一（启动时冲突会失败），重命名或删除引擎会使该引擎的已保存选择失效 —— 这些用户在下次登录时会被要求选择引擎，而不是被路由到回退。从按列表位置记住选择的版本升级会使已记住的选择失效一次：每个用户在下次登录时重新选择引擎。

> **认证**使用引擎自身的：登录表单提交到 `/api/users/_login`，引擎的 `JSESSIONID` cookie 携带会话。Node 服务器不存储凭据；它是流式反向代理。

Node/Docker 将上游 cookie 名称限定到每个引擎 URL。从无作用域 cookie 升级需要重新登录。API 调用携带标签页选定的引擎和登录代际；其他标签页的更改会在提交旧数据前重新加载过期视图。插件代码应使用 `platform.api` / `@oie/web-api` 以参与此检查。缺少上下文头的认证代理变更会被拒绝。WAR cookie 仍由托管引擎拥有。

通道工作副本仅保存在内存中。会话过期、不活动注销和登出会丢弃未保存的通道编辑；重新登录后没有自动草稿恢复。启动时会从浏览器存储中删除旧版本保存的每个引擎/账户的草稿，因为它们可能包含凭据。

引擎请求在 Node 和 WAR 部署中都使用 `cache: 'no-store'`。客户端使用 [`Clear-Site-Data: "cache"`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data) 进行单独的后台请求，以逐出旧客户端保留的 HTTP 响应。成功完成按浏览器和应用路径记录；中断或失败的清理在下次页面加载时重试。将此头从文档中移除可避免阻塞 Chromium 的缓存删除。旧版清理还会清除源的缓存静态资源；它保留 cookie 和偏好。对于不支持此头的浏览器升级，手动清除该站点的缓存文件。此头需要安全上下文，因此远程部署必须使用 HTTPS。

### 通过 HTTPS 服务

默认情况下，源码应用仅在**回环地址**（`127.0.0.1:3030`）服务 HTTP。保持 Docker 发布端口在主机回环，如上所示。对于远程访问，在绑定到网络接口（`WEBADMIN_HOST`）前配置 HTTPS。两种加密浏览器连接的方式：

- **反向代理（生产推荐）。** 在应用前的 nginx、Caddy、Traefik 或负载均衡器终止 TLS —— 自动证书颁发/续期、HTTP→HTTPS 重定向和 HSTS 免费获得。设置 `trustedProxies` 为代理 IP，以便引擎审计日志看到真实客户端地址。使用 Caddy 基本是 `your.host { reverse_proxy localhost:3030 }`。

- **内建 TLS（独立安装方便）。** 将应用指向 PEM 密钥 + 证书，它自行服务 HTTPS —— 无需额外进程：

  ```json
  {
      "tls": { "key": "certs/webadmin-key.pem", "cert": "certs/webadmin-cert.pem" }
  }
  ```

  或通过环境变量：`WEBADMIN_TLS_KEY` / `WEBADMIN_TLS_CERT`（+ `WEBADMIN_TLS_PASSPHRASE` 如果密钥加密）。路径相对于 `web-administrator/` 或绝对路径；**key 和 cert 都需要**；不完整的 TLS 配置会停止启动。启动时记录 `https://…  (TLS)`。自签名证书可用于测试（浏览器会警告）；生产环境使用 CA 签发的证书。

精确字节的消息树序列化和 JavaScript 验证来自**连接的引擎**（`/datatypes/_serialize`、`/javascript/_validate`）—— 无需配置本地 JVM 或引擎安装。客户端在每个会话上探测这些：首先是引擎原生端点，然后是 **Web Support 插件**（[oie-web-support-plugin](https://github.com/gibson9583/oie-web-support-plugin)），它在标准引擎上提供这些功能而无需引擎更改。两者都没有时，应用仍可工作 —— 消息树、服务端验证和引擎服务的插件 UI 被禁用并显示通知。格式化文档完全在客户端运行。

## 故障排除

| 症状 | 修复 |
|---|---|
| `Cannot find package '@oie/web-api'`、空白页或裸导入错误 | 你在子文件夹内安装。删除 `node_modules` 并从**仓库根目录**运行 `npm install` —— workspaces 在此提升。 |
| 登录失败、"引擎不可达"或 `502` | 引擎未运行或 `engine.url` 错误。确认 `<engine.url>/api/server/version` 响应。 |
| 访问引擎时 TLS / 证书错误 | 启动时使用 `NODE_EXTRA_CA_CERTS` 信任引擎 CA，并检查 URL 是否与其证书主机名匹配。 |
| `EADDRINUSE` / 端口 `3030` 已占用 | 设置 `WEBADMIN_PORT`（或 `config.json` 中的 `port`）。 |
| `npm run dev` / `npm start` 时 Vite 或语法错误 | 使用 `.nvmrc` 中的 Node 22.22.3（`node -v`）；最低要求 22.18。 |
| 复制 WAR 后 URL 返回 404 | OIE 仅在启动时发现 WAR。将文件直接放在 `<OIE_HOME>/webapps/`，重启 OIE，并使用与 WAR 文件名匹配的上下文。 |
| 消息树、脚本验证或引擎服务的插件 UI 不工作 | 连接的引擎既没有原生 web-support 端点，也没有 [Web Support 插件](https://github.com/gibson9583/oie-web-support-plugin)。安装插件并重启引擎。格式化文档仍可用，因为它是客户端的。 |

## 插件与社区商店

几乎所有功能都是插件 —— 连接器、数据类型、仪表盘标签页、设置面板等 —— 第三方可使用与内置插件相同的方式添加自己的功能。

**[OIE 社区商店](https://github.com/gibson9583/oie-community-store)** 是查找和安装支持 Web 客户端的插件的最简单方式。它是**纯 Web** 功能：浏览社区插件、通道和代码模板，并直接从客户端 UI 安装 —— 无需手动复制文件。许多现有社区插件已更新以支持 Web 客户端，可在那里进行测试。

构建自己的？参见 [`web-administrator/PLUGINS.md`](web-administrator/PLUGINS.md) 了解扩展点和完整示例。

## 框架包（`@oie/*`）

插件针对发布的工作区包构建，而不是访问 shell 内部：

| 包 | 用途 |
|---|---|
| [`@oie/web-api`](packages/web-api) | 引擎 REST 客户端 + 模型辅助 |
| [`@oie/web-ui`](packages/web-ui) | DOM 工具集、表格、表单、代码编辑器、连接器面板辅助 |
| [`@oie/web-shell`](packages/web-shell) | `platform` 扩展点（导航、视图、设置、连接器） |
| [`@oie/eslint-config`](packages/eslint-config) | 强制执行公共 API 边界的共享 lint 配置 |

框架实现了 API **4.8.0**，包含插件 Reference 注册和查找、作用域编辑器补全和连接器表单回调/验证。参见 [API 4.8 契约](web-administrator/PLUGINS.md#api-48-plugin-contracts) 了解签名和兼容性，包括 Web Support 的数据类型词汇表清单声明。

运行时，宿主页面的 import map 将 `@oie/*` 解析到 shell 加载的副本，因此插件共享一个框架实例，无论它是打包的还是从扩展 zip 服务的。插件也可通过绝对 URL（`/core/ui.js`）导入框架；`@oie/*` 是开发时类型和 lint 的首选。在仓库根目录运行 `npm run lint` 强制执行边界。

## 开发

从仓库根目录运行：

| 命令 | 功能 |
|---|---|
| `npm run lint` | ESLint 跨仓库检查，包括 `@oie/*` 导入边界规则 |
| `npm run typecheck` | `tsc` 检查六个项目 —— `@oie/*` 公共类型表面（`type-tests/`）、客户端、服务器、插件、视图和 e2e 套件 |
| `npm run build:war` | 构建优化的客户端并打包 `web-administrator/dist/oie-webadmin.war` 到 OIE 的 `webapps/` 目录 |
| `npm run e2e` | Playwright 套件；`/api/*` 在浏览器中 mock，因此无需引擎运行 |
| `npm run e2e:live` | 针对真实引擎的相同规格（通过 `E2E_LIVE=1` 启用） |
| `npm run wiki:screenshots` | 从确定性 mock 引擎数据重新生成 Wiki 的第一方 UI 截图 |
| `npm run gen:userapi` | 从引擎 `userutil` Java 源码/Javadoc 重新生成 `web-administrator/client/core/userapi.generated.js`（默认 `../oie` 或 `OIE_SRC`） |
| `npm run vendor:zip` | 从 `@zip.js/zip.js` 重新构建供应商化的 `client/vendor/zipjs.min.js` 包 |

### 发布

**在打标签的同一提交中提升根目录和 `web-administrator/package.json` 版本（及 lockfile）。** web-administrator 字段是应用在关于对话框、启动横幅和 `/webadmin/config.json` 中报告的内容；没有从标签派生。保持单仓多包发布版本同步，以便工具和应用标识相同发布。

推送 `v*` 标签也会将 `oie-webadmin.war` 作为 GitHub Release 资源发布。Web Support 发布流程消费其 `webclient.version` 构建属性声明的版本，并在其自身的发布说明中记录此仓库的解析标签和 WAR SHA-256。

Git 仅提供旁边的构建*元数据*（提交、构建日期，以及当树有未提交更改时的 `dirty` 标志），由 `tools/build-info.mjs` 在每次构建时戳记到 gitignore 的 `build-info.json`。CI 和 Docker 构建将提交作为构建参数传入，因为 `.git` 永远不在镜像上下文中。

因此发布流程是：提升版本、提交、打标签 `vX.Y.Z`、推送标签。Docker 工作流从中剪切 `X.Y.Z` / `X.Y` 镜像标签，并仅对非预发布的语义版本标签移动 `latest`；单独的 `main` 标签跟踪分支顶端。

### Docker 标签清理

CI 在创建正常的多平台标签前发布 `validated-<run-id>-<attempt>-<amd64|arm64>` 中间标签。[validated 标签清理工作流](.github/workflows/docker-validated-cleanup.yml) 每天 UTC 06:23 运行，24 小时后删除这些中间标签，仅当确认其 CI 运行在本仓库中完成时。活动或不可验证的运行被保留并记录。Release、`latest`、`main` 和 `pr-*` 标签不在其范围内；现有的关闭 PR 工作流处理 `pr-*`。清理通过 Docker Hub 删除标签名称，从不清理清单摘要。

要预览或清除现有积压，打开 **Actions → Clean up validated Docker tags → Run workflow**。保持 **dry_run** 选中以预览；取消选中以删除符合条件的标签。工作流必须推送到默认分支才能激活每日计划。它使用现有的 `DOCKERHUB_IMAGE` 变量和 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` 密钥；令牌需要**读取、写入、删除**权限。API 失败会使作业失败；重新运行会在任何已删除的标签后安全继续。

## 文档

- [用户和运维 Wiki](https://github.com/gibson9583/oie-web-client/wiki) —— 完整的第一方界面演练、工作流程、截图、部署和故障排除。版本控制的 [Wiki 源码](wiki/Home.md) 保存在此仓库中。
- [`web-administrator/README.md`](web-administrator/README.md) —— 完整功能概述、外观和引擎 API 说明。
- [`web-administrator/PLUGINS.md`](web-administrator/PLUGINS.md) —— 插件开发指南，包含每个扩展点的完整示例。

## 许可证

参见 [LICENSE](LICENSE)。
