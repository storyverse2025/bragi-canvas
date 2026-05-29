export type GenerationType = 'image' | 'video' | 'text' | 'audio'

export type ImageMode = 'text-to-image' | 'image-ref-to-image'
export type VideoMode = 'text-to-video' | 'first-frame' | 'image-ref' | 'first-last-frame' | 'multi-image-ref' | 'video-ref' | 'video-extend' | 'video-edit'
export type TextMode = 'text-to-text'
export type AudioMode = 'tts' | 'music' | 'sound-effect'

export type Mode = ImageMode | VideoMode | TextMode | AudioMode
export type VoiceSourceMode = 'builtin' | 'reference' | 'design'

export interface ParamOption {
	label: string
	value: string
}

export interface ModelParam {
	id: string
	label: string
	type: 'select' | 'number' | 'range'
	options?: ParamOption[]
	/**
	 * Mode-specific option overrides. When the user picks one of these modes, the
	 * param's dropdown is rebuilt from `optionsByMode[mode]` instead of `options`.
	 * If the currently-selected value isn't in the new list, it snaps back to `default`.
	 * Used e.g. for xAI video where image-ref caps duration at 10s while others go to 15s.
	 */
	optionsByMode?: Record<string, ParamOption[]>
	default: string | number
	min?: number
	max?: number
	step?: number
	unit?: string   // e.g. 's' for seconds
	/**
	 * When true, this param is hidden from the panel UI in Cloud Mode and is
	 * NOT filled into `paramValues` — preventing the plugin from quietly sending
	 * (or defaulting to) a value the V1 router schema doesn't carry. Local Mode
	 * is unaffected. The storyverse provider also throws defensively if any such
	 * field reaches it (e.g. via MCP), so the contract holds end-to-end.
	 */
	unsupportedInCloud?: boolean
	/**
	 * Override `options` in Cloud Mode. Use when the plugin UI exposes more / different
	 * values than the V1 router schema accepts (e.g. nano-banana's plugin aspectRatio
	 * includes 3:2/21:9/4:5/5:4/etc but the router enum is just 1:1/16:9/9:16/4:3/3:4).
	 * Required to be a subset/intersection of `options` (enforced by integration invariant).
	 * Local Mode is unaffected.
	 */
	cloudOptions?: ParamOption[]
	/**
	 * Override `max` for `range` params in Cloud Mode. Use when the router schema
	 * caps the value lower than the plugin UI (e.g. elevenlabs-sfx duration UI=30s,
	 * router=22s; elevenlabs-music UI=300s, router=180s).
	 */
	cloudMax?: number
	/**
	 * Override `default` in Cloud Mode. Use when the plugin default isn't in the
	 * router's accepted set (e.g. grok-tts default voice 'eve' isn't in the OpenAI-style
	 * enum the router expects). Required to be in `cloudOptions` (or `options` if
	 * `cloudOptions` isn't set), enforced by integration invariant.
	 */
	cloudDefault?: string | number
}

/**
 * Provider-specific config for a model.
 * Different providers may use different API model IDs for the same model.
 */
export interface ProviderConfig {
	apiModelId: string
}

export interface ModelConfig {
	id: string
	name: string
	type: GenerationType
	supportedProviders: Record<string, ProviderConfig>  // provider name → config
	modes: Mode[]
	/**
	 * Modes that the V1 router schema can't serve for this model. The panel hides
	 * them from the mode selector in Cloud Mode (Local Mode is unaffected), so the
	 * user can't pick a mode that's destined to fail. The storyverse provider also
	 * throws defensively where the gap would otherwise produce a 4xx round-trip
	 * (e.g. grok-video text-to-video → router requires `input_assets.min(1)`).
	 */
	unsupportedCloudModes?: Mode[]
	params: ModelParam[]
	voiceConfig?: {
		builtin: boolean
		clone: boolean
		design?: boolean
		modelIds?: Partial<Record<VoiceSourceMode, string>>
		sampleModelId?: string
	}
}
