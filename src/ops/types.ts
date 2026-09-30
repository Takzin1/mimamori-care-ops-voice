export interface CareOpsHttpHandler {
  handle(request: Request): Promise<Response>;
}

export type CareOpsRouteClass =
  | "health"
  | "readiness"
  | "care_ops";

export interface CareOpsRequestLogRecord {
  event: "http_request_completed";
  at: string;
  requestId: string | null;
  routeClass: CareOpsRouteClass;
  method: string;
  status: number;
  durationMs: number;
}

export interface CareOpsReadinessLogRecord {
  event: "readiness_evaluated";
  at: string;
  requestId: null;
  routeClass: "readiness";
  method: "GET" | "HEAD";
  status: 200 | 503;
  durationMs: number;
  ready: boolean;
  checkCount: number;
}

export type CareOpsOperationalLogRecord =
  | CareOpsRequestLogRecord
  | CareOpsReadinessLogRecord;

export interface CareOpsStructuredLogger {
  write(
    record: Readonly<CareOpsOperationalLogRecord>,
  ): void | Promise<void>;
}

export interface CareOpsMetricLabels {
  routeClass: CareOpsRouteClass;
  method: string;
  statusClass: string;
}

export interface CareOpsMetricsSink {
  increment(
    name: string,
    labels: Readonly<CareOpsMetricLabels>,
  ): void | Promise<void>;

  observe(
    name: string,
    value: number,
    labels: Readonly<CareOpsMetricLabels>,
  ): void | Promise<void>;
}

export interface CareOpsReadinessCheck {
  readonly name: string;
  check(): boolean | Promise<boolean>;
}

export interface CareOpsAdmissionInput {
  request: Request;
  method: string;
  routeClass: "care_ops";
}

export type CareOpsAdmissionDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterSeconds?: number;
    };

export interface CareOpsRequestAdmission {
  admit(
    input: Readonly<CareOpsAdmissionInput>,
  ):
    | CareOpsAdmissionDecision
    | Promise<CareOpsAdmissionDecision>;
}

export interface CareOpsBrowserOriginPolicy {
  allows(
    origin: string,
  ): boolean | Promise<boolean>;
}

export interface OperationalCareOpsRuntimeOptions {
  handler: CareOpsHttpHandler;
  logger?: CareOpsStructuredLogger;
  metrics?: CareOpsMetricsSink;
  readinessChecks?: readonly CareOpsReadinessCheck[];
  admission?: CareOpsRequestAdmission;
  originPolicy?: CareOpsBrowserOriginPolicy;
  now?: () => string;
  nowMs?: () => number;
  requestIdFactory?: () => string;
}
