import {
  OperationalCareOpsRuntime,
} from "../ops/operational-http-runtime.ts";
import type {
  CareOpsBrowserOriginPolicy,
  CareOpsRequestAdmission,
  OperationalCareOpsRuntimeOptions,
} from "../ops/types.ts";
import {
  SupabaseCareOpsRuntime,
  type SupabaseCareOpsRuntimeOptions,
} from "./supabase-care-ops-runtime.ts";

export interface OperationalSupabaseCareOpsRuntimeOptions {
  runtime: SupabaseCareOpsRuntimeOptions;
  admission: CareOpsRequestAdmission;
  originPolicy: CareOpsBrowserOriginPolicy;
  operations?: Omit<
    OperationalCareOpsRuntimeOptions,
    "handler" | "admission" | "originPolicy"
  >;
}

function requireAdmission(
  value: CareOpsRequestAdmission,
): CareOpsRequestAdmission {
  if (
    !value ||
    typeof value.admit !== "function"
  ) {
    throw new Error(
      "request admission controller is required",
    );
  }

  return value;
}

function requireOriginPolicy(
  value: CareOpsBrowserOriginPolicy,
): CareOpsBrowserOriginPolicy {
  if (
    !value ||
    typeof value.allows !== "function"
  ) {
    throw new Error(
      "browser origin policy is required",
    );
  }

  return value;
}

export class OperationalSupabaseCareOpsRuntime {
  readonly #runtime:
    OperationalCareOpsRuntime;

  constructor(
    options:
      OperationalSupabaseCareOpsRuntimeOptions,
  ) {
    const admission =
      requireAdmission(
        options.admission,
      );

    const originPolicy =
      requireOriginPolicy(
        options.originPolicy,
      );

    const careOps =
      new SupabaseCareOpsRuntime(
        options.runtime,
      );

    this.#runtime =
      new OperationalCareOpsRuntime({
        ...options.operations,
        admission,
        originPolicy,
        handler: careOps,
      });
  }

  handle(
    request: Request,
  ): Promise<Response> {
    return this.#runtime.handle(request);
  }
}

export function createOperationalSupabaseCareOpsRuntime(
  options:
    OperationalSupabaseCareOpsRuntimeOptions,
): OperationalSupabaseCareOpsRuntime {
  return new OperationalSupabaseCareOpsRuntime(
    options,
  );
}
