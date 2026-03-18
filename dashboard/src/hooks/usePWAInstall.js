import { useEffect, useState } from 'react'

/**
 * Captures the `beforeinstallprompt` event so you can trigger the
 * browser's native "Add to Home Screen" dialog at the right moment.
 *
 * Returns:
 *   canInstall  — true when the prompt is available
 *   promptInstall — call this to show the dialog
 */
export function usePWAInstall() {
  const [prompt, setPrompt] = useState(null)

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()        // suppress the automatic mini-infobar
      setPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function promptInstall() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setPrompt(null)
  }

  return { canInstall: !!prompt, promptInstall }
}
