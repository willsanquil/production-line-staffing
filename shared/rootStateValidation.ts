export const MAX_ROOT_STATE_BYTES = 1_000_000;

type JsonObject = Record<string, unknown>;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function validateRootStatePayload(value: unknown): ValidationResult {
  if (!isObject(value)) return { ok: false, error: 'rootState must be an object' };
  if (byteLength(value) > MAX_ROOT_STATE_BYTES) return { ok: false, error: 'rootState is too large' };
  if (typeof value.currentLineId !== 'string' || !value.currentLineId.trim()) {
    return { ok: false, error: 'rootState.currentLineId is required' };
  }
  if (!Array.isArray(value.lines) || value.lines.length === 0) {
    return { ok: false, error: 'rootState.lines must be a non-empty array' };
  }
  if (!isObject(value.lineStates)) {
    return { ok: false, error: 'rootState.lineStates must be an object' };
  }
  if (!isObject(value.lineStates[value.currentLineId])) {
    return { ok: false, error: 'rootState.lineStates is missing the current line' };
  }
  for (const line of value.lines) {
    if (!isObject(line) || typeof line.id !== 'string' || typeof line.name !== 'string' || !Array.isArray(line.areas)) {
      return { ok: false, error: 'rootState.lines contains an invalid line' };
    }
  }
  return { ok: true };
}

export function normalizeRootStateForCloudLine<T extends JsonObject>(
  value: T,
  cloudLineId: string,
  cloudLineName: string
): T {
  const currentLineId = typeof value.currentLineId === 'string' ? value.currentLineId : cloudLineId;
  const lineStates = isObject(value.lineStates) ? { ...value.lineStates } : {};
  const currentLineState = lineStates[currentLineId] ?? lineStates[cloudLineId] ?? {};
  delete lineStates[currentLineId];
  lineStates[cloudLineId] = currentLineState;

  const lines = Array.isArray(value.lines)
    ? value.lines.map((line) => {
        if (!isObject(line)) return line;
        if (line.id !== currentLineId && line.id !== cloudLineId) return line;
        return {
          ...line,
          id: cloudLineId,
          name: cloudLineName.trim() || String(line.name || 'New Line'),
        };
      })
    : [];

  return {
    ...value,
    currentLineId: cloudLineId,
    lines,
    lineStates,
  };
}
