/**
 * Matchers - Glob and regex matching for policy rules.
 *
 * Used to match tool names, categories, and target strings
 * against policy rule criteria.
 */

import type { ToolCategory } from "./r6.js";
import type { PolicyMatch } from "./policy-types.js";

/**
 * Validate a regex pattern for potential ReDoS vulnerabilities.
 * Returns { valid: true } or { valid: false, reason: string }.
 *
 * Checks for common ReDoS patterns:
 * - Nested quantifiers: (a+)+ , (a*)*, (a+)*
 * - Overlapping alternations with quantifiers: (a|a)+
 * - Excessive backtracking patterns
 */
export function validateRegexPattern(pattern: string): { valid: true } | { valid: false; reason: string } {
  // Check for nested quantifiers (common ReDoS pattern)
  // Matches patterns like (.*)+, (.+)+, (a*)+, etc.
  const nestedQuantifier = /\([^)]*[*+]\)[*+?]|\([^)]*[*+?]\)\{/;
  if (nestedQuantifier.test(pattern)) {
    return { valid: false, reason: "Nested quantifiers detected (potential ReDoS)" };
  }

  // Check for exponential backtracking patterns
  // e.g., (a|a)+, (.*|.+)+
  const overlappingAlt = /\([^|)]+\|[^|)]+\)[*+]/;
  if (overlappingAlt.test(pattern)) {
    // More specific check: are the alternatives overlapping?
    const altMatch = pattern.match(/\(([^|)]+)\|([^|)]+)\)[*+]/);
    if (altMatch) {
      const [, alt1, alt2] = altMatch;
      // If either alternative is a superset wildcard, it's risky
      if (alt1 === ".*" || alt1 === ".+" || alt2 === ".*" || alt2 === ".+") {
        return { valid: false, reason: "Overlapping alternations with wildcards (potential ReDoS)" };
      }
    }
  }

  // Check for excessive quantifier chains: a{1,100}{1,100}
  const quantifierChain = /\{[^}]+\}\s*\{/;
  if (quantifierChain.test(pattern)) {
    return { valid: false, reason: "Chained quantifiers detected (potential ReDoS)" };
  }

  // Check pattern length (very long patterns can be problematic)
  if (pattern.length > 500) {
    return { valid: false, reason: "Pattern too long (max 500 characters)" };
  }

  // Try to compile the regex to catch syntax errors
  try {
    new RegExp(pattern);
  } catch (e) {
    return { valid: false, reason: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { valid: true };
}

/**
 * Validate all regex patterns in a PolicyMatch.
 * Returns array of validation errors (empty if all valid).
 */
export function validatePolicyMatchPatterns(match: PolicyMatch, ruleId: string): string[] {
  const errors: string[] = [];

  if (match.targetPatterns && match.targetPatternsAreRegex) {
    for (const pattern of match.targetPatterns) {
      const result = validateRegexPattern(pattern);
      if (!result.valid) {
        errors.push(`Rule "${ruleId}" pattern "${pattern}": ${result.reason}`);
      }
    }
  }

  return errors;
}

/**
 * Convert a glob pattern to a regex.
 * Supports: * (any chars except /), ** (any chars including /), ? (single char)
 */
export function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        // Skip trailing slash after **
        if (pattern[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Check if a value matches any entry in a string list (case-sensitive). */
export function matchesList(value: string, list: string[]): boolean {
  return list.includes(value);
}

/** Check if a target string matches any of the given patterns. */
export function matchesTarget(
  target: string | undefined,
  patterns: string[],
  useRegex: boolean,
): boolean {
  if (target === undefined) return false;
  for (const pattern of patterns) {
    if (useRegex) {
      if (new RegExp(pattern).test(target)) return true;
    } else {
      if (globToRegex(pattern).test(target)) return true;
    }
  }
  return false;
}

/**
 * Evaluate whether a tool call matches a PolicyMatch specification.
 * All specified criteria are AND'd: if tools, categories, and targetPatterns
 * are all specified, all must match.
 */
export function matchesRule(
  toolName: string,
  category: ToolCategory,
  target: string | undefined,
  match: PolicyMatch,
): boolean {
  // Each specified criterion must match (AND logic)
  if (match.tools && !matchesList(toolName, match.tools)) return false;
  if (match.categories && !matchesList(category, match.categories)) return false;
  if (match.targetPatterns) {
    if (!matchesTarget(target, match.targetPatterns, match.targetPatternsAreRegex ?? false)) {
      return false;
    }
  }
  return true;
}
