#!/usr/bin/env python3
"""Dev server for the Fab Lab + FabSim tree.

Same as `python3 -m http.server`, but every response carries
`Cache-Control: no-store` so a browser or proxy never serves a stale
js/*.js after an edit. Static hosting (Pages/Netlify) does its own thing;
this file exists only for local runs.

    python3 serve.py 8092 .        # course at /, simulator at /sim/
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):   # quieter logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8092
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(Handler, directory=directory)
    print(f"Fab Lab dev server on http://0.0.0.0:{port} (dir={directory}, no-store)")
    ThreadingHTTPServer(("0.0.0.0", port), handler).serve_forever()
