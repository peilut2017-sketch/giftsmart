import React from 'react'

type PhIconProps = React.HTMLAttributes<HTMLElement> & {
  name?: string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  size?: string | number
  color?: string
  mirrored?: boolean | string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ph-icon': PhIconProps
    }
  }
}
