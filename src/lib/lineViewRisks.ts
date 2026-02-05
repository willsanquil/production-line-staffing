/**
 * Short risk messages for the Line View. Add more context over time
 * as we plug in more data (breaks, coverage, etc.).
 */

export interface AreaRiskContext {
  filled: number;
  min: number;
  disabledCount: number;
  /** Area has at least one person but no trained/expert (and area requires one). */
  needsTrainedOrExpert: boolean;
}

/** Returns a short list of risk messages for display under an area. */
export function getAreaRisks(ctx: AreaRiskContext): string[] {
  const lines: string[] = [];
  if (ctx.filled < ctx.min) {
    lines.push('Understaffed.');
  }
  if (ctx.needsTrainedOrExpert) {
    lines.push('No trained or expert — station cannot run.');
  }
  if (ctx.disabledCount > 0) {
    lines.push(`${ctx.disabledCount} slot(s) off.`);
  }
  return lines;
}
