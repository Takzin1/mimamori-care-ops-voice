export class LiveConsoleWorkspaceDisposedError extends Error {
  readonly code =
    "LIVE_CONSOLE_WORKSPACE_DISPOSED";

  constructor() {
    super("Live Console workspace is disposed");
    this.name =
      "LiveConsoleWorkspaceDisposedError";
  }
}

export class LiveConsoleSelectionRequiredError extends Error {
  readonly code =
    "LIVE_CONSOLE_SELECTION_REQUIRED";

  constructor() {
    super("Select a Case before executing a command");
    this.name =
      "LiveConsoleSelectionRequiredError";
  }
}

export class LiveConsoleMutationPendingError extends Error {
  readonly code =
    "LIVE_CONSOLE_MUTATION_PENDING";

  constructor() {
    super("A Case command is already pending");
    this.name =
      "LiveConsoleMutationPendingError";
  }
}
