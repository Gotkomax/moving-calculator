"""Локальний сервер для розробки: як `python -m http.server`, але браузер нічого не кешує.

Без цього Chrome тримає старі CSS і JS після правок, і сторінка виглядає по-старому.

Запуск з кореня репо:
    python tools/serve.py          # порт 8790
    python tools/serve.py 8795     # інший порт
"""

import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"http://localhost:{port}  (Ctrl+C — зупинити)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
