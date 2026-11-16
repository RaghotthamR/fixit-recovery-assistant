"""Model clients: a real Gemini client and a deterministic mock.

Both share one interface, generate(context) -> str, so the rest of the app does
not care which one is running. The mock makes the prototype runnable and
repeatable without a key (labelled 'Simulated' in the report).
"""

import re
import time

from . import config
from .mock_data import find_sample


class LLMError(Exception):
    """Raised when the model call fails; shown to the user as a clear error."""


class MockClient:
    name = "mock"

    def generate(self, context: dict, *, source_text: str = "") -> str:
        # Simulated latency so the waiting feedback behaves as it would live.
        time.sleep(config.MOCK_DELAY_MS / 1000)
        sample = find_sample(source_text)
        if sample:
            return sample["bad_output"]
        # Unknown text: a simple, clearly labelled extract of the first sentences.
        sentences = re.split(r"(?<=[.!?])\s+", source_text.strip())
        extract = " ".join(sentences[:3]).strip()
        return f"[Mock response] {extract}" if extract else "[Mock response]"


class GeminiClient:
    def __init__(self, api_key: str, model: str):
        from google import genai  # imported here so mock mode needs no SDK setup

        self._genai = genai
        self._client = genai.Client(api_key=api_key)
        self.name = model

    def generate(self, context: dict, *, source_text: str = "") -> str:
        types = self._genai.types
        try:
            response = self._client.models.generate_content(
                model=self.name,
                contents=context["user"],
                config=types.GenerateContentConfig(
                    system_instruction=context["system"],
                ),
            )
        except Exception as exc:  # network, quota, auth or model-name errors
            raise LLMError(f"The model call failed: {exc}") from exc
        text = (response.text or "").strip()
        if not text:
            raise LLMError("The model returned an empty response.")
        return text


def get_client():
    if config.MOCK_MODE:
        return MockClient()
    return GeminiClient(config.GEMINI_API_KEY, config.GEMINI_MODEL)
