export const ROOM_DESIGNER_ROUTE = 'room-designer' as const

export type AppRoute = 'home' | typeof ROOM_DESIGNER_ROUTE

function normalizeHash(hash: string): string {
  return hash
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .split('?')[0]
    .replace(/\/$/, '')
    .toLowerCase()
}

export function getRouteFromHash(hash?: string): AppRoute {
  const currentHash = hash ?? (typeof window === 'undefined' ? '' : window.location.hash)
  return normalizeHash(currentHash) === ROOM_DESIGNER_ROUTE ? ROOM_DESIGNER_ROUTE : 'home'
}

export function navigateToRoute(route: AppRoute): void {
  if (typeof window === 'undefined') {
    return
  }

  const nextHash = route === 'home' ? '' : `#${route}`
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash
  }
}
