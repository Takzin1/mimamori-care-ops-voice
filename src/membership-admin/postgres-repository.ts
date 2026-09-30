import {
  STAFF_ROLES,
  type StaffRole,
} from "../access/types.ts";
import {
  MembershipAdminConflictError,
  MembershipAlreadyExistsError,
  MembershipAdminStoreCorruptionError,
  MembershipAdminStoreError,
  MembershipNotFoundError,
  InvalidMembershipAdminCommandError,
} from "./errors.ts";
import type {
  AppendMembershipEventInput,
  ManagedTenantMembership,
  MembershipAdminEvent,
  MembershipAdminRepository,
  StoredManagedMembership,
} from "./types.ts";

export interface AdminSqlQueryResult {
  rows: readonly Record<string, unknown>[];
}

export interface AdminSqlExecutor {
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<AdminSqlQueryResult>;
}

interface MutationResult {
  ok?: unknown;
  alreadyExists?: unknown;
  notFound?: unknown;
  conflict?: unknown;
  invalidTransition?: unknown;
  currentVersion?: unknown;
  membership?: unknown;
}

const allowedRoles = new Set<string>(STAFF_ROLES);

function requiredText(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MembershipAdminStoreCorruptionError(
      `${label} is invalid`,
    );
  }
  return value;
}

function parseRoles(value: unknown): StaffRole[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MembershipAdminStoreCorruptionError(
      "membership roles are invalid",
    );
  }

  const roles: StaffRole[] = [];
  for (const raw of value) {
    if (
      typeof raw !== "string" ||
      !allowedRoles.has(raw)
    ) {
      throw new MembershipAdminStoreCorruptionError(
        "membership contains unknown role",
      );
    }

    if (!roles.includes(raw as StaffRole)) {
      roles.push(raw as StaffRole);
    }
  }

  return roles;
}

function integer(
  value: unknown,
  label: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new MembershipAdminStoreCorruptionError(
      `${label} is invalid`,
    );
  }

  return parsed;
}

function parseMembership(
  value: unknown,
): ManagedTenantMembership {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new MembershipAdminStoreCorruptionError(
      "membership payload is invalid",
    );
  }

  const row = value as Record<string, unknown>;

  if (typeof row.active !== "boolean") {
    throw new MembershipAdminStoreCorruptionError(
      "membership active flag is invalid",
    );
  }

  return {
    tenantId: requiredText(
      row.tenant_id,
      "tenant id",
    ),
    principalId: requiredText(
      row.principal_id,
      "principal id",
    ),
    actorId: requiredText(
      row.actor_id,
      "actor id",
    ),
    roles: parseRoles(row.roles),
    active: row.active,
    version: integer(row.version, "membership version"),
    createdAt: requiredText(
      row.created_at,
      "created timestamp",
    ),
    updatedAt: requiredText(
      row.updated_at,
      "updated timestamp",
    ),
  };
}

function parseEvent(
  row: Record<string, unknown>,
): MembershipAdminEvent {
  const tenantId = requiredText(
    row.tenant_id,
    "event tenant id",
  );
  const principalId = requiredText(
    row.principal_id,
    "event principal id",
  );
  const version = integer(
    row.version,
    "event version",
  );
  const at = requiredText(
    row.event_at,
    "event timestamp",
  );
  const adminActorId = requiredText(
    row.admin_actor_id,
    "event admin actor id",
  );
  const reason = requiredText(
    row.reason,
    "event reason",
  );
  const eventType = requiredText(
    row.event_type,
    "event type",
  );
  const data =
    row.data &&
    typeof row.data === "object" &&
    !Array.isArray(row.data)
      ? row.data as Record<string, unknown>
      : {};

  const base = {
    tenantId,
    principalId,
    version,
    at,
    adminActorId,
    reason,
  };

  switch (eventType) {
    case "membership_created":
      if (typeof data.active !== "boolean") {
        throw new MembershipAdminStoreCorruptionError(
          "membership_created active flag is invalid",
        );
      }
      return {
        ...base,
        type: "membership_created",
        data: {
          actorId: requiredText(
            data.actorId,
            "created actor id",
          ),
          roles: parseRoles(data.roles),
          active: data.active,
        },
      };

    case "roles_replaced":
      return {
        ...base,
        type: "roles_replaced",
        data: {
          previousRoles: parseRoles(
            data.previousRoles,
          ),
          roles: parseRoles(data.roles),
        },
      };

    case "membership_activated":
      return {
        ...base,
        type: "membership_activated",
        data: {},
      };

    case "membership_deactivated":
      return {
        ...base,
        type: "membership_deactivated",
        data: {},
      };

    case "actor_id_changed":
      return {
        ...base,
        type: "actor_id_changed",
        data: {
          previousActorId: requiredText(
            data.previousActorId,
            "previous actor id",
          ),
          actorId: requiredText(
            data.actorId,
            "actor id",
          ),
        },
      };

    default:
      throw new MembershipAdminStoreCorruptionError(
        "unknown membership admin event type",
      );
  }
}

function parseMutationEnvelope(
  value: unknown,
): MutationResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new MembershipAdminStoreCorruptionError(
      "membership mutation result is invalid",
    );
  }

  return value as MutationResult;
}

function mutationMembership(
  envelope: MutationResult,
  tenantId: string,
  principalId: string,
  expectedVersion?: number,
): ManagedTenantMembership {
  if (envelope.ok === true) {
    const membership = parseMembership(
      envelope.membership,
    );

    if (
      membership.tenantId !== tenantId ||
      membership.principalId !== principalId
    ) {
      throw new MembershipAdminStoreCorruptionError(
        "membership mutation returned mismatched identity",
      );
    }

    return membership;
  }

  if (envelope.alreadyExists === true) {
    throw new MembershipAlreadyExistsError(
      tenantId,
      principalId,
    );
  }

  if (envelope.notFound === true) {
    throw new MembershipNotFoundError(
      tenantId,
      principalId,
    );
  }

  if (envelope.conflict === true) {
    const currentVersion = integer(
      envelope.currentVersion,
      "current membership version",
    );
    throw new MembershipAdminConflictError(
      expectedVersion ?? 0,
      currentVersion,
    );
  }

  if (envelope.invalidTransition === true) {
    throw new InvalidMembershipAdminCommandError(
      "Membership admin transition is invalid",
    );
  }

  throw new MembershipAdminStoreCorruptionError(
    "membership mutation returned unknown result",
  );
}

function commandParams(
  event: MembershipAdminEvent,
): {
  command: string;
  roles: StaffRole[] | null;
  actorId: string | null;
} {
  switch (event.type) {
    case "roles_replaced":
      return {
        command: "replace_roles",
        roles: [...event.data.roles],
        actorId: null,
      };
    case "membership_activated":
      return {
        command: "activate",
        roles: null,
        actorId: null,
      };
    case "membership_deactivated":
      return {
        command: "deactivate",
        roles: null,
        actorId: null,
      };
    case "actor_id_changed":
      return {
        command: "change_actor_id",
        roles: null,
        actorId: event.data.actorId,
      };
    case "membership_created":
      throw new MembershipAdminStoreError(
        "membership_created must use create()",
      );
  }
}

export class PostgresMembershipAdminRepository
implements MembershipAdminRepository {
  private readonly sql: AdminSqlExecutor;

  constructor(sql: AdminSqlExecutor) {
    this.sql = sql;
  }

  async load(
    tenantId: string,
    principalId: string,
  ): Promise<StoredManagedMembership | null> {
    let snapshot: AdminSqlQueryResult;
    let events: AdminSqlQueryResult;

    try {
      snapshot = await this.sql.query(
        `select
           tenant_id,
           principal_id,
           actor_id,
           roles,
           active,
           version,
           created_at::text,
           updated_at::text
         from public.care_tenant_memberships
         where tenant_id = $1
           and principal_id = $2`,
        [tenantId, principalId],
      );

      events = await this.sql.query(
        `select
           tenant_id,
           principal_id,
           version,
           event_type,
           admin_actor_id,
           reason,
           event_at::text,
           data
         from public.care_membership_admin_events
         where tenant_id = $1
           and principal_id = $2
         order by version asc`,
        [tenantId, principalId],
      );
    } catch (error) {
      throw new MembershipAdminStoreError(
        `Membership admin load failed: ${
          error instanceof Error
            ? error.message
            : "database error"
        }`,
      );
    }

    if (snapshot.rows.length === 0) {
      if (events.rows.length !== 0) {
        throw new MembershipAdminStoreCorruptionError(
          "membership events exist without snapshot",
        );
      }
      return null;
    }

    if (snapshot.rows.length !== 1) {
      throw new MembershipAdminStoreCorruptionError(
        "membership snapshot identity is not unique",
      );
    }

    const membership = parseMembership(
      snapshot.rows[0],
    );
    const parsedEvents = events.rows.map(
      (row) => parseEvent(row),
    );

    if (
      membership.tenantId !== tenantId ||
      membership.principalId !== principalId
    ) {
      throw new MembershipAdminStoreCorruptionError(
        "membership snapshot identity mismatch",
      );
    }

    if (parsedEvents.length !== membership.version) {
      throw new MembershipAdminStoreCorruptionError(
        "membership audit length does not match version",
      );
    }

    return {
      membership,
      events: parsedEvents,
    };
  }

  async create(
    event: Extract<
      MembershipAdminEvent,
      { type: "membership_created" }
    >,
  ): Promise<ManagedTenantMembership> {
    let result: AdminSqlQueryResult;
    try {
      result = await this.sql.query(
        `select care_admin.create_membership(
           $1,$2,$3,$4,$5,$6,$7,$8
         ) as result`,
        [
          event.tenantId,
          event.principalId,
          event.data.actorId,
          event.data.roles,
          event.data.active,
          event.adminActorId,
          event.reason,
          event.at,
        ],
      );
    } catch (error) {
      throw new MembershipAdminStoreError(
        `Membership create failed: ${
          error instanceof Error
            ? error.message
            : "database error"
        }`,
      );
    }

    if (result.rows.length !== 1) {
      throw new MembershipAdminStoreCorruptionError(
        "membership create returned unexpected row count",
      );
    }

    const envelope = parseMutationEnvelope(
      result.rows[0]?.result,
    );

    return mutationMembership(
      envelope,
      event.tenantId,
      event.principalId,
    );
  }

  async append(
    input: AppendMembershipEventInput,
  ): Promise<ManagedTenantMembership> {
    const params = commandParams(input.event);
    let result: AdminSqlQueryResult;

    try {
      result = await this.sql.query(
        `select care_admin.transition_membership(
           $1,$2,$3,$4,$5,$6,$7,$8,$9
         ) as result`,
        [
          input.tenantId,
          input.principalId,
          input.expectedVersion,
          params.command,
          params.roles,
          params.actorId,
          input.event.adminActorId,
          input.event.reason,
          input.event.at,
        ],
      );
    } catch (error) {
      throw new MembershipAdminStoreError(
        `Membership transition failed: ${
          error instanceof Error
            ? error.message
            : "database error"
        }`,
      );
    }

    if (result.rows.length !== 1) {
      throw new MembershipAdminStoreCorruptionError(
        "membership transition returned unexpected row count",
      );
    }

    const envelope = parseMutationEnvelope(
      result.rows[0]?.result,
    );

    return mutationMembership(
      envelope,
      input.tenantId,
      input.principalId,
      input.expectedVersion,
    );
  }
}
