# 远端文件下载

在文件标签页点击“下载”，或使用文件树和 Git 菜单中的“下载”；菜单会先进入对应文件标签页。不支持预览的文件和超过预览大小限制的文件也能下载。

下载进度、取消和错误只在对应文件页内展示。切换标签页后继续下载，后台完成不会切回原标签页，也不会弹出全局浮窗。同一主机、工作目录和路径的文件视图共享一个传输，不同文件各自展示状态。

安卓和 iOS 将文件保存在 Paseo 的文档目录。缓存有效时，主按钮变为“打开”；旁边的“分享”可发送给其他应用或保存到它们支持的位置。安卓“打开”显示系统应用选择器，已知类型按 MIME 匹配，未知类型允许用户选择应用；没有可用应用时在文件页显示错误。打开 APK 时由系统安装器处理，首次使用可能需要在系统提示中允许 Paseo 安装未知来源应用。网页和桌面客户端使用浏览器的下载位置，下载完成状态留在文件页。

原生客户端会为完整下载建立持久化索引。进入文件页时检查本地文件与远端版本；远端未变且本地文件存在、大小正确，就显示“打开”，不重新传输文件内容。关闭标签页或重启应用后仍可恢复。远端变化或本地文件丢失时恢复“下载”；打开前也会再检查本地文件。如果没有服务端连接对象，已保存的本地文件仍可打开；远端查询失败会在本页报错。旧版本保存的文件没有索引，升级后的第一次下载会建立索引，已有文件不会被删除。

下载复用当前连接，支持直连、中继和桌面的 SSH 连接，不需要另开可访问的 HTTP 端口。中继上的文件内容继续使用端到端加密。复用服务端已有的二进制文件流，不新增协议或服务端能力要求。

更新原生客户端时，重新构建并安装应用。原生二进制帧解码和加解密依赖 `react-native-libsodium` 1.7.0，单独更新 JavaScript 无法加入这个原生模块。它与旧服务端的密文格式兼容，无需重启或升级 daemon、relay。网页与桌面客户端保持现有实现。原生解码也受应用构建的 SDK 补丁约束，见 [安卓构建要求](android.md#原生二进制接收)。接口依据：该版本发布包及 [libsodium secretbox 文档](https://libsodium.gitbook.io/doc/secret-key_cryptography/secretbox)。

下载与预览分开：预览继续限制文件大小，下载按块接收原始字节并检查完整长度。下载不设总时长或无进展超时，连接保持正常时，暂停后仍可继续接收。手动取消、连接断开或服务端报错会结束下载；传输过程中源文件变更会报错，重新下载即可。取消后立即停止本地写入并移除本次未完成文件。共享连接上的旧服务端文件流会继续发送，客户端丢弃剩余帧，不影响其他会话。下载失败保留错误提示；外部应用打开失败时，已下载的文件仍可分享。

安卓文件块入队后立即返回，由原生后台线程顺序写入，不在 JS 线程执行磁盘 I/O，也不逐块等待 Promise 回调。原生队列最多保留 8 MiB 和 64 块；存储长期阻塞导致队列超出限制时显式失败。取消先丢弃排队块，当前写入结束后关闭句柄、清理本次未完成文件；末帧之后仍在落盘时也能取消。末帧长度校验通过后，保存流程继续等待原生队列写完、关闭句柄，才发布缓存。进度界面每 200 ms 合并刷新，开始与最终进度立即展示；取消、完成或失败都会释放待刷新的进度。

原生文件句柄、文件检查与内容 URI 使用已锁定的 `expo-file-system` 19.0.21。SDK 54 的 `FileHandle.writeBytes` 同步执行；后台写入模块通过 `expo-modules-core` 3.0.29 的跨模块 `SharedRef<FileChannel>` 复用同一个句柄，避免依赖 SDK 的预编译/源码构建方式。安卓打开由本地 Expo 模块调用 [Intent.createChooser](<https://developer.android.com/reference/android/content/Intent#createChooser(android.content.Intent,%20java.lang.CharSequence)>)，将内容 URI 的读取授权传给所选应用；模块声明 [REQUEST_INSTALL_PACKAGES](https://developer.android.com/reference/android/Manifest.permission#REQUEST_INSTALL_PACKAGES)，否则系统安装器会直接关闭 APK 请求。接口依据：[Expo 文件 API](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/)、[Expo 模块 API](https://docs.expo.dev/modules/module-api/)及安装版本的原生实现。索引使用已锁定的 `@react-native-async-storage/async-storage` 2.2.0，`getItem` / `setItem` 依据安装版本的实现确认。客户端使用 [mime](https://github.com/broofa/mime) 4.1.0 的 `getType` 查询文件类型；旧服务端把 MP4 标为普通二进制时，客户端仍可向安卓播放器提供正确类型。未知扩展名保留服务端返回的类型。

平台限制见 [已知限制](known-limitations.md)。
