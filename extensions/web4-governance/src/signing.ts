/**
 * Signing - Ed25519 cryptographic signatures for audit records.
 *
 * Each session generates a unique Ed25519 keypair. The private key is stored
 * in session state (hex-encoded), and the public key is used as the keyId.
 * Signatures provide non-repudiation: even if an attacker gains file access,
 * they cannot forge valid signatures without the private key.
 */

import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from "node:crypto";

export type SigningKeyPair = {
  /** Hex-encoded private key (keep secret, store in session state) */
  privateKeyHex: string;
  /** Hex-encoded public key (used as keyId, safe to expose) */
  publicKeyHex: string;
  /** Short key ID for display (first 16 chars of public key hex) */
  keyId: string;
};

/**
 * Generate a new Ed25519 keypair for signing audit records.
 */
export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  // Export keys as raw bytes then hex-encode
  const privateKeyDer = privateKey.export({ type: "pkcs8", format: "der" });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });

  const privateKeyHex = privateKeyDer.toString("hex");
  const publicKeyHex = publicKeyDer.toString("hex");

  return {
    privateKeyHex,
    publicKeyHex,
    keyId: publicKeyHex.slice(-32), // Last 32 hex chars (16 bytes) as short ID
  };
}

/**
 * Sign data with a private key.
 * @param data - The data to sign (will be UTF-8 encoded)
 * @param privateKeyHex - Hex-encoded private key from generateSigningKeyPair
 * @returns Hex-encoded signature
 */
export function signData(data: string, privateKeyHex: string): string {
  const privateKeyDer = Buffer.from(privateKeyHex, "hex");
  const privateKey = createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });

  const signature = sign(null, Buffer.from(data, "utf-8"), privateKey);
  return signature.toString("hex");
}

/**
 * Verify a signature against data and public key.
 * @param data - The original data that was signed
 * @param signatureHex - Hex-encoded signature
 * @param publicKeyHex - Hex-encoded public key
 * @returns true if signature is valid
 */
export function verifySignature(data: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const publicKeyDer = Buffer.from(publicKeyHex, "hex");
    const publicKey = createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });

    const signature = Buffer.from(signatureHex, "hex");
    return verify(null, Buffer.from(data, "utf-8"), publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Extract the keyId from a public key hex string.
 */
export function keyIdFromPublicKey(publicKeyHex: string): string {
  return publicKeyHex.slice(-32);
}
