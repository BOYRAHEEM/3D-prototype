/**
 * Everything the user can *do*, as plain functions. Buttons, keyboard
 * shortcuts and (later) VR controller buttons all call these, so behaviour is
 * defined once. main.ts provides the implementation.
 */
import type { AssistToggles } from '../app/state';

export interface Actions {
  undo(): void;
  redo(): void;
  clear(): void;
  exportGlb(): void;
  toggleTheme(): void;
  toggleHelp(): void;
  toggleAssistPanel(): void;
  openStudy(): void;
  openResults(): void;
  toggleVR(): void;
  toggleAssist(k: keyof AssistToggles): void;
  setColorIndex(i: number): void;
  cycleSize(dir: 1 | -1): void;
  planeRotate(steps: number): void;
  planeTilt(steps: number): void;
  planePush(amount: number): void;
  planeToggleFlat(): void;
  planeFaceCamera(): void;
  planeReset(): void;
}
