import type { DenseSpatialPointFrame } from '../types'

/** One-sided derivatives preserve measured borders without crossing depth jumps. */
export function estimateMeasuredDepthNormals(frame: DenseSpatialPointFrame): { normals: Float32Array; normalValid: Uint8Array } {
  const normals = new Float32Array(frame.valid.length * 3)
  const normalValid = new Uint8Array(frame.valid.length)
  const { points, distancesMeters: depth, valid, columns, rows } = frame
  const compatible = (center: number, neighbor: number): boolean => {
    if (!valid[neighbor] || !Number.isFinite(depth[neighbor]) || depth[neighbor] <= 0) return false
    return Math.abs(depth[center] - depth[neighbor]) <= Math.max(.04, Math.min(depth[center], depth[neighbor]) * .025)
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column
    if (!valid[index] || !Number.isFinite(depth[index]) || depth[index] <= 0) continue
    if (!Number.isFinite(points[index * 3]) || !Number.isFinite(points[index * 3 + 1]) || !Number.isFinite(points[index * 3 + 2])) continue
    const left = column > 0 && compatible(index, index - 1) ? index - 1 : index
    const right = column + 1 < columns && compatible(index, index + 1) ? index + 1 : index
    const up = row > 0 && compatible(index, index - columns) ? index - columns : index
    const down = row + 1 < rows && compatible(index, index + columns) ? index + columns : index
    if (left === right || up === down) continue
    const dx = points[right * 3] - points[left * 3]
    const dy = points[right * 3 + 1] - points[left * 3 + 1]
    const dz = points[right * 3 + 2] - points[left * 3 + 2]
    const ex = points[down * 3] - points[up * 3]
    const ey = points[down * 3 + 1] - points[up * 3 + 1]
    const ez = points[down * 3 + 2] - points[up * 3 + 2]
    const nx = dy * ez - dz * ey, ny = dz * ex - dx * ez, nz = dx * ey - dy * ex
    const length = Math.hypot(nx, ny, nz)
    if (!Number.isFinite(length) || length < 1e-7) continue
    normals[index * 3] = nx / length
    normals[index * 3 + 1] = ny / length
    normals[index * 3 + 2] = nz / length
    normalValid[index] = 1
  }
  return { normals, normalValid }
}
