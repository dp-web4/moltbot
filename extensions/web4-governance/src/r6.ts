/**
 * Web4 Governance Extension - R6 Workflow
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2025 Web4 Contributors
 *
 * R6 Framework: Rules + Role + Request + Reference + Resource → Result
 */

import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { R6Request, AuditRecord, SessionState } from "./types.js";
import { getWeb4Paths } from "./session.js";

/**
 * Create an R6 request for a tool call.
 */
export function createR6Request(
  session: SessionState,
  toolName: string,
  params: Record<string, unknown>,
): R6Request {
  const requestId = `r6:${randomBytes(4).toString("hex")}`;
  const actionIndex = session.action_count;
  const prevR6 = session.r6_requests[session.r6_requests.length - 1];

  // Categorize tool
  const category = categorizeToolCall(toolName, params);
  const target = extractTarget(toolName, params);

  const r6: R6Request = {
    request_id: requestId,
    rules: session.preferences,
    role: {
      session_id: session.session_id,
      action_index: actionIndex,
    },
    request: {
      tool: toolName,
      category,
      target,
    },
    reference: {
      chain_position: actionIndex,
      prev_r6_id: prevR6?.request_id,
    },
    timestamp: new Date().toISOString(),
  };

  return r6;
}

/**
 * Finalize R6 request with result.
 */
export function finalizeR6Request(
  r6: R6Request,
  result: unknown,
  error?: string,
): R6Request {
  const status = error ? "error" : "success";
  const outputHash = result
    ? createHash("sha256")
        .update(JSON.stringify(result))
        .digest("hex")
        .slice(0, 16)
    : undefined;

  return {
    ...r6,
    result: {
      status,
      output_hash: outputHash,
      error,
    },
  };
}

/**
 * Create an audit record from R6 request.
 */
export function createAuditRecord(
  r6: R6Request,
  session: SessionState,
): AuditRecord {
  const recordId = `audit:${randomBytes(4).toString("hex")}`;
  const prevRecord = session.audit_chain[session.audit_chain.length - 1];
  const prevRecordHash = prevRecord
    ? createHash("sha256")
        .update(JSON.stringify(prevRecord))
        .digest("hex")
        .slice(0, 16)
    : undefined;

  return {
    record_id: recordId,
    r6_request_id: r6.request_id,
    tool: r6.request.tool,
    category: r6.request.category,
    target: r6.request.target,
    result: r6.result!,
    provenance: {
      session_id: session.session_id,
      action_index: r6.role.action_index,
      prev_record_hash: prevRecordHash,
    },
    timestamp: r6.timestamp,
  };
}

/**
 * Persist R6 request to daily log.
 */
export async function persistR6Request(r6: R6Request): Promise<void> {
  const { r6Dir } = getWeb4Paths();
  await mkdir(r6Dir, { recursive: true });

  const date = new Date().toISOString().split("T")[0];
  const logFile = join(r6Dir, `${date}.jsonl`);

  await appendFile(logFile, JSON.stringify(r6) + "\n");
}

/**
 * Persist audit record to session log.
 */
export async function persistAuditRecord(
  record: AuditRecord,
  sessionId: string,
): Promise<void> {
  const { auditDir } = getWeb4Paths();
  await mkdir(auditDir, { recursive: true });

  const logFile = join(auditDir, `${sessionId}.jsonl`);
  await appendFile(logFile, JSON.stringify(record) + "\n");
}

/**
 * Categorize tool call for audit trail.
 */
function categorizeToolCall(
  toolName: string,
  params: Record<string, unknown>,
): string {
  // Basic categorization - can be extended
  if (toolName.toLowerCase().includes("read") || toolName.toLowerCase().includes("get")) {
    return "read";
  }
  if (
    toolName.toLowerCase().includes("write") ||
    toolName.toLowerCase().includes("create") ||
    toolName.toLowerCase().includes("edit")
  ) {
    return "write";
  }
  if (
    toolName.toLowerCase().includes("delete") ||
    toolName.toLowerCase().includes("remove")
  ) {
    return "delete";
  }
  if (
    toolName.toLowerCase().includes("exec") ||
    toolName.toLowerCase().includes("run") ||
    toolName.toLowerCase().includes("bash")
  ) {
    return "execute";
  }
  return "other";
}

/**
 * Extract target from tool parameters.
 */
function extractTarget(
  toolName: string,
  params: Record<string, unknown>,
): string | undefined {
  // Common parameter names for targets
  const targetKeys = [
    "file_path",
    "path",
    "filename",
    "url",
    "target",
    "destination",
    "command",
  ];

  for (const key of targetKeys) {
    if (params[key]) {
      return String(params[key]);
    }
  }

  return undefined;
}
