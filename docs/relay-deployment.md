# 自托管 Paseo relay

relay 只转发客户端与开发机 daemon 之间的加密流量。Agent、工作目录和密钥仍留在开发机。使用独立的[官方 Elixir relay](https://github.com/getpaseo/paseo-relay)，部署参数以它的 README 和 OPERATIONS.md 为准。

## 示例部署

以下地址、账号与目录是占位示例，部署时替换为自己的配置。资源参数来自已验证的单节点部署，可按实际主机调整。

| 项目         | 值                                                            |
| ------------ | ------------------------------------------------------------- |
| SSH 服务器   | `relay-host`，用户 `relay-user`                               |
| 公网入口     | `ws://relay.example.com:10125/ws`                             |
| 服务目录     | `/srv/paseo-relay`                                            |
| 容器         | `paseo-relay`                                                 |
| 端口映射     | `0.0.0.0:10125 → 4000/tcp`                                    |
| 官方源码版本 | `3fc41c96c8c63f3a7109e832899cc57d473c4531`                    |
| 本地镜像标签 | `paseo-relay:3fc41c96c8c6`                                    |
| 恢复策略     | Docker 开机启动，容器 `unless-stopped`                        |
| 资源配置     | 1 CPU、768 MiB 内存；512 MiB 内存水位；最多 1000 个 WebSocket |
| TCP 接收缓冲 | 212992 字节（208 KiB），匹配当前 Linux 上限                   |
| 日志         | Docker `local` 驱动，10 MiB × 3 个文件                        |

示例为单节点部署，不提供节点故障切换。健康探针位于 `/health`，就绪探针位于 `/ready`，Prometheus 指标位于 `/metrics`。

## 开发机接入

把以下字段合并到目标开发机的 Paseo 配置中，保留已有的其他字段。`endpoint` 使用 `主机:端口`，不包含协议或 `/ws`。

```json
{
  "daemon": {
    "relay": {
      "enabled": true,
      "endpoint": "relay.example.com:10125",
      "publicEndpoint": "relay.example.com:10125",
      "useTls": false,
      "publicUseTls": false
    }
  }
}
```

relay 地址与 TLS 设置需要重启目标 daemon 后生效。已有 Agent 会受到重启影响；在合适时机完成重启，然后用 `paseo daemon pair --relay` 生成新的配对二维码，客户端会从二维码读取自托管入口。配置编辑和重载规则见 [配置说明](../public-docs/configuration.md#apply-changes)。

当前入口使用 `ws://`，Paseo 应用层的端到端加密仍然生效。通过 HTTPS 打开的网页版需要带受信任证书的 `wss://` 入口；浏览器会限制不安全连接。配置域名与 TLS 后同步更新 `publicEndpoint` 和 `publicUseTls`。参见 [浏览器混合内容规则](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)。

## 带宽与下载吞吐

若公网入口使用按流量计费的 EIP，200 Mbps 的带宽上限换算为 25 MB/秒。[阿里云说明](https://www.alibabacloud.com/help/en/ecs/user-guide/network-bandwidth)中，按流量计费的带宽是上限，不保证持续达到该值。远程下载还受开发机上行、客户端下行、链路时延、加解密和客户端写盘影响。

排查时分别测服务器本地转发和实际 Paseo 加密下载，后者应记录客户端平台与写入方式。服务器本地测速绕过了公网，只用于判断转发处理能力。

安卓 APK 下载慢时也要检查客户端版本。旧的 JavaScript 加解密会限制 Hermes 的处理吞吐；原生加解密版本需要重新安装 APK，更新要求见 [远端文件下载](file-downloads.md)。

当前 `PASEO_RELAY_TCP_RECEIVE_BUFFER_BYTES` 为 212992，匹配服务器的 `net.core.rmem_max`。设置 1 MiB 仍会被内核截断。服务器全局网络参数保持原值。

这项调整通过 [Erlang `inet:setopts`](https://www.erlang.org/doc/apps/kernel/inet.html#setopts/2) 在线应用到中继的监听套接字与现有连接，保留了原有连接。已有 TCP 连接的窗口缩放系数在握手时确定；客户端重新连接后才能重新协商，无需重启开发机 daemon。

Compose 环境变量负责后续容器重建。当前容器的 `/app/releases/0.1.0/env.sh` 也设置了相同值，保证直接重启这个容器时参数保留；重建后由 Compose 接管。启动环境脚本是 [Elixir release](https://hexdocs.pm/mix/Mix.Tasks.Release.html#module-vm-args-and-env-sh-env-bat) 的配置入口。

调整配置文件后直接运行 `docker compose up -d` 会重建容器并断开连接。[Ranch 的运行时配置接口](https://ninenines.eu/docs/en/ranch/2.2/manual/ranch.set_transport_options/)也不会立即应用 `socket_opts`，因此本次采用在线套接字调整。后续更改缓冲时先在临时实例验证，再执行在线操作或安排容器维护。

## 运维

```bash
ssh relay-user@relay-host 'cd /srv/paseo-relay && docker compose ps'
ssh relay-user@relay-host 'cd /srv/paseo-relay && docker compose logs --tail 100 relay'
curl --fail --connect-timeout 5 --max-time 10 http://relay.example.com:10125/ready
```

更新时保留旧镜像和旧 Compose 配置，加载新镜像、更新标签后执行 `docker compose up -d`。容器替换会断开已有连接；更新后复验 `/ready` 和真实加密连接。手动停止过的容器需再次执行 `docker compose up -d` 才会恢复自动启动。

本次缓冲调整的备份与 `rollback-buffer.sh` 位于服务目录。回滚脚本恢复当前套接字参数、启动环境和 Compose 文件，不执行重启。使用前确认仍是本次调整过的容器；镜像更新或容器重建后应依据当前部署重新制定回滚步骤。

镜像构建沿用官方 Dockerfile。本次将 Debian 运行时基础镜像固定到官方仓库摘要 `sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251`，原因是镜像加速源返回旧版本并导致软件源签名校验失败。服务器不依赖访问 GitHub 或 Docker Hub：构建好的镜像归档、Dockerfile 和 Compose 文件保留在服务目录中。
