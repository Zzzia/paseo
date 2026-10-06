# macOS 应用自动化

Paseo 启动的代理可以通过各自的电脑操作工具控制其他应用。macOS 可能将这些子进程的 Apple Events 请求归属到 Paseo，因此桌面包必须同时包含：

- 主应用签名权限 `com.apple.security.automation.apple-events`。
- `Info.plist` 中的 `NSAppleEventsUsageDescription`，说明自动化用途。

配置分别位于 `packages/desktop/build/entitlements.mac.plist` 和 `packages/desktop/electron-builder.yml`。保持 Hardened Runtime 开启；正式分发仍使用 Developer ID 签名并公证。配置依据 [Apple 的自动化权限说明](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.automation.apple-events) 和项目所用 [electron-builder 26 的 macOS 配置](https://www.electron.build/v26/docs/api/app-builder-lib.interface.macconfiguration/)。

构建后检查实际产物，不能只检查源配置：

```sh
codesign --verify --deep --strict /path/to/Paseo.app
codesign -d --entitlements :- /path/to/Paseo.app
/usr/libexec/PlistBuddy -c 'Print :NSAppleEventsUsageDescription' /path/to/Paseo.app/Contents/Info.plist
```

这些声明允许系统正常处理自动化授权，不会预先授予权限。首次请求仍可能需要用户在系统提示中允许；辅助功能、屏幕录制和电脑操作工具的锁屏功能各有独立要求。更换签名身份后也可能需要重新授权。

### 锁屏操作的边界

自动化授权通过、解锁状态下能点击应用，都不能证明锁屏操作可用。[官方 Locked use 文档](https://learn.chatgpt.com/docs/computer-use#locked-use) 要求 ChatGPT 确认当前是可信的活动 Computer Use 任务，临时解锁期间还会遮挡显示器并限制本机输入。该机制不是供其他本机进程使用的通用解锁接口。

本仓库的 Codex 接入通过 app-server 启动任务，目前没有单独实现上述锁屏任务接入。不能将安装授权插件或修复 Paseo 签名视为完成该接入；也没有依据声称所有 CLI 都不支持锁屏操作。验收必须在实际锁屏状态执行应用读取和点击。若仍报 `cgWindowNotFound`，应分别核对电脑操作服务、任务接入和授权结果；不能仅凭这个错误要求用户重复授权。

排查时查看 TCC 日志中的实际 `responsible` 应用。若出现 `requires entitlement ... but it is missing` 和 `Policy disallows prompt`，应先修正该应用的打包签名。在同一个 Paseo 下更换 Codex CLI 版本，不会改变其所属的自动化权限主体。Chrome 扩展可以控制网页，也不能据此判断原生桌面权限正常。

## 个人 Mac 的长期安装版

只在自己的 Mac 使用时，可用本机现有的 Apple Development 证书构建个人安装版。它保留应用名 `Paseo`、标识 `sh.paseo.desktop`、Hardened Runtime 和正常数据目录；不是 Apple 公证的分发包。现有分支的版本号保持不变，不因换签名就宣称源码已达到新的稳定版本。

在仓库根目录运行：

```sh
PASEO_MAC_SIGN_IDENTITY='钥匙串中的完整证书名称' npm run build:desktop:personal
```

产物位于 `packages/desktop/release/personal`，包含 Apple Silicon 的应用、DMG 和 ZIP。签名钩子使用锁文件中的 `@electron/osx-sign`，继承主打包配置的权限；找不到指定证书或签名失败会直接终止构建，不生成无签名的替代包。入口依据 [electron-builder 26 的自定义签名接口](https://www.electron.build/v26/docs/mac/#sign)。

后续构建沿用同一签名身份和应用标识。证书需续期时先检查新旧签名要求及系统授权，不能保证一次授权永久有效。这个 fork 的更新来源固定为 `Zzzia/paseo`，只有该仓库发布匹配的 macOS 更新文件后才能自动更新；本地构建不会上传或发布。

安装时替换 `/Applications/Paseo.app`，使用原有数据目录。替换前备份旧应用及数据，并准备断线后的回退方式。Paseo 管理当前远程会话时，关闭它会中断会话，需先约定切换时机。首次系统授权完成后，再验证锁屏下的原生应用操作。
