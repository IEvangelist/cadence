import type { ComponentType, SVGProps } from 'react'

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>

interface IconProps {
  icon: IconComponent
  size?: number
}

export function Icon({ icon: Glyph, size = 20 }: IconProps) {
  return <Glyph aria-hidden="true" focusable="false" size={size} strokeWidth={1.75} />
}
