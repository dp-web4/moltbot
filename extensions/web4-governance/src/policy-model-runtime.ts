/**
 * Model Runtime
 *
 * Abstraction layer for local LLM inference. Supports GGUF format via
 * node-llama-cpp with fallback strategies.
 *
 * Primary model recommendation: Microsoft Phi-4 Mini (3.8B)
 * - MIT license (fully permissive)
 * - 2.49GB quantized (Q4_K_M)
 * - 15-25 tok/s on CPU
 */

import { existsSync, createReadStream, statSync } from "node:fs";
import { createHash } from "node:crypto";
import type {
  ModelStatus,
  ModelMetadata,
  InferenceOptions,
  InferenceResult,
} from "./policy-model-types.js";
import { PolicyModelError } from "./policy-model-types.js";

// =============================================================================
// Types
// =============================================================================

export interface RuntimeConfig {
  /** Path to the model file */
  modelPath: string;
  /** Number of threads for inference */
  threads?: number;
  /** Context size in tokens */
  contextSize?: number;
  /** GPU layers to offload (0 = CPU only) */
  gpuLayers?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

const DEFAULT_RUNTIME_CONFIG: Required<Omit<RuntimeConfig, "modelPath">> = {
  threads: 4,
  contextSize: 4096,
  gpuLayers: 0,
  verbose: false,
};

// =============================================================================
// Model Runtime Implementation
// =============================================================================

/**
 * Model runtime for local LLM inference
 *
 * This is an abstraction that can work with:
 * 1. node-llama-cpp (GGUF models)
 * 2. ONNX Runtime (ONNX models)
 * 3. Mock mode for testing
 *
 * Currently implements mock mode until node-llama-cpp is added as dependency.
 */
export class ModelRuntime {
  private config: Required<RuntimeConfig>;
  private status: ModelStatus = "unloaded";
  private metadata: ModelMetadata | null = null;
  private llamaContext: unknown = null;
  private modelHash: string | null = null;

  constructor(config: RuntimeConfig) {
    this.config = {
      ...DEFAULT_RUNTIME_CONFIG,
      ...config,
    };
  }

  /**
   * Load the model into memory
   */
  async load(): Promise<void> {
    if (this.status === "loading") {
      throw new PolicyModelError("Model is already loading", "MODEL_LOAD_FAILED");
    }

    if (this.status === "ready") {
      return;
    }

    this.status = "loading";

    try {
      // Verify model file exists
      if (!existsSync(this.config.modelPath)) {
        throw new PolicyModelError(
          `Model file not found: ${this.config.modelPath}`,
          "MODEL_NOT_FOUND",
        );
      }

      // Compute model hash
      this.modelHash = await this.computeModelHash();

      // Detect model format and extract metadata
      this.metadata = await this.extractMetadata();

      // Check if node-llama-cpp is available
      const llamaCppAvailable = await this.checkLlamaCppAvailable();

      if (llamaCppAvailable) {
        await this.loadWithLlamaCpp();
      } else {
        // Fall back to mock mode
        if (this.config.verbose) {
          console.warn(
            "[PolicyModel] node-llama-cpp not available, running in mock mode. " +
              "Install with: npm install node-llama-cpp",
          );
        }
        await this.loadMockMode();
      }

      this.status = "ready";
    } catch (error) {
      this.status = "error";
      if (error instanceof PolicyModelError) {
        throw error;
      }
      throw new PolicyModelError(
        `Failed to load model: ${error instanceof Error ? error.message : String(error)}`,
        "MODEL_LOAD_FAILED",
        { originalError: error },
      );
    }
  }

  /**
   * Unload the model from memory
   */
  async unload(): Promise<void> {
    if (this.llamaContext) {
      this.llamaContext = null;
    }
    this.status = "unloaded";
    this.metadata = null;
    this.modelHash = null;
  }

  /**
   * Run inference on the model
   */
  async infer(prompt: string, options: InferenceOptions = {}): Promise<InferenceResult> {
    if (this.status !== "ready") {
      throw new PolicyModelError(
        `Model not ready for inference: ${this.status}`,
        "INFERENCE_FAILED",
      );
    }

    const startTime = Date.now();
    const timeout = options.timeoutMs ?? 2000;

    const mergedOptions: Required<InferenceOptions> = {
      maxTokens: options.maxTokens ?? 256,
      temperature: options.temperature ?? 0.1,
      stopSequences: options.stopSequences ?? ["\n\n", "</decision>"],
      timeoutMs: timeout,
    };

    try {
      // Check if we're in mock mode
      if (!this.llamaContext) {
        return this.mockInference(prompt, mergedOptions, startTime);
      }

      // Real inference with node-llama-cpp
      return await this.realInference(prompt, mergedOptions, startTime, timeout);
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof PolicyModelError) {
        throw error;
      }

      // Check for timeout
      if (duration >= timeout) {
        return {
          text: "",
          promptTokens: this.estimateTokens(prompt),
          completionTokens: 0,
          durationMs: duration,
          truncated: false,
          timedOut: true,
        };
      }

      throw new PolicyModelError(
        `Inference failed: ${error instanceof Error ? error.message : String(error)}`,
        "INFERENCE_FAILED",
        { originalError: error },
      );
    }
  }

  /**
   * Get current model status
   */
  getStatus(): ModelStatus {
    return this.status;
  }

  /**
   * Get model metadata
   */
  getMetadata(): ModelMetadata | null {
    return this.metadata;
  }

  /**
   * Get model hash (for attestation)
   */
  getModelHash(): string | null {
    return this.modelHash;
  }

  /**
   * Check if model is ready for inference
   */
  isReady(): boolean {
    return this.status === "ready";
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async computeModelHash(): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(this.config.modelPath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  private async extractMetadata(): Promise<ModelMetadata> {
    const stats = statSync(this.config.modelPath);
    const fileName = this.config.modelPath.split("/").pop() || "unknown";

    // Parse model info from filename (common convention)
    const isGguf = fileName.endsWith(".gguf");
    const isOnnx = fileName.endsWith(".onnx");

    // Extract name and version from filename
    const baseName = fileName.replace(/\.gguf$|\.onnx$/, "");
    const parts = baseName.split("-");

    return {
      name: parts.slice(0, -1).join("-") || baseName,
      version: parts[parts.length - 1] || "unknown",
      format: isGguf ? "gguf" : isOnnx ? "onnx" : "gguf",
      sizeBytes: stats.size,
      hash: this.modelHash!,
      contextSize: this.config.contextSize,
      license: this.inferLicense(baseName),
    };
  }

  private inferLicense(modelName: string): string {
    const nameLower = modelName.toLowerCase();

    if (nameLower.includes("phi")) return "MIT";
    if (nameLower.includes("llama")) return "Llama Community License";
    if (nameLower.includes("gemma")) return "Gemma Terms of Use";
    if (nameLower.includes("mistral")) return "Apache 2.0";
    if (nameLower.includes("smollm")) return "Apache 2.0";

    return "Unknown";
  }

  private async checkLlamaCppAvailable(): Promise<boolean> {
    try {
      const dynamicImport = new Function("specifier", "return import(specifier)");
      await dynamicImport("node-llama-cpp");
      return true;
    } catch {
      return false;
    }
  }

  private async loadWithLlamaCpp(): Promise<void> {
    const dynamicImport = new Function("specifier", "return import(specifier)");
    const { getLlama } = await dynamicImport("node-llama-cpp");

    // Use CUDA for GPU acceleration when gpuLayers > 0
    const gpuSetting = this.config.gpuLayers > 0 ? "cuda" : false;

    if (this.config.verbose) {
      console.log(`[PolicyModel] Loading with GPU setting: ${gpuSetting}`);
    }

    const llama = await getLlama({
      gpu: gpuSetting,
    });

    const model = await llama.loadModel({
      modelPath: this.config.modelPath,
    });

    this.llamaContext = await model.createContext({
      contextSize: this.config.contextSize,
    });

    if (this.config.verbose) {
      console.log(
        `[PolicyModel] Model loaded successfully with context size: ${this.config.contextSize}`,
      );
    }
  }

  private async loadMockMode(): Promise<void> {
    // Mock mode - no actual model loaded
    this.llamaContext = null;
  }

  private async realInference(
    prompt: string,
    options: Required<InferenceOptions>,
    startTime: number,
    timeout: number,
  ): Promise<InferenceResult> {
    const dynamicImport = new Function("specifier", "return import(specifier)");
    const { LlamaChatSession } = await dynamicImport("node-llama-cpp");

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Inference timeout")), timeout);
    });

    // Track session for cleanup
    let session: any = null;
    let sequence: any = null;

    const inferencePromise = (async () => {
      const context = this.llamaContext as any;

      // Get a fresh sequence for this inference
      sequence = context.getSequence();
      session = new LlamaChatSession({
        contextSequence: sequence,
      });

      const response = await session.prompt(prompt, {
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });

      return response;
    })();

    try {
      const response = await Promise.race([inferencePromise, timeoutPromise]);
      const duration = Date.now() - startTime;

      return {
        text: String(response),
        promptTokens: this.estimateTokens(prompt),
        completionTokens: this.estimateTokens(String(response)),
        durationMs: duration,
        truncated: false,
        timedOut: false,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (duration >= timeout) {
        return {
          text: "",
          promptTokens: this.estimateTokens(prompt),
          completionTokens: 0,
          durationMs: duration,
          truncated: false,
          timedOut: true,
        };
      }

      throw error;
    } finally {
      // Clean up session and sequence to release context resources
      if (session) {
        try {
          session.dispose?.();
        } catch {
          // Ignore disposal errors
        }
      }
      if (sequence) {
        try {
          sequence.dispose?.();
        } catch {
          // Ignore disposal errors
        }
      }
    }
  }

  private mockInference(
    prompt: string,
    _options: Required<InferenceOptions>,
    startTime: number,
  ): InferenceResult {
    // Mock inference for development/testing
    const decision = this.mockDecision(prompt);
    const duration = Date.now() - startTime + Math.random() * 50;

    return {
      text: decision,
      promptTokens: this.estimateTokens(prompt),
      completionTokens: this.estimateTokens(decision),
      durationMs: duration,
      truncated: false,
      timedOut: false,
    };
  }

  private mockDecision(prompt: string): string {
    const promptLower = prompt.toLowerCase();

    // Check for dangerous patterns
    const dangerousPatterns = [
      "rm -rf",
      "delete all",
      "drop table",
      "format disk",
      "sudo",
      "chmod 777",
      "eval(",
      "exec(",
      "/etc/passwd",
      "/etc/shadow",
      "credentials",
      ".env",
    ];

    const hasDangerousPattern = dangerousPatterns.some((p) => promptLower.includes(p));

    // Check for low trust indicators
    const lowTrustIndicators = ["trust: 0.", "competence: 0.", "integrity: 0."];
    const hasLowTrust = lowTrustIndicators.some(
      (i) => promptLower.includes(i) && !promptLower.includes(i + "5"),
    );

    if (hasDangerousPattern) {
      return JSON.stringify({
        decision: "deny",
        confidence: 0.95,
        reasoning: "Detected potentially dangerous operation pattern",
        policyReferences: ["security.dangerous_operations"],
      });
    }

    if (hasLowTrust) {
      return JSON.stringify({
        decision: "require_attestation",
        confidence: 0.8,
        reasoning: "Low trust scores detected, requiring fresh attestation",
        policyReferences: ["trust.minimum_threshold"],
      });
    }

    // Default: allow
    return JSON.stringify({
      decision: "allow",
      confidence: 0.85,
      reasoning: "Action appears within normal operating parameters",
      policyReferences: ["general.default_allow"],
    });
  }

  private estimateTokens(text: string): number {
    // Rough token estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a model runtime with recommended settings for Phi-4 Mini (CPU)
 */
export function createPhi4MiniRuntime(modelPath: string): ModelRuntime {
  return new ModelRuntime({
    modelPath,
    threads: 4,
    contextSize: 4096,
    gpuLayers: 0,
    verbose: false,
  });
}

/**
 * Create a GPU-accelerated model runtime
 */
export function createGpuAcceleratedRuntime(modelPath: string): ModelRuntime {
  return new ModelRuntime({
    modelPath,
    threads: 4,
    contextSize: 4096,
    gpuLayers: 99,
    verbose: true,
  });
}

/**
 * Create a lightweight runtime for smaller models
 */
export function createLightweightRuntime(modelPath: string): ModelRuntime {
  return new ModelRuntime({
    modelPath,
    threads: 2,
    contextSize: 2048,
    gpuLayers: 0,
    verbose: false,
  });
}
