import { useState, useMemo } from 'react'
import { useFetch } from '../../hooks/useFetch.js'
import { Spinner, ErrorBox, RunButton } from './shared.jsx'

const STATUS_COLOR = {
  Running:            'text-green-400',
  Succeeded:          'text-green-300',
  Pending:            'text-yellow-400',
  Terminating:        'text-yellow-300',
  Unknown:            'text-gray-400',
  CrashLoopBackOff:   'text-red-400',
  OOMKilled:          'text-red-400',
  Error:              'text-red-400',
  ImagePullBackOff:   'text-orange-400',
  ErrImagePull:       'text-orange-400',
}

function statusColor(s) {
  return STATUS_COLOR[s] ?? 'text-gray-300'
}

// ── Main component ────────────────────────────────────────────────────────────

export default function K8sList({ agentId }) {
  const [view, setView] = useState('bynode') // 'bynode' | 'pods' | 'nodes'

  // Shared fetch instances so data persists across view switches
  const podsFetch  = useFetch(agentId)
  const nodesFetch = useFetch(agentId)

  const tabs = [
    { id: 'bynode', label: '🖥 Node Overview' },
    { id: 'pods',   label: 'All Pods'         },
    { id: 'nodes',  label: 'Nodes'            },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              view === t.id
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'bynode' && <ByNodePane podsFetch={podsFetch} nodesFetch={nodesFetch} />}
      {view === 'pods'   && <PodsPane fetch={podsFetch} />}
      {view === 'nodes'  && <NodesPane fetch={nodesFetch} />}
    </div>
  )
}

// ── By-Node pane ──────────────────────────────────────────────────────────────
// Fetches both pods + nodes, merges them, renders one card per K8s node.

function ByNodePane({ podsFetch, nodesFetch }) {
  const loading = podsFetch.loading || nodesFetch.loading
  const error   = podsFetch.error   || nodesFetch.error

  const handleFetch = () => {
    podsFetch.run('k8s.pods')
    nodesFetch.run('k8s.nodes')
  }

  // Merge: for each node, attach the pods that are scheduled on it
  const byNode = useMemo(() => {
    if (!podsFetch.data && !nodesFetch.data) return null
    const nodeMap = {}
    for (const n of (nodesFetch.data || [])) {
      nodeMap[n.name] = { ...n, pods: [] }
    }
    for (const p of (podsFetch.data || [])) {
      const key = p.node || '(unscheduled)'
      if (!nodeMap[key]) {
        nodeMap[key] = { name: key, status: 'Unknown', roles: '', version: '', pods: [] }
      }
      nodeMap[key].pods.push(p)
    }
    return Object.values(nodeMap).sort((a, b) => a.name.localeCompare(b.name))
  }, [podsFetch.data, nodesFetch.data])

  const totalPods  = podsFetch.data?.length  ?? 0
  const totalNodes = nodesFetch.data?.length ?? 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <RunButton onClick={handleFetch} loading={loading} label="Fetch Node Overview" />
        {byNode && (
          <span className="text-xs text-gray-400">
            {totalNodes} node{totalNodes !== 1 ? 's' : ''} · {totalPods} pod{totalPods !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {loading && <Spinner />}
      {error   && <ErrorBox message={error} />}
      {byNode  && (
        <div className="space-y-3">
          {byNode.map(node => <NodeCard key={node.name} node={node} />)}
        </div>
      )}
    </div>
  )
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({ node }) {
  const [expanded, setExpanded] = useState(true)

  const runningCount = node.pods.filter(p => p.status === 'Running' || p.status === 'Succeeded').length
  const errorCount   = node.pods.filter(p =>
    ['CrashLoopBackOff', 'Error', 'OOMKilled', 'ImagePullBackOff', 'ErrImagePull'].includes(p.status)
  ).length
  const pendingCount = node.pods.filter(p => p.status === 'Pending').length

  const nodeStatusColor =
    node.status === 'Ready'    ? 'text-green-400' :
    node.status === 'NotReady' ? 'text-red-400'   : 'text-gray-500'

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header row — click to expand / collapse */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full bg-gray-800/80 px-4 py-3 flex items-center gap-3 hover:bg-gray-800 transition-colors text-left"
      >
        <span className={`text-base leading-none ${nodeStatusColor}`}>●</span>
        <span className="font-mono font-semibold text-white truncate max-w-xs">{node.name}</span>

        {node.roles && (
          <span className="text-xs text-cyan-300 bg-cyan-900/30 border border-cyan-800/50 px-2 py-0.5 rounded shrink-0">
            {node.roles}
          </span>
        )}
        {node.version && (
          <span className="text-xs text-gray-500 shrink-0">{node.version}</span>
        )}

        {/* Pod count summary */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {errorCount > 0 && (
            <span className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 px-2 py-0.5 rounded">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 px-2 py-0.5 rounded">
              {pendingCount} pending
            </span>
          )}
          <span className="text-xs text-gray-400">
            {runningCount}/{node.pods.length} running
          </span>
          <span className="text-gray-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Pods table */}
      {expanded && (
        node.pods.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-500 text-xs border-b border-gray-700/60">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Namespace</th>
                  <th className="text-left px-4 py-2 font-medium">Pod</th>
                  <th className="text-left px-4 py-2 font-medium">Ready</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Restarts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/70">
                {node.pods.map(p => (
                  <tr key={`${p.namespace}/${p.name}`} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-2 text-cyan-500/80 text-xs font-mono">{p.namespace}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-200 max-w-xs truncate" title={p.name}>{p.name}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{p.ready}</td>
                    <td className={`px-4 py-2 text-xs font-semibold ${statusColor(p.status)}`}>{p.status}</td>
                    <td className={`px-4 py-2 text-xs ${p.restarts > 0 ? 'text-orange-400' : 'text-gray-600'}`}>
                      {p.restarts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-sm px-4 py-3 italic">No pods scheduled on this node.</p>
        )
      )}
    </div>
  )
}

// ── All Pods pane ─────────────────────────────────────────────────────────────

function PodsPane({ fetch }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <RunButton onClick={() => fetch.run('k8s.pods')} loading={fetch.loading} label="Fetch Pods" />
        {fetch.data && (
          <span className="text-xs text-gray-400">{fetch.data.length} pod{fetch.data.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      {fetch.loading && <Spinner />}
      {fetch.error && <ErrorBox message={fetch.error} />}
      {fetch.data && <PodsTable pods={fetch.data} />}
    </div>
  )
}

function PodsTable({ pods }) {
  if (!pods.length) {
    return <p className="text-gray-400 text-sm">No pods found.</p>
  }

  // Group by namespace
  const byNs = pods.reduce((acc, p) => {
    if (!acc[p.namespace]) acc[p.namespace] = []
    acc[p.namespace].push(p)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(byNs).sort(([a], [b]) => a.localeCompare(b)).map(([ns, nsPods]) => (
        <div key={ns}>
          <div className="text-xs font-semibold text-cyan-400 mb-1 px-1">
            namespace: {ns}
          </div>
          <div className="overflow-x-auto rounded border border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Ready</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Restarts</th>
                  <th className="text-left px-3 py-2 font-medium">Node</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {nsPods.map(p => (
                  <tr key={p.name} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-gray-200 max-w-xs truncate" title={p.name}>{p.name}</td>
                    <td className="px-3 py-2 text-gray-300 text-xs">{p.ready}</td>
                    <td className={`px-3 py-2 text-xs font-semibold ${statusColor(p.status)}`}>{p.status}</td>
                    <td className={`px-3 py-2 text-xs ${p.restarts > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                      {p.restarts}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{p.node || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Nodes pane ────────────────────────────────────────────────────────────────

function NodesPane({ fetch }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <RunButton onClick={() => fetch.run('k8s.nodes')} loading={fetch.loading} label="Fetch Nodes" />
        {fetch.data && (
          <span className="text-xs text-gray-400">{fetch.data.length} node{fetch.data.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      {fetch.loading && <Spinner />}
      {fetch.error && <ErrorBox message={fetch.error} />}
      {fetch.data && <NodesTable nodes={fetch.data} />}
    </div>
  )
}

function NodesTable({ nodes }) {
  if (!nodes.length) {
    return <p className="text-gray-400 text-sm">No nodes found.</p>
  }
  return (
    <div className="overflow-x-auto rounded border border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-800 text-gray-400 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-left px-3 py-2 font-medium">Roles</th>
            <th className="text-left px-3 py-2 font-medium">Version</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700/50">
          {nodes.map(n => (
            <tr key={n.name} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-3 py-2 font-mono text-xs text-gray-200">{n.name}</td>
              <td className={`px-3 py-2 text-xs font-semibold ${n.status === 'Ready' ? 'text-green-400' : 'text-red-400'}`}>
                {n.status}
              </td>
              <td className="px-3 py-2 text-cyan-300 text-xs">{n.roles}</td>
              <td className="px-3 py-2 text-gray-400 text-xs">{n.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
