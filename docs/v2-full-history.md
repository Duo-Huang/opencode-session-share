# V2 完整历史分享方案

第一版 `/share` 只分享 **active context**：`ctx.session.context` 返回最后一次 compaction 之后的活跃消息。v1 的 share 则做了完整 `session.messages` 同步，因此第一版与 v1 的“完整历史”有差异。

本文给出后续实现完整历史的可选路径，供第二版决策。

## 1. 先定义“完整历史”

```text
完整历史：
u1 a1 tool1 ... u50 a50 | compaction summary | u51 a51 ... u60 a60

active context：
compaction summary | u51 a51 ... u60 a60
```

- 完整历史包含 compaction 之前的原始消息、工具调用和工具输出；
- active context 只包含模型当前实际看到的窗口；
- 两者在未 compaction 的 session 上相同。

## 2. V2 可用数据源

### A. HTTP `session.export`（推荐优先验证）

V2 HTTP API 有：

```text
GET /api/experimental/session/{sessionID}/export?sanitize=true|false
```

返回 `SessionTransfer.Data`：`{ info, messages }`，包含完整投影消息。

问题：`@opencode/plugin` 2.1.4 的 server plugin context 里 `SessionDomain` 是 `Pick<SessionApi, ...>`，**没有暴露 `export`**。

可行做法：

1. server plugin 通过 `@opencode/client` 的 `Service.discover()` 找到当前本地服务；
2. 用 `Service.headers(endpoint)` 构造认证 headers；
3. `OpenCode.make({ baseUrl, headers })` 后调用 `client.session.export({ sessionID })`。

风险：

- `Service.discover()` 在 server plugin 进程内是否稳定可用，需要实测；
- 不是插件公开承诺，升级可能变；
- 需要处理服务重启/认证变化。

这是最接近 v1 full sync 的方式，建议第二版先做 spike。

### B. 从 `/share` 开始自己累积事件

server plugin 已经订阅 `ctx.event.subscribe`，可以把 `session.message.content.updated`、`session.text.*`、`session.tool.*`、`session.compaction.*` 等事件累积成完整 transcript。

优点：不依赖未公开 API。  
缺点：只能覆盖分享之后的事件，**无法补回 `/share` 之前的 compaction 历史**；除非用户从 session 创建时就开启录制。

### C. 直接读本地 DB

V2 的 session 数据在本地 SQLite。技术上可读，但：

- 表结构/事件投影会随版本变化；
- 与运行中的 server 并发/锁；
- 容易绕过 OpenCode 的投影/脱敏逻辑。

不建议。

### D. 推动上游暴露 `session.export`

最干净：给 `@opencode/plugin` 的 `SessionDomain` 增加 `export` 或一个 `session.transcript()` 方法。  
在 upstream 提供前，A 是临时方案。

## 3. 推荐路线

1. **第二版先做 A 的 spike**：在 server plugin 里用 `Service.discover()` + `client.session.export` 读取完整 transcript，和 `ctx.session.context` 对比。
2. 如果 A 稳定：`/share` 创建时用 export 生成完整快照；live sync 仍可用 active context（或 export 定期校正）。
3. 如果 A 不稳定：退回 B，并在 README 明确“只录制分享后的完整历史”，不冒充 v1。
4. 同步向上游提 feature request，长期目标是 D。

## 4. 数据/性能差异

- 完整历史可能包含大量工具输出，payload 显著变大；
- 服务端需要更高 `SHARE_MAX_BYTES` 或分页/分块；
- 页面初始渲染需要虚拟列表或按段加载；
- 1 天过期/撤销流程不变；
- SQLite 仍可存 gzip JSON，但建议加 `payload_version`/`full_history` 标记。

## 5. 安全

完整历史会包含更多 compaction 之前的工具输出、密钥、路径。必须：

- 保持现有路径/ANSI/控制字符清洗；
- 增加密钥扫描/脱敏选项；
- 页面宣传语改为“完整历史”，而不是 active context；
- 撤销/过期仍执行同样的物理清空 + CDN purge。

## 6. 测试

- 无 compaction session：完整历史与 active context 一致；
- 有 compaction session：导出包含 1..N 原始消息；
- 大工具输出：大小限制/截断/页面性能；
- export 调用失败：回退 active context 并显示提示；
- 撤销后完整历史同样 410、WS 关闭、DB 清空。
