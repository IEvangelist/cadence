import { useLocation, useNavigate } from 'react-router-dom'
import { PricingPage } from '../../billing/PricingPage'
import { backendConfig } from '../../platform/backendConfig'

export function PricingRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <PricingPage
      backendAvailable={backendConfig.available}
      onClose={() =>
        void navigate({ pathname: '/', search: location.search, hash: location.hash })
      }
    />
  )
}
