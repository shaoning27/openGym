import { POLICY_NAME } from './progression.ts'

/**
 * Presentation-only view of a progression result. The engine remains the source of truth for
 * both the outcome and its explanation; this helper only makes the policy behind that result
 * explicit in the workout guidance.
 */
export function progressionGuidance(plan: { why?: string; kind?: string; policy?: keyof typeof POLICY_NAME } | null | undefined) {
  if (!plan?.why || plan.kind === 'off' || plan.policy === 'off') return null
  const policyLabel = plan.policy ? POLICY_NAME[plan.policy] : undefined
  if (!policyLabel) return null
  return { policyLabel, why: plan.why }
}
