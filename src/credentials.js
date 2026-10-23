/**
 * Credential resolution.
 *
 * Order of preference, mirroring how the built-in search providers resolve
 * theirs: the dsh credentials store first (what the settings card writes, what
 * survives restarts, never in a config file), then the process environment
 * (what a launcher script exports). A literal key in the profile YAML is
 * deliberately *not* supported: that file is meant to be shareable.
 *
 * @module dsh-information/credentials
 */

/**
 * @param {{ credentials?: { resolve(ref: string): Promise<{ value: string } | undefined> }, env?: Record<string, string | undefined> }} options
 */
export function createCredentialResolver({ credentials, env }) {
  const environment = env ?? process.env

  /**
   * @param {string} ref
   * @returns {Promise<string>} the key, or `''` when neither store has it.
   */
  async function resolve(ref) {
    if (!ref) return ''
    try {
      const stored = await credentials?.resolve?.(ref)
      const value = typeof stored?.value === 'string' ? stored.value.trim() : ''
      if (value) return value
    } catch {
      // A broken store must not break a search that the environment can serve.
    }
    const fromEnv = environment[ref]
    return typeof fromEnv === 'string' ? fromEnv.trim() : ''
  }

  /**
   * Where a key can be put, as one sentence for an error message.
   * @param {string} ref
   * @returns {string}
   */
  function hint(ref) {
    return `set it in Settings → Plugins → 信息源 (stored in ~/.dsh/.credentials.yaml as \`${ref}\`) or export \`${ref}\` in the shell that launched dsh`
  }

  return { resolve, hint }
}
