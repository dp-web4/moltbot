/**
 * Persistent Rate Limiter - SQLite-backed sliding window counters.
 *
 * Persists rate limit state across process restarts using SQLite WAL mode.
 * Falls back to memory-only operation if SQLite is unavailable.
 */

import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { RateLimitResult } from "./rate-limiter.js";

// Dynamic import to handle cases where better-sqlite3 isn't installed
type Database = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

type Statement = {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

/**
 * Persistent rate limiter with SQLite storage.
 * Maintains the same interface as the memory-only RateLimiter.
 */
export class PersistentRateLimiter {
  private db: Database | null = null;
  private memoryFallback: Map<string, number[]> = new Map();
  private isPersistent: boolean = false;
  private statements: {
    insert?: Statement;
    selectCount?: Statement;
    pruneOld?: Statement;
    pruneKey?: Statement;
    selectAll?: Statement;
    deleteEmpty?: Statement;
  } = {};

  constructor(storagePath: string) {
    this.initDatabase(storagePath);
  }

  private initDatabase(storagePath: string): void {
    try {
      // Try to load better-sqlite3
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require("better-sqlite3");

      const dbDir = join(storagePath, "data");
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }

      const dbPath = join(dbDir, "rate-limits.db");
      this.db = new BetterSqlite3(dbPath) as Database;

      // Enable WAL mode for better concurrent access
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");

      // Create rate limits table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);

      // Create index for efficient key lookups
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts
        ON rate_limits(key, timestamp)
      `);

      // Prepare statements for reuse
      this.statements.insert = this.db.prepare(
        "INSERT INTO rate_limits (key, timestamp) VALUES (?, ?)",
      );
      this.statements.selectCount = this.db.prepare(
        "SELECT COUNT(*) as count FROM rate_limits WHERE key = ? AND timestamp > ?",
      );
      this.statements.pruneOld = this.db.prepare("DELETE FROM rate_limits WHERE timestamp <= ?");
      this.statements.pruneKey = this.db.prepare(
        "DELETE FROM rate_limits WHERE key = ? AND timestamp <= ?",
      );
      this.statements.selectAll = this.db.prepare("SELECT DISTINCT key FROM rate_limits");

      this.isPersistent = true;
    } catch {
      // better-sqlite3 not available, use memory fallback
      this.isPersistent = false;
    }
  }

  /** Check whether a key is under its rate limit. */
  check(key: string, maxCount: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - windowMs;

    if (this.isPersistent && this.db && this.statements.selectCount && this.statements.pruneKey) {
      // Prune old entries for this key
      this.statements.pruneKey.run(key, cutoff);

      // Count remaining entries
      const result = this.statements.selectCount.get(key, cutoff) as { count: number };
      const current = result?.count ?? 0;

      return {
        allowed: current < maxCount,
        current,
        limit: maxCount,
      };
    }

    // Memory fallback
    const timestamps = this.memoryFallback.get(key);
    if (!timestamps) {
      return { allowed: true, current: 0, limit: maxCount };
    }

    const pruned = timestamps.filter((t) => t > cutoff);
    this.memoryFallback.set(key, pruned);

    return {
      allowed: pruned.length < maxCount,
      current: pruned.length,
      limit: maxCount,
    };
  }

  /** Record a new action for the given key. */
  record(key: string): void {
    const now = Date.now();

    if (this.isPersistent && this.db && this.statements.insert) {
      this.statements.insert.run(key, now);
      return;
    }

    // Memory fallback
    const timestamps = this.memoryFallback.get(key);
    if (timestamps) {
      timestamps.push(now);
    } else {
      this.memoryFallback.set(key, [now]);
    }
  }

  /** Prune all expired entries across all keys. */
  prune(windowMs: number): number {
    const now = Date.now();
    const cutoff = now - windowMs;

    if (this.isPersistent && this.db && this.statements.pruneOld) {
      const result = this.statements.pruneOld.run(cutoff);
      return result.changes;
    }

    // Memory fallback
    let pruned = 0;
    for (const [key, timestamps] of this.memoryFallback) {
      const before = timestamps.length;
      const filtered = timestamps.filter((t) => t > cutoff);
      pruned += before - filtered.length;

      if (filtered.length === 0) {
        this.memoryFallback.delete(key);
      } else {
        this.memoryFallback.set(key, filtered);
      }
    }
    return pruned;
  }

  /** Get current count for a key within a window. */
  count(key: string, windowMs: number = 3_600_000): number {
    const cutoff = Date.now() - windowMs;

    if (this.isPersistent && this.db && this.statements.selectCount) {
      const result = this.statements.selectCount.get(key, cutoff) as { count: number };
      return result?.count ?? 0;
    }

    // Memory fallback
    const timestamps = this.memoryFallback.get(key);
    if (!timestamps) return 0;
    return timestamps.filter((t) => t > cutoff).length;
  }

  /** Number of tracked keys. */
  get keyCount(): number {
    if (this.isPersistent && this.db && this.statements.selectAll) {
      const rows = this.statements.selectAll.all() as { key: string }[];
      return rows.length;
    }
    return this.memoryFallback.size;
  }

  /** Whether persistence is active. */
  get persistent(): boolean {
    return this.isPersistent;
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Build a rate limit key from rule context. */
  static key(ruleId: string, toolOrCategory: string): string {
    return `ratelimit:${ruleId}:${toolOrCategory}`;
  }
}
