#!/usr/bin/env python3
"""Serve a built demo and proxy the external media samples used by the demo."""

from __future__ import annotations

import http.server
import os
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request


DRIVE_DOWNLOADS = {
    "/external-samples/insta360/insp": "https://drive.usercontent.google.com/download?id=1H_7MHubgvRnRbBwT5gn2dCBwghqEqaDZ&export=download&confirm=t",
    "/external-samples/insta360/lrv": "https://drive.usercontent.google.com/download?id=1hEJgzjwJE0UA47V2mT7VXyPcwz9Bit33&export=download&confirm=t",
    "/external-samples/insta360/insv-00": "https://drive.usercontent.google.com/download?id=10YnAzLoNuzJX0fNIatlo0tlJ4XagJqgs&export=download&confirm=t",
    "/external-samples/insta360/insv-10": "https://drive.usercontent.google.com/download?id=1B9h_a1nKSl5Zm1k5sRRN2phqU-ma8ZBf&export=download&confirm=t",
}

DOWNLOAD_TARGETS = {
    "insp": (DRIVE_DOWNLOADS["/external-samples/insta360/insp"], "IMG_20220701_170732_00_018.insp"),
    "insv-00": (DRIVE_DOWNLOADS["/external-samples/insta360/insv-00"], "VID_20220625_140410_00_008.insv"),
    "insv-10": (DRIVE_DOWNLOADS["/external-samples/insta360/insv-10"], "VID_20220625_140410_00_008.insv"),
    "osv": (
        "https://huggingface.co/datasets/SamuelLDX/osmo360-lidar-preview/resolve/main/CAM_20260728172420_0008_D.OSV",
        "CAM_20260728172420_0008_D.OSV",
    ),
    "lrf": (
        "https://huggingface.co/datasets/SamuelLDX/osmo360-lidar-preview/resolve/main/CAM_20260728172420_0008_D.LRF",
        "CAM_20260728172420_0008_D.LRF",
    ),
    "flower-mp4": (
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        "flower.mp4",
    ),
    "flower-webm": (
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
        "flower.webm",
    ),
    "sample-mov": ("https://filesamples.com/samples/video/mov/sample_640x360.mov", "sample_640x360.mov"),
}


def external_target(path: str, query: str) -> str | None:
    if path in DRIVE_DOWNLOADS:
        return DRIVE_DOWNLOADS[path]
    mappings = (
        ("/external-samples/osmo", "https://huggingface.co/datasets/SamuelLDX/osmo360-lidar-preview/resolve/main"),
        ("/external-samples/filesamples", "https://filesamples.com/samples"),
        ("/external-samples/mdn-audio", "https://interactive-examples.mdn.mozilla.net/media/cc0-audio"),
        ("/external-samples/mdn-video", "https://interactive-examples.mdn.mozilla.net/media/cc0-videos"),
        ("/external-samples/wikimedia", "https://upload.wikimedia.org/wikipedia/commons"),
    )
    for prefix, target_prefix in mappings:
        if path == prefix or path.startswith(prefix + "/"):
            suffix = path[len(prefix):]
            return target_prefix + suffix + ("?" + query if query else "")
    return None


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "filens-preview/1.0"

    def do_GET(self) -> None:  # noqa: N802
        if self._proxy_if_needed():
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self._proxy_if_needed():
            return
        super().do_HEAD()

    def _proxy_if_needed(self) -> bool:
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path in ("/api/files/download", "/files/download"):
            return self._download_if_authorized(parsed.query)
        target = external_target(parsed.path, parsed.query)
        if target is None:
            return False
        return self._proxy_target(target)

    def _download_if_authorized(self, query: str) -> bool:
        params = urllib.parse.parse_qs(query)
        expected_token = os.environ.get("FILENS_DOWNLOAD_TOKEN", "")
        supplied_token = params.get("token", [""])[0]
        if not expected_token or supplied_token != expected_token:
            self.send_error(401, "A valid download token is required")
            return True
        file_id = params.get("file", [""])[0].lower()
        resource = DOWNLOAD_TARGETS.get(file_id)
        if resource is None:
            self.send_error(404, "Unknown file resource")
            return True
        target, filename = resource
        return self._proxy_target(target, filename)

    def _proxy_target(self, target: str, filename: str | None = None) -> bool:

        headers = {"User-Agent": "filens-demo/0.1"}
        for name in ("Accept", "Range", "If-Range"):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        request = urllib.request.Request(target, headers=headers, method=self.command)
        try:
            upstream = urllib.request.urlopen(request, timeout=60)
        except urllib.error.HTTPError as error:
            upstream = error
        except (urllib.error.URLError, TimeoutError) as error:
            self.send_error(502, f"External sample unavailable: {error}")
            return True

        with upstream:
            self.send_response(getattr(upstream, "status", upstream.getcode()))
            for name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control"):
                value = upstream.headers.get(name)
                if value:
                    self.send_header(name, value)
            if filename:
                encoded_name = urllib.parse.quote(filename)
                self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{encoded_name}")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if self.command != "HEAD" and getattr(upstream, "status", upstream.getcode()) not in (204, 304):
                shutil.copyfileobj(upstream, self.wfile, length=1024 * 1024)
        return True

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    directory = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "apps/demo/dist")
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    port = int(sys.argv[3]) if len(sys.argv) > 3 else 4173
    handler = lambda *args, **kwargs: PreviewHandler(*args, directory=directory, **kwargs)
    with http.server.ThreadingHTTPServer((host, port), handler) as server:
        print(f"Serving {directory} at http://{host}:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
