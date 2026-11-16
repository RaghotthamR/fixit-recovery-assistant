import os

# Tests always run in mock mode: no key, no network, repeatable results.
os.environ["MOCK_MODE"] = "true"
os.environ["MOCK_DELAY_MS"] = "0"
