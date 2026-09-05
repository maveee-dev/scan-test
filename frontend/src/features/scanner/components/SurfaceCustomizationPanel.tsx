import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { LogicalStructuralSurface } from '../services/logicalSurfaceService'
import {
  PAINT_PRESETS,
  getSurfacePaintColor,
  getSurfaceRoleLabel,
  type SurfaceCustomizationMap,
} from '../services/surfaceCustomizationService'

interface SurfaceCustomizationPanelProps {
  surface: RoomSurfacePatch
  logicalSurface?: LogicalStructuralSurface | null
  customizations: SurfaceCustomizationMap
  onPaintColorChange: (color: string) => void
  onResetSelected: () => void
  onResetAll: () => void
  onClose: () => void
}

function SurfaceCustomizationPanel({
  customizations,
  logicalSurface,
  onPaintColorChange,
  onResetAll,
  onResetSelected,
  onClose,
  surface,
}: SurfaceCustomizationPanelProps) {
  const currentColor = getSurfacePaintColor(surface, customizations)
  const hasCustomizations = Object.keys(customizations).length > 0
  const displayId = logicalSurface?.id ?? surface.id
  const displayArea = logicalSurface ? logicalSurface.totalAreaMetersSquared : surface.areaMetersSquared
  const displayConfidence = logicalSurface ? logicalSurface.confidence : surface.confidence
  const memberCount = logicalSurface?.memberPatchIds.length ?? 1

  return (
    <section className="surface-customization-panel" aria-labelledby="surface-customization-title">
      <div className="surface-customization-heading">
        <div className="surface-customization-heading-copy">
          <span className="scanner-analysis-label" id="surface-customization-title">
            {logicalSurface ? 'Selected Logical Wall' : 'Selected Surface'}
          </span>
          <strong>{displayId}</strong>
          {logicalSurface && memberCount > 1 ? (
            <small style={{ opacity: 0.8, fontSize: '0.8rem' }}>
              Includes {memberCount} structural patches ({logicalSurface.memberPatchIds.join(', ')})
            </small>
          ) : null}
        </div>
        <button
          type="button"
          className="surface-customization-close"
          aria-label="Close customization panel"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="surface-customization-meta">
        <span>{getSurfaceRoleLabel(surface.role)}</span>
        <span>{displayArea.toFixed(2)} m²</span>
        <span>Confidence {(displayConfidence * 100).toFixed(0)}%</span>
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
            aria-label={`Custom paint color for ${displayId}`}
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
