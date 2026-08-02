export const WHEEL_STEP_PIXELS = 100;

export function stepWheelDelta(
  acc: number,
  deltaY: number,
): { steps: number; remaining: number } {
  const total = acc + deltaY;
  const steps = Math.trunc(total / WHEEL_STEP_PIXELS);
  return { steps, remaining: total - steps * WHEEL_STEP_PIXELS };
}
