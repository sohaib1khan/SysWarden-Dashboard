import { useState, useEffect, useRef, useCallback } from 'react'

const PUSH_API = '/api/v1/push'

/**
 * usePush — Web Push subscription hook.
 *
 * - Checks for an existing push subscription on mount so the UI reflects
 *   the real browser state after a page reload.
 * - Detects insecure contexts (HTTP on non-localhost) where the PushManager
 *   API is unavailable and surfaces a helpful error instead of hanging.
 */
export function usePush() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const swRegRef = useRef(null)

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  // Web Push requires a secure context (HTTPS or localhost)
  const isSecure = typeof window !== 'undefined' && window.isSecureContext

  // On mount: check whether the browser already has an active push subscription
  useEffect(() => {
    if (!supported || !isSecure) {
      setLoading(false)
      return
    }
    navigator.serviceWorker.ready
      .then(async (reg) => {
        swRegRef.current = reg
        const existing = await reg.pushManager.getSubscription()
        if (existing) setSubscribed(true)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [supported, isSecure]) // eslint-disable-line react-hooks/exhaustive-deps

  async function getVapidKey() {
    const res = await fetch(`${PUSH_API}/vapid-public-key`)
    if (!res.ok) throw new Error('Push backend not configured — check server logs')
    const { publicKey } = await res.json()
    return publicKey
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
  }

  const subscribe = useCallback(async () => {
    if (!supported) return
    if (!isSecure) {
      setError('Push notifications require HTTPS. Access SysWarden via HTTPS or from localhost.')
      return
    }
    setError(null)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return

      let reg = swRegRef.current
      if (!reg) {
        reg = await navigator.serviceWorker.ready
        swRegRef.current = reg
      }

      const vapidKey = await getVapidKey()
      const pushSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      const json = pushSub.toJSON()
      await fetch(`${PUSH_API}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }),
      })
      setSubscribed(true)
    } catch (err) {
      setError(err.message)
    }
  }, [supported, isSecure]) // eslint-disable-line react-hooks/exhaustive-deps

  const unsubscribe = useCallback(async () => {
    setError(null)
    try {
      let reg = swRegRef.current
      if (!reg) reg = await navigator.serviceWorker.ready
      const pushSub = await reg.pushManager.getSubscription()
      if (pushSub) {
        await fetch(`${PUSH_API}/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: pushSub.endpoint }),
        })
        await pushSub.unsubscribe()
      }
      setSubscribed(false)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  return { supported, isSecure, loading, permission, subscribed, subscribe, unsubscribe, error }
}
