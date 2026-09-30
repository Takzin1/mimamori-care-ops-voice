import {
  parseCareOpsDeploymentEnvironment,
  type DeploymentEnvironmentInput,
} from "./environment.ts";

export interface CareOpsDeploymentValidationSummary {
  status: "valid";
  stage: "staging" | "production";
  supabaseHost: string;
  consoleOriginCount: number;
  tenantPolicyCount: number;
  outboundTimeoutMs: number;
  maxCommandBodyBytes: number;
}

export function validateCareOpsDeploymentEnvironment(
  input: DeploymentEnvironmentInput,
): CareOpsDeploymentValidationSummary {
  const config =
    parseCareOpsDeploymentEnvironment(input);

  const supabaseHost =
    new URL(config.supabaseUrl).host;

  return {
    status: "valid",
    stage: config.stage,
    supabaseHost,
    consoleOriginCount:
      config.consoleOrigins.length,
    tenantPolicyCount:
      Object.keys(
        config.slaPolicies,
      ).length,
    outboundTimeoutMs:
      config.outboundTimeoutMs,
    maxCommandBodyBytes:
      config.maxCommandBodyBytes,
  };
}
