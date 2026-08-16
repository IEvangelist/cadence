import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { Icon } from '../ui/Icon'
import { useTheme } from './themeContext'
import type { ThemePreference } from './themeStorage'

const choices: Array<{
  value: ThemePreference
  label: string
  icon: typeof Monitor
}> = [
  { value: 'system', label: 'System theme', icon: Monitor },
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
]

export function ThemeMenu() {
  const { preference, setPreference } = useTheme()

  return (
    <Tooltip.Provider delayDuration={400}>
      <DropdownMenu.Root modal={false}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="icon-button"
                data-interaction="app.theme.open"
                aria-label="Choose theme"
              >
                <Icon icon={Palette} />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="ui-tooltip" sideOffset={6}>
              Choose theme
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="ui-menu" align="end" sideOffset={8}>
            <DropdownMenu.Label className="ui-menu__label">Theme</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={preference}
              onValueChange={(value) => setPreference(value as ThemePreference)}
            >
              {choices.map((choice) => (
                <DropdownMenu.RadioItem key={choice.value} value={choice.value} asChild>
                  <button
                    type="button"
                    className="ui-menu__item"
                    data-interaction="app.theme.select"
                  >
                    <Icon icon={choice.icon} size={16} />
                    <span>{choice.label}</span>
                    {preference === choice.value ? <Icon icon={Check} size={16} /> : null}
                  </button>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </Tooltip.Provider>
  )
}
