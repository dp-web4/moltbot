# Event Stream API

Real-time monitoring endpoint for the Web4 Governance extension.

## Overview

The event stream provides a JSONL (JSON Lines) file that external clients can tail for real-time monitoring, alerting, and analytics.

**Stream Location**: `~/.openclaw/extensions/web4-governance/events.jsonl`

## Quick Start

### Tail the stream (real-time)

```bash
tail -f ~/.openclaw/extensions/web4-governance/events.jsonl | jq .
```

### Filter by severity

```bash
tail -f ~/.openclaw/extensions/web4-governance/events.jsonl | jq -c 'select(.severity == "alert")'
```

### Filter by event type

```bash
grep '"type":"policy_decision"' ~/.openclaw/extensions/web4-governance/events.jsonl | jq .
```

### Node.js consumer

```typescript
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const stream = createReadStream(
  `${process.env.HOME}/.openclaw/extensions/web4-governance/events.jsonl`,
);

const rl = createInterface({ input: stream });

rl.on("line", (line) => {
  const event = JSON.parse(line);
  if (event.severity === "alert") {
    console.log(`ALERT: ${event.reason}`);
  }
});
```

---

## Event Schema

Each line in the stream is a self-contained JSON object:

```json
{
  "type": "policy_decision",
  "timestamp": "2026-02-05T10:30:00.123Z",
  "severity": "alert",
  "sessionId": "sess-abc123",
  "tool": "Bash",
  "target": "rm -rf /tmp/test",
  "category": "command",
  "decision": "deny",
  "reason": "Destructive command blocked by safety preset",
  "ruleId": "deny-destructive-commands"
}
```

### Required Fields

| Field       | Type   | Description                                               |
| ----------- | ------ | --------------------------------------------------------- |
| `type`      | string | Event type (see Event Types below)                        |
| `timestamp` | string | ISO 8601 UTC timestamp                                    |
| `severity`  | string | Severity level: `debug`, `info`, `warn`, `alert`, `error` |

### Optional Context Fields

| Field       | Type   | Description           |
| ----------- | ------ | --------------------- |
| `sessionId` | string | Session identifier    |
| `agentId`   | string | Agent/role identifier |

### Event-Specific Fields

| Field      | Type   | Description                                                   |
| ---------- | ------ | ------------------------------------------------------------- |
| `tool`     | string | Tool name (Bash, Read, Edit, etc.)                            |
| `target`   | string | Target path, URL, or command                                  |
| `category` | string | Tool category (file_read, file_write, command, network, etc.) |
| `decision` | string | Policy decision: `allow`, `deny`, `warn`                      |
| `reason`   | string | Human-readable explanation                                    |
| `ruleId`   | string | ID of matched policy rule                                     |

### Metrics Fields

| Field        | Type   | Description                        |
| ------------ | ------ | ---------------------------------- |
| `durationMs` | number | Operation duration in milliseconds |
| `count`      | number | Generic count (rate limits, etc.)  |

### Trust Fields

| Field         | Type   | Description                         |
| ------------- | ------ | ----------------------------------- |
| `trustBefore` | number | Trust value before update (0.0-1.0) |
| `trustAfter`  | number | Trust value after update (0.0-1.0)  |
| `trustDelta`  | number | Change in trust value               |

### Error Fields

| Field       | Type   | Description      |
| ----------- | ------ | ---------------- |
| `error`     | string | Error message    |
| `errorType` | string | Error class/type |

### Extensible Metadata

| Field      | Type   | Description               |
| ---------- | ------ | ------------------------- |
| `metadata` | object | Additional key-value data |

---

## Event Types

### Session Lifecycle

| Type            | Severity | Description         |
| --------------- | -------- | ------------------- |
| `session_start` | info     | New session started |
| `session_end`   | info     | Session ended       |

**Example:**

```json
{
  "type": "session_start",
  "timestamp": "2026-02-05T10:00:00Z",
  "severity": "info",
  "sessionId": "sess-abc123",
  "metadata": { "project": "my-app", "atpBudget": 100 }
}
```

### Tool Execution

| Type          | Severity | Description             |
| ------------- | -------- | ----------------------- |
| `tool_call`   | info     | Tool invocation started |
| `tool_result` | info     | Tool completed          |

**Example:**

```json
{
  "type": "tool_call",
  "timestamp": "2026-02-05T10:01:00Z",
  "severity": "info",
  "sessionId": "sess-abc123",
  "tool": "Read",
  "target": "/app/src/main.ts",
  "category": "file_read"
}
```

### Policy Decisions

| Type               | Severity | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `policy_decision`  | varies   | Policy evaluated (info=allow, warn=warn, alert=deny) |
| `policy_violation` | alert    | Policy rule violated                                 |

**Example (deny):**

```json
{
  "type": "policy_decision",
  "timestamp": "2026-02-05T10:02:00Z",
  "severity": "alert",
  "sessionId": "sess-abc123",
  "tool": "Bash",
  "target": "rm -rf /",
  "decision": "deny",
  "reason": "Destructive command blocked by safety preset",
  "ruleId": "deny-destructive-commands"
}
```

**Example (warn):**

```json
{
  "type": "policy_decision",
  "timestamp": "2026-02-05T10:03:00Z",
  "severity": "warn",
  "sessionId": "sess-abc123",
  "tool": "Bash",
  "target": "rm temp.txt",
  "decision": "warn",
  "reason": "File deletion flagged - use with caution",
  "ruleId": "warn-file-delete"
}
```

### Rate Limiting

| Type                  | Severity | Description         |
| --------------------- | -------- | ------------------- |
| `rate_limit_check`    | debug    | Rate limit checked  |
| `rate_limit_exceeded` | alert    | Rate limit exceeded |

**Example:**

```json
{
  "type": "rate_limit_exceeded",
  "timestamp": "2026-02-05T10:04:00Z",
  "severity": "alert",
  "sessionId": "sess-abc123",
  "target": "ratelimit:bash:tool",
  "count": 6,
  "metadata": { "maxCount": 5 }
}
```

### Trust Updates

| Type           | Severity | Description               |
| -------------- | -------- | ------------------------- |
| `trust_update` | info     | Agent trust level changed |

**Example:**

```json
{
  "type": "trust_update",
  "timestamp": "2026-02-05T10:05:00Z",
  "severity": "info",
  "sessionId": "sess-abc123",
  "agentId": "code-reviewer",
  "trustBefore": 0.5,
  "trustAfter": 0.55,
  "trustDelta": 0.05,
  "reason": "Successful code review"
}
```

### Agent Lifecycle

| Type             | Severity | Description     |
| ---------------- | -------- | --------------- |
| `agent_spawn`    | info     | Agent spawned   |
| `agent_complete` | info     | Agent completed |

**Example:**

```json
{
  "type": "agent_spawn",
  "timestamp": "2026-02-05T10:06:00Z",
  "severity": "info",
  "sessionId": "sess-abc123",
  "agentId": "test-runner",
  "metadata": { "capabilities": { "canWrite": true, "canExecute": true } }
}
```

### Audit Events

| Type           | Severity | Description                                         |
| -------------- | -------- | --------------------------------------------------- |
| `audit_record` | info     | Standard audit record                               |
| `audit_alert`  | alert    | High-priority audit event (credential access, etc.) |

**Example (credential access alert):**

```json
{
  "type": "audit_alert",
  "timestamp": "2026-02-05T10:07:00Z",
  "severity": "alert",
  "sessionId": "sess-abc123",
  "tool": "Read",
  "target": "/home/user/.aws/credentials",
  "category": "credential_access",
  "reason": "Credential file access detected"
}
```

### System Events

| Type           | Severity | Description        |
| -------------- | -------- | ------------------ |
| `system_info`  | info     | System information |
| `system_error` | error    | System error       |

**Example:**

```json
{
  "type": "system_error",
  "timestamp": "2026-02-05T10:08:00Z",
  "severity": "error",
  "error": "Database connection failed",
  "errorType": "SqliteError"
}
```

---

## Severity Levels

| Level   | When Used                          | Action              |
| ------- | ---------------------------------- | ------------------- |
| `debug` | Verbose debugging                  | Usually filtered    |
| `info`  | Normal operations                  | Log/monitor         |
| `warn`  | Potential issues                   | Review              |
| `alert` | Security events, policy violations | Immediate attention |
| `error` | System errors                      | Investigate         |

---

## File Rotation

The stream file automatically rotates at 100MB:

- Current: `~/.openclaw/extensions/web4-governance/events.jsonl`
- Rotated: `~/.openclaw/extensions/web4-governance/events.jsonl.1`

Only one backup is kept. For long-term retention, configure an external log collector.

---

## Integration Examples

### Forward to syslog

```bash
tail -f ~/.openclaw/extensions/web4-governance/events.jsonl | while read line; do
  logger -t web4-governance "$line"
done
```

### Send alerts to Slack (Node.js)

```typescript
import { watch } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const WEBHOOK_URL = "https://hooks.slack.com/services/...";
const streamPath = `${process.env.HOME}/.openclaw/extensions/web4-governance/events.jsonl`;

// Tail and filter
let position = 0;

watch(streamPath, async () => {
  const stream = createReadStream(streamPath, { start: position });
  const rl = createInterface({ input: stream });

  for await (const line of rl) {
    position += Buffer.byteLength(line) + 1;
    const event = JSON.parse(line);

    if (event.severity === "alert") {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:warning: ${event.type}: ${event.reason}`,
        }),
      });
    }
  }
});
```

### Structured logging (JSON to stdout)

```bash
tail -f ~/.openclaw/extensions/web4-governance/events.jsonl | jq -c '{
  time: .timestamp,
  level: .severity,
  msg: .reason // .type,
  tool: .tool,
  session: .sessionId
}'
```

---

## TypeScript Usage

```typescript
import { EventStream, EventType, Severity } from "./event-stream.js";

// Custom location and minimum severity
const stream = new EventStream({
  storagePath: "~/.my-app/governance",
  filename: "audit-events.jsonl",
  minSeverity: Severity.Warn, // Only emit WARN and above
});

// Emit events
stream.emit({
  type: EventType.PolicyDecision,
  severity: Severity.Alert,
  sessionId: "sess-123",
  tool: "Bash",
  target: "rm -rf /",
  decision: "deny",
  reason: "Blocked destructive command",
});

// Convenience methods
stream.policyDecision("sess-123", "Read", "/app/.env", "deny", {
  reason: "Credential file access denied",
  ruleId: "deny-secret-files",
});

// Register callback for in-process handling
stream.registerCallback((event) => {
  if (event.severity === Severity.Alert) {
    console.error(`[ALERT] ${event.reason}`);
  }
});
```

---

## Best Practices

1. **Use `tail -f`** for real-time monitoring rather than polling
2. **Filter by severity** to reduce noise (`alert` for critical events)
3. **Use `jq`** for ad-hoc queries and formatting
4. **Configure external log rotation** for long-term retention
5. **Register callbacks** for in-process alerting (low latency)

---

## Version History

| Version | Changes                  |
| ------- | ------------------------ |
| 0.4.0   | Initial event stream API |
