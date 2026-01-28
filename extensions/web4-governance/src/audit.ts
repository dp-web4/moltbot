/**
 * Audit Trail - Hash-linked chain of action records.
 *
 * Each audit record links to its R6 request and the previous record,
 * creating a verifiable chain of provenance.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { R6Request } from "./r6.js";

export type AuditRecord = {
  recordId: string;
  r6RequestId: string;
  timestamp: string;
  tool: string;
  category: string;
  target?: string;
  result: {
    status: "success" | "error" | "blocked";
    outputHash?: string;
    errorMessage?: string;
    durationMs?: number;
  };
  provenance: {
    sessionId: string;
    actionIndex: number;
    prevRecordHash: string;
  };
};

export class AuditChain {
  private storagePath: string;
  private sessionId: string;
  private prevHash: string = "genesis";
  private recordCount: number = 0;

  constructor(storagePath: string, sessionId: string) {
    this.storagePath = storagePath;
    this.sessionId = sessionId;
    mkdirSync(join(this.storagePath, "audit"), { recursive: true });
    this.loadExisting();
  }

  private get filePath(): string {
    return join(this.storagePath, "audit", `${this.sessionId}.jsonl`);
  }

  private loadExisting(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const content = readFileSync(this.filePath, "utf-8").trim();
      if (!content) return;
      const lines = content.split("\n");
      this.recordCount = lines.length;
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        this.prevHash = createHash("sha256").update(lastLine).digest("hex").slice(0, 16);
      }
    } catch {
      // Start fresh on error
    }
  }

  record(r6: R6Request, result: AuditRecord["result"]): AuditRecord {
    const record: AuditRecord = {
      recordId: `audit:${r6.id.slice(3)}`,
      r6RequestId: r6.id,
      timestamp: new Date().toISOString(),
      tool: r6.request.toolName,
      category: r6.request.category,
      target: r6.request.target,
      result,
      provenance: {
        sessionId: this.sessionId,
        actionIndex: r6.role.actionIndex,
        prevRecordHash: this.prevHash,
      },
    };

    const line = JSON.stringify(record);
    appendFileSync(this.filePath, line + "\n");
    this.prevHash = createHash("sha256").update(line).digest("hex").slice(0, 16);
    this.recordCount++;

    return record;
  }

  verify(): { valid: boolean; recordCount: number; errors: string[] } {
    const errors: string[] = [];
    if (!existsSync(this.filePath)) {
      return { valid: true, recordCount: 0, errors: [] };
    }

    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return { valid: true, recordCount: 0, errors: [] };

    const lines = content.split("\n");
    let prevHash = "genesis";

    for (let i = 0; i < lines.length; i++) {
      try {
        const record: AuditRecord = JSON.parse(lines[i]!);
        if (record.provenance.prevRecordHash !== prevHash) {
          errors.push(`Record ${i}: hash mismatch (expected ${prevHash}, got ${record.provenance.prevRecordHash})`);
        }
        prevHash = createHash("sha256").update(lines[i]!).digest("hex").slice(0, 16);
      } catch (e) {
        errors.push(`Record ${i}: parse error`);
      }
    }

    return { valid: errors.length === 0, recordCount: lines.length, errors };
  }

  get count(): number {
    return this.recordCount;
  }

  getLast(n: number): AuditRecord[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];
    const lines = content.split("\n");
    return lines
      .slice(-n)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is AuditRecord => r !== null);
  }
}
