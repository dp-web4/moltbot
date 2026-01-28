# Web4 Governance Extension for Moltbot

Lightweight AI governance with R6 workflow formalism and audit trails.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This extension adds structured governance to Moltbot sessions:

- **R6 Workflow** - Every tool call follows a formal intent→action→result flow
- **Audit Trail** - Verifiable chain of actions with provenance
- **Session Identity** - Software-bound tokens for session tracking

No external dependencies. No network calls. Just structured, auditable AI actions.

## Installation

The extension is bundled with Moltbot. To enable it, configure in your Moltbot config:

```json
{
  "plugins": {
    "web4-governance": {
      "enabled": true,
      "auditLevel": "standard",
      "showR6Status": true,
      "actionBudget": null
    }
  }
}
```

## What It Does

### Every Tool Call Gets an R6 Record

The R6 framework captures structured intent:

```
R6 = Rules + Role + Request + Reference + Resource → Result
```

| Component | What It Captures |
|-----------|------------------|
| **Rules** | Preferences and constraints |
| **Role** | Session identity, action index |
| **Request** | Tool name, category, target |
| **Reference** | Chain position, previous R6 |
| **Resource** | (Optional) Estimated cost |
| **Result** | Status, output hash |

### Audit Trail with Provenance

Each action creates an audit record linked to its R6 request:

```json
{
  "record_id": "audit:f8e9a1b2",
  "r6_request_id": "r6:f8e9a1b2",
  "tool": "Edit",
  "category": "write",
  "target": "src/main.rs",
  "result": {
    "status": "success",
    "output_hash": "a1b2c3d4..."
  },
  "provenance": {
    "session_id": "abc123",
    "action_index": 47,
    "prev_record_hash": "..."
  }
}
```

Records form a hash-linked chain, enabling verification.

### Session Identity

Sessions get a software-bound token:

```
web4:session:a1b2c3d4
```

This is **not** hardware-bound (no TPM/Secure Enclave). Trust interpretation is up to the relying party. For hardware-bound identity and enterprise features, see the [Web4 project](https://github.com/dp-web4/web4).

## Commands

| Command | Description |
|---------|-------------|
| `/audit` | Show session audit summary |
| `/audit last 10` | Show last 10 actions |
| `/audit verify` | Verify chain integrity |
| `/audit export` | Export audit log |

## Configuration

Available configuration options:

```json
{
  "plugins": {
    "web4-governance": {
      "auditLevel": "standard",
      "showR6Status": true,
      "actionBudget": null
    }
  }
}
```

**auditLevel**:
- `minimal` - Just record, no output
- `standard` - Session start message
- `verbose` - Show each R6 request

**showR6Status**: Show session token on session start

**actionBudget**: Maximum number of actions (null = unlimited)

## Files

```
~/.moltbot/extensions/web4-governance/
├── preferences.json     # User preferences (optional)
├── sessions/            # Session state
│   └── {session_id}.json
├── audit/               # Audit records
│   └── {session_id}.jsonl
└── r6/                  # R6 request logs
    └── {date}.jsonl
```

## Why R6?

The R6 framework provides:

1. **Structured Intent** - Every action has documented purpose
2. **Audit Foundation** - Machine-readable action history
3. **Context Preservation** - Reference links maintain history
4. **Trust Basis** - Verifiable record for trust evaluation
5. **Policy Hook** - Rules component enables future enforcement

R6 is observational by default - it records, doesn't block. This makes it safe to deploy without disrupting workflows.

## Web4 Ecosystem

This extension implements a subset of the [Web4 trust infrastructure](https://github.com/dp-web4/web4):

| Concept | This Extension | Full Web4 |
|---------|----------------|-----------|
| Identity | Software token | LCT (hardware-bound) |
| Workflow | R6 framework | R6 + Policy enforcement |
| Audit | Hash-linked chain | Distributed ledger |
| Trust | (Relying party decides) | T3 Trust Tensor |

For enterprise features (hardware binding, team governance, policy enforcement), see the [Web4 project](https://github.com/dp-web4/web4).

## Contributing

Contributions welcome! This extension is MIT licensed.

Areas for contribution:
- Additional audit visualizations
- R6 analytics and insights
- Integration with external audit systems
- Performance optimizations

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [Web4 Project](https://github.com/dp-web4/web4)
- [Moltbot](https://github.com/moltbot/moltbot)
