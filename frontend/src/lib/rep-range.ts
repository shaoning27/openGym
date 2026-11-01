import type { RepRange } from '../types/training.ts'

// Normalize the two bounds used by double progression.
// `reps` is the upper bound and `repsMin` is the lower bound in persisted configs.
/**
 * @param {unknown} reps
 * @param {unknown} repsMin
 * @param {number} [stride]
 * @returns {import('../types/training.js').RepRange}
 */
export function normalizeRepRange(reps: unknown, repsMin: unknown, stride = 1): RepRange {
  const step = Number.isInteger(stride) && stride > 0 ? stride : 1
  const upper = align(positiveInt(reps, 10), step)
  const lower = align(positiveInt(repsMin, Math.max(1, upper - 2)), step)
  return lower >= upper
    ? { reps: lower + step, repsMin: lower }
    : { reps: upper, repsMin: lower }
}

/** @param {number} value @param {number} stride */
function align(value: number, stride: number) {
  return Math.max(stride, Math.ceil(value / stride) * stride)
}

/** @param {unknown} value @param {number} fallback */
function positiveInt(value: unknown, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback
}
