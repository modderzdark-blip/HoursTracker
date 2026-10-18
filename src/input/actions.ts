export const INPUT_ACTIONS = [
  'attack',
  'dodge',
  'skill1',
  'skill2',
  'skill3',
  'ultimate',
  'pause',
] as const;

export type InputAction = (typeof INPUT_ACTIONS)[number];

export const ACTION_COUNT = INPUT_ACTIONS.length;

const ACTION_INDEX: Readonly<Record<InputAction, number>> = Object.fromEntries(
  INPUT_ACTIONS.map((a, i) => [a, i]),
) as Record<InputAction, number>;

export function actionIndex(action: InputAction): number {
  return ACTION_INDEX[action];
}

export function isInputAction(value: string): value is InputAction {
  return (INPUT_ACTIONS as readonly string[]).includes(value);
}

/** Bit flags identifying where an input came from (so one source releasing never releases another). */
export const INPUT_SOURCE = { touch: 0, keyboard: 1, gamepad: 2 } as const;
export type InputSource = (typeof INPUT_SOURCE)[keyof typeof INPUT_SOURCE];
export const INPUT_SOURCE_COUNT = 3;
