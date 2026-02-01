/**
 * Policy Model
 *
 * A local small language model that serves as an intelligent policy enforcer.
 * This implements the "literally smart contract" concept - policy that can
 * reason about context, not just pattern-match.
 *
 * Features:
 * - Pre-reviews tool use with semantic understanding
 * - Post-reviews outcomes in context of stated intent
 * - Heterogeneous review (different architecture = defense in depth)
 *
 * Primary model recommendation: Microsoft Phi-4 Mini (3.8B)
 * - MIT license, 2.5GB quantized, 15-25 tok/s on CPU
 */

import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import type {
  PolicyModelConfig,
  PolicyModelDecision,
  PolicyModelAttestation,
  R6ModelRequest,
  ToolOutcome,
  InferenceMetrics,
  ActionType,
} from "./policy-model-types.js";
import {
  DEFAULT_POLICY_MODEL_CONFIG,
  DEFAULT_POLICY_MODEL_DECISION,
  PolicyModelError,
} from "./policy-model-types.js";
import { ModelRuntime, createPhi4MiniRuntime } from "./policy-model-runtime.js";
import { PolicyEmbeddingStore, createEmbeddingStore } from "./policy-model-embeddings.js";
import { PolicyEngine } from "./policy.js";

// =============================================================================
// Policy Model Implementation
// =============================================================================

/**
 * PolicyModel - Intelligent policy enforcer using local LLM
 */
export class PolicyModel {
  private config: PolicyModelConfig;
  private runtime: ModelRuntime | null = null;
  private embeddings: PolicyEmbeddingStore | null = null;
  private heuristicPolicy: PolicyEngine | null = null;
  private initialized = false;
  private lastAttestation: PolicyModelAttestation | null = null;
  private actorId: string;
  private inferenceMetrics: InferenceMetrics = {
    preToolMs: 0,
    postToolMs: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
  };

  constructor(config: Partial<PolicyModelConfig> & { modelPath: string }, actorId?: string) {
    this.config = {
      ...DEFAULT_POLICY_MODEL_CONFIG,
      ...config,
    } as PolicyModelConfig;
    this.actorId = actorId ?? `policy-model:${randomUUID()}`;
  }

  /**
   * Initialize the policy model
   */
  async init(heuristicPolicy?: PolicyEngine): Promise<void> {
    if (this.initialized) return;

    this.heuristicPolicy = heuristicPolicy ?? null;

    // Initialize model runtime if enabled
    if (this.config.enabled && this.config.modelPath) {
      this.runtime = createPhi4MiniRuntime(this.config.modelPath);
      try {
        await this.runtime.load();
      } catch (error) {
        console.warn(
          `[PolicyModel] Failed to load model, falling back to heuristics: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.runtime = null;
      }
    }

    // Initialize embedding store
    if (this.config.policyEmbeddingsPath) {
      this.embeddings = createEmbeddingStore(this.config.policyEmbeddingsPath);
      await this.embeddings.load();
    }

    this.initialized = true;
  }

  /**
   * Evaluate a proposed tool use BEFORE execution
   */
  async evaluatePreToolUse(request: R6ModelRequest): Promise<PolicyModelDecision> {
    if (!this.initialized) {
      throw new PolicyModelError("PolicyModel not initialized", "INVALID_CONFIG");
    }

    const startTime = Date.now();

    try {
      // Try model inference first
      if (this.runtime?.isReady()) {
        const prompt = this.buildPreToolPrompt(request);
        const result = await this.runtime.infer(prompt, {
          maxTokens: 256,
          temperature: this.config.temperature,
          timeoutMs: this.config.maxInferenceMs,
        });

        if (!result.timedOut) {
          const decision = this.parseDecision(result.text, startTime, "model");
          this.updateMetrics("preToolMs", Date.now() - startTime, result);
          return decision;
        }
      }

      // Fall back to heuristic policy
      return this.evaluateWithHeuristics(request, startTime);
    } catch (error) {
      console.warn(
        `[PolicyModel] Pre-tool evaluation error, using heuristics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.evaluateWithHeuristics(request, startTime);
    }
  }

  /**
   * Evaluate the outcome of a tool use AFTER execution
   */
  async evaluatePostToolUse(
    request: R6ModelRequest,
    outcome: ToolOutcome,
  ): Promise<PolicyModelDecision> {
    if (!this.initialized) {
      throw new PolicyModelError("PolicyModel not initialized", "INVALID_CONFIG");
    }

    const startTime = Date.now();

    try {
      // Try model inference first
      if (this.runtime?.isReady()) {
        const prompt = this.buildPostToolPrompt(request, outcome);
        const result = await this.runtime.infer(prompt, {
          maxTokens: 256,
          temperature: this.config.temperature,
          timeoutMs: this.config.maxInferenceMs,
        });

        if (!result.timedOut) {
          const decision = this.parseDecision(result.text, startTime, "model");
          this.updateMetrics("postToolMs", Date.now() - startTime, result);
          return decision;
        }
      }

      // Fall back to simple post-hoc check
      return this.evaluateOutcomeHeuristic(outcome, startTime);
    } catch (error) {
      console.warn(
        `[PolicyModel] Post-tool evaluation error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.evaluateOutcomeHeuristic(outcome, startTime);
    }
  }

  /**
   * Get attestation of current policy model state
   */
  async attestPolicyState(): Promise<PolicyModelAttestation> {
    const modelHash = this.runtime?.getModelHash() ?? "no-model";
    const policyHash = this.embeddings?.getPolicyHash() ?? "no-policies";
    const metadata = this.runtime?.getMetadata() ?? null;
    const policyCount = this.embeddings?.getCount() ?? 0;

    const now = new Date();

    // Create attestation data
    const attestationData = {
      modelHash,
      policyHash,
      actorId: this.actorId,
      bindingType: "software",
      attestedAt: now.toISOString(),
      modelVersion: metadata?.version ?? "unknown",
      activePolicyCount: policyCount,
      timestamp: now.getTime(),
    };

    // Sign with HMAC (software attestation)
    const signature = createHmac("sha256", this.actorId)
      .update(JSON.stringify(attestationData))
      .digest("hex");

    this.lastAttestation = {
      modelHash,
      policyHash,
      actorId: this.actorId,
      bindingType: "software",
      attestedAt: now,
      signature,
      modelVersion: metadata?.version ?? "unknown",
      activePolicyCount: policyCount,
    };

    return this.lastAttestation;
  }

  /**
   * Check if model is ready for inference
   */
  isModelReady(): boolean {
    return this.runtime?.isReady() ?? false;
  }

  /**
   * Get current inference metrics
   */
  getInferenceMetrics(): InferenceMetrics {
    return { ...this.inferenceMetrics };
  }

  /**
   * Get last attestation
   */
  getLastAttestation(): PolicyModelAttestation | null {
    return this.lastAttestation;
  }

  /**
   * Get model status
   */
  getStatus(): {
    initialized: boolean;
    modelReady: boolean;
    embeddingCount: number;
    heuristicRuleCount: number;
  } {
    return {
      initialized: this.initialized,
      modelReady: this.runtime?.isReady() ?? false,
      embeddingCount: this.embeddings?.getCount() ?? 0,
      heuristicRuleCount: this.heuristicPolicy?.ruleCount ?? 0,
    };
  }

  /**
   * Sync policy embeddings from heuristic policy
   */
  async syncPolicies(): Promise<void> {
    if (!this.embeddings || !this.heuristicPolicy) return;

    for (const rule of this.heuristicPolicy.sortedRules) {
      await this.embeddings.updateEmbedding(rule);
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private buildPreToolPrompt(request: R6ModelRequest): string {
    const relevantPolicies = this.getRelevantPolicySummaries();

    return `You are a policy model evaluating a proposed action for an AI agent.

CONTEXT:
- Actor: ${request.actorId}
- Trust State: competence=${request.trustState.competence.toFixed(2)}, reliability=${request.trustState.reliability.toFixed(2)}, integrity=${request.trustState.integrity.toFixed(2)}
${request.coherenceState ? `- Coherence: d9=${request.coherenceState.d9Score.toFixed(2)}, self_ref=${request.coherenceState.selfReferenceRate.toFixed(2)}, coupling=${request.coherenceState.couplingState}` : ""}
${request.context.intent ? `- Stated Intent: ${request.context.intent}` : ""}

PROPOSED ACTION:
- Type: ${request.action.type}
- Tool: ${request.action.toolName}
- Target: ${request.action.target}
${request.action.description ? `- Description: ${request.action.description}` : ""}
${request.action.parameters ? `- Parameters: ${JSON.stringify(request.action.parameters)}` : ""}

RELEVANT POLICIES:
${relevantPolicies}

Evaluate whether this action should be allowed based on the policies and context.
Respond with a JSON object:
{
  "decision": "allow" | "deny" | "require_attestation" | "escalate",
  "confidence": <0-1>,
  "reasoning": "<brief explanation>",
  "policyReferences": ["<policy_ids>"]
}`;
  }

  private buildPostToolPrompt(request: R6ModelRequest, outcome: ToolOutcome): string {
    return `You are a policy model evaluating the outcome of an AI agent action.

ORIGINAL REQUEST:
- Type: ${request.action.type}
- Tool: ${request.action.toolName}
- Target: ${request.action.target}
${request.context.intent ? `- Stated Intent: ${request.context.intent}` : ""}

OUTCOME:
- Success: ${outcome.success}
- Duration: ${outcome.durationMs}ms
${outcome.error ? `- Error: ${outcome.error}` : ""}
${outcome.sideEffects?.length ? `- Side Effects: ${outcome.sideEffects.join(", ")}` : ""}
- Result Hash: ${outcome.resultHash}

Evaluate whether the outcome matches the stated intent and is within policy.
Respond with a JSON object:
{
  "decision": "allow" | "deny" | "escalate",
  "confidence": <0-1>,
  "reasoning": "<brief explanation>",
  "policyReferences": ["<policy_ids>"]
}`;
  }

  private getRelevantPolicySummaries(): string {
    if (this.heuristicPolicy) {
      const rules = this.heuristicPolicy.sortedRules.slice(0, 5);
      return rules.map((r) => `- ${r.name}: ${r.reason} (decision: ${r.decision})`).join("\n");
    }
    return "- No explicit policies loaded, use general safety guidelines";
  }

  private parseDecision(
    text: string,
    startTime: number,
    source: "model" | "heuristic",
  ): PolicyModelDecision {
    const processingMs = Date.now() - startTime;

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          decision: this.normalizeDecision(parsed.decision),
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
          reasoning: parsed.reasoning || "No reasoning provided",
          policyReferences: Array.isArray(parsed.policyReferences) ? parsed.policyReferences : [],
          processingMs,
          source,
        };
      }
    } catch {
      // JSON parsing failed
    }

    // Fallback: try to extract decision from text
    const textLower = text.toLowerCase();
    let decision: PolicyModelDecision["decision"] = "allow";

    if (textLower.includes("deny") || textLower.includes("reject")) {
      decision = "deny";
    } else if (textLower.includes("escalate") || textLower.includes("human review")) {
      decision = "escalate";
    } else if (textLower.includes("attestation") || textLower.includes("verify")) {
      decision = "require_attestation";
    }

    return {
      decision,
      confidence: 0.5,
      reasoning: text.slice(0, 200),
      policyReferences: [],
      processingMs,
      source,
    };
  }

  private normalizeDecision(decision: string): PolicyModelDecision["decision"] {
    const normalized = (decision || "").toLowerCase().trim();

    if (normalized === "allow") return "allow";
    if (normalized === "deny") return "deny";
    if (normalized === "require_attestation") return "require_attestation";
    if (normalized === "escalate") return "escalate";

    return "allow";
  }

  private evaluateWithHeuristics(
    request: R6ModelRequest,
    startTime: number,
  ): PolicyModelDecision {
    const processingMs = Date.now() - startTime;

    if (this.heuristicPolicy) {
      // Map action type to tool category for heuristic policy
      const toolCategory = this.actionTypeToCategory(request.action.type);
      const evaluation = this.heuristicPolicy.evaluate(
        request.action.toolName,
        toolCategory,
        request.action.target,
      );

      // Map heuristic decision to model decision type
      let decision: PolicyModelDecision["decision"] = "allow";
      if (evaluation.decision === "deny") {
        decision = "deny";
      } else if (evaluation.decision === "warn") {
        decision = "allow"; // warn is not blocking
      }

      return {
        decision,
        confidence: 0.7,
        reasoning:
          evaluation.reason || `Heuristic policy: ${evaluation.matchedRule?.name || "default"}`,
        policyReferences: evaluation.matchedRule ? [evaluation.matchedRule.id] : [],
        processingMs,
        source: "heuristic",
      };
    }

    // No heuristic policy - use basic trust check
    const avgTrust =
      (request.trustState.competence +
        request.trustState.reliability +
        request.trustState.integrity) /
      3;

    if (avgTrust < 0.3) {
      return {
        decision: "deny",
        confidence: 0.6,
        reasoning: "Trust score below minimum threshold",
        policyReferences: ["trust.minimum"],
        processingMs,
        source: "fallback",
      };
    }

    if (avgTrust < 0.5) {
      return {
        decision: "require_attestation",
        confidence: 0.6,
        reasoning: "Trust score moderate, requiring attestation",
        policyReferences: ["trust.attestation_threshold"],
        processingMs,
        source: "fallback",
      };
    }

    return {
      ...DEFAULT_POLICY_MODEL_DECISION,
      processingMs,
    };
  }

  private evaluateOutcomeHeuristic(outcome: ToolOutcome, startTime: number): PolicyModelDecision {
    const processingMs = Date.now() - startTime;

    if (outcome.success) {
      return {
        decision: "allow",
        confidence: 0.8,
        reasoning: "Action completed successfully",
        policyReferences: [],
        processingMs,
        source: "heuristic",
      };
    }

    if (outcome.sideEffects && outcome.sideEffects.length > 0) {
      return {
        decision: "escalate",
        confidence: 0.7,
        reasoning: `Action failed with side effects: ${outcome.sideEffects.join(", ")}`,
        policyReferences: ["audit.side_effects"],
        processingMs,
        source: "heuristic",
      };
    }

    return {
      decision: "allow",
      confidence: 0.6,
      reasoning: `Action failed: ${outcome.error || "unknown error"}`,
      policyReferences: [],
      processingMs,
      source: "heuristic",
    };
  }

  private updateMetrics(
    type: "preToolMs" | "postToolMs",
    durationMs: number,
    result?: { promptTokens: number; completionTokens: number },
  ): void {
    this.inferenceMetrics[type] = durationMs;
    if (result) {
      this.inferenceMetrics.promptTokens += result.promptTokens;
      this.inferenceMetrics.completionTokens += result.completionTokens;
      this.inferenceMetrics.totalTokens =
        this.inferenceMetrics.promptTokens + this.inferenceMetrics.completionTokens;
    }
  }

  /**
   * Map action type to tool category for heuristic policy evaluation
   */
  private actionTypeToCategory(
    actionType: ActionType,
  ): "file_read" | "file_write" | "command" | "network" | "delegation" | "state" | "mcp" | "unknown" {
    switch (actionType) {
      case "file_operation":
        return "file_write";
      case "data_access":
        return "file_read";
      case "network_operation":
        return "network";
      case "system_operation":
        return "command";
      case "code_change":
        return "file_write";
      case "tool_call":
      default:
        return "unknown";
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a PolicyModel with default Phi-4 Mini configuration
 */
export function createPolicyModel(modelPath: string, actorId?: string): PolicyModel {
  return new PolicyModel(
    {
      modelPath,
      contextWindowSize: 4096,
      maxInferenceMs: 2000,
      enabled: true,
      temperature: 0.1,
    },
    actorId,
  );
}

/**
 * Create a PolicyModel in heuristic-only mode (no LLM)
 */
export function createHeuristicOnlyPolicyModel(actorId?: string): PolicyModel {
  return new PolicyModel(
    {
      modelPath: "",
      enabled: false,
    },
    actorId,
  );
}

/**
 * Create an R6ModelRequest from tool call parameters
 */
export function createR6ModelRequest(
  actorId: string,
  toolName: string,
  target: string,
  params?: Record<string, unknown>,
  options?: {
    type?: ActionType;
    intent?: string;
    trustState?: { competence: number; reliability: number; integrity: number };
    coherenceState?: {
      d9Score: number;
      selfReferenceRate: number;
      couplingState?: "coupled" | "quality_leading" | "identity_leading" | "decoupled";
    };
  },
): R6ModelRequest {
  return {
    requestId: randomUUID(),
    actorId,
    action: {
      type: options?.type ?? "tool_call",
      toolName,
      target,
      parameters: params,
    },
    context: {
      intent: options?.intent,
    },
    trustState: options?.trustState ?? {
      competence: 0.8,
      reliability: 0.8,
      integrity: 0.8,
    },
    coherenceState: options?.coherenceState,
    timestamp: new Date().toISOString(),
  };
}
