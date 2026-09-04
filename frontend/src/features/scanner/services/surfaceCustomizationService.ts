import type {
  RoomSurfacePatch,
  RoomSurfacePatchRole,
} from '../../room-analysis/types'

export interface SurfaceCustomization {
  readonly paintColor?: string
}

export type SurfaceCustomizationMap = Readonly<Record<string, SurfaceCustomization>>

export interface PaintPreset {
  readonly id: string
  readonly label: string
  readonly color: string
}

export const PAINT_PRESETS: readonly PaintPreset[] = [
  { id: 'white', label: 'White', color: '#f4f1e8' },
  { id: 'warm-white', label: 'Warm White', color: '#eee5d1' },
  { id: 'light-gray', label: 'Light Gray', color: '#cbd0ce' },
  { id: 'beige', label: 'Beige', color: '#d8c2a2' },
  { id: 'sage', label: 'Sage', color: '#a9c4ad' },
  { id: 'blue', label: 'Blue', color: '#9dbbd2' },
] as const

export const DEFAULT_SURFACE_PAINT_COLORS: Readonly<Record<RoomSurfacePatchRole, string>> = {
  wall: '#c8e1e4',
  ceiling: '#d8cceb',
  floor: '#c9e3cf',
}

export function getSurfacePaintColor(
  patch: Pick<RoomSurfacePatch, 'id' | 'role'>,
  customizations: SurfaceCustomizationMap,
): string {
  return customizations[patch.id]?.paintColor ?? DEFAULT_SURFACE_PAINT_COLORS[patch.role]
}

export function getSurfaceRoleLabel(role: RoomSurfacePatchRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
