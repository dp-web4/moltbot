/**
 * Audit Trail - Hash-linked chain of action records with Ed25519 signatures.
 *
 * Each audit record links to its R6 request and the previous record,
 * creating a verifiable chain of provenance. Records are signed with
 * the session's Ed25519 private key for non-repudiation.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { R6Request } from "./r6.js";
import { globToRegex } from "./matchers.js";
import { signData, verifySignature } from "./signing.js";

export type AuditRecord = {
  recordId: string;
  r6RequestId: string;
  timestamp: string;
  tool: string;
  category: string;
  target?: string;
  /** Additional targets for multi-file operations */
  targets?: string[];
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
  /** Ed25519 signature of the record (hex-encoded, excludes signature field itself) */
  signature?: string;
  /** Key ID used for signing (last 32 hex chars of public key) */
  signingKeyId?: string;
};

export type AuditFilter = {
  tool?: string;
  category?: string;
  status?: "success" | "error" | "blocked";
  targetPattern?: string;
  since?: string;
  limit?: number;
};

/**
 * Parse a "since" value: ISO date string or relative duration (e.g. "1h", "30m", "2d").
 * Returns a Date or undefined if unparseable.
 */
function parseSince(since: string): Date | undefined {
  // Try relative durations first
  const relMatch = since.match(/^(\d+)\s*(s|m|h|d)$/);
  if (relMatch) {
    const amount = parseInt(relMatch[1]!, 10);
    const unit = relMatch[2]!;
    const ms = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
    return new Date(Date.now() - amount * ms);
  }
  // Try ISO date
  const d = new Date(since);
  return isNaN(d.getTime()) ? undefined : d;
}

export type SigningConfig = {
  privateKeyHex: string;
  publicKeyHex: string;
  keyId: string;
};

export class AuditChain {
  private storagePath: string;
  private sessionId: string;
  private prevHash: string = "genesis";
  private recordCount: number = 0;
  private signing?: SigningConfig;

  constructor(storagePath: string, sessionId: string, signing?: SigningConfig) {
    this.storagePath = storagePath;
    this.sessionId = sessionId;
    this.signing = signing;
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
      targets: r6.request.targets,
      result,
      provenance: {
        sessionId: this.sessionId,
        actionIndex: r6.role.actionIndex,
        prevRecordHash: this.prevHash,
      },
    };

    // Sign the record if signing is configured (sign before adding signature fields)
    if (this.signing) {
      const dataToSign = JSON.stringify(record);
      record.signature = signData(dataToSign, this.signing.privateKeyHex);
      record.signingKeyId = this.signing.keyId;
    }

    const line = JSON.stringify(record);
    appendFileSync(this.filePath, line + "\n");
    this.prevHash = createHash("sha256").update(line).digest("hex").slice(0, 16);
    this.recordCount++;

    return record;
  }

  /**
   * Verify the audit chain integrity: hash links and optional signatures.
   * @param publicKeys Optional map of keyId -> publicKeyHex for signature verification.
   *                   If not provided, signatures are noted but not verified.
   */
  verify(publicKeys?: Map<string, string>): {
    valid: boolean;
    recordCount: number;
    errors: string[];
    signatureStats: { signed: number; verified: number; unverified: number; invalid: number };
  } {
    const errors: string[] = [];
    const signatureStats = { signed: 0, verified: 0, unverified: 0, invalid: 0 };

    if (!existsSync(this.filePath)) {
      return { valid: true, recordCount: 0, errors: [], signatureStats };
    }

    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return { valid: true, recordCount: 0, errors: [], signatureStats };

    const lines = content.split("\n");
    let prevHash = "genesis";

    for (let i = 0; i < lines.length; i++) {
      try {
        const record: AuditRecord = JSON.parse(lines[i]!);

        // Verify hash chain
        if (record.provenance.prevRecordHash !== prevHash) {
          errors.push(
            `Record ${i}: hash mismatch (expected ${prevHash}, got ${record.provenance.prevRecordHash})`,
          );
        }
        prevHash = createHash("sha256").update(lines[i]!).digest("hex").slice(0, 16);

        // Verify signature if present
        if (record.signature && record.signingKeyId) {
          signatureStats.signed++;
          const publicKeyHex = publicKeys?.get(record.signingKeyId);

          if (publicKeyHex) {
            // Reconstruct the unsigned record for verification
            const { signature: _, signingKeyId: __, ...unsignedRecord } = record;
            const dataToVerify = JSON.stringify(unsignedRecord);

            if (verifySignature(dataToVerify, record.signature, publicKeyHex)) {
              signatureStats.verified++;
            } else {
              signatureStats.invalid++;
              errors.push(`Record ${i}: invalid signature`);
            }
          } else {
            signatureStats.unverified++;
          }
        }
      } catch (e) {
        errors.push(`Record ${i}: parse error`);
      }
    }

    return { valid: errors.length === 0, recordCount: lines.length, errors, signatureStats };
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

  /** Load all records from the JSONL file. */
  getAll(): AuditRecord[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];
    return content
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as AuditRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is AuditRecord => r !== null);
  }

  /** Filter audit records by criteria. */
  filter(criteria: AuditFilter): AuditRecord[] {
    let records = this.getAll();
    const limit = criteria.limit ?? 50;

    if (criteria.tool) {
      const tool = criteria.tool;
      records = records.filter((r) => r.tool === tool);
    }

    if (criteria.category) {
      const cat = criteria.category;
      records = records.filter((r) => r.category === cat);
    }

    if (criteria.status) {
      const status = criteria.status;
      records = records.filter((r) => r.result.status === status);
    }

    if (criteria.targetPattern) {
      const re = globToRegex(criteria.targetPattern);
      records = records.filter((r) => r.target && re.test(r.target));
    }

    if (criteria.since) {
      const sinceDate = parseSince(criteria.since);
      if (sinceDate) {
        const sinceMs = sinceDate.getTime();
        records = records.filter((r) => new Date(r.timestamp).getTime() >= sinceMs);
      }
    }

    return records.slice(-limit);
  }
}
