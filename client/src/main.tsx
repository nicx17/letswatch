import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-color-emoji/index.css'
import './index.css'
import App from './App.tsx'

type TrustedTypesApi = {
  createPolicy?: (
    name: string,
    rules: {
      createHTML: (input: string) => string
      createScript: (input: string) => string
      createScriptURL: (input: string) => string
    }
  ) => unknown
}

type TrustedTypesWindow = Window & {
  trustedTypes?: TrustedTypesApi
}

const trustedTypesApi = (globalThis.window as TrustedTypesWindow | undefined)?.trustedTypes

if (trustedTypesApi && typeof trustedTypesApi.createPolicy === 'function') {
  try {
    const toError = (sink: string) => {
      throw new TypeError(`Blocked untrusted content for Trusted Types sink: ${sink}`)
    }

    trustedTypesApi.createPolicy('default', {
      createHTML: () => toError('HTML'),
      createScript: () => toError('Script'),
      createScriptURL: () => toError('ScriptURL'),
    })
  } catch {
    // Ignore duplicate/default policy creation errors.
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
