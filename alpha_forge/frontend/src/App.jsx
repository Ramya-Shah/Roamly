import { useCallback, useEffect, useRef, useState } from 'react'

const NODE_LABELS = {
  __init__: 'Calibrated',
  synthesis: 'StrategySynthesisAgent',
  risk_audit: 'RiskAuditAgent',
  execution: 'ExecutionAgent',
  self_correction: 'SelfCorrectionAgent',
}

// The "done" event carries the final merged state but no node name (it
// isn't produced by any single graph node), so it needs its own label.
function nodeLabel(ev) {
  if (ev.type === 'done') return 'Finished'
  return NODE_LABELS[ev.node] || ev.node
}

function statusPillClass(status) {
  if (status === 'ok') return 'pill pill-ok'
  if (status === 'timeout') return 'pill pill-warn'
  if (status === 'error') return 'pill pill-error'
  return 'pill'
}

function Sparkline({ values }) {
  if (values.length < 2) {
    return <span className="sparkline-empty">not enough data yet</span>
  }
  const w = 220
  const h = 40
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 4) + 2
      const y = h - 2 - ((v - min) / range) * (h - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function ProgressLog({ events }) {
  if (events.length === 0) {
    return <p className="muted">No run in progress. Click "Run Pipeline" to start one.</p>
  }
  const latest = events[events.length - 1]
  const s = latest.state || {}
  return (
    <div>
      <ol className="progress-log">
        {events.map((ev, i) => (
          <li key={i} className={ev.type === 'run_error' ? 'log-error' : ''}>
            <span className="log-node">{nodeLabel(ev)}</span>
            {ev.state?.attempt != null && <span className="log-attempt"> · attempt {ev.state.attempt}</span>}
            {ev.node === 'synthesis' && ev.state?.approach_description && (
              <span className="log-approach"> · "{ev.state.approach_description}"</span>
            )}
            {ev.type === 'run_error' && <span> · {ev.error}</span>}
          </li>
        ))}
      </ol>
      {s.tried_approaches && s.tried_approaches.length > 0 && (
        <div className="feedback-box">
          <strong>Approaches tried this run (each forced to differ from the last):</strong>
          <ul>
            {s.tried_approaches.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {s.feedback && (
        <div className="feedback-box">
          <strong>Feedback for next attempt:</strong>
          <pre>{s.feedback}</pre>
        </div>
      )}
      {s.audit_findings && s.audit_findings.length > 0 && (
        <div className="feedback-box feedback-warn">
          <strong>Audit findings:</strong>
          <ul>
            {s.audit_findings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
      {s.metrics && Object.keys(s.metrics).length > 0 && (
        <MetricsGrid metrics={s.metrics} />
      )}
    </div>
  )
}

function MetricsGrid({ metrics }) {
  return (
    <div className="metrics-grid">
      {Object.entries(metrics).map(([k, v]) => (
        <div key={k} className="metric-cell">
          <div className="metric-label">{k.replace(/_/g, ' ')}</div>
          <div className="metric-value">{typeof v === 'number' ? v.toFixed(4) : String(v)}</div>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [runs, setRuns] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState([])
  const [codeViewer, setCodeViewer] = useState(null)
  const [error, setError] = useState(null)
  const esRef = useRef(null)

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/runs')
      if (!res.ok) throw new Error(`GET /api/runs -> ${res.status}`)
      setRuns(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
    return () => esRef.current?.close()
  }, [fetchHistory])

  const startRun = useCallback(async () => {
    setError(null)
    setEvents([])
    setRunning(true)
    try {
      const res = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) {
        const detail = await res.json().then((b) => b.detail).catch(() => null)
        throw new Error(detail || `POST /api/runs -> ${res.status}`)
      }
      const { run_id } = await res.json()

      const es = new EventSource(`/api/runs/${run_id}/stream`)
      esRef.current = es

      const onState = (e) => setEvents((prev) => [...prev, JSON.parse(e.data)])
      const onDone = (e) => {
        setEvents((prev) => [...prev, JSON.parse(e.data)])
        setRunning(false)
        es.close()
        fetchHistory()
      }
      const onRunError = (e) => {
        setEvents((prev) => [...prev, JSON.parse(e.data)])
        setRunning(false)
        es.close()
        fetchHistory()
      }

      es.addEventListener('state', onState)
      es.addEventListener('done', onDone)
      es.addEventListener('run_error', onRunError)
      es.onerror = () => {
        // Connection-level failure (e.g. server restarted mid-stream).
        setRunning(false)
        es.close()
      }
    } catch (e) {
      setError(String(e))
      setRunning(false)
    }
  }, [fetchHistory])

  const viewCode = useCallback(async (filename) => {
    if (!filename) return
    try {
      const res = await fetch(`/api/code/${encodeURIComponent(filename)}`)
      if (!res.ok) throw new Error(`GET /api/code/${filename} -> ${res.status}`)
      setCodeViewer(await res.json())
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const sharpeSeries = runs
    .filter((r) => r.status === 'ok' && typeof r.sharpe_ratio === 'number')
    .slice()
    .reverse()
    .map((r) => r.sharpe_ratio)

  return (
    <div className="app">
      <header className="header">
        <h1>Alpha-Forge Dashboard</h1>
        <p className="muted">Generative Quant Desk — strategy synthesis, risk audit, and backtest sandbox</p>
      </header>

      {error && (
        <div className="banner banner-error" onClick={() => setError(null)} title="Click to dismiss">
          {error}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>Pipeline</h2>
          <button onClick={startRun} disabled={running}>
            {running ? 'Running…' : 'Run Pipeline'}
          </button>
        </div>
        <ProgressLog events={events} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Sharpe over time</h2>
        </div>
        <Sparkline values={sharpeSeries} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Run history</h2>
          <button onClick={fetchHistory} disabled={loadingHistory}>Refresh</button>
        </div>
        {loadingHistory ? (
          <p className="muted">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Approach</th>
                  <th>Regime</th>
                  <th>Status</th>
                  <th>Sharpe</th>
                  <th>OOS Sharpe</th>
                  <th>Sortino</th>
                  <th>Max DD</th>
                  <th>Fill ratio</th>
                  <th>Max inv.</th>
                  <th>Strategy</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.run_id}>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td className="approach-cell" title={r.approach || ''}>{r.approach || '—'}</td>
                    <td>{r.volatility_regime}</td>
                    <td><span className={statusPillClass(r.status)}>{r.status}</span></td>
                    <td>{r.sharpe_ratio?.toFixed(4) ?? '—'}</td>
                    <td>{r.validation_sharpe?.toFixed(4) ?? '—'}</td>
                    <td>{r.sortino_ratio?.toFixed(4) ?? '—'}</td>
                    <td>{r.max_drawdown?.toFixed(4) ?? '—'}</td>
                    <td>{r.fill_ratio?.toFixed(3) ?? '—'}</td>
                    <td>
                      {r.max_inventory?.toFixed(2) ?? '—'}
                      {r.inventory_explosion && <span className="pill pill-warn" title="Inventory Explosion Warning"> ⚠</span>}
                    </td>
                    <td>
                      {r.strategy_filename ? (
                        <button className="link-button" onClick={() => viewCode(r.strategy_filename)}>
                          {r.strategy_filename}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {codeViewer && (
        <div className="modal-backdrop" onClick={() => setCodeViewer(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <strong>{codeViewer.filename}</strong>
              <button onClick={() => setCodeViewer(null)}>Close</button>
            </div>
            <pre className="code-block">{codeViewer.code}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
