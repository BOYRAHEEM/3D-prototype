/**
 * Central app state.
 *
 * A deliberately tiny "store" pattern: one plain object holds the user's
 * settings, `set()` merges a patch into it, and every subscriber is told what
 * changed. UI widgets and 3D modules both subscribe, so a palette click and a
 * keyboard shortcut go through the same path and can never disagree.
 */
import { PALETTE, BRUSH_SIZES, type BrushSizeId } from '../drawing/palette';

export type Theme = 'light' | 'dark';

/** The four research assistance features. Each one can be toggled independently. */
export interface AssistToggles {
  depthGuides: boolean;
  snapping: boolean;
  beautify: boolean;
  adaptive: boolean;
}

export interface Settings {
  color: string;
  size: BrushSizeId;
  theme: Theme;
  assist: AssistToggles;
}

type Listener<T> = (state: T, prev: T) => void;

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T, persistKey?: string): Store<T> {
  let state: T = { ...initial, ...(persistKey ? loadJSON<Partial<T>>(persistKey) : {}) };
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      if (persistKey) saveJSON(persistKey, state);
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** localStorage can throw (private mode, blocked storage), so every access is guarded. */
export function loadJSON<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings simply won't persist */
  }
}

const prefersDark =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

export const settings = createStore<Settings>(
  {
    color: PALETTE[5].hex,
    size: 'medium',
    theme: prefersDark ? 'dark' : 'light',
    assist: { depthGuides: true, snapping: true, beautify: true, adaptive: false },
  },
  'skydoodle.settings',
);

/** Brush radius in metres for the current size setting. */
export const currentRadius = (): number => BRUSH_SIZES[settings.get().size].radius;
