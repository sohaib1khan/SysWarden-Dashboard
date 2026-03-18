import { useState } from 'react'
import { useFetch } from '../../hooks/useFetch.js'
import { Spinner, ErrorBox, RunButton } from './shared.jsx'

const VM_STATE_COLOR = {
  running:      'text-green-400',
  paused:       'text-yellow-400',
  'shut off':   'text-gray-400',
  stopped:      'text-gray-400',
  crashed:      'text-red-400',
  pmsuspended:  'text-blue-300',
}

function vmStateColor(s) {
  return VM_STATE_COLOR[s?.toLowerCase()] ?? 'text-gray-300'
}

const HV_STYLE = {
  'proxmox-qemu': 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
  'proxmox-lxc':  'bg-green-900/40 text-green-300 border border-green-700/50',
  'kvm':          'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  'virtualbox':   'bg-orange-900/40 text-orange-300 border border-orange-700/50',
}
const HV_LABEL = {
  'proxmox-qemu': 'QEMU',
  'proxmox-lxc':  'LXC',
  'kvm':          'KVM',
  'virtualbox':   'VBox',
}

function HvBadge({ hv }) {
  const cls   = HV_STYLE[hv]  ?? 'bg-gray-700 text-gray-300'
  const label = HV_LABEL[hv] ?? hv
  return (
    <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-mono ${cls}`}>
      {label}
    </span>
  )
}

const CONTAINER_STATE_COLOR = {
  running:    'text-green-400',
  exited:     'text-gray-400',
  paused:     'text-yellow-400',
  created:    'text-blue-300',
  restarting: 'text-orange-400',
  dead:       'text-red-400',
}

function containerStateColor(s) {
  return CONTAINER_STATE_COLOR[s?.toLowerCase()] ?? 'text-gray-300'
}

export default function VirtList({ agentId, capabilities = [] }) {
  const hasVMs     = capabilities.includes('virt.vms')
  const hasProxmox = capabilities.includes('proxmox.list_vms')
  const hasPodman  = capabilities.includes('podman.list')

  const tabs = [
    hasVMs     && { id: 'vms',     label: '🖥 KVM / VMs'    },
    hasProxmox && { id: 'proxmox', label: '🔷 Proxmox'      },
    hasPodman  && { id: 'podman',  label: '🦭 Podman'       },
  ].filter(Boolean)

  const [view, setView] = useState(tabs[0]?.id ?? 'vms')

  const vms     = useFetch(agentId)
  const proxmox = useFetch(agentId)
  const podman  = useFetch(agentId)

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                view === t.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {view === 'vms'     && hasVMs     && <VMsPane     fetch={vms}     />}
      {view === 'proxmox' && hasProxmox && <ProxmoxPane fetch={proxmox} />}
      {view === 'podman'  && hasPodman  && <PodmanPane  fetch={podman}  />}
    </div>
  )
}

/* ── KVM / VMs pane (virt.vms) ───────────────────────────────────────────────── */

function VMsPane({ fetch }) {
  const vms = fetch.data ?? []
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <RunButton onClick={() => fetch.run('virt.vms')} loading={fetch.loading} label="Fetch VMs" />
        {fetch.data && (
          <span className="text-xs text-gray-400">
            {vms.length} machine{vms.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {fetch.loading && <Spinner />}
      {fetch.error   && <ErrorBox message={fetch.error} />}
      {fetch.data    && <VMsTable vms={vms} />}
    </div>
  )
}

function VMsTable({ vms }) {
  if (!vms.length) {
    return <p className="text-gray-400 text-sm">No virtual machines found.</p>
  }

  const hasHV    = vms.some(v => v.hypervisor)
  const hasNode  = vms.some(v => v.node)
  const hasID    = vms.some(v => v.vmid)
  const hasStats = vms.some(v => v.cpu_pct != null && v.cpu_pct !== 0)

  return (
    <div className="overflow-x-auto rounded border border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-800 text-gray-400 text-xs">
          <tr>
            {hasHV   && <th className="text-left px-3 py-2 font-medium">Type</th>}
            {hasNode && <th className="text-left px-3 py-2 font-medium">Node</th>}
            {hasID   && <th className="text-left px-3 py-2 font-medium">ID</th>}
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">State</th>
            {hasStats && <th className="text-right px-3 py-2 font-medium">CPU%</th>}
            {hasStats && <th className="text-right px-3 py-2 font-medium">Mem used / max</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700/50">
          {vms.map((vm, i) => (
            <tr key={vm.id || vm.name || i} className="hover:bg-gray-800/40 transition-colors">
              {hasHV   && <td className="px-3 py-2"><HvBadge hv={vm.hypervisor} /></td>}
              {hasNode && <td className="px-3 py-2 text-gray-400 text-xs">{vm.node || '—'}</td>}
              {hasID   && <td className="px-3 py-2 font-mono text-xs text-gray-400">{vm.vmid || '—'}</td>}
              <td className="px-3 py-2 text-gray-200">{vm.name}</td>
              <td className={`px-3 py-2 font-medium capitalize ${vmStateColor(vm.state)}`}>{vm.state}</td>
              {hasStats && (
                <td className="px-3 py-2 text-right font-mono text-xs text-gray-300">
                  {vm.cpu_pct != null ? `${vm.cpu_pct}%` : '—'}
                </td>
              )}
              {hasStats && (
                <td className="px-3 py-2 text-right font-mono text-xs text-gray-300">
                  {vm.mem_mb != null
                    ? `${Math.round(vm.mem_mb)} / ${Math.round(vm.maxmem_mb)} MB`
                    : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Proxmox pane (proxmox.list_vms plugin) ─────────────────────────────────── */

function ProxmoxPane({ fetch }) {
  const resp = fetch.data ?? {}
  const vms  = resp.vms ?? []
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <RunButton
          onClick={() => fetch.run('proxmox.list_vms')}
          loading={fetch.loading}
          label="Fetch Proxmox VMs"
        />
        {fetch.data && (
          <span className="text-xs text-gray-400">
            {resp.total ?? 0} item{resp.total !== 1 ? 's' : ''} across{' '}
            {resp.nodes_queried?.length ?? 0} node{resp.nodes_queried?.length !== 1 ? 's' : ''}
            {resp.mode === 'remote' && <span className="ml-1 text-yellow-400">(remote API)</span>}
          </span>
        )}
      </div>
      {fetch.loading && <Spinner />}
      {fetch.error   && <ErrorBox message={fetch.error} />}
      {fetch.data    && <ProxmoxTable vms={vms} />}
    </div>
  )
}

function ProxmoxTable({ vms }) {
  if (!vms.length) {
    return <p className="text-gray-400 text-sm">No VMs or containers found.</p>
  }
  return (
    <div className="overflow-x-auto rounded border border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-800 text-gray-400 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Node</th>
            <th className="text-left px-3 py-2 font-medium">ID</th>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">Type</th>
            <th className="text-left px-3 py-2 font-medium">State</th>
            <th className="text-right px-3 py-2 font-medium">CPU%</th>
            <th className="text-right px-3 py-2 font-medium">Mem MB</th>
            <th className="text-right px-3 py-2 font-medium">Uptime</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700/50">
          {vms.map(vm => (
            <tr key={`${vm.node}-${vm.vmid}`} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-3 py-2 text-gray-400 text-xs">{vm.node}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-400">{vm.vmid}</td>
              <td className="px-3 py-2 text-gray-200">{vm.name}</td>
              <td className="px-3 py-2"><HvBadge hv={`proxmox-${vm.type}`} /></td>
              <td className={`px-3 py-2 font-medium capitalize ${vmStateColor(vm.status)}`}>{vm.status}</td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-300">
                {vm.cpu_pct != null ? `${vm.cpu_pct}%` : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-300">
                {vm.mem_mb != null ? `${Math.round(vm.mem_mb)} / ${Math.round(vm.maxmem_mb)}` : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-400">
                {vm.uptime_sec != null ? fmtUptime(vm.uptime_sec) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtUptime(sec) {
  if (sec < 60)   return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

/* ── Podman pane ─────────────────────────────────────────────────────────────── */

function PodmanPane({ fetch }) {
  const containers = fetch.data ?? []
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <RunButton onClick={() => fetch.run('podman.list')} loading={fetch.loading} label="Fetch Containers" />
        {fetch.data && (
          <span className="text-xs text-gray-400">
            {containers.length} container{containers.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {fetch.loading && <Spinner />}
      {fetch.error   && <ErrorBox message={fetch.error} />}
      {fetch.data    && <PodmanTable containers={containers} />}
    </div>
  )
}

function PodmanTable({ containers }) {
  if (!containers.length) {
    return <p className="text-gray-400 text-sm">No containers found.</p>
  }
  return (
    <div className="overflow-x-auto rounded border border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-800 text-gray-400 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-medium">ID</th>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">Image</th>
            <th className="text-left px-3 py-2 font-medium">State</th>
            <th className="text-left px-3 py-2 font-medium">Ports</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700/50">
          {containers.map(c => (
            <tr key={c.id} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-3 py-2 font-mono text-xs text-gray-400">{c.id}</td>
              <td className="px-3 py-2 text-gray-200">{c.names}</td>
              <td className="px-3 py-2 text-gray-400 text-xs max-w-xs truncate">{c.image}</td>
              <td className={`px-3 py-2 font-medium capitalize ${containerStateColor(c.state)}`}>{c.state}</td>
              <td className="px-3 py-2 text-gray-400 text-xs">{c.ports || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

