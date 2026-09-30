import {
  canonicalBrowserOrigin,
} from "../ops/exact-browser-origin-policy.ts";
import {
  validateSlaPolicy,
  type CaseSlaPolicy,
  type SlaDurations,
} from "../operations/sla.ts";

export type CareOpsDeploymentStage =
  | "staging"
  | "production";

export interface CareOpsDeploymentEnvironment {
  stage: CareOpsDeploymentStage;
  supabaseUrl: string;
  publishableKey: string;
  secretKey?: string;
  serviceRoleKey?: string;
  consoleOrigins: readonly string[];
  slaPolicies: Readonly<Record<string, CaseSlaPolicy>>;
  outboundTimeoutMs: number;
  maxCommandBodyBytes: number;
}

export type DeploymentEnvironmentInput =
  Readonly<Record<string, string | undefined>>;

const DEFAULT_OUTBOUND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_COMMAND_BODY_BYTES = 32 * 1024;

const PRIORITIES = [
  "critical",
  "high",
  "normal",
  "low",
] as const;

const SLA_FIELDS = [
  "acknowledgeWithinMs",
  "assignWithinMs",
  "firstActionWithinMs",
  "handoffAcceptWithinMs",
  "completeWithinMs",
] as const;

const FORBIDDEN_RUNTIME_SECRET_VARS = [
  "CARE_OPS_MEMBERSHIP_ADMIN_SECRET",
  "CARE_OPS_OUTBOX_PROVIDER_SECRET",
  "CARE_OPS_BACKUP_OPERATOR_SECRET",
] as const;

function required(
  input: DeploymentEnvironmentInput,
  name: string,
): string {
  const value = input[name]?.trim();

  if (!value) {
    throw new Error(
      `deployment environment variable ${name} is required`,
    );
  }

  return value;
}

function optional(
  input: DeploymentEnvironmentInput,
  name: string,
): string | undefined {
  const value = input[name]?.trim();
  return value || undefined;
}

function optionalInteger(
  input: DeploymentEnvironmentInput,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = input[name]?.trim();

  if (!raw) {
    return fallback;
  }

  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(
      `deployment environment variable ${name} must be an integer`,
    );
  }

  const value = Number(raw);

  if (
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `deployment environment variable ${name} must be between ${min} and ${max}`,
    );
  }

  return value;
}

function parseStage(
  input: DeploymentEnvironmentInput,
): CareOpsDeploymentStage {
  const value = required(
    input,
    "CARE_OPS_ENVIRONMENT",
  );

  if (
    value !== "staging" &&
    value !== "production"
  ) {
    throw new Error(
      "CARE_OPS_ENVIRONMENT must be staging or production",
    );
  }

  return value;
}

function parseSupabaseUrl(
  input: DeploymentEnvironmentInput,
): string {
  const raw = required(
    input,
    "SUPABASE_URL",
  );
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "SUPABASE_URL must be a valid URL",
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      "SUPABASE_URL must use https in staging/production",
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "SUPABASE_URL must not contain credentials, query, or fragment",
    );
  }

  return url.toString().replace(/\/$/, "");
}

function parseOrigins(
  input: DeploymentEnvironmentInput,
): readonly string[] {
  const raw = required(
    input,
    "CARE_OPS_CONSOLE_ORIGINS",
  );

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length < 1) {
    throw new Error(
      "at least one Console origin is required",
    );
  }

  const canonical = values.map(
    canonicalBrowserOrigin,
  );

  if (
    new Set(canonical).size !==
    canonical.length
  ) {
    throw new Error(
      "CARE_OPS_CONSOLE_ORIGINS must not contain duplicates",
    );
  }

  return canonical;
}

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `${label} must be an object`,
    );
  }

  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);

  if (
    actual.length !== allowed.length ||
    actual.some(
      (key) => !allowed.includes(key),
    )
  ) {
    throw new Error(
      `${label} has unexpected or missing fields`,
    );
  }
}

function parseSlaPolicy(
  value: unknown,
  tenantId: string,
): CaseSlaPolicy {
  const policy = object(
    value,
    `SLA policy for tenant ${tenantId}`,
  );

  exactKeys(
    policy,
    PRIORITIES,
    `SLA policy for tenant ${tenantId}`,
  );

  const result: Partial<CaseSlaPolicy> = {};

  for (const priority of PRIORITIES) {
    const rule = object(
      policy[priority],
      `SLA policy ${tenantId}.${priority}`,
    );

    exactKeys(
      rule,
      SLA_FIELDS,
      `SLA policy ${tenantId}.${priority}`,
    );

    const parsedRule: SlaDurations = {
      acknowledgeWithinMs: 0,
      assignWithinMs: 0,
      firstActionWithinMs: 0,
      handoffAcceptWithinMs: 0,
      completeWithinMs: 0,
    };

    for (const field of SLA_FIELDS) {
      const duration = rule[field];

      if (
        typeof duration !== "number" ||
        !Number.isSafeInteger(duration) ||
        duration < 0
      ) {
        throw new Error(
          `SLA policy ${tenantId}.${priority}.${field} must be a non-negative integer`,
        );
      }

      parsedRule[field] = duration;
    }

    result[priority] = parsedRule;
  }

  const complete =
    result as CaseSlaPolicy;

  validateSlaPolicy(complete);
  return complete;
}

function parseSlaPolicies(
  input: DeploymentEnvironmentInput,
): Readonly<Record<string, CaseSlaPolicy>> {
  const raw = required(
    input,
    "CARE_OPS_SLA_POLICIES_JSON",
  );

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "CARE_OPS_SLA_POLICIES_JSON must contain valid JSON",
    );
  }

  const policies = object(
    parsed,
    "CARE_OPS_SLA_POLICIES_JSON",
  );
  const entries =
    Object.entries(policies);

  if (entries.length < 1) {
    throw new Error(
      "at least one tenant SLA policy is required",
    );
  }

  const result: Record<
    string,
    CaseSlaPolicy
  > = {};

  for (const [tenantId, policy] of entries) {
    const normalizedTenant =
      tenantId.trim();

    if (
      normalizedTenant !== tenantId ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
        tenantId,
      )
    ) {
      throw new Error(
        "tenant SLA policy key is invalid",
      );
    }

    result[tenantId] =
      parseSlaPolicy(
        policy,
        tenantId,
      );
  }

  return result;
}

function assertSecretSeparation(
  input: DeploymentEnvironmentInput,
  publishableKey: string,
  serverCredentialKey: string,
): void {
  if (
    publishableKey ===
    serverCredentialKey
  ) {
    throw new Error(
      "Supabase publishable and server credentials must be different",
    );
  }

  for (
    const name of
      FORBIDDEN_RUNTIME_SECRET_VARS
  ) {
    if (input[name]?.trim()) {
      throw new Error(
        `${name} must not be present in the Care Ops API runtime environment`,
      );
    }
  }
}

export function parseCareOpsDeploymentEnvironment(
  input: DeploymentEnvironmentInput,
): CareOpsDeploymentEnvironment {
  const stage = parseStage(input);
  const supabaseUrl =
    parseSupabaseUrl(input);
  const publishableKey = required(
    input,
    "SUPABASE_PUBLISHABLE_KEY",
  );
  const secretKey = optional(
    input,
    "SUPABASE_SECRET_KEY",
  );
  const serviceRoleKey = optional(
    input,
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  if (!secretKey && !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required",
    );
  }

  if (
    secretKey &&
    !secretKey.startsWith(
      "sb_secret_",
    )
  ) {
    throw new Error(
      "SUPABASE_SECRET_KEY must use the sb_secret_ format",
    );
  }

  if (
    serviceRoleKey?.startsWith(
      "sb_secret_",
    )
  ) {
    throw new Error(
      "sb_secret_ credentials must use SUPABASE_SECRET_KEY",
    );
  }

  assertSecretSeparation(
    input,
    publishableKey,
    secretKey ?? serviceRoleKey!,
  );

  return {
    stage,
    supabaseUrl,
    publishableKey,
    secretKey,
    serviceRoleKey,
    consoleOrigins:
      parseOrigins(input),
    slaPolicies:
      parseSlaPolicies(input),
    outboundTimeoutMs:
      optionalInteger(
        input,
        "CARE_OPS_OUTBOUND_TIMEOUT_MS",
        DEFAULT_OUTBOUND_TIMEOUT_MS,
        100,
        60_000,
      ),
    maxCommandBodyBytes:
      optionalInteger(
        input,
        "CARE_OPS_MAX_COMMAND_BODY_BYTES",
        DEFAULT_MAX_COMMAND_BODY_BYTES,
        1_024,
        1_048_576,
      ),
  };
}
