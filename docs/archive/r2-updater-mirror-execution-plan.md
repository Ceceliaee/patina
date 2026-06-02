# GitHub 主源 + R2 备用更新源执行方案

## 0. 执行结果

- [x] R2 bucket 已创建：`time-tracker-releases`。
- [x] R2 公共开发 URL 已启用：`https://pub-ad4b539442124a3287529c9435f053ba.r2.dev`。
- [x] R2 API token 已由用户创建，并由用户写入 GitHub Actions Secrets。
- [x] Tauri updater endpoints 已更新为 GitHub 主源 + R2 备用源。
- [x] 发布脚本已改为保留 GitHub 主源并保留已有备用 endpoint。
- [x] GitHub Actions 已增加可选 R2 mirror 同步、R2 manifest 生成、R2 上传和旧镜像清理。
- [x] `CHANGELOG.md` 已记录更新可靠性改进，并使用 `Refs #12`。
- [x] `docs/versioning-and-release-policy.md` 已回写长期镜像策略。
- [x] 本地验证已完成：`npm run test:release`、`npm run test:update`、`npm run release:validate-changelog`、`npm run check` 均通过。
- [x] 本执行单完成后归档到 `docs/archive/`。

发布时继续检查：

- [ ] 下一次正式发布后确认 GitHub Release assets 存在。
- [ ] 下一次正式发布后确认 R2 `latest.json` 可访问。
- [ ] 下一次正式发布后确认 R2 安装包 URL 可下载。
- [ ] 下一次正式发布后确认 R2 旧版本清理符合保留策略。
- [ ] 下一次正式发布后回复 Issue #12。

## 1. 文档定位

这是一份可勾选执行方案，用于把应用内更新链路从“只依赖 GitHub Release 更新清单”扩展为：

- GitHub Release 继续作为主发布源和主更新源。
- Cloudflare R2 作为备用更新清单与安装包镜像源。
- GitHub 不可达或链路波动时，应用仍有机会通过 R2 完成自动更新。

本文是一次性执行单，不是长期发布规范。执行完成并验证后：

- 将长期稳定规则回写到 `docs/versioning-and-release-policy.md`。
- 将本文移入 `docs/archive/`。

关联背景：

- GitHub Issue: `#12`，无法访问更新清单。
- 当前应用内更新依赖 `https://github.com/Ceceliaee/time-tracking/releases/latest/download/latest.json`。
- 当前代码版本：`1.3.0`。

## 2. 最终策略

- [ ] GitHub Release 保持主源。
- [ ] R2 只做备用镜像，不承接完整历史发布仓库职责。
- [ ] R2 可随时关闭；关闭后不能影响 GitHub Release 正常发布和手动下载。
- [ ] R2 免费层优先：默认只保留当前最新版安装包和 `latest.json`。
- [ ] 不改变 Tauri updater 签名体系。
- [ ] 不引入自建网站、自定义下载页或账号体系。

目标更新源顺序：

```json
[
  "https://github.com/Ceceliaee/time-tracking/releases/latest/download/latest.json",
  "https://<r2-public-base-url>/latest.json"
]
```

其中第二个 URL 使用实际 R2 公开访问地址替换。

## 3. 成功标准

- [ ] 新版本发布后，GitHub Release 仍包含安装包和 GitHub 版 `latest.json`。
- [ ] 新版本发布后，R2 包含 R2 版 `latest.json` 和同版本安装包。
- [ ] GitHub 版 `latest.json` 中安装包 URL 指向 GitHub Release asset。
- [ ] R2 版 `latest.json` 中安装包 URL 指向 R2 上的安装包。
- [ ] Tauri updater 配置中 GitHub endpoint 排在第一，R2 endpoint 排在第二。
- [ ] R2 上传失败不会阻止 GitHub Release 已经发布，但会让 workflow 标红提醒备用源同步失败。
- [ ] R2 未配置 secrets 时，workflow 自动跳过 R2 同步，不阻塞正式发布。
- [ ] R2 默认清理旧版本，只保留当前版本目录。
- [ ] 发布后可以直接访问 R2 `latest.json` 和 R2 安装包 URL。
- [ ] Issue #12 可以回复“保留 GitHub Releases，同时新增 R2 备用更新源”。

## 4. 非目标

- [ ] 不把历史版本全量迁移到 R2。
- [ ] 不用 R2 替代 GitHub Release 页面。
- [ ] 不删除 GitHub Release asset。
- [ ] 不改变安装包命名规范。
- [ ] 不改变 updater 公钥或签名私钥。
- [ ] 不新增应用内代理下载服务。
- [ ] 不新增用户可配置更新源 UI。
- [ ] 不在本轮解决所有网络环境下的下载可达性，只降低 GitHub 单点失败概率。

## 5. Owner 与落点

### 5.1 发布脚本 owner

涉及文件：

- `scripts/release.ts`

职责：

- 继续拥有安装包命名规则。
- 继续拥有 `latest.json` 生成规则。
- 继续校验 changelog。
- 继续保证 updater manifest 中的 `version / notes / pub_date / platforms` 结构一致。

本轮允许修改：

- [ ] 将 updater endpoint 常量化，避免 GitHub URL 在多个位置散落。
- [ ] 让 `sync-version` 写入 GitHub + R2 两个 endpoint。
- [ ] 如有必要，补一个 R2 manifest 辅助命令；优先复用现有 `write-latest-json`。

### 5.2 GitHub Actions owner

涉及文件：

- `.github/workflows/prepare-release.yml`

职责：

- 构建安装包。
- 生成 GitHub Release notes。
- 生成 GitHub 版 `latest.json`。
- 发布 GitHub Release。
- 同步 R2 镜像。
- 清理 R2 旧版本。

本轮允许修改：

- [ ] 在 GitHub Release 发布完成后新增 R2 同步步骤。
- [ ] 新增 R2 secrets 检查步骤。
- [ ] 新增 R2 版 `latest.json` 生成步骤。
- [ ] 新增 R2 上传步骤。
- [ ] 新增 R2 旧版本清理步骤。

### 5.3 Tauri updater 配置 owner

涉及文件：

- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.dev.conf.json`
- `src-tauri/tauri.local.conf.json`

职责：

- 声明 updater endpoints。
- 保持主源和备用源顺序稳定。

本轮允许修改：

- [ ] 将 GitHub endpoint 保持第一。
- [ ] 将 R2 endpoint 添加为第二。
- [ ] 确保 `scripts/release.ts sync-version` 后不会把 R2 endpoint 覆盖掉。

### 5.4 应用 UI owner

涉及文件：

- `src/features/update/*`
- `src/shared/copy/uiText.ts`

本轮默认不改 UI。

只有在验证发现错误文案误导用户时，才允许小范围调整：

- [ ] 继续保持“无法检查更新”和“无法下载安装包”的分阶段文案。
- [ ] 手动下载入口继续优先打开 GitHub Release 页面。
- [ ] 不新增 Cloudflare 或 R2 的用户可见术语，避免普通用户承担基础设施心智。

## 6. R2 对象结构

推荐结构：

```text
latest.json
releases/vX.Y.Z/TimeTracker_X.Y.Z_x64-setup.exe
```

示例：

```text
latest.json
releases/v1.3.1/TimeTracker_1.3.1_x64-setup.exe
```

规则：

- [ ] `latest.json` 固定放在 bucket 根路径。
- [ ] 安装包放在版本目录中。
- [ ] 不使用固定文件名 `latest.exe` 覆盖安装包。
- [ ] R2 版 `latest.json` 的 `platforms.windows-x86_64.url` 必须指向 R2 安装包 URL。
- [ ] GitHub 版 `latest.json` 的 URL 继续指向 GitHub Release asset。
- [ ] `latest.json` 上传必须在安装包上传成功之后执行。
- [ ] 清理旧版本必须在新版 `latest.json` 上传成功之后执行。

不使用 `latest.exe` 的原因：

- Tauri updater 会校验签名。
- 如果旧 `latest.json` 指向的文件名被覆盖成新安装包，可能出现 manifest 签名与安装包不匹配。
- 版本化路径更稳，清理旧版本也足够简单。

## 7. R2 保留策略

默认策略：

- [ ] 只保留当前版本目录。
- [ ] 保留根路径 `latest.json`。
- [ ] GitHub Releases 负责完整历史。

可选策略：

- [ ] 如果担心用户已经拿到旧 R2 manifest 但尚未下载安装包，可以保留当前版本 + 上一版本。
- [ ] 如果启用“保留上一版本”，应通过一个明确变量控制，例如 `R2_RETAIN_RELEASE_COUNT=2`。

本轮建议先做默认策略：

```text
latest.json
releases/v<current-version>/*
```

免费层判断：

- 安装包体积远小于 R2 免费层 10 GB-month。
- 当前项目更新检查请求量预计远低于免费层读写请求限制。
- 默认只保留当前版本，可以避免长期对象累积。

## 8. Cloudflare 控制台准备

### 8.1 创建 bucket

- [ ] 打开 Cloudflare Dashboard。
- [ ] 进入 `R2 对象存储`。
- [ ] 点击 `创建存储桶`。
- [ ] 存储桶名称建议使用：

```text
time-tracker-releases
```

- [ ] 存储类型选择 Standard，不使用 Infrequent Access。
- [ ] 创建后进入 bucket 详情页。

### 8.2 开启公开读取

- [ ] 在 bucket 设置中开启公开访问。
- [ ] 优先使用 R2 默认 `r2.dev` 公开 URL。
- [ ] 暂不绑定自定义域名。
- [ ] 记录公开 base URL，例如：

```text
https://pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev
```

注意：

- 这个 URL 后续会写入 Tauri updater endpoint。
- 如果以后关闭公开访问，R2 备用源会失效，但 GitHub 主源仍应可用。

### 8.3 创建 R2 API Token

- [ ] 进入 R2 的 API 令牌管理入口。
- [ ] 创建面向此 bucket 的读写 token。
- [ ] 权限限定为目标 bucket 的对象读写。
- [ ] 不授予账户级无关权限。
- [ ] 保存以下信息：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
```

其中：

- `R2_ACCOUNT_ID` 是 Cloudflare 账户 ID。
- `R2_BUCKET` 是 bucket 名，例如 `time-tracker-releases`。
- `R2_PUBLIC_BASE_URL` 是公开访问 base URL，不带末尾 `/`。

安全要求：

- [ ] 不把 access key 写入仓库。
- [ ] 不把 secret key 写入文档。
- [ ] 不在 issue、commit、release notes 中贴出 secret。

## 9. GitHub Secrets 准备

在 GitHub 仓库中进入：

```text
Settings -> Secrets and variables -> Actions -> Repository secrets
```

新增：

- [ ] `R2_ACCOUNT_ID`
- [ ] `R2_ACCESS_KEY_ID`
- [ ] `R2_SECRET_ACCESS_KEY`
- [ ] `R2_BUCKET`
- [ ] `R2_PUBLIC_BASE_URL`

可选：

- [ ] `R2_RETAIN_RELEASE_COUNT`

默认不需要新增 `R2_ENABLED`。workflow 可以通过必要 secrets 是否存在判断是否启用 R2 同步。

验收：

- [ ] GitHub Actions secrets 页面能看到这些 secret 名称。
- [ ] secret 值不可见，这是正常的。
- [ ] 没有把这些值提交到仓库。

## 10. 实现切片 A：收口 updater endpoint

目标：

- 避免 GitHub endpoint 在 `scripts/release.ts` 和多个 Tauri 配置中漂移。
- 确保以后 `sync-version` 不会删除 R2 endpoint。

步骤：

- [ ] 在 `scripts/release.ts` 中新增常量：

```ts
const GITHUB_UPDATER_ENDPOINT =
  "https://github.com/Ceceliaee/time-tracking/releases/latest/download/latest.json";
const R2_UPDATER_ENDPOINT =
  "https://<r2-public-base-url>/latest.json";
const UPDATER_ENDPOINTS = [GITHUB_UPDATER_ENDPOINT, R2_UPDATER_ENDPOINT];
```

- [ ] 将 `<r2-public-base-url>` 替换成真实公开 URL。
- [ ] 更新 `syncVersion(...)` 中写入 `tauriConfig.plugins.updater.endpoints` 的逻辑，使用 `UPDATER_ENDPOINTS`。
- [ ] 检查 `src-tauri/tauri.conf.json`：

```json
"endpoints": [
  "https://github.com/Ceceliaee/time-tracking/releases/latest/download/latest.json",
  "https://<r2-public-base-url>/latest.json"
]
```

- [ ] 同步检查 `src-tauri/tauri.dev.conf.json`。
- [ ] 同步检查 `src-tauri/tauri.local.conf.json`。
- [ ] 如果 `sync-version` 当前只更新主配置，应扩展它同步三个配置的 updater endpoints。

边界要求：

- [ ] 不把 updater endpoint 写进前端 UI 层。
- [ ] 不让 `features/update/*` 拼接基础设施 URL。
- [ ] URL 配置继续属于 Tauri updater / release 脚本边界。

## 11. 实现切片 B：生成 R2 版 latest.json

目标：

- GitHub 版 `latest.json` 指向 GitHub 安装包。
- R2 版 `latest.json` 指向 R2 安装包。
- 两份 manifest 使用同一个版本号、同一份 release notes、同一个签名。

优先复用现有命令：

```text
npm run release:latest -- <version> <asset-url> <signature> <output> windows-x86_64
```

步骤：

- [ ] 在 `.github/workflows/prepare-release.yml` 的 `Prepare release assets` 之后，新增一个步骤读取 GitHub 版 `latest.json` 中的签名。
- [ ] 根据 release version 计算 R2 安装包 key：

```text
releases/v${version}/TimeTracker_${version}_x64-setup.exe
```

- [ ] 根据 `R2_PUBLIC_BASE_URL` 计算 R2 安装包 URL：

```text
${R2_PUBLIC_BASE_URL}/releases/v${version}/TimeTracker_${version}_x64-setup.exe
```

- [ ] 调用 `npm run release:latest` 生成：

```text
dist-release/r2/latest.json
```

建议 PowerShell 逻辑：

```powershell
$version = "${{ steps.release.outputs.version }}"
$installerName = "TimeTracker_${version}_x64-setup.exe"
$r2BaseUrl = $env:R2_PUBLIC_BASE_URL.TrimEnd("/")
$r2InstallerUrl = "$r2BaseUrl/releases/v$version/$installerName"
$githubLatest = Get-Content "dist-release/latest.json" -Raw | ConvertFrom-Json
$signature = $githubLatest.platforms.'windows-x86_64'.signature
npm run release:latest -- $version $r2InstallerUrl $signature dist-release/r2/latest.json windows-x86_64
```

验收：

- [ ] `dist-release/latest.json` 中 URL 指向 GitHub。
- [ ] `dist-release/r2/latest.json` 中 URL 指向 R2。
- [ ] 两份 `latest.json` 的 `version` 相同。
- [ ] 两份 `latest.json` 的 `notes` 相同。
- [ ] 两份 `latest.json` 的 `signature` 相同。

## 12. 实现切片 C：发布 workflow 中增加 R2 开关

目标：

- R2 secrets 未配置时自动跳过。
- R2 secrets 已配置时执行同步。
- 跳过 R2 不影响 GitHub Release。

步骤：

- [ ] 在 `Publish GitHub Release` 之后新增 `Check R2 mirror configuration`。
- [ ] 将必要 secret 注入 env：

```yaml
env:
  R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
  R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
  R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
  R2_BUCKET: ${{ secrets.R2_BUCKET }}
  R2_PUBLIC_BASE_URL: ${{ secrets.R2_PUBLIC_BASE_URL }}
```

- [ ] 在 PowerShell 中检查是否缺任意必要值。
- [ ] 如果缺值，写入：

```powershell
"R2_MIRROR_ENABLED=false" >> $env:GITHUB_ENV
Write-Host "R2 mirror secrets are not fully configured; skipping R2 sync."
```

- [ ] 如果完整，写入：

```powershell
"R2_MIRROR_ENABLED=true" >> $env:GITHUB_ENV
```

验收：

- [ ] secrets 不完整时，workflow 明确显示跳过 R2。
- [ ] secrets 完整时，后续 R2 步骤会执行。
- [ ] GitHub Release 步骤不依赖 R2 检查结果。

## 13. 实现切片 D：上传 R2 安装包与 manifest

目标：

- 先上传安装包。
- 再上传 R2 版 `latest.json`。
- `latest.json` 使用短缓存或不缓存，避免用户拿到过旧 manifest。

推荐使用 S3 compatible API。

步骤：

- [ ] 确认 GitHub Windows runner 可用 `aws` CLI。
- [ ] 如不可用，新增安装 AWS CLI 的步骤，或改用稳定的 S3 上传 Action。
- [ ] 配置 env：

```yaml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
  AWS_DEFAULT_REGION: auto
  R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
  R2_BUCKET: ${{ secrets.R2_BUCKET }}
```

- [ ] 在 PowerShell 中计算 endpoint：

```powershell
$r2Endpoint = "https://$env:R2_ACCOUNT_ID.r2.cloudflarestorage.com"
```

- [ ] 上传安装包：

```powershell
$version = "${{ steps.release.outputs.version }}"
$installerName = "TimeTracker_${version}_x64-setup.exe"
aws s3 cp `
  "dist-release/$installerName" `
  "s3://$env:R2_BUCKET/releases/v$version/$installerName" `
  --endpoint-url $r2Endpoint `
  --content-type "application/vnd.microsoft.portable-executable"
```

- [ ] 上传 `latest.json`：

```powershell
aws s3 cp `
  "dist-release/r2/latest.json" `
  "s3://$env:R2_BUCKET/latest.json" `
  --endpoint-url $r2Endpoint `
  --content-type "application/json" `
  --cache-control "no-cache"
```

验收：

- [ ] R2 bucket 中出现 `releases/vX.Y.Z/TimeTracker_X.Y.Z_x64-setup.exe`。
- [ ] R2 bucket 根路径出现 `latest.json`。
- [ ] 公开访问 `https://<r2-public-base-url>/latest.json` 返回 JSON。
- [ ] JSON 中的安装包 URL 可以下载。

## 14. 实现切片 E：清理 R2 旧版本

目标：

- 免费层优先。
- 默认只保留当前版本目录。
- 不删除当前版本目录。
- 不删除根路径 `latest.json`。

步骤：

- [ ] 在 R2 安装包和 `latest.json` 上传成功之后执行清理。
- [ ] 使用 S3 API 列出 `releases/` 下的版本目录。
- [ ] 删除除当前版本目录外的其他目录。

建议 PowerShell 逻辑：

```powershell
$version = "${{ steps.release.outputs.version }}"
$currentPrefix = "releases/v$version/"
$r2Endpoint = "https://$env:R2_ACCOUNT_ID.r2.cloudflarestorage.com"
$objects = aws s3api list-objects-v2 `
  --bucket $env:R2_BUCKET `
  --prefix "releases/" `
  --delimiter "/" `
  --endpoint-url $r2Endpoint | ConvertFrom-Json

$prefixes = @($objects.CommonPrefixes | ForEach-Object { $_.Prefix })
foreach ($prefix in $prefixes) {
  if ($prefix -ne $currentPrefix) {
    aws s3 rm "s3://$env:R2_BUCKET/$prefix" --recursive --endpoint-url $r2Endpoint
  }
}
```

验收：

- [ ] 当前版本目录仍存在。
- [ ] 旧版本目录被删除。
- [ ] `latest.json` 仍存在。
- [ ] GitHub Releases 中旧版本仍存在。

风险控制：

- [ ] 第一次上线清理逻辑时，可以先打印将要删除的 prefix，不立即删除。
- [ ] 确认 prefix 只位于 `releases/` 下后，再启用真实删除。
- [ ] 不使用无 prefix 限制的递归删除。

## 15. 实现切片 F：更新长期发布规范

目标：

- 执行完成后，长期规则不只存在于临时计划里。

步骤：

- [ ] 更新 `docs/versioning-and-release-policy.md` 中的发布流程。
- [ ] 补充说明 GitHub Release 是主发布源。
- [ ] 补充说明 R2 是可选备用镜像源。
- [ ] 补充说明 R2 只保留当前版本或当前 + 上一版本。
- [ ] 补充说明 R2 未配置或同步失败不改变 GitHub Release 的主发布事实。
- [ ] 避免把 Cloudflare 配置细节写成长期操作教程；长期文档只写稳定策略。

## 16. 实现切片 G：更新 changelog

目标：

- 发布级变化要在 `CHANGELOG.md` 中可追踪。

步骤：

- [ ] 在 `CHANGELOG.md` 的 `Unreleased` 中添加条目。
- [ ] 如果这是用户可感知的更新可靠性改进，放入 `Changed` 或 `Fixed`。
- [ ] 建议引用 issue，但不使用关闭关键词。

示例：

```md
- 改进应用内更新链路，保留 GitHub Releases 作为主源，并增加 R2 备用更新镜像，降低 GitHub 链路偶发失败对自动更新的影响。Refs [#12](https://github.com/Ceceliaee/time-tracking/issues/12)
```

注意：

- [ ] 不写 `Closes #12`。
- [ ] 不写 `Fixes #12`。
- [ ] 不写 `Resolves #12`。

## 17. 本地验证计划

只改文档时不需要运行测试；真正实现后按下面验证。

### 17.1 脚本与配置验证

- [ ] 运行更新视图模型测试：

```powershell
npm run test:update
```

- [ ] 运行 release policy 测试：

```powershell
npm run test:release
```

- [ ] 运行 changelog 校验：

```powershell
npm run release:validate-changelog
```

- [ ] 如果修改 `scripts/release.ts`，至少额外运行：

```powershell
npm run check
```

- [ ] 如果准备正式发布，运行：

```powershell
npm run release:check
```

### 17.2 manifest 生成验证

使用一个测试 URL 和测试签名验证命令结构：

```powershell
npm run release:latest -- 1.3.1 https://example.com/TimeTracker_1.3.1_x64-setup.exe test-signature dist-release/test-latest.json windows-x86_64
```

检查：

- [ ] `dist-release/test-latest.json` 能生成。
- [ ] `version` 正确。
- [ ] `platforms.windows-x86_64.url` 正确。
- [ ] `platforms.windows-x86_64.signature` 正确。

注意：

- 这只验证脚本结构。
- 真实 updater 验证必须使用实际构建签名。

### 17.3 workflow 静态检查

- [ ] 检查 YAML 缩进。
- [ ] 检查 R2 步骤在 `Publish GitHub Release` 之后。
- [ ] 检查 R2 步骤都带有 `if: env.R2_MIRROR_ENABLED == 'true'`。
- [ ] 检查 R2 上传失败会让 workflow 标红。
- [ ] 检查 R2 secrets 不完整时不会执行上传。

### 17.4 发布后验证

发布一个正式版本或预发布版本后执行：

- [ ] 打开 GitHub Release 页面，确认安装包存在。
- [ ] 打开 GitHub Release 页面，确认 `latest.json` 存在。
- [ ] 打开 R2：

```text
https://<r2-public-base-url>/latest.json
```

- [ ] 确认 R2 `latest.json` 返回 200。
- [ ] 确认 R2 `latest.json` 的 `version` 是新版本。
- [ ] 确认 R2 `latest.json` 的安装包 URL 指向 R2。
- [ ] 打开 R2 安装包 URL，确认可以下载。
- [ ] 检查 R2 bucket 中只有当前版本目录。
- [ ] 如果旧版本目录仍存在，确认是否因为本轮启用了“保留上一版本”策略。
- [ ] 使用旧版本应用点击检查更新，确认仍能发现新版本。

## 18. 真实 fallback 验证方案

目标：

- 验证 GitHub endpoint 不可用时，R2 endpoint 能作为备用源。

可选方案 A：临时构建验证版

- [ ] 在本地临时把 GitHub endpoint 改成一个无效 URL。
- [ ] 保留 R2 endpoint。
- [ ] 使用旧版本或开发构建检查更新。
- [ ] 确认 updater 能通过 R2 manifest 拿到更新。
- [ ] 验证完成后丢弃临时改动，不提交。

可选方案 B：网络阻断验证

- [ ] 使用系统 hosts、代理或防火墙临时阻断 GitHub Release manifest 访问。
- [ ] 不阻断 R2。
- [ ] 运行已发布版本检查更新。
- [ ] 确认仍能通过 R2 获取 manifest。
- [ ] 验证后恢复网络设置。

注意：

- 不建议在正式仓库中提交无效 GitHub endpoint。
- 不建议为了验证而关闭 GitHub Release asset。

## 19. 回滚方案

### 19.1 R2 secrets 配置错误

- [ ] 删除或修正 GitHub Actions secrets。
- [ ] 重新运行 workflow 中失败的发布流程，或等待下一版发布。
- [ ] GitHub Release 已发布时，不重写 tag。
- [ ] 必要时手动上传正确的 R2 `latest.json`。

### 19.2 R2 上传失败

- [ ] 确认 GitHub Release 是否已经发布。
- [ ] 如果 GitHub Release 已发布，主发布不回滚。
- [ ] 修正 R2 credentials、bucket、公开访问或 endpoint。
- [ ] 重新运行 workflow，或手动补传 R2 对象。
- [ ] 验证 R2 `latest.json` 后再回复 issue。

### 19.3 R2 latest.json 错误

- [ ] 立即重新生成正确 R2 `latest.json`。
- [ ] 上传覆盖 R2 根路径 `latest.json`。
- [ ] 确认 `version / url / signature` 匹配。
- [ ] 不改 GitHub Release。

### 19.4 R2 安装包错误

- [ ] 删除错误 R2 安装包对象。
- [ ] 重新上传 GitHub Release 中同名安装包。
- [ ] 确认 R2 `latest.json` 指向正确对象。
- [ ] 确认对象可公开下载。

### 19.5 Cloudflare 停用或超出预期

- [ ] 关闭 R2 bucket 公开访问或删除 bucket。
- [ ] 保留 GitHub Release 主源。
- [ ] 在下一版本移除 Tauri updater 的 R2 endpoint。
- [ ] 删除 GitHub Actions 中的 R2 secrets。
- [ ] 更新 `docs/versioning-and-release-policy.md`，说明备用源已停用。

### 19.6 R2 credentials 泄露

- [ ] 立即在 Cloudflare 轮换或删除 R2 API token。
- [ ] 删除 GitHub Actions 中旧 secret。
- [ ] 新建最小权限 token。
- [ ] 更新 GitHub Actions secrets。
- [ ] 检查 R2 bucket 是否有未知对象。
- [ ] 必要时删除 bucket 并重建。

## 20. GitHub Issue #12 回复口径

不要关闭 issue，除非明确决定此版本已经完全解决并准备关闭。

建议回复：

```md
后续会保留 GitHub Releases 作为主更新源，同时增加 Cloudflare R2 作为备用更新镜像。

这样 GitHub Release 页面和历史版本仍然是正式发布来源；R2 只保存当前版本的更新清单和安装包，用于降低 GitHub 链路偶发失败时对应用内更新的影响。

实现后会在发布说明里标注。Refs #12
```

注意：

- [ ] 不使用 issue-closing keywords。
- [ ] 不承诺“所有网络环境都能成功”。
- [ ] 不把 Cloudflare 说成必需依赖。
- [ ] 不要求用户理解 R2 才能更新。

## 21. 执行顺序总表

- [x] 确认 R2 bucket 已创建。
- [x] 确认 R2 公开 base URL 可用。
- [x] 确认 R2 API token 已创建。
- [x] 配置 GitHub Actions secrets。
- [x] 更新 `scripts/release.ts` 的 updater endpoint 写入逻辑。
- [x] 更新三个 Tauri 配置中的 updater endpoints。
- [x] 更新 `.github/workflows/prepare-release.yml`，新增 R2 配置检查。
- [x] 更新 `.github/workflows/prepare-release.yml`，新增 R2 版 `latest.json` 生成。
- [x] 更新 `.github/workflows/prepare-release.yml`，新增 R2 上传。
- [x] 更新 `.github/workflows/prepare-release.yml`，新增 R2 旧版本清理。
- [x] 更新 `docs/versioning-and-release-policy.md` 的长期发布规则。
- [x] 更新 `CHANGELOG.md` 的 `Unreleased`。
- [x] 运行 `npm run test:update`。
- [x] 运行 `npm run test:release`。
- [x] 运行 `npm run release:validate-changelog`。
- [x] 运行 `npm run check`。
- [ ] 准备正式发布前运行 `npm run release:check`。
- [ ] 发布后检查 GitHub Release assets。
- [ ] 发布后检查 R2 `latest.json`。
- [ ] 发布后检查 R2 安装包 URL。
- [ ] 发布后检查 R2 旧版本清理结果。
- [x] 验证 GitHub 主源仍优先。
- [x] 验证 R2 备用源已配置。
- [ ] 回复 Issue #12。
- [x] 执行完成后将本文移入 `docs/archive/`。

## 22. 暂停条件

出现以下任一情况时暂停实现，不继续硬推：

- [ ] R2 公开 URL 不稳定或无法公开读取。
- [ ] R2 API token 无法限制到合理权限。
- [ ] Tauri updater 无法按预期处理多个 endpoint。
- [ ] R2 上传需要引入过重或不可信的第三方 Action。
- [ ] workflow 为了 R2 同步需要重写现有发布主路径。
- [ ] R2 同步开始影响 GitHub Release 成功发布。
- [ ] 测试发现 manifest 签名与安装包匹配关系不清楚。
- [ ] 用户决定暂时不继续使用 Cloudflare。

暂停后的默认处理：

- 保留 GitHub 单源更新。
- 不关闭 Issue #12。
- 只保留已经无风险的文档或脚本整理。
