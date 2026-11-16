# ローカルでアプリを開くための小さなサーバー（127.0.0.1 だけで待ち受ける）。
# Windows の Python は .mjs を text/plain で返し、ブラウザが ES モジュールを動かさないため、
# .js・.mjs を text/javascript として返す（観戦のしおりと同じ対処）。
# 使い方：python scripts/serve.py [ポート]（既定は 8080）。開くのは http://localhost:<ポート>/
import functools
import http.server
import mimetypes
import pathlib
import sys

mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/manifest+json', '.webmanifest')

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
root = pathlib.Path(__file__).resolve().parent.parent
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
http.server.test(HandlerClass=handler, port=port, bind='127.0.0.1')
