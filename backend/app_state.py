"""Process-wide singletons shared by the API modules (kept import-cycle free)."""

from session.manager import SessionManager

# Global session manager (re-exported as main.session_manager)
session_manager = SessionManager()
