/**
 * Policy Model Types
 *
 * Type definitions for the local policy model that provides semantic
 * understanding of actions for intelligent policy enforcement.
 *
 * This implements the "literally smart contract" concept - policy that
 * can reason about context, not just pattern-match.
 */

// =============================================================================
// Policy Model Configuration
// =============================================================================

/**
 * Configuration for the PolicyModel
 */
export interface PolicyModelConfig {
  /** Path to GGUF/ONNX model file */
  modelPath: string;
  /** Path to pre-computed policy embeddings */
  policyEmbeddingsPath?: string;
  /** Context window size in tokens (e.g., 4096) */
  contextWindowSize: number;
  /** Maximum inference time in milliseconds */
  maxInferenceMs: number;
  /** Whether to enable model inference (false = heuristic fallback only) */
  enabled: boolean;
  /** Model temperature for inference (0-1, lower = more deterministic) */
  temperature?: number;
  /** Number of threads for inference */
  threads?: number;
  /** GPU layers to offload (0 = CPU only) */
  gpuLayers?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_POLICY_MODEL_CONFIG: Partial<PolicyModelConfig> = {
  contextWindowSize: 4096,
  maxInferenceMs: 2000,
  enabled: true,
  temperature: 0.1,
  threads: 4,
  gpuLayers: 0,
};

// =============================================================================
// Policy Decision Types
// =============================================================================

/**
 * Decision made by the policy model
 */
export type PolicyModelDecisionType =
  | "allow" // Action permitted
  | "deny" // Action blocked
  | "require_attestation" // Needs fresh attestation
  | "escalate"; // Requires human review

/**
 * Policy decision with reasoning and metadata
 */
export interface PolicyModelDecision {
  /** The decision outcome */
  decision: PolicyModelDecisionType;
  /** Model confidence in the decision (0-1) */
  confidence: number;
  /** Brief explanation of the decision */
  reasoning: string;
  /** Which policies informed this decision */
  policyReferences: string[];
  /** Time taken for inference in milliseconds */
  processingMs: number;
  /** Whether this decision came from the model or fallback heuristics */
  source: "model" | "heuristic" | "fallback";
}

/**
 * Default decision for fallback scenarios
 */
export const DEFAULT_POLICY_MODEL_DECISION: PolicyModelDecision = {
  decision: "allow",
  confidence: 0.5,
  reasoning: "No policy model available, using default allow",
  policyReferences: [],
  processingMs: 0,
  source: "fallback",
};

// =============================================================================
// R6 Request Types (Tool Use Representation)
// =============================================================================

/**
 * Action types that can be evaluated
 */
export type ActionType =
  | "tool_call"
  | "code_change"
  | "data_access"
  | "file_operation"
  | "network_operation"
  | "system_operation";

/**
 * R6 Request - Represents a proposed tool use for policy evaluation
 *
 * Named after the R6 framework for tool use representation in Web4.
 */
export interface R6ModelRequest {
  /** Unique identifier for this request */
  requestId: string;
  /** Actor making the request (session/agent ID) */
  actorId: string;
  /** The proposed action */
  action: {
    type: ActionType;
    toolName: string;
    target: string;
    parameters?: Record<string, unknown>;
    /** Human-readable description of the action */
    description?: string;
  };
  /** Context for the action */
  context: {
    /** Session identifier */
    sessionId?: string;
    /** Previous actions in this session */
    previousActions?: string[];
    /** Stated intent for this action */
    intent?: string;
    /** Risk assessment by the caller */
    callerRiskAssessment?: "low" | "medium" | "high" | "critical";
  };
  /** Current trust state */
  trustState: {
    competence: number;
    reliability: number;
    integrity: number;
  };
  /** Current coherence state */
  coherenceState?: {
    d9Score: number;
    selfReferenceRate: number;
    couplingState?: "coupled" | "quality_leading" | "identity_leading" | "decoupled";
  };
  /** Timestamp of the request */
  timestamp: string;
}

/**
 * Outcome of a tool use for post-review
 */
export interface ToolOutcome {
  /** Whether the action succeeded */
  success: boolean;
  /** Result of the action (may be redacted) */
  result?: unknown;
  /** Hash of the full result */
  resultHash: string;
  /** Error message if failed */
  error?: string;
  /** Duration of the action in milliseconds */
  durationMs: number;
  /** Side effects observed */
  sideEffects?: string[];
}

// =============================================================================
// Policy Embedding Types
// =============================================================================

/**
 * Categories for policy organization
 */
export type PolicyCategory =
  | "security" // Security-related policies
  | "trust" // Trust threshold policies
  | "coherence" // Identity coherence policies
  | "access" // Resource access policies
  | "action" // Action-specific policies
  | "audit" // Audit requirements
  | "general"; // General policies

/**
 * Pre-computed embedding for a policy
 */
export interface PolicyEmbedding {
  /** Unique identifier for the policy */
  policyId: string;
  /** SHA-256 hash of policy content */
  policyHash: string;
  /** Vector representation of the policy */
  embedding: Float32Array;
  /** Compressed policy description */
  summary: string;
  /** When this policy became effective */
  effectiveDate: Date;
  /** Policy category for filtering */
  category: PolicyCategory;
  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * Configuration for the embedding store
 */
export interface PolicyEmbeddingStoreConfig {
  /** Path to embedding storage */
  storagePath: string;
  /** Embedding dimension (model-specific) */
  embeddingDimension: number;
  /** Maximum policies to load in memory */
  maxPoliciesInMemory?: number;
}

// =============================================================================
// Model Attestation Types
// =============================================================================

/**
 * Attestation of the policy model's state
 *
 * This binds the model and its policies to hardware for audit purposes.
 */
export interface PolicyModelAttestation {
  /** SHA-256 hash of model weights */
  modelHash: string;
  /** SHA-256 hash of policy embeddings */
  policyHash: string;
  /** Session/device identity */
  actorId: string;
  /** Type of binding (software, tpm, fido2, secure_enclave) */
  bindingType: string;
  /** When this attestation was created */
  attestedAt: Date;
  /** Signature of the attestation */
  signature: string;
  /** Model version identifier */
  modelVersion: string;
  /** Number of active policies */
  activePolicyCount: number;
}

/**
 * Metrics from model inference
 */
export interface InferenceMetrics {
  /** Pre-tool-use inference time in ms */
  preToolMs: number;
  /** Post-tool-use inference time in ms */
  postToolMs: number;
  /** Total tokens processed */
  totalTokens: number;
  /** Prompt tokens used */
  promptTokens: number;
  /** Completion tokens generated */
  completionTokens: number;
  /** Cache hit rate for embeddings */
  embeddingCacheHitRate?: number;
}

// =============================================================================
// Model Runtime Types
// =============================================================================

/**
 * Model inference options
 */
export interface InferenceOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for sampling */
  temperature?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Model inference result
 */
export interface InferenceResult {
  /** Generated text */
  text: string;
  /** Tokens used in prompt */
  promptTokens: number;
  /** Tokens generated */
  completionTokens: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Whether the result was truncated */
  truncated: boolean;
  /** Whether inference timed out */
  timedOut: boolean;
}

/**
 * Model loading status
 */
export type ModelStatus =
  | "unloaded" // Model not yet loaded
  | "loading" // Currently loading
  | "ready" // Ready for inference
  | "error" // Failed to load
  | "disabled"; // Explicitly disabled

/**
 * Model metadata
 */
export interface ModelMetadata {
  /** Model name (e.g., 'phi-4-mini') */
  name: string;
  /** Model version */
  version: string;
  /** Model format (gguf, onnx) */
  format: "gguf" | "onnx";
  /** Model size in bytes */
  sizeBytes: number;
  /** SHA-256 hash of model file */
  hash: string;
  /** Context window size */
  contextSize: number;
  /** License type */
  license: string;
}

// =============================================================================
// Audit Bundle Extension
// =============================================================================

/**
 * Policy model review data for audit bundles
 */
export interface PolicyModelReview {
  /** Pre-tool-use decision */
  preToolDecision: PolicyModelDecision;
  /** Post-tool-use decision (optional) */
  postToolDecision?: PolicyModelDecision;
  /** Model attestation at time of review */
  modelAttestation?: PolicyModelAttestation;
  /** Inference metrics */
  inferenceMetrics: InferenceMetrics;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Policy model error codes
 */
export type PolicyModelErrorCode =
  | "MODEL_NOT_FOUND"
  | "MODEL_LOAD_FAILED"
  | "INFERENCE_TIMEOUT"
  | "INFERENCE_FAILED"
  | "EMBEDDING_NOT_FOUND"
  | "ATTESTATION_FAILED"
  | "BINDING_FAILED"
  | "INVALID_CONFIG";

/**
 * Policy model specific errors
 */
export class PolicyModelError extends Error {
  constructor(
    message: string,
    public readonly code: PolicyModelErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PolicyModelError";
  }
}
