export class MembershipAdminConflictError extends Error {
  readonly code = "MEMBERSHIP_ADMIN_CONFLICT";
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(
    expectedVersion: number,
    actualVersion: number,
  ) {
    super(
      `Membership version conflict: expected ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "MembershipAdminConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class MembershipAlreadyExistsError extends Error {
  readonly code = "MEMBERSHIP_ALREADY_EXISTS";

  constructor(tenantId: string, principalId: string) {
    super(
      `Membership already exists: ${tenantId}/${principalId}`,
    );
    this.name = "MembershipAlreadyExistsError";
  }
}

export class MembershipNotFoundError extends Error {
  readonly code = "MEMBERSHIP_NOT_FOUND";

  constructor(tenantId: string, principalId: string) {
    super(
      `Membership not found: ${tenantId}/${principalId}`,
    );
    this.name = "MembershipNotFoundError";
  }
}

export class InvalidMembershipAdminCommandError extends Error {
  readonly code = "INVALID_MEMBERSHIP_ADMIN_COMMAND";

  constructor(message: string) {
    super(message);
    this.name = "InvalidMembershipAdminCommandError";
  }
}

export class MembershipAdminStoreError extends Error {
  readonly code = "MEMBERSHIP_ADMIN_STORE_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "MembershipAdminStoreError";
  }
}

export class MembershipAdminStoreCorruptionError extends Error {
  readonly code = "MEMBERSHIP_ADMIN_STORE_CORRUPTION";

  constructor(message: string) {
    super(message);
    this.name = "MembershipAdminStoreCorruptionError";
  }
}
