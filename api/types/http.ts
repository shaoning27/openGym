/** Wire response from GET /api/health; failure intentionally omits users. */
export type HealthResponse =
  | { ok: true; writable: true; users: number }
  | { ok: false; writable: false }

/** State remains unknown until a caller validates its runtime shape. */
export interface StateResponse<T = unknown> {
  state: T | null
  rev: number
}

export interface RevisionResponse {
  rev: number
  wid?: string
}
