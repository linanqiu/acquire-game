import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'

export function NotFoundPage() {
  return (
    <div className="page not-found-page" style={{ textAlign: 'center', padding: '4rem' }}>
      <h1>404</h1>
      <p className="text-secondary">Page not found</p>
      <Link to="/">
        <Button>Back to Lobby</Button>
      </Link>
    </div>
  )
}
