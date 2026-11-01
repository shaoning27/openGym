import 'react'
declare global {
  const __APP_VERSION__: string
  var Capacitor: { getPlatform?: () => string } | undefined
  var BarcodeDetector: undefined | { new(options: { formats: string[] }): { detect(source: unknown): Promise<Array<{ rawValue: string; format: string }>> } }
  interface Window { webkitAudioContext?: typeof AudioContext }
  interface Navigator { readonly standalone?: boolean }
}
declare module 'react' {
  interface CSSProperties { [key: `--${string}`]: string | number | undefined }
}
