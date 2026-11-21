"""Minimal Gemini API smoke test.

Usage (from services/ai/, with the venv active):
    python hello_gemini.py                  # send a test prompt
    python hello_gemini.py "your prompt"    # send your own prompt
    python hello_gemini.py --list-models    # show models this key can use
"""

import os
import sys

from dotenv import load_dotenv
from google import genai

# Load services/ai/.env no matter which directory the script is run from.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

DEFAULT_MODEL = "gemini-4-hydrogen"


def main() -> None:
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or api_key == "your-key-here":
        sys.exit("GEMINI_API_KEY is missing. Put your real key in services/ai/.env")

    client = genai.Client(api_key=api_key)

    if "--list-models" in sys.argv:
        for m in client.models.list():
            if "generateContent" in (m.supported_actions or []):
                print(m.name)
        return

    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
    prompt = " ".join(a for a in sys.argv[1:] if not a.startswith("--")) or (
        "In one sentence, suggest an outfit for a rainy autumn day in Kyoto."
    )

    response = client.models.generate_content(model=model, contents=prompt)
    print(f"[{model}]\n{response.text}")


if __name__ == "__main__":
    main()
