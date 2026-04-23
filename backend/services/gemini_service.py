import concurrent.futures
from backend.config import config


def _call_gemini(prompt: str) -> str:
    import google.generativeai as genai

    genai.configure(api_key=config.gemini_api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(prompt)
    return (response.text or "").strip()


def ask_gemini(prompt: str) -> str | None:
    if not config.gemini_api_key:
        return None
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_call_gemini, prompt)
            return future.result(timeout=config.gemini_timeout_seconds)
    except Exception:
        return None
