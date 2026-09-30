import {
  STAFF_ROLES,
  type StaffRole,
} from "../access/types.ts";
import {
  isOperationalActorId,
} from "../access/actor-id.ts";
import {
  InvalidMembershipAdminCommandError,
  MembershipAdminConflictError,
} from "./errors.ts";
import type {
  CreateMembershipInput,
  ManagedTenantMembership,
  MembershipAdminCommand,
  MembershipAdminEvent,
} from "./types.ts";

function text(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new InvalidMembershipAdminCommandError(
      `${label} is required`,
    );
  }
  return normalized;
}

function actorId(
  value: string,
): string {
  const normalized = text(
    value,
    "actor id",
  );

  if (!isOperationalActorId(normalized)) {
    throw new InvalidMembershipAdminCommandError(
      "actor id has invalid format",
    );
  }

  return normalized;
}

function roles(
  values: readonly StaffRole[],
): StaffRole[] {
  const selected = STAFF_ROLES.filter((role) =>
    values.includes(role),
  );

  if (selected.length === 0) {
    throw new InvalidMembershipAdminCommandError(
      "At least one Care Ops role is required",
    );
  }

  return [...selected];
}

function sameRoles(
  a: readonly StaffRole[],
  b: readonly StaffRole[],
): boolean {
  return (
    a.length === b.length &&
    a.every((role, index) => role === b[index])
  );
}

function assertVersion(
  membership: ManagedTenantMembership,
  expectedVersion: number,
): void {
  if (membership.version !== expectedVersion) {
    throw new MembershipAdminConflictError(
      expectedVersion,
      membership.version,
    );
  }
}

function eventBase(
  membership: ManagedTenantMembership,
  command: MembershipAdminCommand,
  at: string,
) {
  return {
    tenantId: membership.tenantId,
    principalId: membership.principalId,
    version: membership.version + 1,
    at: text(at, "event time"),
    adminActorId: text(
      command.adminActorId,
      "admin actor id",
    ),
    reason: text(command.reason, "change reason"),
  };
}

export function createManagedMembership(
  input: CreateMembershipInput,
  at: string,
): {
  membership: ManagedTenantMembership;
  event: Extract<
    MembershipAdminEvent,
    { type: "membership_created" }
  >;
} {
  const timestamp = text(at, "event time");
  const event: Extract<
    MembershipAdminEvent,
    { type: "membership_created" }
  > = {
    type: "membership_created",
    tenantId: text(input.tenantId, "tenant id"),
    principalId: text(
      input.principalId,
      "principal id",
    ),
    version: 1,
    at: timestamp,
    adminActorId: text(
      input.adminActorId,
      "admin actor id",
    ),
    reason: text(input.reason, "change reason"),
    data: {
      actorId: actorId(input.actorId),
      roles: roles(input.roles),
      active: input.active ?? true,
    },
  };

  return {
    membership: applyMembershipEvent(null, event),
    event,
  };
}

export function executeMembershipCommand(
  membership: ManagedTenantMembership,
  expectedVersion: number,
  command: MembershipAdminCommand,
  at: string,
): {
  membership: ManagedTenantMembership;
  event: MembershipAdminEvent;
} {
  assertVersion(membership, expectedVersion);
  const base = eventBase(membership, command, at);
  let event: MembershipAdminEvent;

  switch (command.type) {
    case "replace_roles": {
      const nextRoles = roles(command.roles);
      if (sameRoles(membership.roles, nextRoles)) {
        throw new InvalidMembershipAdminCommandError(
          "Role replacement must change roles",
        );
      }

      event = {
        ...base,
        type: "roles_replaced",
        data: {
          previousRoles: [...membership.roles],
          roles: nextRoles,
        },
      };
      break;
    }

    case "activate":
      if (membership.active) {
        throw new InvalidMembershipAdminCommandError(
          "Membership is already active",
        );
      }
      event = {
        ...base,
        type: "membership_activated",
        data: {},
      };
      break;

    case "deactivate":
      if (!membership.active) {
        throw new InvalidMembershipAdminCommandError(
          "Membership is already inactive",
        );
      }
      event = {
        ...base,
        type: "membership_deactivated",
        data: {},
      };
      break;

    case "change_actor_id": {
      const nextActorId = actorId(
        command.actorId,
      );
      if (nextActorId === membership.actorId) {
        throw new InvalidMembershipAdminCommandError(
          "Actor ID change must select a different actor",
        );
      }

      event = {
        ...base,
        type: "actor_id_changed",
        data: {
          previousActorId: membership.actorId,
          actorId: nextActorId,
        },
      };
      break;
    }
  }

  return {
    membership: applyMembershipEvent(
      membership,
      event,
    ),
    event,
  };
}

export function applyMembershipEvent(
  current: ManagedTenantMembership | null,
  event: MembershipAdminEvent,
): ManagedTenantMembership {
  if (event.type === "membership_created") {
    if (current) {
      throw new InvalidMembershipAdminCommandError(
        "membership_created can only initialize state",
      );
    }
    if (event.version !== 1) {
      throw new InvalidMembershipAdminCommandError(
        "Initial membership version must be 1",
      );
    }

    return {
      tenantId: event.tenantId,
      principalId: event.principalId,
      actorId: actorId(event.data.actorId),
      roles: roles(event.data.roles),
      active: event.data.active,
      version: 1,
      createdAt: event.at,
      updatedAt: event.at,
    };
  }

  if (!current) {
    throw new InvalidMembershipAdminCommandError(
      "Membership change requires existing state",
    );
  }

  if (
    event.tenantId !== current.tenantId ||
    event.principalId !== current.principalId
  ) {
    throw new InvalidMembershipAdminCommandError(
      "Membership event identity mismatch",
    );
  }

  if (event.version !== current.version + 1) {
    throw new InvalidMembershipAdminCommandError(
      "Membership event sequence mismatch",
    );
  }

  const next: ManagedTenantMembership = {
    ...structuredClone(current),
    version: event.version,
    updatedAt: event.at,
  };

  switch (event.type) {
    case "roles_replaced": {
      const previous = roles(
        event.data.previousRoles,
      );
      if (!sameRoles(previous, current.roles)) {
        throw new InvalidMembershipAdminCommandError(
          "Previous role snapshot does not match",
        );
      }

      const nextRoles = roles(event.data.roles);
      if (sameRoles(nextRoles, current.roles)) {
        throw new InvalidMembershipAdminCommandError(
          "Role replacement must change roles",
        );
      }

      return {
        ...next,
        roles: nextRoles,
      };
    }

    case "membership_activated":
      if (current.active) {
        throw new InvalidMembershipAdminCommandError(
          "Membership is already active",
        );
      }
      return {
        ...next,
        active: true,
      };

    case "membership_deactivated":
      if (!current.active) {
        throw new InvalidMembershipAdminCommandError(
          "Membership is already inactive",
        );
      }
      return {
        ...next,
        active: false,
      };

    case "actor_id_changed":
      if (
        event.data.previousActorId !==
        current.actorId
      ) {
        throw new InvalidMembershipAdminCommandError(
          "Previous actor ID does not match",
        );
      }
      if (
        event.data.actorId === current.actorId
      ) {
        throw new InvalidMembershipAdminCommandError(
          "Actor ID change must select a different actor",
        );
      }
      return {
        ...next,
        actorId: actorId(
          event.data.actorId,
        ),
      };
  }
}

export function replayMembership(
  events: readonly MembershipAdminEvent[],
): ManagedTenantMembership {
  if (events.length === 0) {
    throw new InvalidMembershipAdminCommandError(
      "Membership event stream is empty",
    );
  }

  let current: ManagedTenantMembership | null = null;

  for (const event of events) {
    current = applyMembershipEvent(current, event);
  }

  if (!current) {
    throw new InvalidMembershipAdminCommandError(
      "Membership replay did not produce state",
    );
  }

  return current;
}
