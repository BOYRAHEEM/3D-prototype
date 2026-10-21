/**
 * Kid-friendly colours and brush sizes.
 *
 * Every colour has a name so buttons get readable labels (screen readers say
 * "Sunshine" rather than "#FFD23F"). Sizes are tube radii in metres, because
 * the whole scene uses real-world units (that matters once we are in VR).
 */
export interface PaletteColor {
  name: string;
  hex: string;
}

export const PALETTE: PaletteColor[] = [
  { name: 'Cherry', hex: '#ff4d6d' },
  { name: 'Tangerine', hex: '#ff9f1c' },
  { name: 'Sunshine', hex: '#ffd23f' },
  { name: 'Lime', hex: '#6fd36b' },
  { name: 'Lagoon', hex: '#16c6c0' },
  { name: 'Ocean', hex: '#3a86ff' },
  { name: 'Grape', hex: '#8f5cff' },
  { name: 'Bubblegum', hex: '#ff70c6' },
];

export type BrushSizeId = 'small' | 'medium' | 'large';

export const BRUSH_SIZES: Record<BrushSizeId, { label: string; radius: number }> = {
  small: { label: 'Small', radius: 0.008 },
  medium: { label: 'Medium', radius: 0.016 },
  large: { label: 'Large', radius: 0.03 },
};

export const BRUSH_SIZE_ORDER: BrushSizeId[] = ['small', 'medium', 'large'];
