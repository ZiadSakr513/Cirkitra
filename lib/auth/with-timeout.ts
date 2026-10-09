export class AuthFlowTimeoutError extends Error {
  readonly code = "AUTH_FLOW_TIMEOUT";

  constructor(message: string) {
    super(message);
    this.name = "AuthFlowTimeoutError";
  }
}

export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new AuthFlowTimeoutError(message)), timeoutMs);
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}
