/**
 * Browser half of dsh-information: one settings page inside the DSH settings
 * panel (`settings.section`) that manages information sources.
 *
 * Layout follows the execution model exactly, so the page explains itself:
 *
 * ```
 * 网页搜索信息源
 * ┌─ [✓] Tavily — 带回答与引用的通用网页搜索            2 个实例 ─┐
 * │  1 [↑↓] [主号      ] [API Key ______] 额度 12%  [高级] [×]     │
 * │  2 [↑↓] [备用号    ] [API Key ______]           [高级] [×]     │
 * │  + 添加实例                                                   │
 * └───────────────────────────────────────────────────────────────┘
 * ```
 *
 * - The switch on a type header disables the **whole category**: its instances
 *   stop being offered to the model and stop being queried.
 * - Instances are the fail-over chain of that type; the list order is the
 *   priority (↑↓ reorders inside the type).
 * - A key is written the moment you finish typing (debounced) straight into the
 *   dsh credential store — it never renders back and never enters a config
 *   file, so there is nothing to "save".
 * - Structural edits (instances, disabled types, limits) go through the one
 *   footer button, because committing them reloads the plugin row.
 *
 * Styling and i18n follow the host settings pages: hairline-separated rows,
 * 14px labels with 12px hints, and `ctx.locale` read through
 * `useSyncExternalStore` so a language switch re-renders in place.
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
.di-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.di-row--head{padding-top:14px;align-items:flex-start}
.di-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.di-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.di-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.di-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.di-hint--tight{margin:0}
.di-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.di-ok{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
.di-input{box-sizing:border-box;min-width:0;height:30px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.di-input:focus-visible,.di-select:focus-visible,.di-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.di-input--name{width:130px}
.di-input--key{flex:1;min-width:150px}
.di-input--url{width:100%}
.di-input--num{width:104px}
.di-select{box-sizing:border-box;height:30px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.di-textarea{box-sizing:border-box;width:100%;min-height:52px;padding:7px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);font-size:12px;line-height:18px;resize:vertical}
.di-type{display:flex;align-items:flex-start;gap:12px;padding:16px 0 10px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.di-typeText{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.di-typeName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px;letter-spacing:.01em}
.di-typeMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.di-instance{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.di-instance:last-child{border-bottom:0}
.di-order{display:flex;align-items:center;gap:1px;flex:none}
.di-index{min-width:16px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.di-iconbtn{appearance:none;border:0;border-radius:6px;padding:2px 4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;line-height:1;font-size:12px}
.di-iconbtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.di-iconbtn:disabled{opacity:.3;cursor:default}
.di-iconbtn--danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.di-quota{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.di-quota b{color:var(--dsw-alias-label-primary);font-weight:600}
.di-switch{position:relative;flex:none;box-sizing:border-box;width:38px;height:21px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s}
.di-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.di-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.di-knob{display:block;width:17px;height:17px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 120ms ease}
.di-switch[aria-checked="true"] .di-knob{transform:translateX(17px)}
.di-details{margin:1px 0 3px}
.di-details>summary{cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;list-style:none}
.di-details>summary::-webkit-details-marker{display:none}
.di-details[open]>summary{margin-bottom:7px}
.di-advanced{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.di-advancedRow{display:flex;align-items:center;gap:8px}
.di-advancedRow .di-hint{flex:1;min-width:0}
.di-footer{display:flex;align-items:center;gap:8px;padding-top:18px}
.di-status{flex:1;min-width:0;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.di-status--error{color:var(--dsw-alias-state-error-primary)}
.di-status--ok{color:var(--dsw-alias-state-success-primary)}
.di-btn{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:transparent;color:var(--dsw-alias-label-primary)}
.di-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.di-btn--primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}
.di-btn:disabled{opacity:.4;cursor:default}
.di-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.di-empty{margin:0;padding:8px 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
`

    const zh = {
      nav: '信息源',
      intro:
        '插件提供信息源类型，你按类型建实例。查询时每种类型并行执行；同类型的实例按顺序互为备用，前面的失败自动用后面的（除非该实例选「失败即停」）。关掉一个类型 = 整个类别停用。',
      'group.limits': '通用',
      'group.web': '网页搜索信息源',
      'group.fact': '事实查询信息源',
      'maxResults.label': '每次结果条数',
      'maxResults.hint': '单个信息源一次返回多少条（1–20）。',
      'timeout.label': '超时（ms）',
      'timeout.hint': '单个实例的超时时间。',
      'type.enabled': '启用该类型',
      'type.count': '{n} 个实例',
      'type.countOne': '1 个实例',
      'instance.name': '名称',
      'instance.key': 'API Key',
      'instance.keySet': '已配置',
      'instance.keyEmpty': '未配置',
      'instance.keyHint': '输入即存入本机凭据库，不写进配置文件。',
      'instance.keySaved': '已存入凭据库',
      'instance.keyCleared': '已清除',
      'instance.keyFailed': '保存失败：{message}',
      'instance.quota': '额度',
      'instance.quotaRefresh': '刷新',
      'instance.quotaNone': '该类型不提供额度',
      'instance.quotaNoKey': '填了 Key 可查额度',
      'instance.remove': '删除该实例',
      'instance.moveUp': '上移（更优先）',
      'instance.moveDown': '下移',
      'instance.advanced': '高级选项',
      'instance.baseUrl': '接口地址（可选）',
      'instance.params': '厂商参数（JSON，可选）',
      'instance.onError': '失败时',
      'onError.next': '用同类型下一个',
      'onError.stop': '失败即停',
      'add.instance': '+ 添加实例',
      'type.noInstance': '还没有实例：点下面的按钮新建（密钥在实例行里填）。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      dirty: '有未保存的修改',
      loadFailed: '读取设置失败',
      saveFailed: '保存失败：{message}',
      loading: '正在读取设置…',
    }

    const en = {
      nav: 'Information sources',
      intro:
        'The plugin ships source types; you create the instances. Every type runs in parallel at query time, and the instances of one type are each other’s backup in order — the first that fails hands over to the next, unless it says “stop on failure”. Switching a type off disables the whole category.',
      'group.limits': 'General',
      'group.web': 'Web search sources',
      'group.fact': 'Fact lookup sources',
      'maxResults.label': 'Results per source',
      'maxResults.hint': 'How many results one source returns per call (1–20).',
      'timeout.label': 'Timeout (ms)',
      'timeout.hint': 'Per-instance timeout.',
      'type.enabled': 'Enable this type',
      'type.count': '{n} instances',
      'type.countOne': '1 instance',
      'instance.name': 'Name',
      'instance.key': 'API key',
      'instance.keySet': 'configured',
      'instance.keyEmpty': 'not set',
      'instance.keyHint': 'Saved to the local credential store as you type; never written to a config file.',
      'instance.keySaved': 'Stored',
      'instance.keyCleared': 'Cleared',
      'instance.keyFailed': 'Could not save: {message}',
      'instance.quota': 'Quota',
      'instance.quotaRefresh': 'Refresh',
      'instance.quotaNone': 'This type publishes no quota',
      'instance.quotaNoKey': 'Set a key to read the quota',
      'instance.remove': 'Remove this instance',
      'instance.moveUp': 'Move up (higher priority)',
      'instance.moveDown': 'Move down',
      'instance.advanced': 'Advanced',
      'instance.baseUrl': 'Endpoint (optional)',
      'instance.params': 'Vendor parameters (JSON, optional)',
      'instance.onError': 'On failure',
      'onError.next': 'Try the next instance',
      'onError.stop': 'Stop',
      'add.instance': '+ Add instance',
      'type.noInstance': 'No instance yet: add one below (the key lives on the instance row).',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      dirty: 'Unsaved changes',
      loadFailed: 'Could not read the settings',
      saveFailed: 'Save failed: {message}',
      loading: 'Reading settings…',
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
     * first render.
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

    /** One instance row: name, key (saved as you type), quota, advanced, remove. */
    function InstanceRow({ instance, index, total, t, onChange, onMove, onRemove, onKey, onQuota, usage, keyNote }) {
      const patch = (next) => onChange({ ...instance, ...next })
      const [keyDraft, setKeyDraft] = React.useState('')
      const quota = usage

      return h(
        'div',
        { className: 'di-instance', key: instance.id },
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
            instance.keyless
              ? null
              : h('input', {
                  className: 'di-input di-input--key',
                  type: 'password',
                  value: keyDraft,
                  placeholder: `${t('instance.key')}（${instance.keySet ? t('instance.keySet') : t('instance.keyEmpty')}）`,
                  'aria-label': t('instance.key'),
                  onChange: (event) => {
                    const value = event.target.value
                    setKeyDraft(value)
                    onKey(instance.id, value)
                  },
                  onBlur: () => onKey(instance.id, keyDraft, true),
                }),
            keyNote ?? h('span', { className: 'di-hint di-hint--tight' }, t('instance.keyHint')),
            instance.supportsUsage
              ? h(
                  'span',
                  { className: 'di-quota' },
                  `${t('instance.quota')} `,
                  // Nothing is fetched until the user asks: an ellipsis here
                  // would read as "loading" on every freshly opened card.
                  quota === undefined
                    ? null
                    : quota === null
                      ? t(instance.keySet ? 'instance.quotaNone' : 'instance.quotaNoKey')
                      : h(React.Fragment, null,
                          h('b', null, Number(quota.used ?? 0).toLocaleString()),
                          typeof quota.limit === 'number' && quota.limit > 0
                            ? ` / ${Number(quota.limit).toLocaleString()} (${Math.round((quota.used / quota.limit) * 100)}%)`
                            : '',
                          quota.plan ? ` · ${quota.plan}` : ''),
                  h('button', { type: 'button', className: 'di-btn', onClick: () => onQuota(instance.id) }, t('instance.quotaRefresh')),
                )
              : null,
            h('button', { type: 'button', className: 'di-iconbtn di-iconbtn--danger', title: t('instance.remove'), 'aria-label': t('instance.remove'), onClick: onRemove }, '✕'),
          ),
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
              h(
                'div',
                { className: 'di-advancedRow' },
                h('span', { className: 'di-hint' }, t('instance.onError')),
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
              ),
            ),
          ),
        ),
      )
    }

    function InformationSettingsPage(ctx) {
      const [t] = useT(ctx)
      const [state, setState] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [error, setError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [usage, setUsage] = React.useState({})
      const [keyNotes, setKeyNotes] = React.useState({})
      const keyTimers = React.useRef({})

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(API, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setState(data)
          setDraft({
            maxResults: data.config.maxResults,
            timeoutMs: data.config.timeoutMs,
            disabledTypes: data.types.filter((type) => type.enabled === false).map((type) => type.id),
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

      React.useEffect(() => () => {
        for (const timer of Object.values(keyTimers.current)) clearTimeout(timer)
      }, [])

      const types = state?.types ?? []
      const instances = draft?.instances ?? []
      const dirty = state !== null && draft !== null && JSON.stringify({
        maxResults: draft.maxResults,
        timeoutMs: draft.timeoutMs,
        disabledTypes: draft.disabledTypes,
        instances: draft.instances.map((i) => ({ id: i.id, type: i.type, name: i.name, onError: i.onError, baseUrl: i.baseUrl ?? '', extra: i.extra ?? {} })),
      }) !== JSON.stringify({
        maxResults: state.config.maxResults,
        timeoutMs: state.config.timeoutMs,
        disabledTypes: state.types.filter((type) => type.enabled === false).map((type) => type.id),
        instances: state.instances.map((i) => ({ id: i.id, type: i.type, name: i.name, onError: i.onError, baseUrl: i.baseUrl ?? '', extra: i.extra ?? {} })),
      })

      const noteFor = (id, text, tone) => {
        setKeyNotes((current) => ({ ...current, [id]: text ? h('span', { className: tone === 'error' ? 'di-error' : 'di-ok' }, text) : null }))
        const timer = setTimeout(() => setKeyNotes((current) => ({ ...current, [id]: null })), 2400)
        keyTimers.current[id] = timer
      }

      /** Keys are written as you type: debounce, then commit straight away. */
      const saveKey = (id, value, immediate = false) => {
        clearTimeout(keyTimers.current[id])
        keyTimers.current[id] = setTimeout(async () => {
          try {
            // A freshly added instance does not exist on the Host yet, so the
            // credential write would 404. The first keystroke therefore commits
            // the instance itself; adding a row alone stays cheap and local.
            if (!state.instances.some((instance) => instance.id === id)) await commit()
            const response = await fetch(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: value === '' ? 'clear-key' : 'set-key', id, value }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
            setUsage((current) => ({ ...current, [id]: undefined }))
            noteFor(id, t(value === '' ? 'instance.keyCleared' : 'instance.keySaved'))
            await load()
          } catch (keyError) {
            noteFor(id, t('instance.keyFailed', { message: keyError.message }), 'error')
          }
        }, immediate ? 0 : 700)
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

      /** Commit the structural draft (instances, disabled types, limits). */
      const commit = async () => {
        const response = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            config: {
              maxResults: draft.maxResults,
              timeoutMs: draft.timeoutMs,
              disabledTypes: JSON.stringify(draft.disabledTypes),
              instances: JSON.stringify(draft.instances.map((instance) => ({
                id: instance.id,
                type: instance.type,
                name: instance.name,
                onError: instance.onError,
                baseUrl: instance.baseUrl ?? '',
                extra: instance.extra ?? {},
              }))),
            },
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
        await load()
      }

      const save = async () => {
        setSaving(true)
        setStatus('')
        try {
          await commit()
          setStatus(t('saved'))
        } catch (saveError) {
          setError(t('saveFailed', { message: saveError.message }))
        } finally {
          setSaving(false)
        }
      }

      if (draft === null) {
        return h('div', { className: 'di-page' }, h('p', { className: 'di-intro' }, error || t('loading')))
      }

      const patchInstance = (next) =>
        setDraft((current) => ({
          ...current,
          instances: current.instances.map((instance) => (instance.id === next.id ? next : instance)),
        }))

      const toggleType = (typeId, on) =>
        setDraft((current) => ({
          ...current,
          disabledTypes: on ? current.disabledTypes.filter((id) => id !== typeId) : [...current.disabledTypes, typeId],
        }))

      const addInstance = (typeId) => {
        let id = typeId
        let counter = 2
        while (instances.some((instance) => instance.id === id)) id = `${typeId}-${counter++}`
        setDraft((current) => ({
          ...current,
          instances: [...current.instances, {
            id,
            type: typeId,
            name: `${types.find((type) => type.id === typeId)?.label ?? typeId} ${counter === 2 ? 1 : counter - 1}`,
            onError: 'next',
            baseUrl: '',
            extra: {},
          }],
        }))
      }

      /** Reorder inside one type only: cross-type order carries no meaning. */
      const moveInstance = (typeId, index, delta) =>
        setDraft((current) => {
          const group = current.instances.filter((instance) => instance.type === typeId)
          const target = index + delta
          if (target < 0 || target >= group.length) return current
          const rest = current.instances.filter((instance) => instance.type !== typeId)
          const moved = [...group]
          const [item] = moved.splice(index, 1)
          moved.splice(target, 0, item)
          // Keep the moved type's block where its first instance used to sit.
          const at = current.instances.indexOf(group[0])
          const head = at < 0 ? rest : current.instances.slice(0, at)
          const tail = at < 0 ? [] : current.instances.slice(at + group.length)
          return { ...current, instances: [...head, ...moved, ...tail] }
        })

      const typeBlock = (type) => {
        const group = instances.filter((instance) => instance.type === type.id)
        const enabled = !draft.disabledTypes.includes(type.id)
        return h(
          'div',
          { key: type.id, style: { opacity: enabled ? 1 : 0.55 } },
          h(
            'div',
            { className: 'di-type' },
            h(Switch, {
              checked: enabled,
              onChange: (value) => toggleType(type.id, value),
              label: `${t('type.enabled')}：${type.label}`,
            }),
            h(
              'div',
              { className: 'di-typeText' },
              h('span', { className: 'di-typeName' }, type.label),
              h('p', { className: 'di-hint di-hint--tight' }, type.hint),
              h('span', { className: 'di-typeMeta' }, group.length === 1 ? t('type.countOne') : t('type.count', { n: group.length })),
            ),
          ),
          group.length === 0
            ? h('p', { className: 'di-empty' }, t('type.noInstance'))
            : group.map((instance, index) =>
                h(InstanceRow, {
                  key: instance.id,
                  instance,
                  index,
                  total: group.length,
                  t,
                  onChange: patchInstance,
                  onMove: (from, delta) => moveInstance(type.id, from, delta),
                  onRemove: () =>
                    setDraft((current) => ({ ...current, instances: current.instances.filter((item) => item.id !== instance.id) })),
                  onKey: saveKey,
                  onQuota: refreshQuota,
                  usage: usage[instance.id],
                  keyNote: keyNotes[instance.id],
                }),
              ),
          h(
            'div',
            { className: 'di-row' },
            h('button', { type: 'button', className: 'di-btn', onClick: () => addInstance(type.id) }, t('add.instance')),
          ),
        )
      }

      const kindSection = (kind, title, empty) => {
        const list = types.filter((type) => type.kind === kind)
        return h(
          'div',
          { className: 'di-group' },
          h('h3', { className: 'di-groupTitle' }, title),
          list.length === 0 ? h('p', { className: 'di-empty' }, empty) : list.map(typeBlock),
        )
      }

      return h(
        'div',
        { className: 'di-page' },
        h('p', { className: 'di-intro' }, t('intro')),
        h(
          'div',
          { className: 'di-group' },
          h('h3', { className: 'di-groupTitle' }, t('group.limits')),
          h(
            'div',
            { className: 'di-row' },
            h('div', { className: 'di-main' }, h('span', { className: 'di-label' }, t('maxResults.label')), h('p', { className: 'di-hint' }, t('maxResults.hint'))),
            h('input', {
              className: 'di-input di-input--num',
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
              className: 'di-input di-input--num',
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
        kindSection('web', t('group.web'), ''),
        kindSection('fact', t('group.fact'), ''),
        h(
          'div',
          { className: 'di-footer' },
          h('p', { className: `di-status${error ? ' di-status--error' : status ? ' di-status--ok' : ''}` }, error || status || (dirty ? t('dirty') : '')),
          h('button', { type: 'button', className: 'di-btn di-btn--primary', disabled: saving || !dirty, onClick: save }, saving ? t('saving') : t('save')),
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
