/**
 * Quick test for the policy model implementation
 */

import {
  PolicyModel,
  createR6ModelRequest,
} from "./extensions/web4-governance/src/policy-model.js";

const MODEL_PATH = "/home/dp/ai-workspace/models/phi-4-mini-instruct-Q4_K_M.gguf";

async function main() {
  console.log("=== Policy Model Test ===\n");

  // Create policy model
  const model = new PolicyModel(
    {
      modelPath: MODEL_PATH,
      maxInferenceMs: 10000, // Much faster on GPU
      enabled: true,
      gpuLayers: 99, // Offload all layers to GPU
    },
    "test-actor",
  );

  console.log("Initializing policy model...");
  await model.init();

  const status = model.getStatus();
  console.log(`Status: initialized=${status.initialized}, modelReady=${status.modelReady}\n`);

  // Test 1: Safe file read
  console.log("--- Test 1: Safe file read ---");
  const req1 = createR6ModelRequest("test-session", "Read", "/home/user/code/app.ts", {});
  const decision1 = await model.evaluatePreToolUse(req1);
  console.log(`Decision: ${decision1.decision}`);
  console.log(`Confidence: ${decision1.confidence}`);
  console.log(`Source: ${decision1.source}`);
  console.log(`Reasoning: ${decision1.reasoning}`);
  console.log(`Processing: ${decision1.processingMs}ms\n`);

  // Test 2: Dangerous command
  console.log("--- Test 2: Dangerous command ---");
  const req2 = createR6ModelRequest("test-session", "Bash", "rm -rf /", { command: "rm -rf /" });
  const decision2 = await model.evaluatePreToolUse(req2);
  console.log(`Decision: ${decision2.decision}`);
  console.log(`Confidence: ${decision2.confidence}`);
  console.log(`Source: ${decision2.source}`);
  console.log(`Reasoning: ${decision2.reasoning}`);
  console.log(`Processing: ${decision2.processingMs}ms\n`);

  // Test 3: Credential access
  console.log("--- Test 3: Credential access ---");
  const req3 = createR6ModelRequest("test-session", "Read", "/etc/passwd", {});
  const decision3 = await model.evaluatePreToolUse(req3);
  console.log(`Decision: ${decision3.decision}`);
  console.log(`Confidence: ${decision3.confidence}`);
  console.log(`Source: ${decision3.source}`);
  console.log(`Reasoning: ${decision3.reasoning}`);
  console.log(`Processing: ${decision3.processingMs}ms\n`);

  // Test 4: Normal bash command
  console.log("--- Test 4: Normal bash command ---");
  const req4 = createR6ModelRequest("test-session", "Bash", "git status", {
    command: "git status",
  });
  const decision4 = await model.evaluatePreToolUse(req4);
  console.log(`Decision: ${decision4.decision}`);
  console.log(`Confidence: ${decision4.confidence}`);
  console.log(`Source: ${decision4.source}`);
  console.log(`Reasoning: ${decision4.reasoning}`);
  console.log(`Processing: ${decision4.processingMs}ms\n`);

  // Attestation
  console.log("--- Attestation ---");
  const attestation = await model.attestPolicyState();
  console.log(`Model Hash: ${attestation.modelHash.slice(0, 32)}...`);
  console.log(`Policy Hash: ${attestation.policyHash}`);
  console.log(`Binding Type: ${attestation.bindingType}`);

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
