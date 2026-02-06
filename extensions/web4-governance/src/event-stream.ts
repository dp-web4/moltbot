/**
 * Event Stream for Real-Time Monitoring.
 *
 * Provides a JSONL-based event stream that external clients can consume
 * for real-time monitoring, alerting, and analytics.
 *
 * Stream Location: ~/.openclaw/extensions/web4-governance/events.jsonl
 *
 * Usage:
 *   import { EventStream, EventType, Severity } from "./event-stream.js";
 *
 *   const stream = new EventStream();
 *   stream.emit({
 *     type: EventType.PolicyDecision,
 *     severity: Severity.Alert,
 *     sessionId: "sess-123",
 *     tool: "Bash",
 *     target: "rm -rf /tmp/test",
 *     decision: "deny",
 *     reason: "Destructive command blocked"
 *   });
 *
 * Consuming the stream:
 *   tail -f ~/.openclaw/extensions/web4-governance/events.jsonl | jq .
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Event types emitted by the governance system */
export const EventType = {
  // Session lifecycle
  SessionStart: "session_start",
  SessionEnd: "session_end",

  // Tool execution
  ToolCall: "tool_call",
  ToolResult: "tool_result",

  // Policy decisions
  PolicyDecision: "policy_decision",
  PolicyViolation: "policy_violation",

  // Rate limiting
  RateLimitCheck: "rate_limit_check",
  RateLimitExceeded: "rate_limit_exceeded",

  // Trust updates
  TrustUpdate: "trust_update",

  // Agent lifecycle
  AgentSpawn: "agent_spawn",
  AgentComplete: "agent_complete",

  // Audit
  AuditRecord: "audit_record",
  AuditAlert: "audit_alert",

  // System
  SystemInfo: "system_info",
  SystemError: "system_error",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** Event severity levels */
export const Severity = {
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Alert: "alert",
  Error: "error",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

/** Standard event structure for the monitoring stream */
export type Event = {
  // Required fields
  type: EventType;
  timestamp: string;
  severity: Severity;

  // Context fields (optional but recommended)
  sessionId?: string;
  agentId?: string;

  // Event-specific payload
  tool?: string;
  target?: string;
  category?: string;
  decision?: string;
  reason?: string;
  ruleId?: string;

  // Metrics (optional)
  durationMs?: number;
  count?: number;

  // Trust (optional)
  trustBefore?: number;
  trustAfter?: number;
  trustDelta?: number;

  // Error details (optional)
  error?: string;
  errorType?: string;

  // Extensible metadata
  metadata?: Record<string, unknown>;
};

/** Event callback type */
export type EventCallback = (event: Event) => void;

/** Severity ordering for filtering */
const SEVERITY_ORDER: Record<Severity, number> = {
  [Severity.Debug]: 0,
  [Severity.Info]: 1,
  [Severity.Warn]: 2,
  [Severity.Alert]: 3,
  [Severity.Error]: 4,
};

export type EventStreamOptions = {
  /** Base directory for stream file (default: ~/.openclaw/extensions/web4-governance) */
  storagePath?: string;
  /** Stream filename (default: events.jsonl) */
  filename?: string;
  /** Minimum severity to emit (default: info) */
  minSeverity?: Severity;
};

/**
 * JSONL event stream for real-time monitoring.
 *
 * Writes events to a file that external clients can tail.
 * Supports optional in-process callbacks for direct integration.
 */
export class EventStream {
  private storagePath: string;
  private streamFile: string;
  private minSeverity: Severity;
  private callbacks: EventCallback[] = [];

  static readonly DEFAULT_FILENAME = "events.jsonl";
  static readonly MAX_FILE_SIZE_MB = 100;

  constructor(options: EventStreamOptions = {}) {
    this.storagePath =
      options.storagePath ?? join(homedir(), ".openclaw", "extensions", "web4-governance");
    this.streamFile = join(this.storagePath, options.filename ?? EventStream.DEFAULT_FILENAME);
    this.minSeverity = options.minSeverity ?? Severity.Info;

    // Ensure storage directory exists
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /** Get the full path to the stream file */
  get streamPath(): string {
    return this.streamFile;
  }

  /** Register an in-process callback for events */
  registerCallback(callback: EventCallback): void {
    this.callbacks.push(callback);
  }

  /** Unregister an in-process callback */
  unregisterCallback(callback: EventCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  private shouldEmit(severity: Severity): boolean {
    return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[this.minSeverity];
  }

  private checkRotation(): void {
    try {
      if (existsSync(this.streamFile)) {
        const stats = statSync(this.streamFile);
        const sizeMb = stats.size / (1024 * 1024);
        if (sizeMb >= EventStream.MAX_FILE_SIZE_MB) {
          const rotated = this.streamFile + ".1";
          if (existsSync(rotated)) {
            unlinkSync(rotated);
          }
          renameSync(this.streamFile, rotated);
        }
      }
    } catch {
      // Best effort rotation
    }
  }

  private serializeEvent(event: Event): string {
    // Remove undefined values for cleaner JSON
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (value !== undefined && value !== null) {
        if (typeof value === "object" && Object.keys(value as object).length === 0) {
          continue; // Skip empty objects
        }
        clean[key] = value;
      }
    }
    return JSON.stringify(clean);
  }

  /** Emit an event to the stream */
  emit(event: Omit<Event, "timestamp"> & { timestamp?: string }): Event | undefined {
    if (!this.shouldEmit(event.severity)) {
      return undefined;
    }

    const fullEvent: Event = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    // Calculate trust delta if both values provided
    if (fullEvent.trustBefore !== undefined && fullEvent.trustAfter !== undefined) {
      fullEvent.trustDelta = fullEvent.trustAfter - fullEvent.trustBefore;
    }

    this.writeEvent(fullEvent);
    this.notifyCallbacks(fullEvent);

    return fullEvent;
  }

  private writeEvent(event: Event): void {
    this.checkRotation();
    try {
      appendFileSync(this.streamFile, this.serializeEvent(event) + "\n", "utf-8");
    } catch (error) {
      console.error("[web4-event-stream] Write error:", error);
    }
  }

  private notifyCallbacks(event: Event): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch {
        // Don't let callback errors break the stream
      }
    }
  }

  // Convenience methods for common event types

  /** Emit session start event */
  sessionStart(sessionId: string, metadata?: Record<string, unknown>): Event | undefined {
    return this.emit({
      type: EventType.SessionStart,
      severity: Severity.Info,
      sessionId,
      metadata,
    });
  }

  /** Emit session end event */
  sessionEnd(
    sessionId: string,
    durationMs?: number,
    metadata?: Record<string, unknown>,
  ): Event | undefined {
    return this.emit({
      type: EventType.SessionEnd,
      severity: Severity.Info,
      sessionId,
      durationMs,
      metadata,
    });
  }

  /** Emit policy decision event */
  policyDecision(
    sessionId: string,
    tool: string,
    target: string | undefined,
    decision: string,
    options?: {
      reason?: string;
      ruleId?: string;
      category?: string;
    },
  ): Event | undefined {
    // Determine severity based on decision
    let severity: Severity;
    if (decision === "deny") {
      severity = Severity.Alert;
    } else if (decision === "warn") {
      severity = Severity.Warn;
    } else {
      severity = Severity.Info;
    }

    return this.emit({
      type: EventType.PolicyDecision,
      severity,
      sessionId,
      tool,
      target,
      decision,
      reason: options?.reason,
      ruleId: options?.ruleId,
      category: options?.category,
    });
  }

  /** Emit rate limit exceeded event */
  rateLimitExceeded(
    sessionId: string,
    key: string,
    count: number,
    maxCount: number,
  ): Event | undefined {
    return this.emit({
      type: EventType.RateLimitExceeded,
      severity: Severity.Alert,
      sessionId,
      target: key,
      count,
      metadata: { maxCount },
    });
  }

  /** Emit trust update event */
  trustUpdate(
    sessionId: string,
    agentId: string,
    trustBefore: number,
    trustAfter: number,
    reason?: string,
  ): Event | undefined {
    return this.emit({
      type: EventType.TrustUpdate,
      severity: Severity.Info,
      sessionId,
      agentId,
      trustBefore,
      trustAfter,
      reason,
    });
  }

  /** Emit audit alert (credential access, memory write, etc.) */
  auditAlert(
    sessionId: string,
    tool: string,
    target: string | undefined,
    reason: string,
    category?: string,
  ): Event | undefined {
    return this.emit({
      type: EventType.AuditAlert,
      severity: Severity.Alert,
      sessionId,
      tool,
      target,
      reason,
      category,
    });
  }

  /** Emit system error event */
  systemError(error: string, errorType?: string, sessionId?: string): Event | undefined {
    return this.emit({
      type: EventType.SystemError,
      severity: Severity.Error,
      sessionId,
      error,
      errorType,
    });
  }
}

// Module-level default stream instance
let defaultStream: EventStream | undefined;

/** Get or create the default event stream instance */
export function getDefaultStream(): EventStream {
  if (!defaultStream) {
    defaultStream = new EventStream();
  }
  return defaultStream;
}

/** Emit an event using the default stream */
export function emit(event: Omit<Event, "timestamp"> & { timestamp?: string }): Event | undefined {
  return getDefaultStream().emit(event);
}
