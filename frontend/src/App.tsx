import { useEffect, useState } from 'react'
import { getRouteFromHash, navigateToRoute, type AppRoute } from './app/routes'
import SiteHome from './features/site/SiteHome'
import ScannerPageContainer from './features/scanner/containers/ScannerPageContainer'

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromHash())

  useEffect(() => {
    const handleHashChange = (): void => {
      setRoute(getRouteFromHash())
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  if (route === 'room-designer') {
    return <ScannerPageContainer onExit={() => navigateToRoute('home')} />
  }

  return <SiteHome />
}

export default App
