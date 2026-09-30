import {
  createCareOpsDeployment,
  type CareOpsDeploymentOptions,
} from "./create-care-ops-deployment.ts";
import {
  AssemblyAiRealtimeSessionIssuer,
  HmacVoiceIntegrity,
} from "../voice/index.ts";

export interface AssemblyAiVoiceCareOpsDeploymentOptions
extends Omit<
  CareOpsDeploymentOptions,
  "voiceSessionIssuer"
> {
  assemblyAiApiKey: string;
  voiceIntegritySecret: string;
  assemblyAiFetchImpl?: typeof fetch;
}

export function createAssemblyAiVoiceCareOpsDeployment(
  options:
    AssemblyAiVoiceCareOpsDeploymentOptions,
) {
  const {
    assemblyAiApiKey,
    voiceIntegritySecret,
    assemblyAiFetchImpl,
    ...careOps
  } = options;

  const voiceSessionIssuer =
    new AssemblyAiRealtimeSessionIssuer({
      apiKey:
        assemblyAiApiKey,
      fetchImpl:
        assemblyAiFetchImpl,
      now:
        options.clock,
    });

  return createCareOpsDeployment({
    ...careOps,
    voiceSessionIssuer,
    voiceIntegrity:
      new HmacVoiceIntegrity(
        voiceIntegritySecret,
      ),
  });
}
