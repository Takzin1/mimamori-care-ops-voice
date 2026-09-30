import {
  PostgrestTenantMembershipDirectory,
} from "../access/postgrest-membership-directory.ts";
import {
  AuthenticatedCareOpsGateway,
} from "../application/authenticated-gateway.ts";
import {
  CaseQueueService,
} from "../application/queue-service.ts";
import {
  CaseService,
} from "../application/case-service.ts";
import {
  CareOpsHttpApi,
} from "../http/care-ops-http-api.ts";
import {
  VoicePlanHttpApi,
} from "../http/voice-plan-http-api.ts";
import {
  VoiceCommunicationHttpApi,
} from "../http/voice-communication-http-api.ts";
import {
  VoiceOutboxHealthHttpApi,
} from "../http/voice-outbox-health-http-api.ts";
import {
  VoiceSessionHttpApi,
} from "../http/voice-session-http-api.ts";
import type {
  RequestIdFactory,
} from "../http/types.ts";
import {
  SupabaseAuthAuthenticator,
} from "../identity/supabase-authenticator.ts";
import {
  createSupabaseServerCredential,
} from "../supabase/server-credential.ts";
import {
  InMemoryTenantSlaPolicyDirectory,
} from "../operations/policy-directory.ts";
import type {
  CaseSlaPolicy,
} from "../operations/sla.ts";
import {
  PostgrestCaseRepository,
} from "../persistence/postgrest-case-repository.ts";
import {
  PostgrestOutboxStore,
} from "../outbox/postgrest-outbox-store.ts";
import {
  PostgrestOutboxMonitor,
} from "../outbox/monitor.ts";
import {
  VoiceOpsService,
  type VoiceIntegrity,
  type VoiceRealtimeSessionIssuer,
} from "../voice/index.ts";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RuntimeClock = () => string;

export interface SupabaseCareOpsRuntimeOptions {
  supabaseUrl: string;
  publishableKey: string;
  secretKey?: string;
  serviceRoleKey?: string;
  slaPolicies: Readonly<Record<string, CaseSlaPolicy>>;
  voiceSessionIssuer?: VoiceRealtimeSessionIssuer;
  voiceOpsService?: VoiceOpsService;
  voiceIntegrity?: VoiceIntegrity;
  fetchImpl?: FetchLike;
  casePageSize?: number;
  outboundTimeoutMs?: number;
  maxCommandBodyBytes?: number;
  requestIdFactory?: RequestIdFactory;
  clock?: RuntimeClock;
}

function requiredText(
  value: string,
  label: string,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  return normalized;
}

function assertRuntimeConfig(
  options: SupabaseCareOpsRuntimeOptions,
): void {
  const publishableKey = requiredText(
    options.publishableKey,
    "Supabase publishable key",
  );
  const serverCredential =
    createSupabaseServerCredential({
      secretKey: options.secretKey,
      serviceRoleKey:
        options.serviceRoleKey,
    });

  requiredText(
    options.supabaseUrl,
    "Supabase URL",
  );

  if (
    publishableKey ===
    serverCredential.apiKey
  ) {
    throw new Error(
      "Supabase publishable and server credentials must be different",
    );
  }

  if (
    Object.keys(options.slaPolicies).length === 0
  ) {
    throw new Error(
      "At least one tenant SLA policy is required",
    );
  }
}

function voiceRouteKind(
  request: Request,
): "session" | "plan" | "communication" | "outbox-health" | null {
  const pathname =
    new URL(request.url)
      .pathname;

  if (
    /^\/api\/care-ops\/tenants\/[^/]+\/voice\/session$/.test(
      pathname,
    )
  ) {
    return "session";
  }

  if (
    /^\/api\/care-ops\/tenants\/[^/]+\/voice\/plan$/.test(
      pathname,
    )
  ) {
    return "plan";
  }

  if (
    /^\/api\/care-ops\/tenants\/[^/]+\/voice\/communications\/approve$/.test(
      pathname,
    )
  ) {
    return "communication";
  }

  if (
    /^\/api\/care-ops\/tenants\/[^/]+\/voice\/outbox\/health$/.test(
      pathname,
    )
  ) {
    return "outbox-health";
  }

  return null;
}

export class SupabaseCareOpsRuntime {
  readonly #http: CareOpsHttpApi;
  readonly #voiceSessionHttp:
    VoiceSessionHttpApi | null;
  readonly #voicePlanHttp:
    VoicePlanHttpApi | null;
  readonly #voiceCommunicationHttp:
    VoiceCommunicationHttpApi | null;
  readonly #voiceOutboxHealthHttp:
    VoiceOutboxHealthHttpApi | null;

  constructor(
    options: SupabaseCareOpsRuntimeOptions,
  ) {
    assertRuntimeConfig(options);

    const now =
      options.clock ??
      (() => new Date().toISOString());
    const serverCredential =
      createSupabaseServerCredential({
        secretKey: options.secretKey,
        serviceRoleKey:
          options.serviceRoleKey,
      });

    const authenticator =
      new SupabaseAuthAuthenticator({
        baseUrl: options.supabaseUrl,
        publishableKey:
          options.publishableKey,
        fetchImpl: options.fetchImpl,
        requestTimeoutMs:
          options.outboundTimeoutMs,
      });

    const memberships =
      new PostgrestTenantMembershipDirectory({
        baseUrl: options.supabaseUrl,
        serverCredential,
        fetchImpl: options.fetchImpl,
        requestTimeoutMs:
          options.outboundTimeoutMs,
      });

    const repository =
      new PostgrestCaseRepository({
        baseUrl: options.supabaseUrl,
        serverCredential,
        fetchImpl: options.fetchImpl,
        pageSize: options.casePageSize,
        requestTimeoutMs:
          options.outboundTimeoutMs,
      });

    const policies =
      new InMemoryTenantSlaPolicyDirectory(
        options.slaPolicies,
      );

    const caseService = new CaseService(
      repository,
      memberships,
      now,
    );

    const queueService =
      new CaseQueueService(
        repository,
        memberships,
        policies,
        now,
      );

    const gateway =
      new AuthenticatedCareOpsGateway({
        authenticator,
        caseService,
        queueService,
      });

    this.#http = new CareOpsHttpApi({
      gateway,
      maxCommandBodyBytes:
        options.maxCommandBodyBytes,
      requestIdFactory:
        options.requestIdFactory,
    });

    const voiceEnabled =
      Boolean(
        options.voiceSessionIssuer ||
        options.voiceOpsService,
      );

    if (
      voiceEnabled &&
      !options.voiceIntegrity
    ) {
      throw new Error(
        "Voice integrity is required when Voice Ops is enabled",
      );
    }

    this.#voiceSessionHttp =
      options.voiceSessionIssuer
        ? new VoiceSessionHttpApi({
            gateway,
            issuer:
              options.voiceSessionIssuer,
            integrity:
              options.voiceIntegrity!,
            now,
          })
        : null;

    this.#voicePlanHttp =
      voiceEnabled
        ? new VoicePlanHttpApi({
            gateway,
            service:
              options.voiceOpsService,
            integrity:
              options.voiceIntegrity!,
            now,
            maxBodyBytes:
              options.maxCommandBodyBytes,
          })
        : null;

    this.#voiceCommunicationHttp =
      voiceEnabled
        ? new VoiceCommunicationHttpApi({
            gateway,
            outbox:
              new PostgrestOutboxStore({
                baseUrl:
                  options.supabaseUrl,
                serverCredential,
                fetchImpl:
                  options.fetchImpl,
                requestTimeoutMs:
                  options.outboundTimeoutMs,
              }),
            integrity:
              options.voiceIntegrity!,
            now,
          })
        : null;

    this.#voiceOutboxHealthHttp =
      voiceEnabled
        ? new VoiceOutboxHealthHttpApi({
            gateway,
            monitor:
              new PostgrestOutboxMonitor({
                baseUrl:
                  options.supabaseUrl,
                serverCredential,
                fetchImpl:
                  options.fetchImpl,
                requestTimeoutMs:
                  options.outboundTimeoutMs,
              }),
          })
        : null;
  }

  handle(
    request: Request,
  ): Promise<Response> {
    const voiceRoute =
      voiceRouteKind(
        request,
      );

    if (
      voiceRoute === "session" &&
      this.#voiceSessionHttp
    ) {
      return this.#voiceSessionHttp
        .handle(request);
    }

    if (
      voiceRoute === "plan" &&
      this.#voicePlanHttp
    ) {
      return this.#voicePlanHttp
        .handle(request);
    }

    if (
      voiceRoute === "communication" &&
      this.#voiceCommunicationHttp
    ) {
      return this.#voiceCommunicationHttp
        .handle(request);
    }

    if (
      voiceRoute === "outbox-health" &&
      this.#voiceOutboxHealthHttp
    ) {
      return this.#voiceOutboxHealthHttp
        .handle(request);
    }

    return this.#http
      .handle(request);
  }
}

export function createSupabaseCareOpsRuntime(
  options: SupabaseCareOpsRuntimeOptions,
): SupabaseCareOpsRuntime {
  return new SupabaseCareOpsRuntime(options);
}
