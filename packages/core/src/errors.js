/** Error with a process exit code. Message is shown to the user as-is. */
export class WdysaError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'WdysaError';
    this.exitCode = exitCode;
  }
}
