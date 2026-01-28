/**
 * Web4 Governance Extension - Audit Command
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2025 Web4 Contributors
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PluginCommandHandler } from "clawdbot/plugin-sdk";
import { getWeb4Paths, loadSession } from "./session.js";
import type { AuditRecord, SessionState } from "./types.js";

/**
 * Handle /audit command.
 */
export const handleAuditCommand: PluginCommandHandler = async (ctx) => {
  const args = ctx.args?.trim() || "";

  // Parse command arguments
  if (args.startsWith("last ")) {
    const count = parseInt(args.slice(5), 10);
    return await showLastActions(count);
  }

  if (args === "verify") {
    return await verifyChainIntegrity();
  }

  if (args === "export") {
    return await exportAuditLog();
  }

  // Default: show session summary
  return await showSessionSummary();
};

/**
 * Show session summary.
 */
async function showSessionSummary() {
  try {
    const { sessionDir } = getWeb4Paths();
    const sessions = await readdir(sessionDir);

    if (sessions.length === 0) {
      return { text: "No Web4 governance sessions found." };
    }

    // Get latest session
    const latestSessionFile = sessions.sort().reverse()[0];
    const sessionId = latestSessionFile.replace(".json", "");
    const session = await loadSession(sessionId);

    if (!session) {
      return { text: "Failed to load session data." };
    }

    const tokenShort = session.token.token_id.split(":")[2];
    const duration = Date.now() - new Date(session.started_at).getTime();
    const durationMin = Math.floor(duration / 60000);

    const text = [
      "**Web4 Governance Session Summary**",
      "",
      `Session: ${tokenShort} (software-bound)`,
      `Started: ${new Date(session.started_at).toLocaleString()}`,
      `Duration: ${durationMin} minutes`,
      `Actions: ${session.action_count}`,
      `Audit Level: ${session.preferences.auditLevel}`,
      "",
      "Use `/audit last 10` to see recent actions",
      "Use `/audit verify` to verify chain integrity",
      "Use `/audit export` to export full audit log",
    ].join("\n");

    return { text };
  } catch (error) {
    return { text: `Error reading audit data: ${error}` };
  }
}

/**
 * Show last N actions.
 */
async function showLastActions(count: number) {
  try {
    const { sessionDir, auditDir } = getWeb4Paths();
    const sessions = await readdir(sessionDir);

    if (sessions.length === 0) {
      return { text: "No audit records found." };
    }

    // Get latest session
    const latestSessionFile = sessions.sort().reverse()[0];
    const sessionId = latestSessionFile.replace(".json", "");

    // Read audit log
    const auditFile = join(auditDir, `${sessionId}.jsonl`);
    const auditData = await readFile(auditFile, "utf-8");
    const records: AuditRecord[] = auditData
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    const lastRecords = records.slice(-count);

    const lines = [
      `**Last ${lastRecords.length} Actions**`,
      "",
    ];

    for (const record of lastRecords) {
      const time = new Date(record.timestamp).toLocaleTimeString();
      const status = record.result.status === "success" ? "✓" : "✗";
      lines.push(
        `${status} [${time}] ${record.tool} (${record.category})${record.target ? ` → ${record.target}` : ""}`,
      );
    }

    return { text: lines.join("\n") };
  } catch (error) {
    return { text: `Error reading audit log: ${error}` };
  }
}

/**
 * Verify chain integrity.
 */
async function verifyChainIntegrity() {
  try {
    const { sessionDir, auditDir } = getWeb4Paths();
    const sessions = await readdir(sessionDir);

    if (sessions.length === 0) {
      return { text: "No audit chain to verify." };
    }

    // Get latest session
    const latestSessionFile = sessions.sort().reverse()[0];
    const sessionId = latestSessionFile.replace(".json", "");

    // Read audit log
    const auditFile = join(auditDir, `${sessionId}.jsonl`);
    const auditData = await readFile(auditFile, "utf-8");
    const records: AuditRecord[] = auditData
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    // Verify chain
    let isValid = true;
    let prevHash: string | undefined;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const expectedPrevHash = prevHash;
      const actualPrevHash = record.provenance.prev_record_hash;

      if (i === 0) {
        if (actualPrevHash !== undefined) {
          isValid = false;
          break;
        }
      } else {
        if (actualPrevHash !== expectedPrevHash) {
          isValid = false;
          break;
        }
      }

      // Compute hash for next iteration
      prevHash = createHash("sha256")
        .update(JSON.stringify(record))
        .digest("hex")
        .slice(0, 16);
    }

    if (isValid) {
      return {
        text: `✓ Audit chain verified: ${records.length} records, integrity intact`,
      };
    } else {
      return { text: "✗ Audit chain verification failed: integrity compromised" };
    }
  } catch (error) {
    return { text: `Error verifying chain: ${error}` };
  }
}

/**
 * Export audit log.
 */
async function exportAuditLog() {
  try {
    const { sessionDir, auditDir } = getWeb4Paths();
    const sessions = await readdir(sessionDir);

    if (sessions.length === 0) {
      return { text: "No audit logs to export." };
    }

    // Get latest session
    const latestSessionFile = sessions.sort().reverse()[0];
    const sessionId = latestSessionFile.replace(".json", "");

    const auditFile = join(auditDir, `${sessionId}.jsonl`);
    const text = [
      `Audit log exported: ${auditFile}`,
      "",
      "Copy this file to share with auditors or relying parties.",
      "The JSONL format preserves the hash-linked chain structure.",
    ].join("\n");

    return { text };
  } catch (error) {
    return { text: `Error exporting audit log: ${error}` };
  }
}
