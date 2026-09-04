import type { RoomSurfacePatch } from '../../room-analysis/types'
import {
  PAINT_PRESETS,
  getSurfacePaintColor,
  getSurfaceRoleLabel,
  type SurfaceCustomizationMap,
} from '../services/surfaceCustomizationService'

interface SurfaceCustomizationPanelProps {
  surface: RoomSurfacePatch
  customizations: SurfaceCustomizationMap
  onPaintColorChange: (color: string) => void
  onResetSelected: () => void
  onResetAll: () => void
}

function SurfaceCustomizationPanel({
  customizations,
  onPaintColorChange,
  onResetAll,
  onResetSelected,
  surface,
}: SurfaceCustomizationPanelProps) {
  const currentColor = getSurfacePaintColor(surface, customizations)
  const hasCustomizations = Object.keys(customizations).length > 0

  return (
    <section className="surface-customization-panel" aria-labelledby="surface-customization-title">
      <div className="surface-customization-heading">
        <span className="scanner-analysis-label" id="surface-customization-title">Selected Surface</span>
        <strong>{surface.id}</strong>
      </div>
      <div className="surface-customization-meta">
        <span>{getSurfaceRoleLabel(surface.role)}</span>
        <span>{surface.areaMetersSquared.toFixed(2)} m²</span>
        <span>Confidence {(surface.confidence * 100).toFixed(0)}%</span>
      </div>
      <div className="surface-customization-palette" aria-label="Paint colors">
        {PAINT_PRESETS.map((preset) => (
          <button
            type="button"
            className={`surface-paint-option${currentColor.toLowerCase() === preset.color ? ' is-active' : ''}`}
            key={preset.id}
            aria-label={`Paint ${getSurfaceRoleLabel(surface.role)} ${preset.label}`}
            aria-pressed={currentColor.toLowerCase() === preset.color}
            onClick={() => onPaintColorChange(preset.color)}
          >
            <span className="surface-paint-swatch" style={{ backgroundColor: preset.color }} aria-hidden="true" />
            <span>{preset.label}</span>
          </button>
        ))}
        <label className="surface-paint-option surface-paint-custom">
          <span className="surface-paint-swatch surface-paint-swatch-custom" style={{ backgroundColor: currentColor }} aria-hidden="true" />
          <span>Custom</span>
          <input
            type="color"
            value={currentColor}
            aria-label={`Custom paint color for ${surface.id}`}
            onChange={(event) => onPaintColorChange(event.target.value)}
          />
        </label>
      </div>
      <div className="surface-customization-actions">
        <button type="button" className="scan-button scan-button-secondary" onClick={onResetSelected}>
          Reset to Default
        </button>
        <button
          type="button"
          className="scan-button scan-button-secondary"
          disabled={!hasCustomizations}
          onClick={onResetAll}
        >
          Reset All Colors
        </button>
      </div>
    </section>
  )
}

export default SurfaceCustomizationPanel
