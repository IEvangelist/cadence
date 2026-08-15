import { useLocation, useNavigate } from 'react-router-dom'
import { PricingPage } from '../../billing/PricingPage'

export function PricingRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <PricingPage
      onClose={() =>
        void navigate({ pathname: '/', search: location.search, hash: location.hash })
      }
    />
  )
}
