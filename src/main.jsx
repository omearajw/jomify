import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import GuestParty from './views/Party/GuestParty.jsx'
import PartyScreen from './views/Party/PartyScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installDebugLog } from './services/debugLog'

// First, so it hears about everything from start-up onwards
installDebugLog()

// A guest at a party has no account and never sees the sign-in page: /p/<code> is its own app,
// and /p/<code>/screen the display for a screen on the wall
const partyPath = location.pathname.match(/^\/p\/([A-Za-z0-9]{4})(\/screen)?\/?$/)
const guestCode = partyPath?.[1]
const partyScreen = Boolean(partyPath?.[2])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      {guestCode ? (partyScreen ? <PartyScreen code={guestCode.toUpperCase()} /> : <GuestParty code={guestCode.toUpperCase()} />) : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
