# Pi GUI

Pi GUI 是一个面向 [Pi coding agent](https://github.com/earendil-works/pi) 的原生桌面客户端。它使用 Tauri 2、Rust、React 19 和 Pi 的 JSONL RPC：Pi 继续负责模型、会话与工具执行，Pi GUI 负责桌面窗口、多会话工作区、文件、终端、Git、包管理，以及可选的应用自管 Pi 运行时。

> English summary: Pi GUI is a native Tauri desktop shell for the Pi coding agent, with real RPC chat and workspace-scoped developer tools.

[![MIT license](https://img.shields.io/badge/license-MIT-6b7280?style=for-the-badge)](./LICENSE)

> 当前状态：`0.1.0` 仍是未发布的 Windows-only 二进制候选版。源码仓库位于 [fananly233/pi-gui](https://github.com/fananly233/pi-gui)，GitHub-hosted Windows 安装生命周期已经通过，但候选安装包尚未签名，因此目前最可靠的使用方式仍是从源码运行。macOS 和 Linux 可以继续从源码构建，但不属于 `0.1.0` 的受支持发行资产。不要把 Gustav 的历史 Release 当作 Pi GUI 的 Release。

## 这个项目能做什么

- 直接连接真实的 `pi --mode rpc`，支持流式回复、thinking、工具事件、停止和后续消息；
- 按工作区读取真实 Pi 会话，支持新建、恢复、切换、重命名、分叉和删除；
- 读取模型与思考等级，并只向 React 界面暴露脱敏后的认证元数据；
- 在选定工作区内浏览、编辑和 `@file` 引用文件，支持图片附件；
- 使用 Rust 管理的原生 PTY，以及受限的 Git 状态、diff 和 worktree 操作；
- 调用 Pi 自身的 package install/list/update/remove，并发现真实 extension、skill、prompt 和 theme；
- 可安装应用私有、可校验、可回滚的 Pi 运行时，也可显式使用已经配置好的系统 Pi。

Electron main/preload/agent-host、Browser Agent、Channels、任意 shell/Git 参数桥接和 React 直接访问任意文件系统都没有带入。准确的功能边界见 [FEATURE_MAPPING.md](./FEATURE_MAPPING.md)。

## 项目来源与二次开发声明

Pi GUI 基于 [Gustav Pi Desktop](https://github.com/gustavonline/pi-desktop) 二次开发，保留并扩展了其 Tauri 2、Rust 与 Pi RPC 主干；React 界面的部分结构思路和暖色视觉 token 改编自 Apache-2.0 许可的 [DLYZZT Pi Desktop](https://github.com/DLYZZT/pi-desktop)。

本项目包含大量独立修改，不是上述任一原项目的官方版本。具体基线版本、许可证和修改边界记录在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 与 [MIGRATION_MATRIX.md](./MIGRATION_MATRIX.md)。发布或分发时必须保留这些声明和许可证。

## 安装与启动

### 目前：从源码运行

需要：

- Node.js 22 或更高版本；
- 当前稳定版 Rust 工具链；
- [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)；
- 可选：已经安装并完成认证的 Pi CLI。没有系统 Pi 时，也可以稍后从 Runtime 面板安装应用自管版本。

```powershell
git clone https://github.com/fananly233/pi-gui.git
cd pi-gui
npm ci
npm run tauri dev
```

构建本机安装包：

```powershell
npm run check:release
npm run check
npm test
npm run build:frontend
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm audit
npm run build
```

Windows 产物位于 `src-tauri/target/release/bundle/`。`0.1.0` 只计划发布签名后的 Windows NSIS 和 MSI；在正式 Release 出现前，不建议把本地未签名安装包分发给普通用户。

## 第一次使用

1. 启动应用，确认左侧底部的 Desktop runtime 信息正常显示。
2. 在左侧 **Working directory** 选择项目目录，然后点击 **Connect Pi**。Pi GUI 只会在你明确连接后读取这个工作区的会话和文件。
3. 从侧栏选择已有会话，或新建会话。每个打开的会话使用独立 Pi RPC 进程，切换时不会共享流式状态。
4. 打开 **Model / Models & auth** 面板选择模型和 thinking level。若 provider 尚未认证，在系统终端运行 `pi`，输入 `/login` 完成交互式登录，回到 Pi GUI 后点击 Refresh；Pi 0.84.2 没有对应的 RPC 登录接口。
5. 在输入框发送任务。运行中可停止当前请求；extension/skill/prompt 命令从当前 Pi runtime 实时读取，点击 **Use** 只会把命令放入输入框，不会自动执行。
6. 使用聊天区右上方入口打开 **Files**、**Git**、**Terminal** 或 **Ecosystem**，并从左侧 runtime 卡片打开 **Runtime**。文件和本地 package 路径被限制在当前工作区，危险操作会要求确认。
7. 若要使用应用自管 Pi，在 **Runtime** 中检查并安装匹配当前平台的版本。下载内容会校验官方 SHA-256，安装位于应用数据目录，不会修改全局 npm、`PATH` 或系统 Pi。

## 当前限制

- Pi 的交互式 `/login`、`/logout` 和 `pi config` 仍需在 Pi TUI 中完成；
- 会话导出、统计和 tree/history overlay 尚未迁移；
- Git 仅提供状态、diff 和受保护的 worktree 操作，不提供 stage、commit、fetch、push 或 reset；
- extension 自定义 UI 请求尚未接入 React renderer；
- managed runtime 不做静默后台更新，安装和切换都需要用户确认。

## 数据与隐私

- 模型凭据继续由 Pi 的本地认证存储管理；WebView 只收到 provider、来源和凭据类型等元数据；
- 生命周期日志不记录 prompt、模型输出、凭据或环境变量；
- 当前代码没有集成 analytics/telemetry SDK，但 Pi 调用模型、检查 runtime 更新或下载 runtime 时仍会按功能需要联网；
- `.env`、Pi/Codex 本地状态、认证文件、签名私钥、日志和本地主控提示词均被忽略；正式推送前运行 `npm run check:publish`；
- 应用拥有工作区文件和本地进程权限，请只连接你信任的目录和 package。详细边界见 [docs/PERMISSIONS.md](./docs/PERMISSIONS.md)。

## 开发与验证

日常确定性验证：

```powershell
npm run check
npm test
npm run build:frontend
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

以下命令会调用真实 Pi 或下载真实 runtime，不能当作普通单元测试结果：

```powershell
npm run gate:pi-real
npm run gate:sessions-real
npm run gate:models-real
npm run gate:ecosystem-real
npm run gate:runtime-real
```

这些 real gates 会把可变 Pi 配置、会话和 managed runtime 放入隔离临时目录，并验证真实 Pi 配置没有变化；它们仍会调用真实 Pi，部分步骤也会访问网络。发布、签名与 clean-machine 验证流程见 [docs/RELEASES.md](./docs/RELEASES.md)、[docs/SIGNING.md](./docs/SIGNING.md)、[docs/RC_ACCEPTANCE.md](./docs/RC_ACCEPTANCE.md) 和 [RELEASE_CRITERIA.md](./RELEASE_CRITERIA.md)。

## 文档

- [架构](./docs/ARCHITECTURE.md)
- [功能映射](./FEATURE_MAPPING.md)
- [能力与权限边界](./docs/CAPABILITY_MODEL.md)
- [Packages、extensions 与 resources](./docs/PACKAGES.md)
- [发布流程](./docs/RELEASES.md)
- [0.1 RC 验收记录](./docs/RC_ACCEPTANCE.md)
- [发布签名](./docs/SIGNING.md)
- [图标维护](./docs/ICONS.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

## License

本仓库以 MIT 许可证发布；引入内容继续受 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中列出的原许可证和声明约束。
