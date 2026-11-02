#!/usr/bin/env python3
"""Static server for Lift Log. Adds a manifest MIME type Python does not know."""
import argparse
import functools
import http.server
import mimetypes

mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('image/png', '.png')

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=4173)
parser.add_argument('--dir', default='site')
args = parser.parse_args()

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=args.dir)
http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler).serve_forever()
