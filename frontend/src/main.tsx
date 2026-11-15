import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/typography.css'
import './styles/colors.css'
import './index.css'
import { App } from './App'
import { applyStoredTheme } from './lib/theme'

// A remembered light/dark choice, before the first paint (the default follows the system).
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
