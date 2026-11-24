"""SSRF protection: only public internet addresses may be fetched (by HTTP client and by the browser)."""

import asyncio
from collections import deque
import ipaddress
import socket
from urllib.parse import urlsplit

from app.config import settings

BLOCKED_HOSTS = {"localhost", "metadata", "metadata.google.internal", "instance-data"}
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp")


class UnsafeURL(Exception):
    """The URL points at a private, loopback, link-local, metadata or otherwise non-public address."""


def ip_is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%")[0])
    if isinstance(addr, ipaddress.IPv6Address):
        mapped = addr.ipv4_mapped or addr.sixtofour or (addr.teredo[1] if addr.teredo else None)
        if mapped is not None:
            addr = mapped
    return addr.is_global and not addr.is_multicast


def check_host_name(host: str) -> None:
    h = host.lower().rstrip(".")
    if h in BLOCKED_HOSTS or h.endswith(BLOCKED_SUFFIXES):
        raise UnsafeURL(f"Host '{host}' is not a public internet host")


async def resolve_public(host: str, port: int) -> list[str]:
    """Resolve host and return its IPs, raising UnsafeURL if any of them is non-public."""
    if settings.allow_private_networks:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return list(dict.fromkeys(i[4][0] for i in infos))
    check_host_name(host)
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UnsafeURL(f"Could not resolve host '{host}'") from e
    ips = list(dict.fromkeys(i[4][0] for i in infos))
    if not ips:
        raise UnsafeURL(f"Could not resolve host '{host}'")
    bad = [ip for ip in ips if not ip_is_public(ip)]
    if bad:
        raise UnsafeURL(f"Host '{host}' resolves to a non-public address ({bad[0]})")
    return ips


async def assert_public_url(url: str) -> list[str]:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeURL("Only http(s) URLs can be fetched")
    return await resolve_public(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))


ALLOWED_PORTS = {80, 443, 8080, 8443}


class EgressProxy:
    """Tiny HTTP/CONNECT proxy that every Chromium request goes through. Each destination is resolved,
    checked with resolve_public() and connected by IP, so page redirects, subresources and DNS rebinding
    can't reach private networks. (Playwright's page.route() does not see redirect hops.)"""

    def __init__(self) -> None:
        self.server: asyncio.base_events.Server | None = None
        self.port = 0

    async def start(self) -> int:
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        return self.port

    async def close(self) -> None:
        if self.server:
            self.server.close()
            self.server = None

    @staticmethod
    async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError, OSError):
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
            request_line, *header_lines = head.decode("latin-1").split("\r\n")
            method, target, version = request_line.split(" ", 2)
            if method == "CONNECT":
                host, _, port_s = target.rpartition(":")
                host, port, rest = host.strip("[]"), int(port_s), b""
            else:
                parts = urlsplit(target)
                if parts.scheme != "http" or not parts.hostname:
                    raise UnsafeURL("Unsupported proxy request")
                host, port = parts.hostname, parts.port or 80
                path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
                kept = [h for h in header_lines if h and not h.lower().startswith(("proxy-", "connection:"))]
                rest = "\r\n".join([f"{method} {path} {version}", *kept, "Connection: close", "", ""]).encode(
                    "latin-1")
            if port not in ALLOWED_PORTS and not settings.allow_private_networks:
                raise UnsafeURL(f"Port {port} is not allowed")
            ips = await resolve_public(host, port)
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(ips[0], port), 15)
        except (UnsafeURL, ValueError, OSError, asyncio.TimeoutError, asyncio.IncompleteReadError) as e:
            try:
                writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                await writer.drain()
                writer.close()
            except Exception:
                pass
            if isinstance(e, UnsafeURL):
                blocked_requests.append(str(e))
            return
        if method == "CONNECT":
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
        else:
            up_writer.write(rest)
            await up_writer.drain()
        await asyncio.gather(self._pipe(reader, up_writer), self._pipe(up_reader, writer))


blocked_requests: deque[str] = deque(maxlen=50)  # recent blocked destinations, for logs/tests

