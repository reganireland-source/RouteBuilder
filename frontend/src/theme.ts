import { createContext, useContext } from 'react'

export interface Theme {
  bgBase: string
  bgPanel: string
  bgDeep: string
  bgCard: string
  bgCardSelected: string
  bgActiveSort: string
  bgInput: string
  bgMap: string
  border: string
  borderSubtle: string
  text: string
  textMuted: string
  textFaint: string
  textFaintest: string
  blue: string
  green: string
  red: string
  orange: string
  pink: string
  mapInactiveSegment: string
  mapTileUrl: string
}

export const darkTheme: Theme = {
  bgBase:          '#1e1e2e',
  bgPanel:         '#181825',
  bgDeep:          '#11111b',
  bgCard:          '#181825',
  bgCardSelected:  '#1e1e2e',
  bgActiveSort:    '#1e3a5f',
  bgInput:         '#1e1e2e',
  bgMap:           '#0f0f1a',
  border:          '#313244',
  borderSubtle:    '#45475a',
  text:            '#cdd6f4',
  textMuted:       '#a6adc8',
  textFaint:       '#6c7086',
  textFaintest:    '#45475a',
  blue:            '#89b4fa',
  green:           '#a6e3a1',
  red:             '#f38ba8',
  orange:          '#fab387',
  pink:            '#f5c2e7',
  mapInactiveSegment: '#2a2a3e',
  mapTileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
}

export const lightTheme: Theme = {
  bgBase:          '#eff1f5',
  bgPanel:         '#e6e9ef',
  bgDeep:          '#dce0e8',
  bgCard:          '#e6e9ef',
  bgCardSelected:  '#eff1f5',
  bgActiveSort:    '#c5d0f5',
  bgInput:         '#eff1f5',
  bgMap:           '#e8eaf2',
  border:          '#bcc0cc',
  borderSubtle:    '#ccd0da',
  text:            '#4c4f69',
  textMuted:       '#5c5f77',
  textFaint:       '#6c6f85',
  textFaintest:    '#9ca0b0',
  blue:            '#1e66f5',
  green:           '#40a02b',
  red:             '#d20f39',
  orange:          '#fe640b',
  pink:            '#ea76cb',
  mapInactiveSegment: '#9090b8',
  mapTileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
}

export const duskTheme: Theme = {
  bgBase:          '#1c1e30',
  bgPanel:         '#21233a',
  bgDeep:          '#161828',
  bgCard:          '#21233a',
  bgCardSelected:  '#272a42',
  bgActiveSort:    '#1e3a5f',
  bgInput:         '#1c1e30',
  bgMap:           '#e8e4dc',
  border:          '#383c58',
  borderSubtle:    '#4a4f72',
  text:            '#cdd6f4',
  textMuted:       '#a0a8c8',
  textFaint:       '#70788c',
  textFaintest:    '#505870',
  blue:            '#5b9cf6',
  green:           '#34c77a',
  red:             '#dc2626',
  orange:          '#ea6c00',
  pink:            '#be185d',
  mapInactiveSegment: '#8090aa',
  mapTileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
}

export type ThemeMode = 'dark' | 'dusk' | 'light'

export const ThemeContext = createContext<Theme>(darkTheme)
export const useTheme = () => useContext(ThemeContext)
