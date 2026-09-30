export class ConsoleWebInputError extends Error {
  readonly code = "CONSOLE_WEB_INPUT_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ConsoleWebInputError";
  }
}
