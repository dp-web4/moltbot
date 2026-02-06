# Web4 Governance Plugin — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        web4-governance                               │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Policy     │  │   Audit      │  │   Session    │              │
│  │   Engine     │  │   Chain      │  │   Store      │              │
│  │              │  │              │  │              │              │
│  │ • Rules      │  │ • R6 Records │  │ • LCT Token  │              │
│  │ • Presets    │  │ • Hash Links │  │ • Counters   │              │
│  │ • Time/Rate  │  │ • Signatures │  │ • Sign Keys  │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│  ┌──────┴─────────────────┴─────────────────┴───────┐              │
│  │                   index.ts                        │              │
│  │  before_tool_call → Policy Check → Block/Allow   │              │
│  │  after_tool_call  → R6 Record → Sign → Persist   │              │
│  └──────────────────────────────────────────────────┘              │
│                              │                                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ hooks
┌──────────────────────────────┼──────────────────────────────────────┐
│                    Moltbot Agent Runtime                            │
│              pi-tools.hooks.ts (tool execution)                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Policy Engine (`src/policy.ts`, `src/policy-types.ts`)

Evaluates tool calls against configurable rules before execution.

```typescript
interface PolicyRule {
  id: string;
  name: string;
  priority: number; // Lower = evaluated first
  decision: "allow" | "deny" | "warn";
  reason?: string;
  match: PolicyMatch;
}

interface PolicyMatch {
  tools?: string[]; // Tool name filter
  categories?: string[]; // Category filter
  targetPatterns?: string[]; // Glob/regex patterns
  targetPatternsAreRegex?: boolean;
  rateLimit?: RateLimitSpec;
  timeWindow?: TimeWindow;
}
```

**Evaluation flow:**

1. Sort rules by priority (ascending)
2. For each rule, check all match criteria (AND logic)
3. First matching rule determines decision
4. If no match, use `defaultPolicy`

### Policy Presets (`src/presets.ts`)

Pre-configured rule sets for common use cases:

| Preset       | Purpose                                |
| ------------ | -------------------------------------- |
| `permissive` | Audit only, no blocking                |
| `safety`     | Block dangerous ops, warn on sensitive |
| `strict`     | Default deny, explicit allowlist       |
| `audit-only` | Record everything, dry-run mode        |

### Audit Chain (`src/audit.ts`)

Hash-linked append-only log with Ed25519 signatures.

```typescript
interface AuditRecord {
  recordId: string;
  r6RequestId: string;
  timestamp: string;
  tool: string;
  category: string;
  target?: string;
  targets?: string[]; // Multi-file operations
  result: {
    status: "success" | "error" | "blocked";
    outputHash?: string;
    errorMessage?: string;
    durationMs?: number;
  };
  provenance: {
    sessionId: string;
    actionIndex: number;
    prevRecordHash: string; // SHA-256 of previous line
  };
  signature?: string; // Ed25519 signature (hex)
  signingKeyId?: string; // Key identifier
}
```

**Integrity guarantees:**

- Each record includes hash of previous record
- Genesis record has `prevRecordHash: "genesis"`
- Ed25519 signature covers record content (excluding signature fields)
- Tampering breaks hash chain OR invalidates signatures

### Signing (`src/signing.ts`)

Ed25519 cryptographic signatures for audit records.

```typescript
// Key generation (per session)
const { privateKeyHex, publicKeyHex, keyId } = generateSigningKeyPair();

// Signing (before writing to chain)
const signature = signData(JSON.stringify(record), privateKeyHex);

// Verification (during audit verify)
const valid = verifySignature(recordData, signature, publicKeyHex);
```

Keys are stored in session state and used for all records in that session.

### Rate Limiter (`src/rate-limiter.ts`, `src/persistent-rate-limiter.ts`)

Sliding window counters for rate-based rules.

**Memory-only (`RateLimiter`):**

- Fast, no I/O
- Resets on restart

**Persistent (`PersistentRateLimiter`):**

- SQLite WAL mode
- Survives restarts
- Graceful fallback if SQLite unavailable

### Session State (`src/session-state.ts`)

Per-session metadata:

```typescript
interface SessionState {
  sessionId: string;
  lct: SoftLCTToken; // Session identity
  actionIndex: number; // Auto-incrementing counter
  lastR6Id?: string;
  startedAt: string;
  toolCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  policyEntityId?: string;
  signingPrivateKeyHex?: string;
  signingPublicKeyHex?: string;
  signingKeyId?: string;
}
```

### R6 Framework (`src/r6.ts`)

Structured request format for tool calls:

```
R6 = Rules + Role + Request + Reference + Resource → Result
```

**Target extraction:**

- `extractTarget()`: Primary target (file path, command, URL)
- `extractTargets()`: All targets (multi-file ops, bash commands)
- `isCredentialTarget()`: Detects `.env`, credentials, API keys
- `isMemoryTarget()`: Detects agent memory files

### Policy Entity (`src/policy-entity.ts`)

Policies as first-class trust network participants.

```typescript
interface PolicyEntity {
  entityId: PolicyEntityId; // policy:<name>:<version>:<hash>
  contentHash: string; // SHA-256 of config
  config: PolicyConfig;
}
```

**Witnessing:**

- Sessions witness operating under a policy
- Policies witness session decisions
- Relationships persisted to `witnesses.jsonl`

### Matchers (`src/matchers.ts`)

Pattern matching utilities:

- `globToRegex()`: Convert glob to regex
- `matchesRule()`: Check tool call against rule criteria
- `matchesTimeWindow()`: Check temporal constraints
- `validateRegexPattern()`: ReDoS protection

## Data Flow

### before_tool_call

```
1. Extract target from params
2. Extract all targets (multi-file detection)
3. Check credential patterns → Alert if match
4. Check memory patterns → Alert if write
5. If policy engine has rules:
   a. Classify tool (may upgrade to credential_access)
   b. Evaluate rules in priority order
   c. Check time window constraints
   d. Check rate limits
   e. Return block/allow decision
```

### after_tool_call

```
1. Get session state (create if needed)
2. Create R6 request with targets
3. Add policy constraints from stashed evaluation
4. Build audit record
5. Sign record with session key
6. Append to hash chain
7. Update session counters
8. Record rate limit action
9. Persist witnessing relationship
```

## Storage

```
~/.moltbot/extensions/web4-governance/
├── audit/
│   └── {sessionId}.jsonl     # Audit records (append-only)
├── sessions/
│   └── {sessionId}.json      # Session state (overwritten)
├── data/
│   └── rate-limits.db        # SQLite (WAL mode)
└── witnesses.jsonl           # Witnessing graph (append-only)
```

## Security Model

### Threat Model

| Threat            | Mitigation                            |
| ----------------- | ------------------------------------- |
| Audit tampering   | Hash chain + signatures               |
| Replay attacks    | Session-scoped keys, action index     |
| Credential theft  | Detection + alerting (not prevention) |
| Memory poisoning  | Warn/block on memory file writes      |
| Rate limit bypass | SQLite persistence                    |
| ReDoS attacks     | Pattern validation at rule load       |

### Trust Boundaries

1. **Trusted**: Plugin code, moltbot runtime
2. **Semi-trusted**: Policy configuration (validated)
3. **Untrusted**: Tool parameters, external input

### Key Management

- Each session generates unique Ed25519 keypair
- Private key stored in session state (file-system protected)
- Public key used for verification
- No key rotation (session-scoped)

## Extension Points

### Adding New Tool Categories

1. Update `TOOL_CATEGORIES` in `src/r6.ts`
2. Add detection patterns if needed
3. Update category documentation

### Adding New Presets

1. Add rule array in `src/presets.ts`
2. Register in `PRESETS` map
3. Document in README

### Custom Rate Limit Keys

Rate limit keys are built from rule context:

- Tool-specific: `ratelimit:{ruleId}:tool:{toolName}`
- Category-specific: `ratelimit:{ruleId}:category:{category}`
- Global: `ratelimit:{ruleId}:global`

## Upgrade Path to Tier 2 (Hardbound)

| Component | Tier 1 (Current)    | Tier 2 (Hardbound)    |
| --------- | ------------------- | --------------------- |
| Identity  | Soft LCT (software) | Hardware LCT (TPM/SE) |
| Policy    | Rule-based          | T3 trust tensors      |
| Economics | None                | ATP allocation        |
| Signing   | Ed25519 (software)  | Hardware-backed       |
| Storage   | Local files         | Distributed ledger    |

The plugin interface remains compatible — policy evaluation becomes richer.
