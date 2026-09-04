const configuredCommit = import.meta.env.VITE_GIT_COMMIT?.trim()

export const BUILD_INFO = Object.freeze({
  scannerMilestone: 'M8.4.2.2',
  commit: configuredCommit ? configuredCommit.slice(0, 7) : 'dev',
})
