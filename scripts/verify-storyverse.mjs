// Static invariants for the storyverse provider. Each assertion is a source-grep so the
// script runs in <100ms with no toolchain — same shape as the existing
// verify-gemini-video-text.mjs / verify-text-multimodal.mjs scripts.
//
// What this guards (round 8 + 9 of Codex review):
//   - cloud-overrides.ts is gone (architectural refactor invariant)
//   - storyverse is a multi-field ProviderSpec, surfaced in the Add Provider modal like
//     every other provider
//   - storyverse is the LAST entry in supportedProviders for every model that lists it,
//     preserving legacy fallback for users who configured a local provider before this build
//   - midjourney models do NOT declare supportedProviders.storyverse (router legnext
//     adapter is stubbed at 501; would otherwise fail every generation)
//   - V1-router-unsupported params/modes are explicitly enumerated in storyverse.ts and
//     mirrored as panel + MCP carve-outs (no silent param drop)
//   - panel voiceConfigFor is provider-aware (storyverse forces voice clone+design off)
//   - panel modelSupportsInputs uses visibleModesFor (not raw m.modes)
//   - storyverse text capability declares kinds:[] (V1 router chat is text-only)
//   - MCP generate validates explicit mode against the effective set
//   - aspectToSize / grok-imagine refs / Veo refs / grok-video missing refs throw rather
//     than silently dropping the user's input
//   - one-shot migration moves bragiCloudUrl/Token → providers.storyverse{Url,Token} and
//     strips legacy keys

import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'

const models = {
	audio:       readFileSync('src/models/audio.ts', 'utf8'),
	gpt:         readFileSync('src/models/gpt-image.ts', 'utf8'),
	grok:        readFileSync('src/models/grok.ts', 'utf8'),
	kling:       readFileSync('src/models/kling.ts', 'utf8'),
	midjourney:  readFileSync('src/models/midjourney.ts', 'utf8'),
	nanoBanana:  readFileSync('src/models/nano-banana.ts', 'utf8'),
	seedance:    readFileSync('src/models/seedance.ts', 'utf8'),
	seedream:    readFileSync('src/models/seedream.ts', 'utf8'),
	veo:         readFileSync('src/models/veo.ts', 'utf8'),
	textGen:     readFileSync('src/models/text-gen.ts', 'utf8'),
	textInputs:  readFileSync('src/models/text-input-capabilities.ts', 'utf8'),
}
const sv          = readFileSync('src/providers/storyverse.ts', 'utf8')
const registry    = readFileSync('src/providers/registry.ts', 'utf8')
const panel       = readFileSync('src/panel.ts', 'utf8')
const mcp         = readFileSync('src/mcp-tool-registry.ts', 'utf8')
const settings    = readFileSync('src/settings.ts', 'utf8')
const main        = readFileSync('src/main.ts', 'utf8')
const addProvider = readFileSync('src/ui/add-provider-modal.ts', 'utf8')
const serverAuth  = readFileSync('server/src/routes/auth.ts', 'utf8')
const serverAuthTest = readFileSync('server/test/routes/auth.test.ts', 'utf8')

// ── R8 architectural invariants ─────────────────────────────────────────────────

assert.ok(
	!existsSync('src/models/cloud-overrides.ts'),
	'cloud-overrides.ts must remain deleted — the cloud-mode abstraction was removed in PR #3',
)

assert.match(
	registry,
	/id:\s*['"]storyverse['"][\s\S]*storyverseUrl[\s\S]*storyverseToken/,
	'storyverse is registered as a multi-field ProviderSpec with URL + token fields',
)

assert.doesNotMatch(
	addProvider,
	/p\.id\s*!==\s*['"]storyverse['"]/,
	'add-provider-modal must NOT filter storyverse out — it surfaces like every other provider',
)

assert.match(
	settings,
	/migrateStoryverseProvider/,
	'settings.ts exports migrateStoryverseProvider',
)

assert.match(
	main,
	/migrateStoryverseProvider\(migrateDashScopeSettings\(merged, raw\), raw, storyverseModelIds\)/,
	'main.ts loadSettings wires the migration with the storyverse-capable model id list',
)

// ── supportedProviders ordering: storyverse must be LAST in every block that declares it ──

function assertStoryverseLast(source, label) {
	// Find every `supportedProviders: { ... }` block in `source` and inside each, if a
	// storyverse entry exists, it must be the last key.
	let cursor = 0
	while (cursor < source.length) {
		const marker = source.indexOf('supportedProviders:', cursor)
		if (marker === -1) break
		const open = source.indexOf('{', marker)
		assert.notStrictEqual(open, -1, `${label}: supportedProviders has an opening brace`)
		let depth = 0
		let close = -1
		for (let i = open; i < source.length; i++) {
			const ch = source[i]
			if (ch === '{') depth++
			if (ch === '}') {
				depth--
				if (depth === 0) {
					close = i
					break
				}
			}
		}
		assert.notStrictEqual(close, -1, `${label}: supportedProviders has a closing brace`)
		const body = source.slice(open + 1, close)
		const keyOrder = []
		depth = 0
		for (const line of body.split('\n')) {
			if (depth === 0) {
				const key = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)?.[1]
				if (key) keyOrder.push(key)
			}
			for (const ch of line) {
				if (ch === '{') depth++
				if (ch === '}') depth--
			}
		}
		cursor = close + 1
		if (!keyOrder.includes('storyverse')) continue
		assert.strictEqual(
			keyOrder[keyOrder.length - 1],
			'storyverse',
			`${label}: storyverse must be the LAST supportedProviders entry (got order ${keyOrder.join(', ')}) — getActiveProvider falls back to the first configured key, so putting storyverse first would change the default for users who configured a local provider before this build`,
		)
	}
}

for (const [name, src] of Object.entries(models)) assertStoryverseLast(src, name)

// ── midjourney must NOT declare storyverse (router legnext adapter is stubbed at 501) ──

assert.doesNotMatch(
	models.midjourney,
	/storyverse:\s*\{/,
	'midjourney models must NOT declare supportedProviders.storyverse — router legnext adapter currently throws unknown_model. When server implements the upstream call, add it back here.',
)

// ── Storyverse text capability is text-only in V1 (no multimodal upstream refs) ──

assert.match(
	models.textInputs,
	/storyverse:\s*\{\s*kinds:\s*\[\s*\]\s*\}/,
	'text-input-capabilities.ts: storyverse declares empty kinds (V1 router /v1/chat/completions content is a plain string)',
)

// ── R9 carve-outs: STORYVERSE_NOOP_PARAMS / STORYVERSE_UNSUPPORTED_MODES are exported ──

assert.match(
	sv,
	/export const STORYVERSE_NOOP_PARAMS:\s*Readonly<Record<string,\s*readonly string\[\]>>/,
	'storyverse.ts exports the per-model no-op param map',
)

assert.match(
	sv,
	/export const STORYVERSE_UNSUPPORTED_MODES:\s*Readonly<Record<string,\s*readonly string\[\]>>/,
	'storyverse.ts exports the per-model unsupported modes map',
)

// Spot-check a few high-impact entries so a future "I removed this carve-out" mistake fails CI
assert.match(sv, /['"]elevenlabs-tts-v3['"]:\s*\[[^\]]*['"]stability['"][^\]]*['"]similarity_boost['"][^\]]*['"]style['"][^\]]*['"]speed['"]/s,
	'STORYVERSE_NOOP_PARAMS["elevenlabs-tts-v3"] must list stability + similarity_boost + style + speed (V1 schema accepts only voice + response_format)')
assert.match(sv, /['"]veo-3\.1['"]:\s*\[[^\]]*['"]durationSeconds['"][^\]]*['"]resolution['"]/s,
	'STORYVERSE_NOOP_PARAMS["veo-3.1"] must list durationSeconds + resolution')
assert.match(sv, /['"]gpt-image-2['"]:\s*\[[^\]]*['"]imageSize['"][^\]]*['"]quality['"]/s,
	'STORYVERSE_NOOP_PARAMS["gpt-image-2"] must list imageSize + quality (router only takes size)')
assert.match(sv, /['"]veo-3\.1['"]:\s*\[[^\]]*['"]first-frame['"][^\]]*['"]first-last-frame['"][^\]]*['"]image-ref['"]/s,
	'STORYVERSE_UNSUPPORTED_MODES["veo-3.1"] must block all ref modes (V1 Veo router schema has no input_assets)')
assert.match(sv, /['"]grok-imagine['"]:\s*\[[^\]]*['"]image-ref-to-image['"]/s,
	'STORYVERSE_UNSUPPORTED_MODES["grok-imagine"] must block image-ref-to-image')
assert.match(sv, /['"]grok-video['"]:\s*\[[^\]]*['"]text-to-video['"][^\]]*['"]video-extend['"]/s,
	'STORYVERSE_UNSUPPORTED_MODES["grok-video"] must block text-to-video + video-extend (router requires input_assets.min(1))')
assert.match(sv, /['"]grok-video['"]:\s*\[[^\]]*['"]duration['"][^\]]*['"]aspect_ratio['"][^\]]*['"]resolution['"]/s,
	'STORYVERSE_NOOP_PARAMS["grok-video"] must list duration + aspect_ratio + resolution (router hard-locks duration and ignores ratio/resolution)')

// ── Panel mirrors the storyverse-specific carve-outs ──

assert.match(
	panel,
	/import\s+\{\s*STORYVERSE_NOOP_PARAMS,\s*STORYVERSE_UNSUPPORTED_MODES\s*\}\s+from\s+'\.\/providers\/storyverse'/,
	'panel.ts imports both storyverse carve-out maps',
)

assert.match(
	panel,
	/function visibleModesFor\([\s\S]*activeProvider !== 'storyverse'/,
	'panel.ts visibleModesFor returns raw m.modes for non-storyverse providers',
)

assert.match(
	panel,
	/function visibleParamsFor\([\s\S]*activeProvider !== 'storyverse'/,
	'panel.ts visibleParamsFor returns raw m.params for non-storyverse providers',
)

// rebuildModeList in both panels MUST use visibleModesFor, not raw model.modes
const rebuildModeListMatches = [...panel.matchAll(/function rebuildModeList\(\)\s*\{[\s\S]*?(?=\n\t}\n)/g)]
assert.strictEqual(rebuildModeListMatches.length, 2, 'panel.ts has two rebuildModeList declarations (single + batch panel)')
for (const m of rebuildModeListMatches) {
	assert.match(m[0], /visibleModesFor\(selectedModel,\s*providerFor\(selectedModel\)\)/,
		'each rebuildModeList must derive modes via visibleModesFor + providerFor')
}

// modelSupportsInputs must use visibleModesFor to keep model-picker compatibility checks honest
assert.match(
	panel,
	/function modelSupportsInputs[\s\S]*?const modes = visibleModesFor\(m, providerFor\(m\)\)/,
	'modelSupportsInputs uses visibleModesFor so it does not advertise modes the storyverse provider would runtime-throw on',
)
assert.match(
	panel,
	/function modelSupportsInputs[\s\S]*?m\.type === 'image'[\s\S]*?STORYVERSE_UNSUPPORTED_MODES\[m\.id\]\?\.includes\('image-ref-to-image'\)/,
	'modelSupportsInputs handles storyverse image-model unsupported ref modes (grok-imagine + upstream image must not be selectable)',
)
assert.match(
	panel,
	/function stripHiddenParamValues[\s\S]*?STORYVERSE_NOOP_PARAMS\[model\.id\]/,
	'panel.ts has a helper that strips hidden storyverse no-op params from restored/submitted param values',
)
assert.match(
	panel,
	/paramValues = stripHiddenParamValues\(selectedModel,\s*providerFor\(selectedModel\),\s*\{ \.\.\.paramValues,\s*\.\.\.savedParams \}\)/,
	'panel.ts strips storyverse no-op params when restoring old lastSelection params',
)
assert.match(
	panel,
	/const submitParams = stripHiddenParamValues\(selectedModel,\s*providerFor\(selectedModel\),\s*paramValues\)[\s\S]*params:\s*\{ \.\.\.submitParams \}/,
	'panel.ts stores stripped params in lastSelection/node metadata before single-submit',
)
assert.match(
	panel,
	/onSubmit\(\{ prompt, model: selectedModel,[\s\S]*params:\s*submitParams/,
	'panel.ts submits stripped params from the single-node panel',
)

assert.match(
	panel,
	/if \(selectedModel && !disabled && !modelSupportsInputs\(selectedModel\)\)[\s\S]*disabled = true/,
	'updateRunState disables Run when the selected model is incompatible with current upstream (otherwise the user can still hit Run on a (not supported) model that the dropdown grayed out but didn\'t auto-replace)',
)
assert.match(
	panel,
	/onSubmit\(nodes,\s*\{[\s\S]*params:\s*submitParams/,
	'panel.ts submits stripped params from the batch panel',
)

// voiceConfigFor must take activeProvider + force clone/design off under storyverse
assert.match(
	panel,
	/function voiceConfigFor\(model:\s*ModelConfig\s*\|\s*null,\s*activeProvider:\s*string\s*\|\s*null\)/,
	'voiceConfigFor takes an activeProvider param',
)
assert.match(
	panel,
	/isStoryverse\s*=\s*activeProvider === 'storyverse'/,
	'voiceConfigFor detects storyverse explicitly',
)
assert.match(panel, /clone:\s*!isStoryverse\s*&&/, 'voiceConfigFor: clone is gated on !isStoryverse')
assert.match(panel, /design:\s*!isStoryverse\s*&&/, 'voiceConfigFor: design is gated on !isStoryverse')

// ── MCP mirrors the same carve-outs in list_models + generate ──

assert.match(
	mcp,
	/import\s+\{\s*STORYVERSE_NOOP_PARAMS,\s*STORYVERSE_UNSUPPORTED_MODES\s*\}/,
	'mcp-tool-registry imports both storyverse carve-out maps',
)
assert.match(
	mcp,
	/const visibleModes = m\.modes\.filter\(x => !unsupportedModes\.includes\(x\)\)/,
	'list_models advertises the visible (storyverse-filtered) modes',
)
assert.match(
	mcp,
	/const visibleParams = m\.params\.filter\(p => !noOpParams\.includes\(p\.id\)\)/,
	'list_models advertises the visible (storyverse-filtered) params',
)
assert.match(
	mcp,
	/if \(mode && !effectiveModes\.includes\(mode as Mode\)\)/,
	'mcp generate validates explicit mode against the storyverse-filtered effective set',
)
assert.match(
	mcp,
	/Parameter "\$\{k\}" is not supported for \$\{model\.id\} via storyverse/,
	'mcp generate refuses no-op storyverse params explicitly (no silent strip)',
)

// ── Server auth check must not echo svsk tokens ─────────────────────────────────

assert.match(
	serverAuth,
	/c\.json\(\{\s*ok:\s*true\s*\}\)/,
	'server /v1/auth/check returns only { ok: true }',
)
assert.doesNotMatch(
	serverAuth,
	/label:\s*token|get\(['"]bragiToken['"]\)/,
	'server /v1/auth/check must not echo or read the raw token into the response body',
)
assert.match(
	serverAuthTest,
	/not\.toHaveProperty\(['"]label['"]\)[\s\S]*not\.toContain\(['"]svsk-test-1['"]\)/,
	'server auth test asserts the response does not contain the raw token',
)

// ── storyverse.ts defensive throws (last line of defense for non-panel callers) ──

assert.match(
	sv,
	/function aspectToSize[\s\S]*throw new Error\(/,
	'gpt-image-2 aspectToSize refuses unsupported ratios instead of silently mapping to a square',
)

// grok-imagine refImages refuse
const grokImagineCase = sv.match(/case 'grok-imagine':[\s\S]*?(?=case '|default:)/)
assert.ok(grokImagineCase, 'grok-imagine case found in buildBody')
assert.match(grokImagineCase[0], /userRefs\.length > 0[\s\S]*throw new Error\(/,
	'storyverse grok-imagine branch refuses image refs (router schema is text-to-image only)')

// grok-video requires refs
assert.match(
	sv,
	/case 'grok-video':[\s\S]*if \(inputAssets\.length === 0\)[\s\S]*throw new Error\(/,
	'storyverse grok-video branch requires at least one input asset (router schema input_assets.min(1))',
)

// Veo branch refuses refs (case 'veo-3.1': falls through to case 'veo-3.1-lite': { ... })
const veoCase = sv.match(/case 'veo-3\.1':[\s\S]*?case 'veo-3\.1-lite':\s*\{[\s\S]*?(?=case '|default:)/)
assert.ok(veoCase, 'veo-3.1 case found in buildBody')
assert.match(veoCase[0], /userRefs\.length > 0[\s\S]*throw new Error\(/,
	'storyverse veo branch refuses image refs (router schema accepts only { prompt, aspectRatio })')

// refuseTooManyRefs guards every multi-image-ref-supporting model
assert.match(
	sv,
	/function refuseTooManyRefs[\s\S]*INPUT_ASSETS_MAX\[modelId\]/,
	'refuseTooManyRefs enforces the per-model input_assets.max(N) limit',
)

// ── grok-tts voice remap + midjourney quality remap (provider boundary translations) ──

assert.match(sv, /const GROK_TTS_VOICE_REMAP/,
	'storyverse.ts keeps the grok-tts voice id remap (plugin eve/ara/leo/rex/sal → router alloy/echo/...) at the provider boundary')
assert.match(sv, /function remapMidjourneyQuality/,
	'storyverse.ts keeps the midjourney quality remap (plugin 1/4 cost tier → router medium/high enum)')

console.log('✓ verify-storyverse: all', countAssertions(), 'invariants pass')

function countAssertions() {
	// Sloppy but enough for the success line; counts assert.* calls in this file at runtime.
	const self = readFileSync('scripts/verify-storyverse.mjs', 'utf8')
	return (self.match(/assert\.(match|ok|strictEqual|notStrictEqual|doesNotMatch)/g) || []).length
}
