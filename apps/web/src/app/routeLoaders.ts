export const loadStemsRoute = async () => {
  const { StemsRoute } = await import('./routes/StemsRoute')
  return { Component: StemsRoute }
}

export const loadPricingRoute = async () => {
  const { PricingRoute } = await import('./routes/PricingRoute')
  return { Component: PricingRoute }
}

export const loadProfileRoute = async () => {
  const { ProfileRoute } = await import('./routes/ProfileRoute')
  return { Component: ProfileRoute }
}

export const loadLicensesRoute = async () => {
  const { LicensesRoute } = await import('./routes/LicensesRoute')
  return { Component: LicensesRoute }
}

export const secondaryRouteLoaders = [
  loadStemsRoute,
  loadPricingRoute,
  loadProfileRoute,
  loadLicensesRoute,
] as const
