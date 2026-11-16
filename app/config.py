"""Configuration loaded from environment variables (.env).

The API key is read from the environment only; it is never hard-coded or sent
to the browser.
"""

import os

from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip()
_force_mock = os.getenv("MOCK_MODE", "false").strip().lower() in {"1", "true", "yes"}

# Mock mode runs whenever there is no key, or when explicitly requested.
MOCK_MODE: bool = _force_mock or not GEMINI_API_KEY

# Simulated response time in mock mode (milliseconds). Set to 0 in tests.
MOCK_DELAY_MS: int = int(os.getenv("MOCK_DELAY_MS", "800"))
