/**
 * Policy Embedding Store
 *
 * Manages pre-computed embeddings for policies, enabling efficient
 * semantic search for relevant policies during decision-making.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  PolicyEmbedding,
  PolicyCategory,
  PolicyEmbeddingStoreConfig,
} from "./policy-model-types.js";
import type { PolicyRule } from "./policy-types.js";
import { PolicyModelError } from "./policy-model-types.js";

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_EMBEDDING_CONFIG: Partial<PolicyEmbeddingStoreConfig> = {
  embeddingDimension: 384,
  maxPoliciesInMemory: 1000,
};

// =============================================================================
// Policy Embedding Store
// =============================================================================

/**
 * Store for policy embeddings with similarity search
 */
export class PolicyEmbeddingStore {
  private config: Required<PolicyEmbeddingStoreConfig>;
  private embeddings: Map<string, PolicyEmbedding> = new Map();
  private embeddingIndex: Float32Array[] = [];
  private policyIds: string[] = [];
  private loaded = false;

  constructor(config: PolicyEmbeddingStoreConfig) {
    this.config = {
      ...DEFAULT_EMBEDDING_CONFIG,
      ...config,
    } as Required<PolicyEmbeddingStoreConfig>;
  }

  /**
   * Load embeddings from storage
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    const storagePath = this.config.storagePath;

    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
      this.loaded = true;
      return;
    }

    const indexPath = join(storagePath, "index.json");
    if (!existsSync(indexPath)) {
      this.loaded = true;
      return;
    }

    try {
      const indexData = JSON.parse(readFileSync(indexPath, "utf-8"));

      for (const entry of indexData.policies) {
        const embeddingPath = join(storagePath, `${entry.policyId}.bin`);
        const metadataPath = join(storagePath, `${entry.policyId}.json`);

        if (!existsSync(embeddingPath) || !existsSync(metadataPath)) {
          continue;
        }

        // Load embedding vector
        const embeddingBuffer = readFileSync(embeddingPath);
        const embedding = new Float32Array(embeddingBuffer.buffer);

        // Load metadata
        const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

        const policyEmbedding: PolicyEmbedding = {
          policyId: entry.policyId,
          policyHash: metadata.policyHash,
          embedding,
          summary: metadata.summary,
          effectiveDate: new Date(metadata.effectiveDate),
          category: metadata.category,
          priority: metadata.priority,
        };

        this.embeddings.set(entry.policyId, policyEmbedding);
        this.embeddingIndex.push(embedding);
        this.policyIds.push(entry.policyId);
      }

      this.loaded = true;
    } catch (error) {
      throw new PolicyModelError(
        `Failed to load embeddings: ${error instanceof Error ? error.message : String(error)}`,
        "EMBEDDING_NOT_FOUND",
        { originalError: error },
      );
    }
  }

  /**
   * Get relevant policies for a given context using similarity search
   */
  async getRelevantPolicies(
    context: string,
    topK: number = 5,
    category?: PolicyCategory,
  ): Promise<PolicyEmbedding[]> {
    if (!this.loaded) {
      await this.load();
    }

    if (this.embeddings.size === 0) {
      return [];
    }

    // Generate embedding for context
    const contextEmbedding = await this.generateEmbedding(context);

    // Calculate similarities
    const similarities: Array<{ policyId: string; similarity: number }> = [];

    for (let i = 0; i < this.embeddingIndex.length; i++) {
      const policyId = this.policyIds[i];
      const embedding = this.embeddings.get(policyId);

      // Apply category filter if specified
      if (category && embedding?.category !== category) {
        continue;
      }

      const similarity = this.cosineSimilarity(contextEmbedding, this.embeddingIndex[i]);
      similarities.push({ policyId, similarity });
    }

    // Sort by similarity (descending) and priority (ascending)
    similarities.sort((a, b) => {
      const simDiff = b.similarity - a.similarity;
      if (Math.abs(simDiff) > 0.01) return simDiff;

      const priorityA = this.embeddings.get(a.policyId)?.priority ?? 100;
      const priorityB = this.embeddings.get(b.policyId)?.priority ?? 100;
      return priorityA - priorityB;
    });

    return similarities
      .slice(0, topK)
      .map((s) => this.embeddings.get(s.policyId)!)
      .filter(Boolean);
  }

  /**
   * Add or update an embedding for a policy
   */
  async updateEmbedding(policy: PolicyRule): Promise<PolicyEmbedding> {
    if (!this.loaded) {
      await this.load();
    }

    // Generate policy text for embedding
    const policyText = this.policyToText(policy);
    const policyHash = createHash("sha256").update(policyText).digest("hex");

    // Check if embedding already exists and is current
    const existing = this.embeddings.get(policy.id);
    if (existing && existing.policyHash === policyHash) {
      return existing;
    }

    // Generate new embedding
    const embedding = await this.generateEmbedding(policyText);

    const policyEmbedding: PolicyEmbedding = {
      policyId: policy.id,
      policyHash,
      embedding,
      summary: this.summarizePolicy(policy),
      effectiveDate: new Date(),
      category: this.categorizePolicy(policy),
      priority: policy.priority,
    };

    // Update in-memory store
    this.embeddings.set(policy.id, policyEmbedding);

    // Update index
    const existingIndex = this.policyIds.indexOf(policy.id);
    if (existingIndex >= 0) {
      this.embeddingIndex[existingIndex] = embedding;
    } else {
      this.embeddingIndex.push(embedding);
      this.policyIds.push(policy.id);
    }

    // Persist
    await this.persistEmbedding(policyEmbedding);
    await this.persistIndex();

    return policyEmbedding;
  }

  /**
   * Remove an embedding
   */
  async removeEmbedding(policyId: string): Promise<void> {
    const index = this.policyIds.indexOf(policyId);
    if (index >= 0) {
      this.policyIds.splice(index, 1);
      this.embeddingIndex.splice(index, 1);
    }
    this.embeddings.delete(policyId);

    // Remove files
    const embeddingPath = join(this.config.storagePath, `${policyId}.bin`);
    const metadataPath = join(this.config.storagePath, `${policyId}.json`);

    if (existsSync(embeddingPath)) unlinkSync(embeddingPath);
    if (existsSync(metadataPath)) unlinkSync(metadataPath);

    await this.persistIndex();
  }

  /**
   * Get the hash of all policy embeddings (for attestation)
   */
  getPolicyHash(): string {
    const hashes = Array.from(this.embeddings.values())
      .map((e) => e.policyHash)
      .sort()
      .join("");

    return createHash("sha256").update(hashes).digest("hex");
  }

  /**
   * Get count of loaded policies
   */
  getCount(): number {
    return this.embeddings.size;
  }

  /**
   * Get all policy IDs
   */
  getPolicyIds(): string[] {
    return Array.from(this.embeddings.keys());
  }

  /**
   * Get a specific embedding
   */
  getEmbedding(policyId: string): PolicyEmbedding | undefined {
    return this.embeddings.get(policyId);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate embedding for text
   *
   * NOTE: In production, this would use the local model's embedding layer.
   * For now, we use a hash-based approach that produces consistent pseudo-embeddings.
   */
  private async generateEmbedding(text: string): Promise<Float32Array> {
    const dimension = this.config.embeddingDimension;
    const embedding = new Float32Array(dimension);

    // Generate a consistent pseudo-embedding using hash
    const hash = createHash("sha256").update(text).digest();

    // Use hash bytes to seed pseudo-random values
    for (let i = 0; i < dimension; i++) {
      const hashIndex = i % hash.length;
      const value = (hash[hashIndex] + hash[(hashIndex + 1) % hash.length]) / 510 - 0.5;
      embedding[i] = value;
    }

    // Normalize to unit vector
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    return norm > 0 ? dotProduct / norm : 0;
  }

  /**
   * Convert policy rule to text for embedding
   */
  private policyToText(policy: PolicyRule): string {
    const match = policy.match;
    const conditions: string[] = [];

    if (match.tools) {
      conditions.push(`tools: ${match.tools.join(", ")}`);
    }
    if (match.categories) {
      conditions.push(`categories: ${match.categories.join(", ")}`);
    }
    if (match.targetPatterns) {
      conditions.push(`targets: ${match.targetPatterns.join(", ")}`);
    }

    return (
      `Policy: ${policy.name}. ${policy.reason || ""}. ` +
      `Conditions: ${conditions.join(" AND ")}. Decision: ${policy.decision}. Priority: ${policy.priority}.`
    );
  }

  /**
   * Generate a short summary of a policy
   */
  private summarizePolicy(policy: PolicyRule): string {
    const matchCount =
      (policy.match.tools?.length || 0) +
      (policy.match.categories?.length || 0) +
      (policy.match.targetPatterns?.length || 0);
    return `${policy.name}: ${policy.decision} when ${matchCount} condition(s) met`;
  }

  /**
   * Categorize a policy based on its conditions
   */
  private categorizePolicy(policy: PolicyRule): PolicyCategory {
    const match = policy.match;

    // Check for security-related patterns
    if (match.targetPatterns?.some((p) => p.includes("secret") || p.includes("credential"))) {
      return "security";
    }

    // Check for network-related
    if (match.categories?.includes("network")) {
      return "security";
    }

    // Check for action-specific
    if (match.tools?.length) {
      return "action";
    }

    return "general";
  }

  /**
   * Persist an embedding to storage
   */
  private async persistEmbedding(embedding: PolicyEmbedding): Promise<void> {
    const storagePath = this.config.storagePath;

    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }

    // Save embedding vector as binary
    const embeddingPath = join(storagePath, `${embedding.policyId}.bin`);
    const buffer = Buffer.from(embedding.embedding.buffer);
    writeFileSync(embeddingPath, buffer);

    // Save metadata as JSON
    const metadataPath = join(storagePath, `${embedding.policyId}.json`);
    const metadata = {
      policyHash: embedding.policyHash,
      summary: embedding.summary,
      effectiveDate: embedding.effectiveDate.toISOString(),
      category: embedding.category,
      priority: embedding.priority,
    };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Persist the embedding index
   */
  private async persistIndex(): Promise<void> {
    const storagePath = this.config.storagePath;
    const indexPath = join(storagePath, "index.json");

    const index = {
      version: "1.0",
      dimension: this.config.embeddingDimension,
      count: this.embeddings.size,
      policies: Array.from(this.embeddings.values()).map((e) => ({
        policyId: e.policyId,
        policyHash: e.policyHash,
        category: e.category,
      })),
    };

    writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an embedding store with default settings
 */
export function createEmbeddingStore(storagePath: string): PolicyEmbeddingStore {
  return new PolicyEmbeddingStore({
    storagePath,
    embeddingDimension: 384,
    maxPoliciesInMemory: 1000,
  });
}
