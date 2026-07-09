import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Manga Realtime Translator',
  version: '0.1.0',
  description:
    'Overlay Thai translations on manga/manhwa/manhua as you scroll. Draw a translate scope, cache results so nothing is translated twice.',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Manga Translator',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  // storage: settings + per-domain scope; unlimitedStorage: IndexedDB cache can grow.
  // tabs + host access: captureVisibleTab fallback + cross-origin image refetch.
  permissions: ['storage', 'unlimitedStorage', 'tabs', 'activeTab', 'scripting'],
  host_permissions: ['<all_urls>'],
});
