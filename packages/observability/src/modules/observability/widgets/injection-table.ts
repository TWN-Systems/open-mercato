import {
  BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID,
  PORTAL_HEADER_ACTIONS_INJECTION_SPOT_ID,
} from '@open-mercato/ui/backend/injection/spotIds'
import AdminShellObservability from './injection/admin-shell/widget.client'
import PortalShellObservability from './injection/portal-shell/widget.client'

export const widgets = [
  {
    id: 'observability.admin-shell',
    spot: BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID,
    component: AdminShellObservability,
  },
  {
    id: 'observability.portal-shell',
    spot: PORTAL_HEADER_ACTIONS_INJECTION_SPOT_ID,
    component: PortalShellObservability,
  },
]
