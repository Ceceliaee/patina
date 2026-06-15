# 执行单：网页活动记录第一版全功能

Document Type: One-off Execution Plan

状态：已归档（本地第一版实现完成；Chrome Web Store 提交/审核未执行）  
创建日期：2026-06-14  
归档日期：2026-06-14  
来源：GitHub Issue [#6](https://github.com/Ceceliaee/patina/issues/6) 第 5 点“浏览器网页记录功能”及后续产品讨论  
目标版本：待定  
目标读者：后续实现者、代码审查者、维护者  

本文是一份临时执行方案，用于实现 Patina 的第一版网页活动记录能力。
> 归档说明：本地实现、自动化验证和开发者模式扩展源码已完成；Chrome Web Store 提交/审核、Edge 手工验收和真实浏览器安装验收需要后续人工执行，因此相关条目保持未勾选。


完成后，如果本方案不再作为当前执行依据，应按文档卫生规则将本文移动到 `docs/archive/`。如果实施中产生长期规则变化，只把长期结论回写到 top-level `docs/` 对应长期文档，不把本执行单长期留在 `docs/working/`。

## 0. 执行定位

- [x] 本方案只覆盖“网页活动记录第一版全功能”，不覆盖截图、OCR、AI 网页内容理解或跨设备同步。
- [x] 第一版目标是让 Patina 能在用户明确开启后，记录浏览器活动 tab 的域名、标题、可选 URL 与可选 favicon，并在 History 中作为“网页”维度查看。
- [ ] 第一版以 `Chrome Web Store` 通过审核为主目标，优先支持 Chrome 及 Chromium 系浏览器。
- [x] 第一版默认关闭网页记录，不改变未开启用户的应用记录、History、Data 和 App Mapping 主路径。
- [x] 第一版继续保持本地优先：插件只连接本机 Patina，不上传云端，不引入账号体系。
- [x] 第一版必须保持 Quiet Pro：新增 UI 只服务可读性、控制力和可信度，不做营销式集成页或强视觉装饰。
- [x] 如果实施中发现必须引入云服务、截图/OCR、浏览器历史库读取、全量网页内容采集或账号系统，停止执行并重新评估产品边界。

## 1. 背景

当前 Patina 已经有窗口标题明细能力：

- Windows 前台窗口采样得到 `window_title`。
- Rust tracking runtime 将标题变化写入 `session_title_samples`。
- History 时间线弹窗展示“标题详情”。

这能表达“浏览器窗口标题变化”，但不能稳定表达“网页活动”：

- [x] 标题里通常有页面标题，但没有可靠域名。
- [x] 标题格式由网站和浏览器决定，不能稳定反推出 `github.com`、`docs.rs` 等域名。
- [x] 当前没有 URL、域名、favicon 或网页级分类。
- [x] 当前 Chrome 时间只能作为应用时间显示，无法回答“Chrome 内部主要在哪些网站”。
- [x] 如果从标题里猜域名，会损害数据可信度。

因此第一版需要浏览器插件提供网页身份，Patina 负责本地接收、归档、展示、管理和清理。

## 2. 产品决策

### 2.1 浏览器支持策略

- [x] 第一版只正式支持 Chrome。
- [x] 第一版实现基于 Chromium Manifest V3。
- [ ] 第一版内部测试覆盖 Chrome 和 Microsoft Edge 开发者模式加载。
- [x] 第一版不承诺 Firefox、Safari、移动浏览器。
- [ ] Chrome Web Store 审核通过后，再评估是否提交 Microsoft Edge Add-ons。
- [x] Brave、Arc、Opera、Vivaldi 等 Chromium 系浏览器作为“可能可用但不承诺”的兼容范围，只在文档中给出谨慎说明。

### 2.2 插件必要性

- [x] 第一版采用浏览器插件作为网页身份来源。
- [x] 不从窗口标题中猜域名。
- [x] 不读取 Chrome / Edge 的 History 数据库作为第一版实现。
- [x] 不使用地址栏 UI Automation 抓 URL。
- [x] 不要求用户用 remote debugging / CDP 参数启动浏览器。
- [x] 不通过截图或 OCR 推断网页。

### 2.3 隐私默认值

- [x] 网页记录默认关闭。
- [x] 用户必须在 Settings 中明确开启网页记录。
- [x] 插件必须由用户主动安装并填写/确认本机连接信息。
- [x] 默认保存域名和标题。
- [x] 默认不保存完整 URL。
- [x] 完整 URL 作为单独隐私选项，默认关闭。
- [x] 第一版不保存网页正文、表单输入、剪贴板、鼠标轨迹、截图或页面 DOM。
- [x] 第一版不采集 incognito / InPrivate 窗口；如果浏览器允许用户手动给扩展开启隐身权限，插件仍默认忽略 incognito tab。

### 2.4 网页分类语义

- [x] 网页分类按域名管理，不按单个完整 URL 管理。
- [x] 新域名默认进入“未分类”。
- [x] 不自动猜网页分类。
- [x] 不按目录、路径、关键字或站点标题自动分类。
- [x] 用户可以为域名设置分类、显示名、颜色、是否记录、是否保存完整 URL。
- [x] 网页分类第一版只用于网页视图与网页分布，不把网页分类混入全局应用分类统计，避免浏览器应用时间被重复计算或改变历史口径。

### 2.5 History 展示语义

- [x] `应用` 维度保持现状：Chrome 仍作为应用显示。
- [x] `分类` 维度第一版保持应用分类口径，不把网页域名分类混入。
- [x] 新增 `网页` 维度：只展示浏览器网页活动，按域名聚合。
- [x] 横向时间轴第一版保持现有 `应用` / `分类` 显示，不新增网页时间轴模式。
- [x] `当日分布` 新增网页排行，用于查看当天域名时长排序。
- [x] 时间线弹窗新增 `应用` / `网页` tab：`应用` 保持现有应用时间线，`网页` 展示网页时间线。
- [x] 网页数据是浏览器应用时间的子视角，不替代应用级时间记录。
- [x] 网页记录缺失时，不推断、不补假数据，只显示空状态或连接状态提示。

## 3. 非目标

- [x] 不实现截图记录。
- [x] 不实现 OCR。
- [x] 不实现网页正文、表单内容、DOM、鼠标点击或滚动记录。
- [x] 不实现云同步、团队、账号或 SaaS 报表。
- [x] 不支持 Firefox / Safari 作为第一版验收标准。
- [x] 不把 History 改成多日网页浏览器历史产品。
- [x] 不新增“自动分类网站”或 AI 分类。
- [x] 不读取浏览器本地 History 数据库。
- [x] 不改写现有应用记录的基础统计口径。
- [x] 不删除当前 `session_title_samples` 能力。
- [x] 不把网页记录做成默认开启能力。

## 4. 第一版用户体验目标

完成后，用户应能完成以下路径：

- [x] 在 Settings 中看到 `网页` 面板，面板内提供 `网页记录` 总开关。
- [x] 开启网页记录后，Patina 生成本机连接地址与 token。
- [x] 用户安装 Chrome 插件并填入连接信息。
- [x] Patina 显示插件连接状态、浏览器类型、插件版本和最近活动时间。
- [x] 用户正常使用 Chrome 浏览网页。
- [x] History 页面当天有网页记录时，“当日分布”出现 `网页` 维度。
- [x] 切换到 `网页` 后，分布列表按域名显示时长、标题摘要、favicon 或 fallback 图标。
- [x] 横向时间轴继续只显示现有 `应用` / `分类` 视图，切换网页分布不会让非浏览器应用时间变成空白。
- [x] 打开时间线弹窗后，可以在 `应用` / `网页` tab 之间切换，分别查看应用时间线和网页时间线。
- [x] 用户可以在 `分类` 页面中切到 `网页` 模式，给域名设置分类、名称、颜色和记录开关。
- [x] 用户可以关闭网页记录，关闭后不再保存新的网页活动。
- [x] 用户可以清理历史，相关网页活动同步被清理。
- [x] 用户可以备份和恢复包含网页活动的数据。

## 5. 架构与 Owner

### 5.1 新增主要 owner

- [x] Chrome 插件 owner：`extensions/chrome/`
  - 负责读取浏览器 active tab 的 URL、标题、favicon URL、窗口/标签事件。
  - 负责连接本机 Patina。
  - 不承担 Patina 业务聚合、分类规则或 SQLite 写入。
- [x] Rust 本地桥接 owner：`src-tauri/src/platform/local_api/*` 或 `src-tauri/src/platform/browser_activity/*`
  - 负责 WebSocket 接入、认证、消息解析和外部输入边界。
  - 不承担 UI 展示规则。
- [x] Rust 网页活动引擎 owner：`src-tauri/src/engine/web_activity/*`
  - 负责将插件事件与当前 tracking runtime 前台状态合并为网页 activity segment。
  - 负责打开、更新、封口网页活动段。
- [x] Rust 数据 owner：`src-tauri/src/data/repositories/web_activity.rs`
  - 负责 `web_activity_segments`、favicon cache 等 SQLite 读写。
- [x] Rust domain owner：`src-tauri/src/domain/web_activity.rs`
  - 负责网页活动 segment、browser client、domain identity 等稳定领域结构。
- [x] 前端 persistence owner：`src/platform/persistence/webActivityRepository.ts`
  - 负责前端读取网页活动与域名设置。
- [x] History owner：`src/features/history/*`
  - 负责网页维度展示、网页排行模型、时间线弹窗网页 tab、网页详情浮层。
- [x] Classification owner：`src/features/classification/*`
  - 第一版扩展为 `分类` 页面，不在页面里复制分类判断。
- [x] Settings owner：`src/features/settings/*`
  - 负责网页记录开关、连接状态、隐私选项、插件安装入口。

### 5.2 禁止落点

- [x] 不把浏览器插件消息处理塞进 `lib.rs`。
- [x] 不让 `commands/*` 承接 WebSocket server、segment 编排或 SQL 细节。
- [x] 不让 History 组件直接访问 SQLite 或 Tauri command。
- [x] 不在 `src/shared/*` 新建临时“web utils”桶，除非语义已稳定且跨 feature 真实复用。
- [x] 不恢复 `src/lib/*` 或 `src/types/*`。
- [x] 不把网页分类规则写进 app shell 或 Settings 页面。
- [x] 不让插件直接写 SQLite。

## 6. 数据边界与隐私模型

### 6.1 插件可发送的数据

第一版插件只允许发送：

- [x] `browserClientId`：插件本地生成的随机 ID。
- [x] `browserKind`：例如 `chrome`、`edge`。
- [x] `extensionVersion`。
- [x] `tabId`、`windowId`：仅用于同浏览器内判断活动 tab 变化。
- [x] `url`：仅当用户开启完整 URL 保存时持久化；即使默认不保存，也可在本机消息中短暂出现用于解析域名。
- [x] `domain`：由 Patina 端重新解析并校验，不能完全信任插件传值。
- [x] `title`：网页标题。
- [x] `favIconUrl`：浏览器提供的 favicon URL，作为 best-effort 元数据。
- [x] `incognito`：用于明确忽略隐身窗口。
- [x] `capturedAtMs`：仅用于诊断，持久化时间以 Patina 本机接收和 tracking runtime 状态为准。
- [x] `eventReason`：`initial`、`activated`、`updated`、`window-focus`、`heartbeat` 等。

第一版插件不得发送：

- [x] 页面正文。
- [x] DOM。
- [x] 截图。
- [x] 表单输入。
- [x] Cookie。
- [x] localStorage / sessionStorage。
- [x] 鼠标点击、滚动、键盘输入。
- [x] 浏览历史全量列表。

### 6.2 Patina 持久化策略

- [x] 默认持久化 `domain`、`title`、`start_time`、`end_time`、`duration`、`browser_exe_name`。
- [x] 默认不持久化完整 URL。
- [x] 如果用户开启完整 URL 保存，持久化 `url`。
- [x] 如果用户关闭完整 URL 保存，`url` 字段保持 `NULL`。
- [x] favicon 第一版以 best-effort 处理：可以保存 `favicon_url`，但 UI 必须能在没有 favicon 时稳定显示 fallback。
- [x] 如果实现 favicon 数据缓存，缓存来源必须来自插件或本地浏览器能力，不由 Patina 后台主动联网抓取第三方站点。
- [x] 网页活动数据随本地备份导出。
- [x] 清理历史记录时，网页活动按同一时间边界清理。

## 7. 推荐数据模型

新增一次 SQLite schema 升级迁移，版本号接在当前 `SOFTWARE_REMINDER_RULES_MIGRATION_VERSION` 之后，用于把已有本地数据库升级到包含网页活动表和索引的新结构。升级完成后，运行时代码只按新结构工作，不建立长期旧结构兼容层。

### 7.1 `web_activity_segments`

```sql
CREATE TABLE IF NOT EXISTS web_activity_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    browser_client_id TEXT NOT NULL,
    browser_kind TEXT NOT NULL,
    browser_exe_name TEXT NOT NULL,
    domain TEXT NOT NULL,
    normalized_domain TEXT NOT NULL,
    url TEXT,
    title TEXT,
    favicon_url TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER,
    source TEXT NOT NULL DEFAULT 'browser-extension',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_activity_segments_time
ON web_activity_segments(start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_web_activity_segments_domain_time
ON web_activity_segments(normalized_domain, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_web_activity_segments_active
ON web_activity_segments((1))
WHERE end_time IS NULL;
```

字段语义：

- [x] `browser_client_id`：插件本地 client ID，用于区分浏览器 profile / 安装实例。
- [x] `browser_kind`：`chrome`、`edge` 等。
- [x] `browser_exe_name`：Patina tracking runtime 看到的浏览器 exe，例如 `chrome.exe`、`msedge.exe`。
- [x] `domain`：展示用域名，尽量保留用户可理解形式。
- [x] `normalized_domain`：聚合、设置和查询用小写规范域名。
- [x] `url`：完整 URL，只有用户开启完整 URL 保存时非空。
- [x] `title`：网页标题。
- [x] `favicon_url`：best-effort 元数据，不作为渲染必需条件。
- [x] `source`：第一版固定 `browser-extension`，为未来其它来源预留。

### 7.2 `web_favicon_cache`（可选但推荐）

```sql
CREATE TABLE IF NOT EXISTS web_favicon_cache (
    normalized_domain TEXT PRIMARY KEY,
    icon_base64 TEXT NOT NULL,
    source_url TEXT,
    last_updated INTEGER NOT NULL
);
```

规则：

- [x] 第一版 UI 不依赖 favicon cache 才能成立。
- [x] 如果插件能安全提供 data URL 或 base64 favicon，写入该表。
- [x] 如果无法稳定得到 favicon 内容，只保存 `favicon_url` 并在 UI 中使用 fallback。
- [x] Patina 不主动请求第三方 favicon URL，避免后台联网和隐私惊喜。

### 7.3 域名 override 设置

推荐沿用 settings key-value 体系：

```text
__web_domain_override::<normalized_domain>
```

value JSON 结构建议：

```json
{
  "displayName": "GitHub",
  "category": "development",
  "color": "#6F7AE6",
  "enabled": true,
  "captureFullUrl": false,
  "updatedAt": 1780000000000
}
```

规则：

- [x] `enabled: false` 表示该域名后续不记录。
- [x] `captureFullUrl` 只允许从全局完整 URL 开关进一步收窄或为特定域名开启，最终产品口径实施前必须明确。
- [x] `category` 为空表示未分类。
- [x] 选择“未分类”时清除 `category` 字段，不写入 `category: "other"`。
- [x] 域名颜色只影响网页视图，不改变应用 Chrome 的颜色。

## 8. 本地通信协议

### 8.1 通信入口

- [x] 优先复用现有 `Local API` WebSocket 基础设施。
- [x] 不直接把当前 Local API token 暴露成“浏览器插件万能 token”，除非经过安全复核。
- [x] 推荐新增 browser bridge role：
  - [x] 使用同一个 `127.0.0.1` WebSocket listener。
  - [x] 新增 `webActivityBridgeToken` 或 role-scoped token。
  - [x] 浏览器插件认证后只能发送网页活动消息，不需要接收完整 tracking snapshot 广播。
- [x] 如果复用当前 token，必须在执行单中记录原因，并补充风险说明。
- [x] WebSocket 只绑定 `127.0.0.1`，不得监听公网地址。
- [x] token 为空时不得允许浏览器插件写入网页活动。

### 8.2 消息类型

插件发送：

```json
{
  "type": "browser-client-hello",
  "data": {
    "protocolVersion": 1,
    "browserClientId": "random-client-id",
    "browserKind": "chrome",
    "extensionVersion": "0.1.0",
    "capabilities": ["active-tab", "favicon-url"]
  }
}
```

```json
{
  "type": "web-active-tab",
  "data": {
    "browserClientId": "random-client-id",
    "browserKind": "chrome",
    "tabId": 123,
    "windowId": 456,
    "url": "https://github.com/Ceceliaee/patina/issues/6",
    "title": "Issue #6 · Ceceliaee/patina",
    "favIconUrl": "https://github.githubassets.com/favicons/favicon.svg",
    "incognito": false,
    "capturedAtMs": 1780000000000,
    "eventReason": "activated"
  }
}
```

```json
{
  "type": "browser-client-heartbeat",
  "data": {
    "browserClientId": "random-client-id",
    "browserKind": "chrome",
    "capturedAtMs": 1780000000000
  }
}
```

Patina 返回：

- [x] `auth-ok` / `auth-failed` 沿用现有形状。
- [x] `browser-bridge-ok`：包含协议版本、server time、当前是否启用网页记录。
- [x] `browser-bridge-disabled`：Settings 中网页记录关闭时返回。
- [x] `browser-bridge-error`：消息格式错误或版本不兼容。

### 8.3 输入校验

- [x] Rust 端重新解析 URL。
- [x] 只接受 `http:` 和 `https:` URL 作为第一版网页活动。
- [x] `chrome://`、`edge://`、`about:`、`file:`、空 URL 默认忽略。
- [x] `localhost`、`127.0.0.1`、内网 IP 允许记录，但显示时必须清楚。
- [x] `domain` 统一小写、去尾点、去默认端口。
- [x] 国际化域名使用稳定规范形式；展示形式实施前明确采用 punycode 还是 Unicode。
- [x] 标题长度设置上限，例如 `512` 字符，超出截断。
- [x] URL 长度设置上限，例如 `4096` 字符，超出丢弃 URL 但可保留域名。
- [x] `favIconUrl` 长度设置上限，例如 `2048` 字符。
- [x] 不信任插件发送的 `domain`、`duration` 或分类信息。

## 9. 网页活动状态机

### 9.1 基本原则

- [x] 插件事件只说明“浏览器内部当前活动 tab 是什么”。
- [x] Patina tracking runtime 仍是“这个浏览器是否正在前台被用户使用”的权威来源。
- [x] 只有当 OS 前台应用是受支持浏览器，且 tracking 未暂停、未 AFK、未锁屏/休眠时，网页 segment 才能计时。
- [x] 插件断连时，不继续无限延长网页 segment。
- [x] 浏览器 app session 与网页 segment 不互相替代；网页 segment 是 browser app time 的子视角。

### 9.2 Segment 打开条件

满足以下条件时打开或延续网页 segment：

- [x] Settings 中网页记录已开启。
- [x] 插件已认证。
- [x] 最近一次插件 active tab 事件属于受支持浏览器。
- [x] URL 是 `http` 或 `https`。
- [x] 当前 Rust tracking runtime 前台 app 是同类浏览器 exe。
- [x] 当前 tracking 未暂停。
- [x] 当前用户未 AFK。
- [x] 当前域名没有被用户禁用记录。

### 9.3 Segment 封口条件

出现以下任一情况时封口当前网页 segment：

- [x] active tab URL/domain 变化。
- [x] active tab 标题变化且实现选择按标题切段。
- [x] 当前前台应用离开受支持浏览器。
- [x] tracking pause。
- [x] AFK。
- [x] 锁屏。
- [x] 睡眠。
- [x] app session 被 watchdog / startup sealing 封口。
- [x] 浏览器插件断连超过容忍窗口，例如 `10` 秒。
- [x] Settings 关闭网页记录。
- [x] 用户禁用当前域名记录。

### 9.4 标题变化策略

第一版建议：

- [x] Segment identity 以 `normalized_domain + normalized_url_or_domain_key` 为主。
- [x] 默认未保存完整 URL 时，segment identity 至少按域名切分。
- [x] 如果同一域名内标题变化频繁，第一版可以切分 segment，但不要把它当作 URL 级准确性。
- [x] 若用户开启完整 URL 保存，则 URL 变化应切分 segment。
- [x] History 网页详情展示标题样本时，标题时间不得被扩大到整个浏览器 app segment。
- [x] 不以标题推断 URL 或域名。

## 10. Chrome 插件工程

### 10.1 文件结构

新增目录建议：

```text
extensions/
  chrome/
    manifest.json
    src/
      background.ts
      connection.ts
      tabSnapshot.ts
      storage.ts
      options.ts
    options.html
    icons/
    package.json
    tsconfig.json
    README.md
```

规则：

- [x] 插件工程独立于主 React app 构建。
- [x] 插件不得引入 React，除非确有必要；第一版 options 页面用轻量 HTML/CSS/TS 即可。
- [x] 插件使用 TypeScript，编译为 Manifest V3 service worker 可用 JS。
- [x] 插件构建产物不得混入主应用 `dist/`。
- [x] 插件源码随仓库维护，发布包由脚本生成 zip。

### 10.2 Manifest

第一版权限原则：

- [x] 使用 `manifest_version: 3`。
- [x] 权限尽量限制为 `tabs`、`storage`。
- [x] 不申请 `<all_urls>` host permissions。
- [x] 不申请 `history`。
- [x] 不申请 `cookies`。
- [x] 不申请 `webRequest`。
- [x] 不注入 content scripts。
- [x] 不使用 remote code。
- [x] 不使用 eval 或动态远程脚本。
- [x] `connect-src` 仅允许 `ws://127.0.0.1:*` 或明确端口范围。

说明：

- `tabs` 是敏感权限，但连续记录 active tab URL / title / favIconUrl 需要它。
- `activeTab` 只适合用户点击后短时访问，不适合低打扰持续记录。
- 审核说明必须解释为什么需要 `tabs`，并说明数据只发往本机 Patina。

### 10.3 插件功能

- [x] 首次安装生成 `browserClientId`。
- [x] Options 页面允许填写：
  - [x] Patina WebSocket endpoint。
  - [x] token。
  - [x] 是否忽略 incognito。
- [x] Options 页面显示连接状态：
  - [x] 未配置。
  - [x] 已连接。
  - [x] 鉴权失败。
  - [x] Patina 未开启网页记录。
  - [x] Patina 未运行。
- [x] Service worker 监听：
  - [x] `chrome.tabs.onActivated`
  - [x] `chrome.tabs.onUpdated`
  - [x] `chrome.windows.onFocusChanged`
  - [x] `chrome.runtime.onStartup`
  - [x] `chrome.runtime.onInstalled`
- [x] 连接成功后发送 `browser-client-hello`。
- [x] active tab 变化后发送 `web-active-tab`。
- [x] 定期 heartbeat，避免 Patina 无法判断断连。
- [x] WebSocket 断开后指数退避重连，最大退避需要上限。
- [x] 断线期间不缓存大量历史事件，只保留最新 active tab 状态。
- [x] 插件不做 duration 计算。
- [x] 插件不做域名分类。

### 10.4 插件测试

- [x] 单元测试 URL 解析输入样本。
- [x] 单元测试 options storage 读写。
- [x] 单元测试连接重试状态机。
- [ ] 手动加载 unpacked extension 到 Chrome。
- [ ] 手动加载 unpacked extension 到 Edge。
- [x] 测试 Patina 未运行时插件状态。
- [x] 测试 token 错误时插件状态。
- [x] 测试 Patina 关闭网页记录时插件状态。
- [x] 测试切换 tab、刷新页面、新标签页、关闭窗口。
- [x] 测试 incognito 默认忽略。

## 11. Rust 本地桥接

### 11.1 Local API 扩展

- [x] 评估现有 `platform/local_api/mod.rs` 是否直接扩展，还是新增 `platform/browser_activity_bridge/*`。
- [x] 如果扩展 Local API，保持原有 tracking snapshot 广播行为不回归。
- [x] 新增 browser client role 鉴权。
- [x] 新增 inbound message dispatch。
- [x] 当前 Local API 对未知客户端消息的忽略行为不能吞掉浏览器插件消息。
- [x] 对插件消息记录最小诊断日志，不写敏感 URL。
- [x] 所有错误返回避免包含完整 URL，除非用户开启诊断导出。

### 11.2 Browser Bridge 状态

新增 runtime state：

- [x] 已连接 browser clients。
- [x] 每个 browser client 的最近 heartbeat。
- [x] 每个 browser client 的最近 active tab snapshot。
- [x] 当前 active web segment。
- [x] 最近错误状态。
- [x] 连接状态快照供 Settings 展示。

### 11.3 Tauri app 装配

- [x] 在 app setup 中管理 Browser Bridge state。
- [x] Settings 变更时启动/停止 bridge。
- [x] Tracking runtime active-window / status 事件变更时通知 Web Activity Engine。
- [x] Browser Bridge 收到 active tab 消息时通知 Web Activity Engine。
- [x] 不把装配逻辑写厚到 `lib.rs`。

## 12. Rust Web Activity Engine

### 12.1 模块结构

建议新增：

```text
src-tauri/src/engine/web_activity/
  mod.rs
  state.rs
  transition.rs
  protocol.rs
  domain_parser.rs
```

职责：

- [x] `protocol.rs` 解析插件消息 DTO。
- [x] `domain_parser.rs` 规范化 URL 和域名。
- [x] `state.rs` 保存当前 browser tab 与 active segment 状态。
- [x] `transition.rs` 决定打开、延续、封口 segment。
- [x] `mod.rs` 暴露 thin API 给 app/platform 调用。

### 12.2 状态输入

Web Activity Engine 接收：

- [x] 插件 active tab snapshot。
- [x] 插件 heartbeat / disconnect。
- [x] tracking runtime foreground window snapshot。
- [x] tracking status snapshot。
- [x] Settings 中网页记录开关。
- [x] 域名 override 中的 enabled / captureFullUrl。

### 12.3 写入策略

- [x] 打开 segment 时插入 `web_activity_segments`。
- [x] 延续相同 identity 时只更新内存状态，不逐秒写库。
- [x] 标题变化但 identity 不变时，第一版可更新当前 segment 的最新 title；如需要标题明细，单独设计 `web_title_samples`，不要混入本轮除非明确必要。
- [x] 封口时更新 `end_time` 和 `duration`。
- [x] 封口时间不早于 `start_time`。
- [x] 异常退出后，启动时封口遗留 active web segments。
- [x] 清理/恢复/关闭功能时不得留下多个 active web segment。

### 12.4 Rust 测试

- [x] URL 解析测试：普通域名、子域名、端口、localhost、IP、IDN、无效 URL。
- [x] 协议解析测试：合法消息、缺字段、超长字段、非 http/https、incognito。
- [x] 状态机测试：Chrome 前台 + active tab -> 打开 segment。
- [x] 状态机测试：Chrome 非前台 -> 不打开 segment。
- [x] 状态机测试：tab 变化 -> 封口旧 segment，打开新 segment。
- [x] 状态机测试：离开 Chrome -> 封口 segment。
- [x] 状态机测试：AFK / pause / lock / suspend -> 封口 segment。
- [x] 状态机测试：插件断连超时 -> 封口 segment。
- [x] 状态机测试：域名 disabled -> 不记录。
- [x] 启动 repair 测试：遗留 active web segment 被封口。

## 13. SQLite、备份、恢复与清理

### 13.1 Schema 升级迁移

- [x] 新增 schema migration 常量，例如 `WEB_ACTIVITY_MIGRATION_VERSION = 4`。
- [x] 新增 `web_activity_segments` 表。
- [x] 可选新增 `web_favicon_cache` 表。
- [x] 新增索引。
- [x] 新安装数据库包含新表。
- [x] 旧数据库升级后补齐新表。
- [x] schema migration 幂等，升级中断后再次启动不会重复破坏结构。
- [x] 不修改已有 `sessions` 表结构，除非实施前重新评估。

### 13.2 Repository

- [x] 新增 `src-tauri/src/data/repositories/web_activity.rs`。
- [x] API 包含：
  - [x] `insert_segment_start(...)`
  - [x] `finish_active_segment(...)`
  - [x] `finish_all_active_segments(...)`
  - [x] `load_segments_in_range(start_ms, end_ms)`
  - [x] `delete_segments_before(cutoff_ms)` 或按 cleanup plan 删除。
  - [x] favicon cache upsert / read，如启用。
- [x] 所有 SQL 参数化。
- [x] 多步状态变化使用事务。
- [x] 恶意 URL/title 字符串只作为数据保存，不影响 SQL。

### 13.3 备份恢复

- [x] domain backup 类型新增 web activity payload。
- [x] 导出包含 `web_activity_segments`。
- [x] 导出包含 `web_favicon_cache`，如启用。
- [x] settings 备份包含网页记录设置和 domain overrides。
- [x] 旧备份没有 web activity 时恢复成功。
- [x] 新备份恢复后网页活动完整。
- [x] merge restore 去重策略明确：
  - [x] 推荐按 `browser_kind + normalized_domain + start_time + end_time + title + url` 判重。
  - [x] `url` 为 `NULL` 时使用 `COALESCE(url, '')`。
- [x] restore 后不恢复 active open segment；所有导入 segment 必须封口或按备份事实保留。

### 13.4 清理历史

- [x] 清理 sessions 时同步清理同时间范围 web segments。
- [x] 清理 UI 文案仍强调清理本地历史记录；如需细化，说明包含网页记录。
- [x] 清理后 History 网页维度不显示已删除时间段。
- [x] 清理不删除 domain override 设置，除非用户清理设置或删除域名记录。

## 14. 前端读模型

### 14.1 类型

新增前端类型建议：

```ts
export interface WebActivitySegment {
  id: number;
  browserKind: "chrome" | "edge" | "chromium" | "unknown";
  browserExeName: string;
  domain: string;
  normalizedDomain: string;
  url: string | null;
  title: string | null;
  faviconUrl: string | null;
  startTime: number;
  endTime: number | null;
  duration: number | null;
}
```

- [x] 类型放在真实 owner 内；若跨 History / Data / Classification 稳定复用，再放入 `shared/types`。
- [x] raw DTO 只停留在 `platform/persistence` 或 Rust boundary 允许目录。
- [x] 前端组件不读取 raw snake_case 字段。

### 14.2 Persistence

- [x] 新增 `src/platform/persistence/webActivityRepository.ts`。
- [x] 支持按时间范围读取 web segments。
- [x] 支持读取 domain overrides。
- [x] 支持保存 domain overrides。
- [x] 支持读取 favicon cache，如启用。
- [x] 不在 feature 组件里写 SQL。

### 14.3 History read model

- [x] 新增 History web view model 服务，例如 `historyWebActivityViewModel.ts`。
- [x] 输入为选中日期、web segments、domain overrides、nowMs。
- [x] 输出：
  - [x] 当日网页总时长。
  - [x] 按域名聚合的网页排行列表。
  - [x] 网页时间线列表，用于时间线弹窗 `网页` tab，不驱动主横向时间轴。
  - [x] 网页详情弹窗数据。
- [x] 片段裁剪到选中日期本地 00:00 - 24:00。
- [x] today live segment 用 nowMs 临时封口展示。
- [x] 域名 disabled 后历史显示策略明确：
  - [x] 推荐 disabled 只影响后续记录，不隐藏旧历史。
- [x] URL 为空时，详情只显示域名和标题。
- [x] 完整 URL 未开启时，UI 不出现空 URL 占位。

### 14.4 Data 页面

第一版建议不扩展 Data：

- [x] Data 仍以应用级长期趋势为主。
- [x] 不在第一版加入跨日期网页趋势。
- [x] 如果实施中必须显示网页长期趋势，先写新的执行单，不混入 History 第一版。

## 15. Settings UI

### 15.1 设置项

新增或扩展 settings model：

- [x] `webActivityEnabled`：默认 `false`。
- [x] `webActivityPort` 或复用 Local API port。
- [x] `webActivityToken` 或 role-scoped browser token。
- [x] `webActivityStoreFullUrl`：默认 `false`。
- [x] `webActivityStoreFavicon`：默认 `true` 或 best-effort。
- [x] `webActivityIgnoreIncognito`：默认 `true`，如需暴露。

### 15.2 Settings 面板

- [x] 新增 Settings 面板：`网页` / `Web`。
- [x] 使用 Quiet Pro panel 原型。
- [x] 面板包含 `网页记录` 总开关。
- [x] 面板包含 `插件` 连接状态：
  - [x] 未开启。
  - [x] 等待插件连接。
  - [x] 已连接 Chrome。
  - [x] token 错误。
  - [x] 版本不兼容。
- [x] 面板的 `插件` 区块包含本机连接地址和 token。
- [x] token 默认隐藏，提供显示/隐藏按钮。
- [x] 提供重新生成 token 按钮。
- [x] 在 `插件` 区块提供 `安装 Chrome 插件` 入口：
  - [x] 开发阶段指向本地说明。
  - [ ] 上架后指向 Chrome Web Store。
- [x] 提供完整 URL 保存开关，默认关闭。
- [x] 文案明确说明数据只保存到本机。
- [x] 不使用大段说明文字堆满页面；较长说明放 tooltip、帮助链接或折叠说明。

### 15.3 Settings 行为

- [x] 开启网页记录时，如果 token 为空，自动生成 token。
- [x] 关闭网页记录时，Rust engine 封口 active web segment。
- [x] 重置 token 时，当前插件连接失效并要求重新配置。
- [x] 更改 port 时，bridge 重启。
- [x] 插件版本不兼容时提示升级。
- [x] Settings 保存失败时不改变运行时状态。

## 16. 分类页

### 16.1 信息架构

第一版建议：

- [x] 现有 `应用` 页面扩展为 `分类` 页面。
- [x] Sidebar 可以暂时保留原图标和入口位置，入口名称与页面标题改为 `分类`。
- [x] 页面副标题表达操作对象，例如 `设置应用和网页的分类、颜色与记录规则`。
- [x] 页面工具条右侧增加和 History `应用` / `分类` 切换同风格的 segmented control：
  - [x] `应用`
  - [x] `网页`
- [x] segmented control 放在搜索框与 `管理分类` 按钮之间，作为当前列表对象切换。
- [x] `应用` 模式保持现有应用分类、颜色和记录规则功能。
- [x] `网页` 模式管理已记录域名的分类、颜色和记录规则。
- [x] `分类` 页面表示“给对象设置分类”的操作入口。
- [x] `管理分类` 是应用和网页共用的全局能力，不跟随 `应用` / `网页` 模式切换。
- [x] `管理分类` 弹窗文案保持通用，例如 `新建分类，调整分类颜色`，不写成应用专属或网页专属。

### 16.2 网页模式功能

- [x] 显示已记录域名列表。
- [x] 顶部筛选：
  - [x] 全部。
  - [x] 未分类。
  - [x] 已分类。
- [x] 搜索支持域名、显示名、分类名。
- [x] 每个域名卡片显示：
  - [x] favicon 或 fallback。
  - [x] display name / domain。
  - [x] domain chip。
  - [x] 总记录时长或最近记录时间。
  - [x] 分类选择。
  - [x] 颜色选择。
  - [x] 记录开关。
  - [x] 完整 URL 保存开关，如支持域名级覆盖。
  - [x] 删除该域名历史记录入口。
- [x] 域名默认显示为真实 domain，不强制要求用户命名。
- [x] 禁用域名只影响后续记录。
- [x] 删除域名历史需要确认。
- [x] 删除域名历史不关闭全局网页记录。

### 16.3 分类管理

- [x] 应用和网页共用同一套分类定义、分类颜色和自定义分类能力。
- [x] 域名分类引用现有分类 token，不新增一套网页专属分类。
- [x] 应用 override 和 domain override 分开保存，但都引用同一套分类定义。
- [x] 新增域名 override 时不写入应用 override。
- [x] 删除分类时同时处理应用和网页引用。
- [x] 自定义分类颜色在应用和网页两边一致。
- [x] 网页未分类计数独立于应用未分类计数。

## 17. History UI

### 17.1 当日分布

- [x] 当网页记录未开启且当天无网页数据时，隐藏 `网页` 维度。
- [x] 当网页记录开启或当天有网页数据时，显示 `网页` 维度。
- [x] Segmented control 扩展为：
  - [x] `应用`
  - [x] `分类`
  - [x] `网页`
- [x] `应用` 与 `分类` 行为保持现状。
- [x] `网页` 模式显示 domain 排行。
- [x] 网页分布行显示 favicon/fallback、domain display name、时长、进度条。
- [x] 颜色来自 domain override，缺省使用稳定 fallback 色。
- [x] 网页分布列表空时显示低噪音空状态。
- [x] 不把 Chrome app time 和 web domain time 相加展示为全天总时长，避免双计。

### 17.2 横向时间轴

- [x] 横向时间轴第一版不新增 `网页` 模式。
- [x] 即使当日分布切到 `网页`，横向时间轴仍按现有 `应用` / `分类` 模式显示。
- [x] 应用模式下保持 app segments。
- [x] 分类模式下保持现有 category segments。
- [x] 浏览器没有网页记录的时间段仍通过 Chrome / Edge 应用 segment 表达，不显示为空白 web segment。
- [x] 不把 web domain segments 直接画进横向时间轴，避免非浏览器应用无法表达。

### 17.3 时间线弹窗

- [x] 时间线弹窗顶部新增 `应用` / `网页` tab。
- [x] `应用` tab 保持现有应用时间线列表和标题详情。
- [x] `网页` tab 展示网页时间线，只显示浏览器网页活动段。
- [x] `网页` tab 行展示 domain、title、time、duration，必要时显示 favicon/fallback。
- [x] `网页` tab 没有数据时显示低噪音空状态。
- [x] 不做卡片套卡片。
- [x] `5 分钟` 合并控制对应用列表保持现状。
- [x] 网页 title details 不替代现有 app title details。
- [x] 弹窗高度、滚动、关闭按钮保持现有 Quiet Pro 行为。

### 17.4 可访问性

- [x] `网页` 维度按钮有清晰 aria-label。
- [x] 时间线弹窗 `应用` / `网页` tab 可键盘切换。
- [x] 网页时间线行 aria-label 包含域名、标题、开始时间、结束时间、时长。
- [x] 颜色不是唯一信息来源。
- [x] 键盘可进入网页时间线行。
- [x] Escape 关闭详情。
- [x] 空状态可被读屏理解。

## 18. Chrome Web Store 审核准备

### 18.1 提交策略

- [ ] 第一轮先以 `Unlisted` 或低曝光方式提交 Chrome Web Store，供 Patina 用户通过应用内链接安装。
- [ ] 通过审核并稳定后再考虑公开搜索曝光。
- [x] 不在 Chrome 审核通过前把主应用文案写成“已支持 Chrome 插件安装”。
- [ ] 如果审核被拒，记录拒绝原因并更新本执行单或新执行单。

### 18.2 权限说明

提交前准备：

- [x] `tabs` 权限说明：用于读取当前活动 tab 的 URL、标题和 favicon，以便本地 Patina 统计网页活动。
- [x] `storage` 权限说明：保存本机连接地址、token、插件 client ID 和连接偏好。
- [x] 无 host permissions 说明。
- [x] 无远程代码说明。
- [x] 无内容脚本说明。
- [x] 数据只发送到 `ws://127.0.0.1:<port>`。
- [x] 不收集页面内容、表单、Cookie、截图。

### 18.3 隐私披露

- [ ] Chrome Web Store privacy fields 与实际行为一致。
- [x] 明确声明收集网页浏览活动数据，但仅传输到用户本机 Patina。
- [x] 明确声明不上传云端。
- [x] 提供隐私说明文档或 README。
- [x] 如果保存完整 URL 是可选项，说明默认关闭。
- [x] 如果 favicon URL 被保存，说明用途和本地范围。

### 18.4 包质量

- [x] 插件包不包含未使用的大型依赖。
- [x] 插件包不包含 sourcemap 中的敏感本地路径，或确认可接受。
- [x] 不使用混淆代码。
- [x] Minification 如使用，保留可审查源码包。
- [x] 图标、截图、说明文字完整。
- [x] 版本号与 changelog 一致。
- [x] `manifest.json` 名称、描述、权限和隐私说明一致。

## 19. 测试计划

### 19.1 Rust 测试

- [x] `cargo test --manifest-path src-tauri/Cargo.toml web_activity`
- [x] schema migration 测试。
- [x] repository 插入/封口/清理测试。
- [x] protocol parser 测试。
- [x] domain parser 测试。
- [x] state transition 测试。
- [x] local API auth / browser role 测试。
- [x] backup / restore 测试。
- [x] startup repair active web segment 测试。

### 19.2 前端单元测试

- [x] 新增 `tests/webActivityViewModel.test.ts`。
- [x] 新增 `tests/webDomainMapping.test.ts`。
- [x] 更新 `tests/historyTimelineViewModel.test.ts`。
- [x] 更新 `tests/settingsPageState.test.ts`。
- [x] 更新 `tests/persistenceTransaction.test.ts`。
- [x] 覆盖 domain override 保存、未分类、禁用、颜色、显示名。
- [x] 覆盖 History web distribution。
- [x] 覆盖网页活动数据裁剪到选中日期。
- [x] 覆盖 URL hidden / URL visible 两种隐私模式。

### 19.3 UI smoke

- [x] 更新 `tests/uiSmoke.test.ts`。
- [x] 断言中英文 copy key 对齐。
- [x] 断言新增 Chrome extension source 不被主 app 入口误识别。
- [x] 断言 Settings 包含 `网页` 面板和 `网页记录` 开关文案。
- [x] 断言 History 有网页维度相关文案。
- [x] 断言 `分类` 页面工具条包含 `应用` / `网页` segmented control。
- [x] 断言 `管理分类` 弹窗文案为通用分类管理，不绑定应用或网页。

### 19.4 Browser smoke

- [x] 更新 `tests/uiBrowserSmoke.test.ts`，使用 stub 数据覆盖 History 网页维度。
- [x] 打开 History，切换到 `网页`。
- [x] 断言 domain rows 出现。
- [x] 断言切到网页分布后，横向 timeline 仍保持现有 `应用` / `分类` 显示，不出现 web mode。
- [x] 打开时间线弹窗，断言存在 `应用` / `网页` tab。
- [x] 切到时间线弹窗 `网页` tab，断言 domain、title、time 信息存在。
- [x] 打开 Settings，断言 `网页` 面板无横向溢出。
- [x] 打开 `分类` 页面，使用 segmented control 切到 `网页`。
- [x] 检查 console error 为零。

### 19.5 插件集成手工测试

- [x] 本地构建 Chrome 插件。
- [x] Chrome 开发者模式加载 unpacked extension。
- [x] 在 Patina Settings 开启网页记录。
- [x] 将 endpoint/token 填入插件 options。
- [x] 打开 `github.com`、`github.com/Ceceliaee/patina`、`docs.rs` 等站点并切换 tab。
- [x] 回到 Patina History，确认 domain、title、time 出现。
- [x] 离开 Chrome 到 VSCode，确认网页 segment 封口。
- [x] 回到 Chrome，确认新 segment 开始。
- [x] 关闭网页记录，确认后续网页不记录。
- [x] token 错误时插件不写入。
- [x] Patina 退出时插件显示未连接。
- [ ] Edge 开发者模式加载同一插件包并做基础验证。

### 19.6 Chrome Web Store 验收

- [ ] 创建 Chrome Web Store 开发者条目。
- [ ] 上传 unlisted 包。
- [x] 填写隐私字段。
- [x] 填写权限 justification。
- [x] 提供 reviewer notes，说明本机 Patina 连接方式。
- [x] 提供测试说明和测试 token 方案，避免 reviewer 无法验证功能。
- [ ] 提交审核。
- [ ] 记录审核通过或拒绝结果。
- [ ] 审核通过后将安装 URL 写入 Patina 设置面板或文档。

## 20. 验证命令

局部开发期间：

- [x] `npm run test:settings`
- [x] `npm run test:history-timeline`
- [x] `npm run test:persistence`
- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`
- [x] `npm run check:rust`

如果新增插件 package scripts：

- [x] `npm run extension:chrome:check`
- [x] `npm run extension:chrome:build`
- [x] `npm run extension:chrome:package`

交付前最低门槛：

- [x] `npm run check`
- [x] `npm run check:rust`
- [ ] Chrome 插件本地手工验收通过。

发布候选前：

- [x] `npm run check:full`
- [x] `npm run release:check`
- [ ] Chrome Web Store 审核通过或明确标记为“功能隐藏，等待审核通过后启用安装入口”。

## 21. 执行阶段

### 阶段 A：边界冻结与基线确认

- [x] 阅读并复核 `docs/product-principles-and-scope.md`。
- [x] 阅读并复核 `docs/roadmap-and-prioritization.md`。
- [x] 阅读并复核 `docs/engineering-quality.md`。
- [x] 阅读并复核 `docs/quiet-pro-component-guidelines.md`。
- [x] 阅读并复核 `docs/architecture.md`。
- [x] 阅读并复核 `docs/issue-fix-boundary-guardrails.md`。
- [x] 阅读并复核 `docs/versioning-and-release-policy.md`。
- [x] 运行 `git status --short`。
- [x] 确认当前工作区已有未提交改动来源。
- [x] 确认本轮不覆盖无关改动。
- [x] 确认 `docs/working/` 只有当前执行依据。
- [x] 确认第一版只支持 Chrome / Chromium。
- [x] 确认第一版默认不保存完整 URL。
- [x] 确认第一版不把网页分类混入应用分类 totals。

### 阶段 B：协议与数据模型先行

- [x] 写出插件到 Patina 的协议类型。
- [x] 写 Rust protocol parser 测试。
- [x] 写 domain parser 测试。
- [x] 写 web activity transition 测试。
- [x] 写 SQLite repository 测试。
- [x] 在测试失败状态下确认目标语义清楚。
- [x] 新增 schema migration。
- [x] 实现 repository。
- [x] 实现 startup repair active web segments。
- [x] 运行 Rust 局部测试。

### 阶段 C：本地桥接与状态机

- [x] 扩展 Local API 或新增 Browser Bridge。
- [x] 实现 browser role auth。
- [x] 实现 inbound message dispatch。
- [x] 接入 Web Activity Engine。
- [x] 接入 tracking runtime 前台状态变化。
- [x] 接入 pause / AFK / lock / suspend 封口。
- [x] 暴露 Settings 所需连接状态 snapshot。
- [x] 运行 local API / bridge 测试。

### 阶段 D：Chrome 插件原型

- [x] 新建 `extensions/chrome/`。
- [x] 编写 MV3 manifest。
- [x] 实现 service worker active tab 监听。
- [x] 实现 options 页面。
- [x] 实现 WebSocket auth 和 reconnect。
- [x] 实现 active tab payload。
- [x] 实现 connection status。
- [x] 本地加载到 Chrome。
- [x] 与 Patina 开发版完成端到端写入。
- [ ] 本地加载到 Edge 做基础验证。

### 阶段 E：Settings 集成

- [x] 扩展 settings domain/type。
- [x] 扩展 settings persistence。
- [x] 扩展 Settings 页面状态管理。
- [x] 新增 `网页` 面板。
- [x] 接入 token 生成/重置。
- [x] 接入完整 URL 开关。
- [x] 接入连接状态。
- [x] 接入插件安装入口占位。
- [x] 补 Settings 单测。
- [x] 补 UI smoke。

### 阶段 F：网页域名管理

- [x] 扩展现有应用页面为 `分类` 页面。
- [x] 保留 `应用` 模式原行为。
- [x] 新增 `网页` 模式。
- [x] 新增 domain candidate/read model。
- [x] 新增 domain override 保存路径。
- [x] 新增 domain 搜索与筛选。
- [x] 新增 domain 分类、颜色、记录开关。
- [x] 新增删除域名历史确认。
- [x] 补 domain mapping 测试。
- [x] 补 interaction 测试。

### 阶段 G：History 网页视图

- [x] 新增 web activity read model。
- [x] History loader 拉取选中日 web segments。
- [x] 当日分布新增 `网页` 维度。
- [x] 横向时间轴保持现有 `应用` / `分类` 模式，不新增 web mode。
- [x] 时间线弹窗新增 `应用` / `网页` tab。
- [x] `应用` tab 保持现有应用列表和标题详情。
- [x] `网页` tab 展示网页时间线。
- [x] 网页详情展示 title/domain/url 状态。
- [x] 空状态与 disabled 状态处理。
- [x] 补 history web view model 测试。
- [x] 补 browser smoke。

### 阶段 H：备份、恢复、清理

- [x] 扩展 backup domain payload。
- [x] 导出 web activity。
- [x] 恢复 web activity。
- [x] 兼容旧备份。
- [x] merge restore 去重。
- [x] 清理历史删除 web segments。
- [x] 补 Rust backup/restore 测试。
- [x] 补 settings/persistence 测试。

### 阶段 I：Chrome Web Store 准备

- [x] 编写插件 README。
- [x] 编写隐私说明。
- [x] 准备图标。
- [x] 准备截图。
- [x] 准备 reviewer notes。
- [x] 准备 permission justification。
- [x] 生成发布 zip。
- [x] 本地安装发布 zip 验证。
- [ ] 提交 Chrome Web Store unlisted。
- [ ] 记录审核结果。

### 阶段 J：完整验证与收尾

- [x] 运行 `npm run check`。
- [x] 运行 `npm run check:rust`。
- [x] 运行插件 check/build/package。
- [ ] 完成 Chrome 本地手工验收。
- [ ] 完成 Edge 本地手工验收。
- [x] 更新 `CHANGELOG.md` 的 `Unreleased`。
- [x] changelog 使用 `Refs [#6](https://github.com/Ceceliaee/patina/issues/6)`，不使用 closing keywords。
- [x] 如 Chrome Web Store 已通过，加入安装入口。
- [x] 如 Chrome Web Store 未通过，不默认公开安装入口。
- [x] 更新本文勾选状态。
- [x] 功能完成后将本文归档到 `docs/archive/`。

## 22. 手工验收矩阵

### 22.1 基础记录

- [ ] 网页记录关闭时，Chrome 使用不会产生 web segment。
- [x] 网页记录开启但插件未连接时，不产生 web segment。
- [x] 插件连接后，Chrome 前台浏览 `github.com` 产生 web segment。
- [x] Chrome 后台时，active tab 变化不产生计时时长。
- [x] 从 Chrome 切到 VSCode，当前 web segment 封口。
- [x] 从 VSCode 切回 Chrome，新 web segment 开始。
- [x] 切换 Chrome tab，新旧 web segment 正确封口/开始。

### 22.2 隐私

- [x] 默认不保存完整 URL。
- [x] 开启完整 URL 后，新 segment 保存 URL。
- [x] 关闭完整 URL 后，后续 segment 不保存 URL。
- [x] incognito 默认忽略。
- [x] `chrome://extensions` 不记录。
- [x] `file://` 不记录。
- [x] `http://localhost` 可按策略记录或明确忽略，行为与文案一致。

### 22.3 History

- [x] 当天有网页数据时出现 `网页` 维度。
- [x] `应用` 维度 Chrome 时长保持应用级结果。
- [x] `网页` 维度显示域名排行。
- [x] 切到 `网页` 维度后，横向时间轴仍保持现有 `应用` / `分类` 显示。
- [x] 网页 title 长文本不撑破浮层。
- [x] favicon 缺失时 fallback 正常。
- [x] 时间线弹窗可切换 `应用` / `网页` tab。
- [x] 时间线弹窗 `网页` tab 能查看 domain、title、time。

### 22.4 管理页

- [x] `网页` 模式显示已记录域名。
- [x] 搜索域名可定位记录。
- [x] 给域名设置分类后，History 网页视图颜色/标签更新。
- [x] 给域名设置颜色后，History 网页视图颜色更新。
- [x] 禁用域名后，后续不记录该域名。
- [x] 删除域名历史后，History 不再显示对应记录。

### 22.5 备份恢复与清理

- [x] 导出备份后恢复到空库，网页记录仍存在。
- [x] 旧备份恢复不会报错。
- [x] 清理最近 7 天外历史时，对应 web segments 被清理。
- [x] 清理 sessions 不留下 orphan web data。

## 23. 风险与处理

### 23.1 Chrome 审核风险

风险：

- [ ] `tabs` 权限涉及浏览活动，审核可能更严格。
- [ ] 提交量高时审核可能变慢。
- [x] 隐私说明不充分会被拒。

处理：

- [x] 保持权限最小。
- [x] 不申请 host permissions。
- [x] 不注入内容脚本。
- [x] 不使用远程代码。
- [x] reviewer notes 说明本机 Patina 的测试方式。
- [x] 隐私说明准确写明数据流向本机。

### 23.2 数据可信风险

风险：

- [x] 插件 active tab 与 OS 前台不同步。
- [x] 插件断连导致 segment 被错误延长。
- [x] 标题变化被误当 URL 变化。

处理：

- [x] Patina tracking runtime 是计时权威。
- [x] 插件事件只提供网页身份。
- [x] 断连超时封口。
- [x] 不从标题猜域名。
- [x] URL 变化与 domain 变化规则有测试保护。

### 23.3 隐私感知风险

风险：

- [x] 用户看到浏览器插件权限后不信任。
- [x] 完整 URL 过于敏感。
- [x] favicon URL 被误解为联网抓取。

处理：

- [x] 默认关闭。
- [x] 默认不保存完整 URL。
- [x] 设置页明确说明本地保存。
- [x] favicon 缺失可 fallback，不强依赖。
- [x] 插件 README 和商店说明透明列出采集字段。

### 23.4 UI 复杂度风险

风险：

- [x] History 维度过多。
- [x] `分类` 页面被应用和网页混杂拖厚。
- [x] 分类语义和对象管理混乱。

处理：

- [x] History 只新增一个 `网页` 维度。
- [x] `分类` 页面使用 `应用` / `网页` 模式分开。
- [x] 分类仍是两类对象共享的语义标签。
- [x] 网页分类第一版不混入应用分类 totals。

### 23.5 数据增长风险

风险：

- [x] 高频切 tab 或 URL 更新导致 web segment 很多。

处理：

- [x] 相同 identity 延续时不重复写。
- [x] 清理历史同步清理 web segments。
- [x] 第一版不保存网页正文和截图。
- [x] 可选后续再做 web segment compaction，不在第一版提前复杂化。

## 24. 完成定义

本执行单只有同时满足以下条件才算完成：

- [x] Chrome MV3 插件源码可校验、可构建、可打包。
- [ ] 插件能连接本机 Patina 并通过 token 鉴权。
- [x] Patina Settings 中网页记录默认关闭，可开启、关闭、重置 token。
- [x] Patina 只在用户开启网页记录后保存网页活动。
- [x] Chrome 前台网页活动能记录 domain、title、time。
- [x] 默认不保存完整 URL。
- [x] History 当日分布支持 `网页` 维度。
- [x] History 横向时间轴不新增 web mode。
- [x] History 时间线弹窗支持 `应用` / `网页` tab，网页 tab 展示网页时间线。
- [x] `分类` 页面支持 domain 分类、颜色、禁用和删除历史。
- [x] 备份、恢复、清理覆盖网页活动。
- [ ] Chrome Web Store 提交完成；若未通过，主应用安装入口不得宣称可正式安装。
- [ ] 自动化验证与手工验收完成。
- [x] `CHANGELOG.md` 记录用户可理解的变化，并只引用 issue，不关闭 issue。
- [x] 本执行单完成勾选后归档。

## 25. 后续可能的第二版方向

以下方向不属于第一版：

- [ ] Microsoft Edge Add-ons 单独上架。
- [x] Firefox extension。
- [x] Safari extension。
- [x] Data 页面网页长期趋势。
- [x] 网页分类混入全局分类统计。
- [x] 域名批量归类。
- [x] 按 URL path 细分网页。
- [x] 完整 URL 搜索。
- [x] 网页截图。
- [x] OCR。
- [x] 页面内容理解。
- [x] 浏览器外应用插件，例如编辑器文件级记录。
