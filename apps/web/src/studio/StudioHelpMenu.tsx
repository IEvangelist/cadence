import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { CircleHelp, FileText, Scissors, WalletCards } from 'lucide-react'
import { Icon } from '../ui/Icon'

interface StudioHelpMenuProps {
  onNavigate(path: '/stems' | '/pricing' | '/licenses'): void
}

export function StudioHelpMenu({ onNavigate }: StudioHelpMenuProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="studio-frame__utility-button"
          data-interaction="studio.help.toggle"
        >
          <Icon icon={CircleHelp} size={16} />
          Help
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ui-menu" align="end" sideOffset={8}>
          <DropdownMenu.Label className="ui-menu__label">Help and resources</DropdownMenu.Label>
          <DropdownMenu.Item asChild>
            <button
              type="button"
              className="ui-menu__item"
              data-interaction="app.nav.stems"
              onClick={() => onNavigate('/stems')}
            >
              <Icon icon={Scissors} size={16} />
              <span>Stems</span>
            </button>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <button
              type="button"
              className="ui-menu__item"
              data-interaction="app.nav.pricing"
              onClick={() => onNavigate('/pricing')}
            >
              <Icon icon={WalletCards} size={16} />
              <span>Pricing</span>
            </button>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <button
              type="button"
              className="ui-menu__item"
              data-interaction="app.nav.licenses"
              onClick={() => onNavigate('/licenses')}
            >
              <Icon icon={FileText} size={16} />
              <span>Third-party licenses</span>
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
