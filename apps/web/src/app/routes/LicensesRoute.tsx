import { useLocation, useNavigate } from 'react-router-dom'
import { AcknowledgementsPage } from '../../acknowledgements/AcknowledgementsPage'

export function LicensesRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <AcknowledgementsPage
      onClose={() =>
        void navigate({ pathname: '/', search: location.search, hash: location.hash })
      }
    />
  )
}
