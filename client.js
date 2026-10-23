/**
 * Browser half of dsh-information: one settings page inside the DSH settings
 * panel (`settings.section`) that manages information sources.
 *
 * Design rules this page follows (the host's own settings pages are the
 * reference — see dsh-penalty's card):
 *
 * - **Type → instances.** The plugin ships the types; the user creates as many
 *   instances per type as they need (two Tavily accounts, two SearXNG mirrors).
 *   The list order *is* the priority: the first one answers, the rest are the
 *   fail-over chain.
 * - **One row per instance**, hairline-separated, 14px label / 12px hint, a
 *   switch, and nothing that needs a manual to understand. Advanced fields
 *   (endpoint override, vendor parameters) hide behind a `<details>`.
 * - **Dynamic i18n.** `ctx.locale.bind()` returns a translator that reads the
 *   active language at call time, and `useSyncExternalStore` on the locale
 *   snapshot re-renders on a language switch — no reload, no stale text.
 * - **Keys never render back.** A key field is a password input that writes
 *   straight to the dsh credentials store through the same-origin API; the
 *   page only ever learns "configured / not configured".
 * - **Quota** is shown for the sources that publish one (Tavily today), with a
 *   manual refresh; the host caches and backs off so the card cannot burn the
 *   vendor's usage endpoint.
 *
 * @module dsh-information/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-information',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'settings.information'
    const API = 'dsh-information/api/settings'

    const CSS = `
.di-page{display:flex;flex-direction:column;min-width:0}
.di-intro{margin:0 0 4px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px}
.di-group{display:flex;flex-direction:column}
.di-groupTitle{margin:22px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;letter-spacing:.04em;text-transform:uppercase}
.di-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.di-row--head{padding-top:14px}
.di-order{display:flex;align-items:center;gap:2px;flex:none}
.di-index{min-width:18px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.di-iconbtn{appearance:none;border:0;border-radius:6px;padding:2px 4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;line-height:1}
.di-iconbtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.di-iconbtn:disabled{opacity:.35;cursor:default}
.di-iconbtn--danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.di-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.di-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.di-input{box-sizing:border-box;min-width:0;height:30px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.di-input:focus-visible,.di-select:focus-visible,.di-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.di-input--name{flex:1;min-width:120px}
.di-input--key{flex:1;min-width:140px}
.di-input--url{width:100%}
.di-select{box-sizing:border-box;height:30px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.di-textarea{box-sizing:border-box;width:100%;min-height:56px;padding:7px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);font-size:12px;line-height:18px;resize:vertical}
.di-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.di-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.di-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.di-quota{display:flex;align-items:center;gap:6px;flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.di-quota b{color:var(--dsw-alias-label-primary);font-weight:600}
.di-seg{display:inline-flex;padding:2px;border:.5px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);gap:2px}
.di-seg button{appearance:none;border:0;border-radius:7px;padding:4px 12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.di-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.di-switch{position:relative;flex:none;box-sizing:border-box;width:34px;height:19px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s}
.di-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.di-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.di-knob{display:block;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 120ms ease}
.di-switch[aria-checked="true"] .di-knob{transform:translateX(15px)}
.di-details{margin:2px 0 4px}
.di-details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;list-style:none}
.di-details>summary::-webkit-details-marker{display:none}
.di-details[open]>summary{margin-bottom:8px}
.di-advanced{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.di-footer{display:flex;align-items:center;gap:8px;padding-top:18px}
.di-status{flex:1;min-width:0;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.di-status--error{color:var(--dsw-alias-state-error-primary)}
.di-status--ok{color:var(--dsw-alias-state-success-primary)}
.di-btn{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:transparent;color:var(--dsw-alias-label-primary)}
.di-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.di-btn--primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}
.di-btn:disabled{opacity:.4;cursor:default}
.di-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.di-empty{margin:0;padding:10px 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
`

    const zh = {
      nav: '信息源',
      intro: '插件提供信息源类型，你按需创建实例；列表顺序即优先级，前面的失败会自动用后面的（除非该实例选择「失败即停」）。',
      'group.mode': '执行方式',
      'group.web': '网页搜索信息源',
      'group.fact': '事实查询信息源',
      'group.provider': '内置 web_search 的提供方（可选）',
      'mode.label': '检索方式',
      'mode.chain': '逐个尝试',
      'mode.merge': '多源合并',
      'mode.hint': '逐个尝试：按优先级用第一个成功的；多源合并：同时查所有并合并去重（召回更高、调用更多）。',
      'maxResults.label': '每次结果条数',
      'maxResults.hint': '单个信息源一次返回多少条（1–20）。',
      'timeout.label': '超时（ms）',
      'timeout.hint': '单个信息源的超时时间。',
      'instance.name': '名称',
      'instance.type': '类型',
      'instance.onError': '失败时',
      'onError.next': '用下一个',
      'onError.stop': '失败即停',
      'instance.enabled': '启用',
      'instance.key': 'API Key',
      'instance.keySet': '已配置',
      'instance.keyEmpty': '未配置',
      'instance.keyHint': '保存在本机凭据库里，不写进配置文件。',
      'instance.baseUrl': '接口地址（可选）',
      'instance.params': '厂商参数（JSON，可选）',
      'instance.quota': '额度',
      'instance.quotaRefresh': '刷新额度',
      'instance.quotaNone': '该信息源不提供额度查询',
      'instance.quotaNoKey': '配置密钥后可查额度',
      'instance.remove': '删除该信息源',
      'instance.moveUp': '上移（提高优先级）',
      'instance.moveDown': '下移（降低优先级）',
      'instance.advanced': '高级选项',
      'add.web': '+ 添加网页信息源',
      'add.fact': '+ 添加事实信息源',
      'empty.web': '还没有网页信息源：点下面的按钮按类型新建。',
      'empty.fact': '还没有事实信息源：点下面的按钮按类型新建。',
      'provider.label': '提供方',
      'provider.keep': '保持当前（不修改）',
      'provider.hint': '把内置 web_search 工具也接到这些信息源上；留空则沿用当前配置。',
      'provider.save': '应用',
      'provider.saved': '已切换内置 web_search 的提供方',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      loadFailed: '读取设置失败',
      saveFailed: '保存失败：{message}',
      loading: '正在读取设置…',
      'key.saved': '密钥已保存',
      'key.cleared': '密钥已清除',
      'key.failed': '密钥保存失败：{message}',
      'quota.failed': '额度查询失败',
      'quota.plan': '{plan} 套餐',
    }

    const en = {
      nav: 'Information sources',
      intro: 'The plugin ships source types; you create the instances. List order is the priority: the first one answers and the rest are the fail-over chain, unless an instance chooses “stop on failure”.',
      'group.mode': 'Execution',
      'group.web': 'Web search sources',
      'group.fact': 'Fact lookup sources',
      'group.provider': 'Provider for the built-in web_search (optional)',
      'mode.label': 'Mode',
      'mode.chain': 'One by one',
      'mode.merge': 'Merge all',
      'mode.hint': 'One by one: use the first source that succeeds. Merge all: query every source at once and merge the results (better recall, more calls).',
      'maxResults.label': 'Results per source',
      'maxResults.hint': 'How many results one source returns per call (1–20).',
      'timeout.label': 'Timeout (ms)',
      'timeout.hint': 'Per-source timeout.',
      'instance.name': 'Name',
      'instance.type': 'Type',
      'instance.onError': 'On failure',
      'onError.next': 'Try next',
      'onError.stop': 'Stop',
      'instance.enabled': 'Enabled',
      'instance.key': 'API key',
      'instance.keySet': 'configured',
      'instance.keyEmpty': 'not set',
      'instance.keyHint': 'Stored in the local credential store, never in a config file.',
      'instance.baseUrl': 'Endpoint (optional)',
      'instance.params': 'Vendor parameters (JSON, optional)',
      'instance.quota': 'Quota',
      'instance.quotaRefresh': 'Refresh quota',
      'instance.quotaNone': 'This source publishes no quota',
      'instance.quotaNoKey': 'Set a key to read the quota',
      'instance.remove': 'Remove this source',
      'instance.moveUp': 'Move up (higher priority)',
      'instance.moveDown': 'Move down (lower priority)',
      'instance.advanced': 'Advanced',
      'add.web': '+ Add web source',
      'add.fact': '+ Add fact source',
      'empty.web': 'No web source yet: add one by type below.',
      'empty.fact': 'No fact source yet: add one by type below.',
      'provider.label': 'Provider',
      'provider.keep': 'Keep current (no change)',
      'provider.hint': 'Point the built-in web_search tool at these sources; leave empty to keep the current configuration.',
      'provider.save': 'Apply',
      'provider.saved': 'Built-in web_search provider updated',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      loadFailed: 'Could not read the settings',
      saveFailed: 'Save failed: {message}',
      loading: 'Reading settings…',
      'key.saved': 'Key saved',
      'key.cleared': 'Key cleared',
      'key.failed': 'Could not save the key: {message}',
      'quota.failed': 'Quota lookup failed',
      'quota.plan': '{plan} plan',
    }

    /** Fill `{name}` placeholders; the host locale has no templating of its own. */
    function fill(template, params) {
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
    }

    /**
     * Per-context locale bindings. `useSyncExternalStore` needs a *stable*
     * subscribe function, and `ctx.locale.subscribe` is a method — handing it
     * over unbound would call it with `this === undefined` and throw on the
     * first render. The wrappers below are created once per plugin context.
     *
     * @returns {[ (key: string, params?: Record<string, string>) => string, string ]}
     */
    const localeBindings = new WeakMap()
    function useT(ctx) {
      let bindings = localeBindings.get(ctx)
      if (bindings === undefined) {
        bindings = {
          subscribe: (listener) => ctx.locale.subscribe(listener),
          getSnapshot: () => ctx.locale.getSnapshot().revision,
          translate: (key, params) => fill(ctx.locale.bind(NS)(key), params),
        }
        localeBindings.set(ctx, bindings)
      }
      const revision = React.useSyncExternalStore(bindings.subscribe, bindings.getSnapshot, () => 'boot')
      return [bindings.translate, String(revision)]
    }

    /** One compact switch, following the host settings pages. */
    function Switch({ checked, onChange, label }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'di-switch',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'di-knob' }),
      )
    }

    /** One instance row: identity + priority controls, key, quota, advanced. */
    function InstanceRow({ instance, index, total, types, t, onChange, onMove, onRemove, onKey, onQuota, usage }) {
      const type = types.find((candidate) => candidate.id === instance.type) ?? { label: instance.type }
      const [keyDraft, setKeyDraft] = React.useState('')
      const [keyState, setKeyState] = React.useState('')
      const patch = (next) => onChange({ ...instance, ...next })
      const quotaText = () => {
        if (usage === undefined) return null
        if (usage === null) return t(instance.keyless ? 'instance.quotaNone' : 'instance.quotaNoKey')
        const used = Number(usage.used ?? 0).toLocaleString()
        const limit = typeof usage.limit === 'number' && usage.limit > 0 ? Number(usage.limit).toLocaleString() : null
        const percent = limit ? Math.round((usage.used / usage.limit) * 100) : null
        return h(
          React.Fragment,
          null,
          h('b', null, used),
          limit ? ` / ${limit}` : '',
          percent !== null ? ` (${percent}%)` : '',
          usage.plan ? ` · ${fill(t('quota.plan'), { plan: usage.plan })}` : '',
        )
      }

      return h(
        'div',
        { className: 'di-row', key: instance.id },
        h(
          'div',
          { className: 'di-order' },
          h('span', { className: 'di-index' }, String(index + 1)),
          h('button', { type: 'button', className: 'di-iconbtn', title: t('instance.moveUp'), 'aria-label': t('instance.moveUp'), disabled: index === 0, onClick: () => onMove(index, -1) }, '↑'),
          h('button', { type: 'button', className: 'di-iconbtn', title: t('instance.moveDown'), 'aria-label': t('instance.moveDown'), disabled: index === total - 1, onClick: () => onMove(index, 1) }, '↓'),
        ),
        h(
          'div',
          { className: 'di-main' },
          h(
            'div',
            { className: 'di-line' },
            h('input', {
              className: 'di-input di-input--name',
              value: instance.name,
              'aria-label': t('instance.name'),
              onChange: (event) => patch({ name: event.target.value }),
            }),
            h(
              'select',
              {
                className: 'di-select',
                value: instance.type,
                'aria-label': t('instance.type'),
                onChange: (event) => patch({ type: event.target.value }),
              },
              types.map((candidate) =>
                h('option', { key: candidate.id, value: candidate.id }, `${candidate.label}${candidate.kind === 'web' ? '' : ''}`),
              ),
            ),
            h(
              'select',
              {
                className: 'di-select',
                value: instance.onError,
                'aria-label': t('instance.onError'),
                onChange: (event) => patch({ onError: event.target.value }),
              },
              h('option', { value: 'next' }, t('onError.next')),
              h('option', { value: 'stop' }, t('onError.stop')),
            ),
            h(Switch, { checked: instance.enabled !== false, onChange: (value) => patch({ enabled: value }), label: t('instance.enabled') }),
            h('button', { type: 'button', className: 'di-iconbtn di-iconbtn--danger', title: t('instance.remove'), 'aria-label': t('instance.remove'), onClick: onRemove }, '✕'),
          ),
          instance.keyless
            ? null
            : h(
                'div',
                { className: 'di-line' },
                h('input', {
                  className: 'di-input di-input--key',
                  type: 'password',
                  value: keyDraft,
                  placeholder: `${t('instance.key')}（${instance.keySet ? t('instance.keySet') : t('instance.keyEmpty')}）`,
                  'aria-label': t('instance.key'),
                  onChange: (event) => setKeyDraft(event.target.value),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'di-btn',
                    disabled: keyDraft.trim() === '',
                    onClick: async () => {
                      setKeyState('')
                      const ok = await onKey(instance.id, keyDraft.trim())
                      setKeyState(ok ? 'ok' : 'error')
                      if (ok) setKeyDraft('')
                    },
                  },
                  t('save'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'di-btn',
                    onClick: async () => {
                      const ok = await onKey(instance.id, '')
                      setKeyState(ok ? 'cleared' : 'error')
                    },
                  },
                  '✕',
                ),
                keyState === 'ok'
                  ? h('span', { className: 'di-hint' }, t('key.saved'))
                  : keyState === 'cleared'
                    ? h('span', { className: 'di-hint' }, t('key.cleared'))
                    : keyState === 'error'
                      ? h('span', { className: 'di-error' }, t('key.failed', { message: '' }))
                      : h('span', { className: 'di-hint' }, t('instance.keyHint')),
              ),
          instance.supportsUsage
            ? h(
                'div',
                { className: 'di-line' },
                h('span', { className: 'di-quota' }, `${t('instance.quota')}：`, quotaText() ?? '…'),
                h(
                  'button',
                  { type: 'button', className: 'di-btn', onClick: () => onQuota(instance.id) },
                  t('instance.quotaRefresh'),
                ),
              )
            : null,
          h(
            'details',
            { className: 'di-details' },
            h('summary', null, t('instance.advanced')),
            h(
              'div',
              { className: 'di-advanced' },
              h('input', {
                className: 'di-input di-input--url',
                value: instance.baseUrl ?? '',
                placeholder: t('instance.baseUrl'),
                'aria-label': t('instance.baseUrl'),
                onChange: (event) => patch({ baseUrl: event.target.value }),
              }),
              h('textarea', {
                className: 'di-textarea',
                value: JSON.stringify(instance.extra ?? {}),
                spellCheck: false,
                'aria-label': t('instance.params'),
                onChange: (event) => {
                  try {
                    patch({ extra: JSON.parse(event.target.value || '{}') })
                  } catch {
                    // Keep the draft as-is; the user is still typing.
                  }
                },
              }),
            ),
          ),
        ),
      )
    }

    function InformationSettingsPage(ctx) {
      const [t] = useT(ctx)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [draft, setDraft] = React.useState(null)
      const [usage, setUsage] = React.useState({})
      const [provider, setProvider] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(API, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setState(data)
          setDraft({
            mode: data.config.mode,
            maxResults: data.config.maxResults,
            timeoutMs: data.config.timeoutMs,
            instances: data.instances,
          })
          setError('')
        } catch (loadError) {
          setError(`${t('loadFailed')}（${loadError.message}）`)
        }
      }, [t])

      React.useEffect(() => {
        void load()
      }, [load])

      const types = state?.types ?? []
      const webTypes = types.filter((type) => type.kind === 'web')
      const factTypes = types.filter((type) => type.kind === 'fact')
      const instances = draft?.instances ?? []

      const patchInstance = (next) =>
        setDraft((current) => ({
          ...current,
          instances: current.instances.map((instance) => (instance.id === next.id ? next : instance)),
        }))

      const move = (index, delta) =>
        setDraft((current) => {
          const list = [...current.instances]
          const target = index + delta
          if (target < 0 || target >= list.length) return current
          const [moved] = list.splice(index, 1)
          list.splice(target, 0, moved)
          return { ...current, instances: list }
        })

      const addInstance = (kind) => {
        const pool = kind === 'web' ? webTypes : factTypes
        if (pool.length === 0) return
        const type = pool[0]
        const base = type.id
        let id = base
        let counter = 2
        while (instances.some((instance) => instance.id === id)) id = `${base}-${counter++}`
        setDraft((current) => ({
          ...current,
          instances: [
            ...current.instances,
            {
              id,
              type: type.id,
              name: type.label,
              enabled: true,
              onError: 'next',
              baseUrl: '',
              extra: {},
              keyless: type.keyless === true,
              keySet: false,
              credentialRef: null,
              supportsUsage: type.supportsUsage === true,
            },
          ],
        }))
      }

      const removeInstance = (id) =>
        setDraft((current) => ({ ...current, instances: current.instances.filter((instance) => instance.id !== id) }))

      const saveKey = async (id, value) => {
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: value === '' ? 'clear-key' : 'set-key', id, value }),
          })
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`)
          setUsage((current) => ({ ...current, [id]: undefined }))
          await load()
          return true
        } catch (keyError) {
          setError(t('key.failed', { message: keyError.message }))
          return false
        }
      }

      const refreshQuota = async (id) => {
        setUsage((current) => ({ ...current, [id]: undefined }))
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'usage', id }),
          })
          const data = await response.json()
          setUsage((current) => ({ ...current, [id]: data.usage ?? null }))
        } catch {
          setUsage((current) => ({ ...current, [id]: null }))
        }
      }

      const save = async () => {
        setSaving(true)
        setStatus('')
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              config: {
                mode: draft.mode,
                maxResults: draft.maxResults,
                timeoutMs: draft.timeoutMs,
                instances: JSON.stringify(draft.instances.map((instance) => ({
                  id: instance.id,
                  type: instance.type,
                  name: instance.name,
                  enabled: instance.enabled !== false,
                  onError: instance.onError,
                  baseUrl: instance.baseUrl ?? '',
                  extra: instance.extra ?? {},
                }))),
              },
            }),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
          setStatus(t('saved'))
          await load()
        } catch (saveError) {
          setError(t('saveFailed', { message: saveError.message }))
        } finally {
          setSaving(false)
        }
      }

      const applyProvider = async () => {
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'search-provider', provider }),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
          setStatus(t('provider.saved'))
          await load()
        } catch (providerError) {
          setError(t('saveFailed', { message: providerError.message }))
        }
      }

      if (draft === null) {
        return h('div', { className: 'di-page' }, h('p', { className: 'di-intro' }, error || t('loading')))
      }

      const section = (kind, title, emptyText, addLabel) => {
        const list = instances.filter((instance) => (types.find((type) => type.id === instance.type)?.kind ?? 'web') === kind)
        return h(
          'div',
          { className: 'di-group' },
          h('h3', { className: 'di-groupTitle' }, title),
          list.length === 0
            ? h('p', { className: 'di-empty' }, emptyText)
            : list.map((instance, index) =>
                h(InstanceRow, {
                  key: instance.id,
                  instance,
                  index,
                  total: list.length,
                  types: kind === 'web' ? webTypes : factTypes,
                  t,
                  onChange: patchInstance,
                  onMove: (from, delta) => {
                    const absolute = instances.indexOf(list[from])
                    move(absolute, delta)
                  },
                  onRemove: () => removeInstance(instance.id),
                  onKey: saveKey,
                  onQuota: refreshQuota,
                  usage: usage[instance.id],
                }),
              ),
          h(
            'div',
            { className: 'di-row di-row--head' },
            h('button', { type: 'button', className: 'di-btn', onClick: () => addInstance(kind) }, addLabel),
          ),
        )
      }

      return h(
        'div',
        { className: 'di-page' },
        h('p', { className: 'di-intro' }, t('intro')),
        h(
          'div',
          { className: 'di-group' },
          h('h3', { className: 'di-groupTitle' }, t('group.mode')),
          h(
            'div',
            { className: 'di-row' },
            h('div', { className: 'di-main' }, h('span', { className: 'di-label' }, t('mode.label')), h('p', { className: 'di-hint' }, t('mode.hint'))),
            h(
              'div',
              { className: 'di-seg', role: 'group', 'aria-label': t('mode.label') },
              h('button', { type: 'button', 'aria-pressed': draft.mode === 'chain' ? 'true' : 'false', onClick: () => setDraft({ ...draft, mode: 'chain' }) }, t('mode.chain')),
              h('button', { type: 'button', 'aria-pressed': draft.mode === 'merge' ? 'true' : 'false', onClick: () => setDraft({ ...draft, mode: 'merge' }) }, t('mode.merge')),
            ),
          ),
          h(
            'div',
            { className: 'di-row' },
            h('div', { className: 'di-main' }, h('span', { className: 'di-label' }, t('maxResults.label')), h('p', { className: 'di-hint' }, t('maxResults.hint'))),
            h('input', {
              className: 'di-input',
              type: 'number',
              min: 1,
              max: 20,
              value: draft.maxResults,
              'aria-label': t('maxResults.label'),
              onChange: (event) => setDraft({ ...draft, maxResults: Math.max(1, Math.min(20, Number(event.target.value) || 1)) }),
            }),
          ),
          h(
            'div',
            { className: 'di-row' },
            h('div', { className: 'di-main' }, h('span', { className: 'di-label' }, t('timeout.label')), h('p', { className: 'di-hint' }, t('timeout.hint'))),
            h('input', {
              className: 'di-input',
              type: 'number',
              min: 1000,
              max: 120000,
              step: 1000,
              value: draft.timeoutMs,
              'aria-label': t('timeout.label'),
              onChange: (event) => setDraft({ ...draft, timeoutMs: Math.max(1000, Math.min(120000, Number(event.target.value) || 1000)) }),
            }),
          ),
        ),
        section('web', t('group.web'), t('empty.web'), t('add.web')),
        section('fact', t('group.fact'), t('empty.fact'), t('add.fact')),
        h(
          'div',
          { className: 'di-group' },
          h('h3', { className: 'di-groupTitle' }, t('group.provider')),
          h(
            'div',
            { className: 'di-row' },
            h('div', { className: 'di-main' }, h('span', { className: 'di-label' }, t('provider.label')), h('p', { className: 'di-hint' }, t('provider.hint'))),
            h(
              'select',
              {
                className: 'di-select',
                value: provider,
                'aria-label': t('provider.label'),
                onChange: (event) => setProvider(event.target.value),
              },
              h('option', { value: '' }, t('provider.keep')),
              (state?.webProviders ?? []).map((id) => h('option', { key: id, value: id }, id)),
            ),
            h('button', { type: 'button', className: 'di-btn', disabled: provider === '', onClick: applyProvider }, t('provider.save')),
          ),
        ),
        h(
          'div',
          { className: 'di-footer' },
          h('p', { className: `di-status${error ? ' di-status--error' : status ? ' di-status--ok' : ''}` }, error || status),
          h('button', { type: 'button', className: 'di-btn di-btn--primary', disabled: saving, onClick: save }, saving ? t('saving') : t('save')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-information: dictionaries')
        ctx.effect(
          () => {
            const tag = document.createElement('style')
            tag.setAttribute('data-dsh-information', '')
            tag.textContent = CSS
            document.head.appendChild(tag)
            return () => tag.remove()
          },
          'dsh-information: styles',
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-information',
              order: 55,
              label: () => ctx.locale.bind(NS)('nav'),
              locale: NS,
            },
            () => InformationSettingsPage(ctx),
          ),
        )
      },
    }
  },
})
