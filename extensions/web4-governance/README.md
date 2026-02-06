# web4-governance

**Security-first governance for AI agent tool execution.** Audit trails, policy gating, credential protection, and cryptographic non-repudiation for moltbot agent sessions.

## Why This Exists

AI agents executing tools (file access, shell commands, network requests) need accountability and safety guardrails:

- **Audit everything**: Every tool call is recorded in a tamper-evident hash chain
- **Block dangerous operations**: Policy rules can deny destructive commands, secret file access
- **Detect credential exfiltration**: Automatic alerting when agents access `.env`, API keys, SSH keys
- **Prevent memory poisoning**: Warn/block writes to agent memory files
- **Cryptographic proof**: Ed25519 signatures on audit records for non-repudiation
- **Time-based policies**: Restrict operations to business hours

## Installation

### Quick Install

```bash
# Clone the repo
git clone https://github.com/dp-web4/moltbot.git
cd moltbot

# Install the plugin
openclaw plugins install ./extensions/web4-governance

# Set security level (recommended: safety)
openclaw config set plugins.web4-governance.policy.preset safety

# Restart to activate
openclaw gateway restart
```

### Alternative: Download Release

```bash
# Download the latest release
curl -L https://github.com/dp-web4/moltbot/releases/latest/download/web4-governance.tgz -o web4-governance.tgz

# Install
openclaw plugins install ./web4-governance.tgz
```

### Verify Installation

```bash
openclaw plugins list
# Should show: web4-governance  loaded

openclaw policy test Bash "rm -rf /"
# Should show: Decision: deny
```

For detailed instructions, see [INSTALL.md](./INSTALL.md).

## Quick Start

Choose your security level:

| If you want...                  | Use this preset |
| ------------------------------- | --------------- |
| Full protection (recommended)   | `safety`        |
| Audit only, no blocking         | `permissive`    |
| Maximum security, default-deny  | `strict`        |
| Record everything, dry-run mode | `audit-only`    |

Add to your config:

```json
{
  "plugins": {
    "web4-governance": {
      "policy": { "preset": "safety" }
    }
  }
}
```

That's it! The plugin will now:

- Block dangerous commands (`rm -rf`, etc.)
- Block access to secret files (`.env`, credentials)
- Warn on network access and memory file writes
- Create a signed audit trail of all agent actions

## Features

### Core Capabilities

| Feature                | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| **R6 Audit Chain**     | Every tool call becomes a structured R6 record with hash-linked provenance |
| **Policy Engine**      | Pre-execution rules with allow/deny/warn decisions                         |
| **Session Identity**   | Soft LCT (Linked Context Token) for session tracking                       |
| **Ed25519 Signatures** | Cryptographic signing of audit records                                     |
| **SQLite Persistence** | Rate limits survive process restarts                                       |

### Security Features

| Feature                          | Description                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| **Credential Detection**         | Alerts on access to `.env`, `.aws/credentials`, SSH keys, API tokens |
| **Memory Protection**            | Warns on writes to `MEMORY.md` and agent memory files                |
| **Destructive Command Blocking** | Denies `rm -rf`, `mkfs.*`, and other dangerous commands              |
| **Multi-target Extraction**      | Detects all file paths in bash commands and Task prompts             |
| **ReDoS Protection**             | Validates regex patterns to prevent denial-of-service                |
| **Temporal Constraints**         | Rules that only apply during certain hours/days                      |

### Policy Presets

| Preset       | Default | Enforce | Key Rules                                                         |
| ------------ | ------- | ------- | ----------------------------------------------------------------- |
| `permissive` | allow   | false   | No blocking, audit only                                           |
| `safety`     | allow   | true    | Block destructive commands + secret files, warn on network/memory |
| `strict`     | deny    | true    | Default deny, explicit allowlist required                         |
| `audit-only` | allow   | false   | Record everything, block nothing                                  |

## Configuration

```json
{
  "plugins": {
    "web4-governance": {
      "auditLevel": "standard",
      "storagePath": "~/.moltbot/extensions/web4-governance/",
      "policy": {
        "preset": "safety",
        "rules": []
      }
    }
  }
}
```

| Field            | Type                             | Default          | Description                     |
| ---------------- | -------------------------------- | ---------------- | ------------------------------- |
| `auditLevel`     | `minimal \| standard \| verbose` | `standard`       | Audit detail level              |
| `storagePath`    | `string`                         | `~/.moltbot/...` | Storage directory               |
| `policy.preset`  | `string`                         | `safety`         | Base policy preset              |
| `policy.rules`   | `PolicyRule[]`                   | `[]`             | Additional custom rules         |
| `policy.enforce` | `boolean`                        | `true`           | Block on deny (false = dry-run) |

## Policy Rules

Rules are evaluated in priority order (ascending). First match wins.

### Rule Schema

```json
{
  "id": "deny-secrets",
  "name": "Block reading secret files",
  "priority": 5,
  "decision": "deny",
  "reason": "Secret file access denied",
  "match": {
    "categories": ["file_read", "credential_access"],
    "targetPatterns": ["**/.env", "**/.env.*", "**/credentials.*"],
    "timeWindow": {
      "allowedHours": [9, 17],
      "allowedDays": [1, 2, 3, 4, 5],
      "timezone": "America/New_York"
    },
    "rateLimit": {
      "maxCount": 10,
      "windowMs": 60000
    }
  }
}
```

### Match Criteria

| Field            | Type       | Description                                                                                        |
| ---------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `tools`          | `string[]` | Tool names: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `Task`, etc.              |
| `categories`     | `string[]` | `file_read`, `file_write`, `credential_access`, `command`, `network`, `delegation`, `state`, `mcp` |
| `targetPatterns` | `string[]` | Glob patterns (or regex if `targetPatternsAreRegex: true`)                                         |
| `timeWindow`     | `object`   | Temporal constraint: `allowedHours`, `allowedDays`, `timezone`                                     |
| `rateLimit`      | `object`   | Rate limit: `maxCount` actions per `windowMs` milliseconds                                         |

### Tool Categories

| Category            | Tools                     | Description                |
| ------------------- | ------------------------- | -------------------------- |
| `file_read`         | Read, Glob, Grep          | Reading file contents      |
| `file_write`        | Write, Edit, NotebookEdit | Modifying files            |
| `credential_access` | (auto-detected)           | Access to credential files |
| `command`           | Bash                      | Shell command execution    |
| `network`           | WebFetch, WebSearch       | Network requests           |
| `delegation`        | Task                      | Spawning sub-agents        |
| `state`             | TodoWrite                 | State modifications        |

## CLI Commands

### Audit Commands

```bash
moltbot audit summary                    # Session stats
moltbot audit verify [sessionId]         # Verify chain + signatures
moltbot audit last [count]               # Last N records
moltbot audit query --tool Bash --since 1h  # Filter records
moltbot audit report [--json]            # Aggregated report
```

### Policy Commands

```bash
moltbot policy status                    # Engine status
moltbot policy rules                     # List rules in order
moltbot policy test <tool> [target]      # Dry-run evaluation
moltbot policy presets                   # List available presets
moltbot policy entities                  # Show policy trust graph
```

### Example: Test Policy

```bash
$ moltbot policy test Bash "rm -rf /tmp"
Tool:       Bash
Category:   command
Target:     rm -rf /tmp
Decision:   deny
Enforced:   true
Reason:     Destructive command blocked by safety policy
Rule:       deny-destructive-commands (priority 1)
```

## Storage Layout

```
~/.moltbot/extensions/web4-governance/
├── audit/
│   └── <sessionId>.jsonl      # Signed, hash-linked audit records
├── sessions/
│   └── <sessionId>.json       # Session state + signing keys
├── data/
│   └── rate-limits.db         # SQLite persistent rate limits
└── witnesses.jsonl            # Policy witnessing graph
```

## Architecture

### Hook Flow

```
Tool Call
    │
    ▼
┌─────────────────────────────┐
│ before_tool_call            │
│ • Extract targets           │
│ • Check credentials/memory  │  → Alert if sensitive
│ • Evaluate policy rules     │  → Block if denied
│ • Check time window         │
│ • Check rate limit          │
└─────────────────────────────┘
    │
    ▼ (if allowed)
┌─────────────────────────────┐
│ Tool Execution              │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ after_tool_call             │
│ • Create R6 record          │
│ • Sign with Ed25519         │
│ • Append to hash chain      │
│ • Update rate limits        │
│ • Witness policy decision   │
└─────────────────────────────┘
```

### R6 Record Structure

| Field         | Content                                           |
| ------------- | ------------------------------------------------- |
| **Rules**     | Audit level, policy constraints, policy entity ID |
| **Role**      | Session ID, agent ID, action index                |
| **Request**   | Tool name, category, target(s), input hash        |
| **Reference** | Previous R6 ID, chain position                    |
| **Resource**  | Approval flags                                    |
| **Result**    | Status, output hash, duration, error              |
| **Signature** | Ed25519 signature + key ID                        |

### Signature Verification

Each session generates a unique Ed25519 keypair. Records are signed before the signature field is added, ensuring the signature covers all content. Verify with:

```bash
moltbot audit verify <sessionId>
# Output: Chain valid: true, Signatures: 42 signed, 42 verified, 0 invalid
```

## Security Considerations

### What This Protects Against

- **Credential exfiltration**: Detects and alerts on access to secret files
- **Memory poisoning**: Warns when agents write to their own memory files
- **Destructive commands**: Blocks `rm -rf`, `mkfs.*`, system modifications
- **Audit tampering**: Hash chain + signatures make tampering detectable
- **Rate limit bypass**: SQLite persistence survives restarts

### What This Does NOT Protect Against

- **Root access**: If attacker has root, they can modify anything
- **Key theft**: Private signing keys are stored in session state files
- **Determined insider**: Someone with file access could delete audit files
- **Real-time exfiltration**: Detection is logging, not prevention (for credentials)

### Recommended Deployment

1. Use `safety` or `strict` preset
2. Set `enforce: true` in production
3. Monitor `[web4-alert]` log messages
4. Periodically run `moltbot audit verify` to check chain integrity
5. Back up audit files to immutable storage for forensics

## Development

```bash
# Run tests
pnpm test extensions/web4-governance/

# Type check
pnpm build

# Test policy manually
moltbot policy test Bash "cat /etc/passwd"
moltbot policy test Read ".env"
```

## Implementation Status

| Phase | Feature                       | Status  |
| ----- | ----------------------------- | ------- |
| 1     | R6 audit chain, hash linking  | Done    |
| 1     | Session identity (Soft LCT)   | Done    |
| 1     | Policy engine with presets    | Done    |
| 1     | Credential access alerting    | Done    |
| 1     | Memory protection rules       | Done    |
| 1     | ReDoS pattern validation      | Done    |
| 2     | Ed25519 audit signatures      | Done    |
| 2     | SQLite persistent rate limits | Done    |
| 3     | Multi-target extraction       | Done    |
| 3     | Policy witnessing persistence | Done    |
| 3     | Temporal constraints          | Done    |
| —     | Hardware-bound LCT (Tier 2)   | Planned |
| —     | T3 trust tensors              | Planned |
| —     | ATP economics                 | Planned |

## License

Part of the moltbot project. See repository root for license.
