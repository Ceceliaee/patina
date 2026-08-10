import { invoke } from "@tauri-apps/api/core";

interface CommandError {
  code: string;
  message: string;
  retryable: boolean;
}

const UNKNOWN_COMMAND_ERROR: CommandError = {
  code: "UNKNOWN_COMMAND_ERROR",
  message: "The operation could not be completed.",
  retryable: false,
};

export function parseCommandError(value: unknown): CommandError {
  if (
    typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).code === "string"
    && typeof (value as Record<string, unknown>).message === "string"
    && typeof (value as Record<string, unknown>).retryable === "boolean"
  ) {
    const candidate = value as Record<string, unknown>;
    return {
      code: candidate.code as string,
      message: candidate.message as string,
      retryable: candidate.retryable as boolean,
    };
  }

  return {
    ...UNKNOWN_COMMAND_ERROR,
    message: value instanceof Error ? value.message : UNKNOWN_COMMAND_ERROR.message,
  };
}

export async function invokeWithCommandError<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invokeWithCommandErrorUsing(invoke, command, args);
}

export async function invokeWithCommandErrorUsing<T>(
  invokeCommand: typeof invoke,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invokeCommand<T>(command, args);
  } catch (error) {
    throw parseCommandError(error);
  }
}

export function isRetryableCommandError(error: unknown): boolean {
  return parseCommandError(error).retryable;
}
