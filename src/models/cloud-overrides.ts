/**
 * Cloud-aware lookups for a model's modes and params.
 *
 * Both the panel UI (`src/panel.ts`) and the MCP tool registry (`src/mcp-tool-registry.ts`)
 * are user-facing entry points that surface modes/params/defaults to a caller; if either
 * one returns the raw `model.modes` / `model.params[].default` in Cloud Mode, the caller
 * picks something the V1 router schema can't carry and the storyverse provider then
 * refuses it. Sharing one helper module keeps both entry points in lockstep — adding a
 * new field on ModelConfig/ModelParam only needs to be honored here.
 */
import type { ModelConfig, ModelParam, Mode, ParamOption } from './types'
import type { BragiSettings } from '../settings'

/** Cloud-effective mode list — `model.modes` minus `unsupportedCloudModes`. Local Mode: unchanged. */
export function cloudEffectiveModes(model: ModelConfig, settings: BragiSettings): Mode[] {
	if (settings.generationMode !== 'cloud') return model.modes
	const blocked = new Set(model.unsupportedCloudModes || [])
	return model.modes.filter(m => !blocked.has(m))
}

/** Cloud-effective options for a select param. */
export function cloudEffectiveOptions(param: ModelParam, settings: BragiSettings): ParamOption[] | undefined {
	if (settings.generationMode === 'cloud' && param.cloudOptions) return param.cloudOptions
	return param.options
}

/** Cloud-effective `max` for a range param. */
export function cloudEffectiveMax(param: ModelParam, settings: BragiSettings): number | undefined {
	if (settings.generationMode === 'cloud' && param.cloudMax !== undefined) return param.cloudMax
	return param.max
}

/** Cloud-effective default value. */
export function cloudEffectiveDefault(param: ModelParam, settings: BragiSettings): string | number {
	if (settings.generationMode === 'cloud' && param.cloudDefault !== undefined) return param.cloudDefault
	return param.default
}

/** Whether the panel/MCP must skip this param entirely (don't render, don't fill default). */
export function isParamHiddenInCloud(param: ModelParam, settings: BragiSettings): boolean {
	return settings.generationMode === 'cloud' && !!param.unsupportedInCloud
}

/** True iff `mode` is selectable for `model` in the current mode (cloud filters unsupportedCloudModes). */
export function isModeAllowed(model: ModelConfig, mode: Mode, settings: BragiSettings): boolean {
	return cloudEffectiveModes(model, settings).includes(mode)
}

/**
 * Normalize a single caller-supplied / persisted param value against the cloud-effective
 * options / max / hidden flag.
 *
 *  - hidden in cloud (unsupportedInCloud)               → undefined (drop)
 *  - select & value not in cloudEffectiveOptions        → undefined (drop / let caller default-fill)
 *  - range/number & value > cloudMax                    → clamped to cloudMax
 *  - range/number & value < min                          → clamped to min
 *  - anything else                                       → value as-is (or string→number coerced for ranges)
 *
 * Local Mode: only clamps numeric range to its plain `max` / `min`; otherwise pass-through.
 *
 * Callers decide how to react to `undefined`:
 *   - panel rehydrate (lastSelection): silent — let initDefaults fill the cloud-effective default
 *   - MCP generate: throw a clear error so scripted callers know their value was rejected
 */
export function normalizeCloudParamValue(
	param: ModelParam,
	value: unknown,
	settings: BragiSettings,
): string | number | undefined {
	const cloud = settings.generationMode === 'cloud'
	if (cloud && param.unsupportedInCloud) return undefined

	// Select / dropdown: value must be one of the (cloud-effective) options
	if (param.type === 'select' || param.options) {
		const opts = cloudEffectiveOptions(param, settings)
		if (!opts) return undefined
		const strVal = typeof value === 'string' ? value
			: typeof value === 'number' || typeof value === 'boolean' ? String(value)
			: ''
		return opts.some(o => o.value === strVal) ? strVal : undefined
	}

	// Range / number: clamp to (cloud-effective) max / plain min
	const mx = cloudEffectiveMax(param, settings) ?? param.max
	const mn = param.min
	let n: number | undefined
	if (typeof value === 'number' && Number.isFinite(value)) n = value
	else if (typeof value === 'string') {
		const parsed = parseFloat(value)
		if (Number.isFinite(parsed)) n = parsed
	}
	if (n === undefined) return undefined
	if (mx !== undefined && n > mx) return mx
	if (mn !== undefined && n < mn) return mn
	return n
}
