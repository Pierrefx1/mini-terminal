import httpx
from ..config import USER_AGENT

client = httpx.Client(timeout=25, follow_redirects=True, headers={"User-Agent": USER_AGENT})


def get(url: str, **kw) -> httpx.Response:
    last = None
    for _ in range(2):  # une reprise sur erreur réseau
        try:
            r = client.get(url, **kw)
            r.raise_for_status()
            return r
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            last = e
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code < 500 and e.response.status_code != 429:
                break
    raise last
