import { api } from './client.js'

export const configApi = {
  /**
   * Download the config export as a parsed JSON object.
   * The caller is responsible for triggering the browser download.
   */
  exportConfig: () => api.get('/api/v1/config/export'),

  /**
   * Upload a config snapshot for import.
   * Returns an ImportResult: { monitors_created, monitors_updated,
   *   rules_created, rules_skipped, channels_created, channels_updated, warnings }
   */
  importConfig: (payload) => api.post('/api/v1/config/import', payload),
}
