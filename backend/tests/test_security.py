import asyncio

import pytest

from app.auth import hash_password, verify_password
from app.netguard import EgressProxy, UnsafeURL, assert_public_url, check_host_name, ip_is_public


@pytest.mark.parametrize("ip,public", [
    ("8.8.8.8", True), ("1.1.1.1", True), ("2606:4700:4700::1111", True),
    ("127.0.0.1", False), ("10.0.0.5", False), ("172.16.3.4", False), ("192.168.1.1", False),
    ("169.254.169.254", False),  # cloud metadata
    ("100.64.0.1", False), ("0.0.0.0", False), ("::1", False), ("fd00::1", False), ("fe80::1", False),
    ("::ffff:127.0.0.1", False), ("::ffff:8.8.8.8", True), ("2002:7f00:1::", False),  # 6to4 of 127.0.0.1
    ("224.0.0.1", False),
])
def test_ip_is_public(ip, public):
    assert ip_is_public(ip) is public


@pytest.mark.parametrize("host", ["localhost", "LOCALHOST.", "metadata.google.internal", "printer.local",
                                  "db.internal", "app.localhost"])
def test_blocked_hostnames(host):
    with pytest.raises(UnsafeURL):
        check_host_name(host)


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://localhost:8000/", "http://[::1]/",
                                 "http://169.254.169.254/latest/meta-data/", "http://2130706433/",
                                 "http://0x7f000001/", "file:///etc/passwd"])
async def test_assert_public_url_blocks_internal(url):
    with pytest.raises(UnsafeURL):
        await assert_public_url(url)


async def _proxy_request(proxy: EgressProxy, payload: bytes) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", proxy.port)
    writer.write(payload)
    await writer.drain()
    data = await asyncio.wait_for(reader.read(200), 10)
    writer.close()
    return data


async def test_egress_proxy_refuses_private_destinations():
    proxy = EgressProxy()
    await proxy.start()
    try:
        for payload in (b"CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
                        b"GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
                        b"CONNECT localhost:443 HTTP/1.1\r\n\r\n",
                        b"CONNECT example.com:22 HTTP/1.1\r\n\r\n"):
            assert (await _proxy_request(proxy, payload)).startswith(b"HTTP/1.1 403")
    finally:
        await proxy.close()


def test_password_hashing():
    h = hash_password("hunter2hunter2")
    assert h.startswith("scrypt$") and "hunter2" not in h
    assert verify_password("hunter2hunter2", h)
    assert not verify_password("wrong-password", h)
    assert not verify_password("x", "garbage")
