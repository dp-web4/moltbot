# Policy Presets Reference

This document details exactly what each policy preset blocks, warns on, and allows.

## Overview

| Preset       | Default | Enforce | Use Case                                  |
| ------------ | ------- | ------- | ----------------------------------------- |
| `permissive` | allow   | false   | Pure observation, no blocking             |
| `safety`     | allow   | true    | Recommended for most users                |
| `strict`     | deny    | true    | High-security environments                |
| `audit-only` | allow   | false   | Testing rules before enabling enforcement |

---

## `permissive`

**Purpose**: Pure observation mode. Logs everything, blocks nothing.

| Action    | What       |
| --------- | ---------- |
| **Deny**  | Nothing    |
| **Warn**  | Nothing    |
| **Allow** | Everything |

**Rules**: None

**When to use**: Development, debugging, or when you want audit logs without any interference.

---

## `safety` (Recommended)

**Purpose**: Block dangerous operations while allowing normal development work.

### What Gets Denied

| Rule ID                     | Trigger                                    | Example Blocked                        |
| --------------------------- | ------------------------------------------ | -------------------------------------- |
| `deny-destructive-commands` | `rm -rf` or `mkfs.*` in Bash commands      | `rm -rf ./build`, `mkfs.ext4 /dev/sda` |
| `deny-secret-files`         | Reading files matching credential patterns | `.env`, `.aws/credentials`, `*.apikey` |

**Full list of blocked file patterns:**

- `**/.env`, `**/.env.*`
- `**/credentials.*`
- `**/*secret*`
- `**/.aws/credentials`
- `**/.ssh/id_*`
- `**/.netrc`, `**/.pgpass`
- `**/.npmrc`, `**/.pypirc`
- `**/token*.json`, `**/auth*.json`
- `**/*apikey*`

### What Gets Warned

| Rule ID             | Trigger                       | Example Flagged            |
| ------------------- | ----------------------------- | -------------------------- |
| `warn-memory-write` | Writing to agent memory files | `MEMORY.md`, `memory/*.md` |
| `warn-network`      | Any network access            | `WebFetch`, `WebSearch`    |

**Memory file patterns warned:**

- `**/MEMORY.md`, `**/memory.md`
- `**/memory/**/*.md`
- `**/.moltbot/**/memory*`
- `**/.clawdbot/**/memory*`
- `**/.openclaw/**/memory*`

### What Gets Allowed

Everything else, including:

- Normal file reads (source code, configs without credentials)
- Normal file writes (code, docs)
- Safe Bash commands (`ls`, `git`, `npm`, etc.)
- Task delegation to sub-agents

---

## `strict`

**Purpose**: Maximum security. Denies everything by default, only allows read-only operations.

### What Gets Denied

| Action           | What                              |
| ---------------- | --------------------------------- |
| **Default deny** | Everything not explicitly allowed |

This means:

- All Bash commands (including safe ones like `ls`)
- All file writes (`Write`, `Edit`, `NotebookEdit`)
- All network access (`WebFetch`, `WebSearch`)
- All Task delegation

### What Gets Allowed

| Rule ID            | Tools Allowed                       |
| ------------------ | ----------------------------------- |
| `allow-read-tools` | `Read`, `Glob`, `Grep`, `TodoWrite` |

**When to use**: High-security environments, compliance scenarios, or when you need strict control over what the agent can do.

---

## `audit-only`

**Purpose**: Same rules as `safety`, but enforcement is disabled (dry-run mode).

### Behavior

- Uses the exact same rules as `safety`
- Logs what **would** be blocked/warned
- Does **not** actually block anything

| What safety would... | audit-only does... |
| -------------------- | ------------------ |
| Deny                 | Logs "would deny"  |
| Warn                 | Logs warning       |
| Allow                | Allows             |

**When to use**: Testing policy rules before enabling `safety`, or when you want to see what would be blocked without actually blocking.

---

## Choosing a Preset

```
┌─────────────────────────────────────────────────────────────┐
│  Do you need to block dangerous operations?                 │
│                                                             │
│  NO ──────────────────────────┬──────────────────────────── │
│  │                            │                             │
│  │  Want audit logs?          │                             │
│  │  YES → permissive          │                             │
│  │  NO  → (no plugin needed)  │                             │
│                               │                             │
│  YES ─────────────────────────┼──────────────────────────── │
│                               │                             │
│  │  Maximum security?         │                             │
│  │  YES → strict              │                             │
│  │                            │                             │
│  │  NO ───────────────────────┘                             │
│  │                                                          │
│  │  Ready for enforcement?                                  │
│  │  YES → safety (recommended)                              │
│  │  NO  → audit-only (test first)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Custom Rules

All presets can be extended with custom rules. Custom rules are appended after preset rules and evaluated in priority order (lowest priority number wins).

```json
{
  "plugins": {
    "web4-governance": {
      "policy": {
        "preset": "safety",
        "rules": [
          {
            "id": "my-custom-rule",
            "name": "Block writes to production config",
            "priority": 1,
            "decision": "deny",
            "reason": "Production config is read-only",
            "match": {
              "categories": ["file_write"],
              "targetPatterns": ["**/config/production.*"]
            }
          }
        ]
      }
    }
  }
}
```

See [README.md](./README.md) for full rule schema documentation.
