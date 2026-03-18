import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth.js'
import { notificationsApi } from '../api/notifications.js'
import { configApi } from '../api/configio.js'
import { useAuthStore } from '../store/authStore.js'

// ── small reusable components ─────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Input(props) {
  return (
    <input
      {...props}
      className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
    />
  )
}

function Btn({ variant = 'primary', disabled, children, ...rest }) {
  const base = 'text-sm font-medium rounded-md px-4 py-2 transition-colors disabled:opacity-50'
  const styles = {
    primary:  `${base} bg-indigo-600 hover:bg-indigo-500 text-white`,
    danger:   `${base} bg-red-700 hover:bg-red-600 text-white`,
    ghost:    `${base} bg-gray-800 hover:bg-gray-700 text-gray-300`,
  }
  return <button disabled={disabled} className={styles[variant]} {...rest}>{children}</button>
}

// ── My Account section ────────────────────────────────────────────────────────

function MyAccount() {
  const { user, setAuth } = useAuthStore()
  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm ] = useState('')
  const [msg,      setMsg   ]   = useState(null)   // { type: 'ok'|'err', text }
  const [loading,  setLoading]  = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    setMsg(null)
    if (password && password !== confirm) {
      setMsg({ type: 'err', text: 'Passwords do not match' })
      return
    }
    setLoading(true)
    try {
      const payload = {}
      if (username !== user.username) payload.username = username
      if (password) payload.password = password
      if (!Object.keys(payload).length) {
        setMsg({ type: 'ok', text: 'Nothing changed' })
        setLoading(false)
        return
      }
      const updated = await authApi.updateMe(payload)
      // Refresh the stored user (token stays valid)
      setAuth(useAuthStore.getState().token, updated)
      setPassword('')
      setConfirm('')
      setMsg({ type: 'ok', text: 'Saved!' })
    } catch (err) {
      setMsg({ type: 'err', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Section title="My Account">
      <form onSubmit={handleSave} className="space-y-4 max-w-sm">
        {msg && (
          <div className={`text-sm rounded-md px-3 py-2 ${
            msg.type === 'ok'
              ? 'bg-green-900/40 border border-green-700 text-green-300'
              : 'bg-red-900/40 border border-red-700 text-red-300'
          }`}>
            {msg.text}
          </div>
        )}
        <Field label="Username">
          <Input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="New Password">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Leave blank to keep current"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
          />
        </Field>
        {password && (
          <Field label="Confirm Password">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        )}
        <Btn type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save changes'}
        </Btn>
      </form>
    </Section>
  )
}

// ── User Management section (admin only) ──────────────────────────────────────

function UserRow({ u, currentId, onDeleted, onToggleAdmin }) {
  const [busy, setBusy] = useState(false)

  async function del() {
    if (!confirm(`Delete user "${u.username}"?`)) return
    setBusy(true)
    try {
      await authApi.deleteUser(u.id)
      onDeleted(u.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleAdmin() {
    setBusy(true)
    try {
      const updated = await authApi.updateUser(u.id, { is_admin: !u.is_admin })
      onToggleAdmin(updated)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-t border-gray-800">
      <td className="py-2 pr-4 text-sm text-gray-200">{u.username}</td>
      <td className="py-2 pr-4">
        <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_admin ? 'bg-indigo-800 text-indigo-200' : 'bg-gray-700 text-gray-400'}`}>
          {u.is_admin ? 'admin' : 'user'}
        </span>
      </td>
      <td className="py-2 text-right space-x-2">
        {u.id !== currentId && (
          <>
            <Btn variant="ghost" disabled={busy} onClick={toggleAdmin}>
              {u.is_admin ? 'Remove admin' : 'Make admin'}
            </Btn>
            <Btn variant="danger" disabled={busy} onClick={del}>Delete</Btn>
          </>
        )}
      </td>
    </tr>
  )
}

function AddUserForm({ onAdded }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin,  setIsAdmin ] = useState(false)
  const [error,    setError  ]  = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await authApi.createUser({ username, password, is_admin: isAdmin })
      onAdded(user)
      setUsername('')
      setPassword('')
      setIsAdmin(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-gray-800 flex flex-wrap items-end gap-3">
      {error && <p className="w-full text-red-400 text-sm">{error}</p>}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Username</label>
        <Input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          style={{ width: '140px' }}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Password (min 8)</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={{ width: '160px' }}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-400 pb-1.5">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
          className="accent-indigo-500"
        />
        Admin
      </label>
      <Btn type="submit" disabled={loading}>
        {loading ? 'Adding…' : 'Add user'}
      </Btn>
    </form>
  )
}

function UsersManagement() {
  const { user: me } = useAuthStore()
  const [users,   setUsers  ] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError  ] = useState('')

  useEffect(() => {
    authApi.listUsers()
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-gray-500">Loading users…</p>
  if (error)   return <p className="text-sm text-red-400">{error}</p>

  return (
    <Section title="User Management">
      <table className="w-full">
        <tbody>
          {users.map((u) => (
            <UserRow
              key={u.id}
              u={u}
              currentId={me?.id}
              onDeleted={(id) => setUsers((prev) => prev.filter((x) => x.id !== id))}
              onToggleAdmin={(updated) => setUsers((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
            />
          ))}
        </tbody>
      </table>
      <AddUserForm onAdded={(u) => setUsers((prev) => [...prev, u])} />
    </Section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  async function handleLogout() {
    try { await authApi.logout() } catch { /* ignore */ }
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Settings</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-red-400 hover:text-red-300 transition-colors"
        >
          Sign out
        </button>
      </div>

      <MyAccount />
      {user?.is_admin && <UsersManagement />}
      {user?.is_admin && <NotificationChannels />}
      {user?.is_admin && <ImportExport />}
    </div>
  )
}

// ── Notification channels ─────────────────────────────────────────────────────

const CH_TYPES = ['gotify', 'ntfy', 'email', 'webhook']

const DEFAULT_CONFIG = {
  gotify:  { url: '', token: '', priority: 5 },
  ntfy:    { url: 'https://ntfy.sh', topic: '', priority: 'default' },
  email:   { smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', smtp_tls: true, from_addr: '', to_addrs: '' },
  webhook: { url: '', headers: {} },
}

function ConfigFields({ type, config, onChange }) {
  const set = (k, v) => onChange({ ...config, [k]: v })
  const inp = (label, key, extra = {}) => (
    <div key={key}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <Input value={config[key] ?? ''} onChange={e => set(key, e.target.value)} {...extra} />
    </div>
  )

  if (type === 'gotify') return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inp('Server URL', 'url', { placeholder: 'https://gotify.example.com' })}
      {inp('App Token', 'token', { placeholder: 'token…', type: 'password' })}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Priority (1–10)</label>
        <Input type="number" min={1} max={10} value={config.priority ?? 5} onChange={e => set('priority', Number(e.target.value))} />
      </div>
    </div>
  )

  if (type === 'ntfy') return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inp('Server URL', 'url', { placeholder: 'https://ntfy.sh' })}
      {inp('Topic', 'topic', { placeholder: 'my-topic' })}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Priority</label>
        <select className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100"
          value={config.priority ?? 'default'} onChange={e => set('priority', e.target.value)}>
          {['max','urgent','high','default','low','min'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
    </div>
  )

  if (type === 'email') return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inp('SMTP Host', 'smtp_host', { placeholder: 'smtp.gmail.com' })}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Port</label>
        <Input type="number" value={config.smtp_port ?? 587} onChange={e => set('smtp_port', Number(e.target.value))} />
      </div>
      {inp('Username', 'smtp_user', { placeholder: 'user@example.com' })}
      {inp('Password', 'smtp_password', { placeholder: '••••••••', type: 'password' })}
      {inp('From', 'from_addr', { placeholder: 'syswarden@example.com' })}
      {inp('To (comma-separated)', 'to_addrs', { placeholder: 'a@b.com, c@d.com' })}
      <label className="flex items-center gap-2 text-sm text-gray-400 col-span-full">
        <input type="checkbox" className="accent-indigo-500"
          checked={!!config.smtp_tls} onChange={e => set('smtp_tls', e.target.checked)} />
        Use STARTTLS
      </label>
    </div>
  )

  if (type === 'webhook') return (
    <div className="grid grid-cols-1 gap-3">
      {inp('Webhook URL', 'url', { placeholder: 'https://hooks.example.com/…' })}
    </div>
  )

  return null
}

function ChannelRow({ ch, onUpdated, onDeleted }) {
  const [busy,    setBusy   ] = useState(false)
  const [testMsg, setTestMsg] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editName,   setEditName  ] = useState(ch.name)
  const [editConfig, setEditConfig] = useState(ch.config)
  const [editEvents, setEditEvents] = useState({
    notify_agent_offline: ch.notify_agent_offline,
    notify_agent_online:  ch.notify_agent_online,
    notify_monitor_down:  ch.notify_monitor_down,
    notify_monitor_up:    ch.notify_monitor_up,
  })
  const [editError, setEditError] = useState('')

  function openEdit() {
    setEditName(ch.name)
    setEditConfig({ ...ch.config })
    setEditEvents({
      notify_agent_offline: ch.notify_agent_offline,
      notify_agent_online:  ch.notify_agent_online,
      notify_monitor_down:  ch.notify_monitor_down,
      notify_monitor_up:    ch.notify_monitor_up,
    })
    setEditError('')
    setEditing(true)
  }

  async function saveEdit(e) {
    e.preventDefault()
    setEditError('')
    setBusy(true)
    try {
      const updated = await notificationsApi.update(ch.id, {
        name: editName,
        config: editConfig,
        ...editEvents,
      })
      onUpdated(updated)
      setEditing(false)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggle() {
    setBusy(true)
    try {
      const updated = await notificationsApi.update(ch.id, { enabled: !ch.enabled })
      onUpdated(updated)
    } catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  async function del() {
    if (!confirm(`Delete channel "${ch.name}"?`)) return
    setBusy(true)
    try {
      await notificationsApi.remove(ch.id)
      onDeleted(ch.id)
    } catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  async function test() {
    setBusy(true)
    setTestMsg(null)
    try {
      await notificationsApi.test(ch.id)
      setTestMsg({ ok: true, text: 'Test sent!' })
    } catch (err) {
      setTestMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
      setTimeout(() => setTestMsg(null), 5000)
    }
  }

  const toggleEvent = (k) => setEditEvents(prev => ({ ...prev, [k]: !prev[k] }))

  const eventLabels = [
    ch.notify_agent_offline && 'agent↓',
    ch.notify_agent_online  && 'agent↑',
    ch.notify_monitor_down  && 'monitor↓',
    ch.notify_monitor_up    && 'monitor↑',
  ].filter(Boolean)

  return (
    <div className="border-t border-gray-800">
      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
        <span className={`w-2 h-2 rounded-full shrink-0 ${ch.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
        <span className="font-medium text-gray-200 min-w-[120px]">{ch.name}</span>
        <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded-full uppercase">{ch.type}</span>
        <span className="flex gap-1 flex-wrap flex-1">
          {eventLabels.map(l => (
            <span key={l} className="text-[10px] bg-indigo-900/50 text-indigo-300 border border-indigo-700/50 px-1.5 py-0.5 rounded-full">{l}</span>
          ))}
        </span>
        {testMsg && (
          <span className={`text-xs ${testMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{testMsg.text}</span>
        )}
        <div className="flex gap-1 ml-auto">
          <Btn variant="ghost" disabled={busy} onClick={test}>Test</Btn>
          <Btn variant="ghost" disabled={busy} onClick={openEdit}>Edit</Btn>
          <Btn variant="ghost" disabled={busy} onClick={toggle}>{ch.enabled ? 'Disable' : 'Enable'}</Btn>
          <Btn variant="danger" disabled={busy} onClick={del}>Delete</Btn>
        </div>
      </div>

      {/* Inline edit panel */}
      {editing && (
        <form onSubmit={saveEdit} className="mb-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700 space-y-4">
          {editError && <p className="text-red-400 text-sm">{editError}</p>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Channel name</label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} required />
          </div>
          <ConfigFields type={ch.type} config={editConfig} onChange={setEditConfig} />
          <div>
            <p className="text-xs text-gray-500 mb-2">Notify on</p>
            <div className="flex flex-wrap gap-4">
              {[
                ['notify_agent_offline', 'Agent goes offline'],
                ['notify_agent_online',  'Agent comes online'],
                ['notify_monitor_down',  'Monitor goes down'],
                ['notify_monitor_up',    'Monitor recovers'],
              ].map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" className="accent-indigo-500"
                    checked={editEvents[k]} onChange={() => toggleEvent(k)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Btn>
            <Btn variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
        </form>
      )}
    </div>
  )
}

function AddChannelForm({ onAdded }) {
  const [open,   setOpen  ] = useState(false)
  const [type,   setType  ] = useState('gotify')
  const [name,   setName  ] = useState('')
  const [config, setConfig] = useState(DEFAULT_CONFIG.gotify)
  const [events, setEvents] = useState({ notify_agent_offline: true, notify_agent_online: false, notify_monitor_down: true, notify_monitor_up: false })
  const [error,  setError ] = useState('')
  const [busy,   setBusy  ] = useState(false)

  function handleTypeChange(t) {
    setType(t)
    setConfig({ ...DEFAULT_CONFIG[t] })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const ch = await notificationsApi.create({ name, type, config, ...events })
      onAdded(ch)
      setOpen(false)
      setName('')
      setType('gotify')
      setConfig({ ...DEFAULT_CONFIG.gotify })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false) }
  }

  const toggle = (k) => setEvents(prev => ({ ...prev, [k]: !prev[k] }))

  if (!open) return (
    <div className="pt-3">
      <Btn variant="ghost" onClick={() => setOpen(true)}>+ Add channel</Btn>
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-gray-800 space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Channel name</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="My Gotify server" required />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100"
            value={type} onChange={e => handleTypeChange(e.target.value)}>
            {CH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <ConfigFields type={type} config={config} onChange={setConfig} />

      <div>
        <p className="text-xs text-gray-500 mb-2">Notify on</p>
        <div className="flex flex-wrap gap-4">
          {[
            ['notify_agent_offline', 'Agent goes offline'],
            ['notify_agent_online',  'Agent comes online'],
            ['notify_monitor_down',  'Monitor goes down'],
            ['notify_monitor_up',    'Monitor recovers'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-400">
              <input type="checkbox" className="accent-indigo-500" checked={events[k]} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save channel'}</Btn>
        <Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
    </form>
  )
}

function NotificationChannels() {
  const [channels, setChannels] = useState([])
  const [loading,  setLoading ] = useState(true)
  const [error,    setError   ] = useState('')

  useEffect(() => {
    notificationsApi.list()
      .then(setChannels)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null

  return (
    <Section title="Notification Channels">
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <p className="text-xs text-gray-500 mb-3">
        Send alerts via Gotify, ntfy, email, or webhook when agents go offline or monitors go down.
      </p>

      {channels.length === 0 && !error && (
        <p className="text-sm text-gray-600 italic mb-2">No channels configured yet.</p>
      )}

      {channels.map(ch => (
        <ChannelRow
          key={ch.id}
          ch={ch}
          onUpdated={updated => setChannels(prev => prev.map(c => c.id === updated.id ? updated : c))}
          onDeleted={id => setChannels(prev => prev.filter(c => c.id !== id))}
        />
      ))}

      <AddChannelForm onAdded={ch => setChannels(prev => [...prev, ch])} />
    </Section>
  )
}

// ── Import / Export ───────────────────────────────────────────────────────────

function ImportExport() {
  const fileRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result,    setResult   ] = useState(null)   // ImportResult from server
  const [error,     setError    ] = useState('')

  async function handleExport() {
    setExporting(true)
    setError('')
    try {
      const data = await configApi.exportConfig()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.href     = url
      a.download = `syswarden-config-${ts}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(`Export failed: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setResult(null)
    setError('')
    try {
      const text    = await file.text()
      const parsed  = JSON.parse(text)
      // Strip _meta before sending — backend ignores it but keeps payload clean
      const { _meta, ...payload } = parsed
      const res = await configApi.importConfig(payload)
      setResult(res)
    } catch (err) {
      setError(`Import failed: ${err.message}`)
    } finally {
      setImporting(false)
      // Reset file input so the same file can be re-selected
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Section title="Import / Export">
      <p className="text-xs text-gray-500 mb-4">
        Export your monitors, alert rules, and notification channel settings to a JSON file.
        Import a previously exported file to restore or migrate configuration.
        Sensitive credentials are masked in exports&nbsp;— you may need to re-enter them after import.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
        >
          {exporting ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
            </svg>
          )}
          {exporting ? 'Exporting…' : 'Export config'}
        </button>

        {/* Import button — wraps hidden file input */}
        <label className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md cursor-pointer transition-colors
          ${importing
            ? 'bg-gray-700 opacity-50 text-gray-300 pointer-events-none'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
        >
          {importing ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 8l5-5 5 5M12 3v12"/>
            </svg>
          )}
          {importing ? 'Importing…' : 'Import config'}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
            disabled={importing}
          />
        </label>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {/* Import result summary */}
      {result && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-md p-4 space-y-3">
          <p className="text-sm font-semibold text-green-400">Import complete</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400">
            <ResultRow label="Monitors created"  value={result.monitors_created}  />
            <ResultRow label="Monitors updated"  value={result.monitors_updated}  />
            <ResultRow label="Alert rules added" value={result.rules_created}     />
            <ResultRow label="Alert rules skipped" value={result.rules_skipped}   dim />
            <ResultRow label="Channels created"  value={result.channels_created}  />
            <ResultRow label="Channels updated"  value={result.channels_updated}  />
          </div>

          {result.warnings?.length > 0 && (
            <div className="border-t border-gray-700 pt-3">
              <p className="text-xs font-medium text-yellow-400 mb-1">Warnings</p>
              <ul className="space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-yellow-300/80 flex gap-1.5">
                    <span className="shrink-0 mt-0.5">⚠</span>{w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function ResultRow({ label, value, dim }) {
  return (
    <>
      <span className="text-gray-500">{label}</span>
      <span className={dim && value === 0 ? 'text-gray-600' : value > 0 ? 'text-gray-200 font-medium' : 'text-gray-500'}>
        {value}
      </span>
    </>
  )
}
