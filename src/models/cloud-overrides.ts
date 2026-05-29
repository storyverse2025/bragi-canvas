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
