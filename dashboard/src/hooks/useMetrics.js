import { useState, useEffect, useRef } from 'react'
import { metricsApi } from '../api/metrics.js'

/**
 * Poll metric data for a given agent + metric name.
 * Returns the last `maxPoints` data points, newest first.
 */
export function useMetrics(agentId, metricName, { interval = 10_000, maxPoints = 60 } = {}) {
  const [data, setData]     = useState([])
  const [error, setError]   = useState(null)
  const calledOnce = useRef(false)

  useEffect(() => {
    if (!agentId || !metricName) return

    const fetch = async () => {
      try {
        const points = await metricsApi.query(agentId, metricName, { limit: maxPoints })
        setData(points)
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    }

    if (!calledOnce.current) {
      fetch()
      calledOnce.current = true
    }
    const id = setInterval(fetch, interval)
    return () => clearInterval(id)
  }, [agentId, metricName, interval, maxPoints])

  return { data, error }
}
