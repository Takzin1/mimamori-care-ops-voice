export interface RepositoryGovernanceReport {
  passed: boolean;
  protected: boolean;
  protectionEnabled: boolean;
  requiredStatusChecksEnforced: boolean;
  requiredChecks: readonly string[];
  configuredChecks: readonly string[];
  missingChecks: readonly string[];
}

interface BranchProtectionSnapshot {
  protected?: unknown;
  protection?: {
    enabled?: unknown;
    required_status_checks?: {
      enforcement_level?: unknown;
      contexts?: unknown;
      checks?: unknown;
    };
  };
}

function stringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.length > 0,
  );
}

function checkContexts(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const contexts: string[] = [];

  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      "context" in item &&
      typeof item.context === "string" &&
      item.context.length > 0
    ) {
      contexts.push(item.context);
    }
  }

  return contexts;
}

export function evaluateRepositoryGovernance(
  snapshot: BranchProtectionSnapshot,
  requiredChecks: readonly string[] = [
    "verify",
    "postgres-integration",
  ],
): RepositoryGovernanceReport {
  const protectedBranch =
    snapshot.protected === true;
  const protectionEnabled =
    snapshot.protection?.enabled === true;

  const status =
    snapshot.protection
      ?.required_status_checks;

  const configuredChecks = [
    ...stringArray(status?.contexts),
    ...checkContexts(status?.checks),
  ].filter(
    (value, index, values) =>
      values.indexOf(value) === index,
  );

  const enforcementLevel =
    typeof status?.enforcement_level ===
    "string"
      ? status.enforcement_level
      : "off";

  const requiredStatusChecksEnforced =
    enforcementLevel !== "off";

  const missingChecks =
    requiredChecks.filter(
      (name) =>
        !configuredChecks.includes(name),
    );

  return {
    passed:
      protectedBranch &&
      protectionEnabled &&
      requiredStatusChecksEnforced &&
      missingChecks.length === 0,
    protected: protectedBranch,
    protectionEnabled,
    requiredStatusChecksEnforced,
    requiredChecks: [...requiredChecks],
    configuredChecks,
    missingChecks,
  };
}
