export class OutboxDeliveryKeyConflictError extends Error {
  readonly code = "OUTBOX_DELIVERY_KEY_CONFLICT";

  constructor(
    tenantId: string,
    deliveryKey: string,
  ) {
    super(
      `Outbox delivery key reused with different payload: ${tenantId}/${deliveryKey}`,
    );
    this.name = "OutboxDeliveryKeyConflictError";
  }
}
