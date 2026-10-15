"""Testes de autenticação independentes do banco de dados."""
import os
import unittest
from unittest.mock import patch
from starlette.requests import Request
from backend.auth import create_session, current_user, check_credentials, _FAILED, COOKIE_NAME


def request_with_token(token: str) -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/auth/me",
        "headers": [(b"cookie", (COOKIE_NAME + "=" + token).encode("ascii"))],
        "query_string": b"",
        "scheme": "http",
        "server": ("localhost", 3000),
    })


class SessionTests(unittest.TestCase):
    def setUp(self):
        _FAILED.clear()
        self.env = patch.dict(os.environ, {
            "APP_ADMIN_EMAIL": "teste@example.com",
            "APP_ADMIN_PASSWORD": "somente-teste",
            "APP_SECRET_KEY": "exemplo-chave-aleatoria-de-teste-12345678901234567890",
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()
        _FAILED.clear()

    def test_session_valid_and_tampered(self):
        token, ttl = create_session("TESTE@example.com", remember=False)
        self.assertEqual(ttl, 86400)
        self.assertEqual(current_user(request_with_token(token)), "teste@example.com")
        self.assertIsNone(current_user(request_with_token(token + "alterado")))

    def test_credentials(self):
        self.assertEqual(check_credentials("TESTE@example.com", "somente-teste", "ip-a"), (True, 200))
        self.assertEqual(check_credentials("teste@example.com", "errada", "ip-b"), (False, 401))
        for _ in range(7):
            check_credentials("teste@example.com", "errada", "ip-b")
        self.assertEqual(check_credentials("teste@example.com", "somente-teste", "ip-b"), (False, 429))

    def test_missing_secret_denies_login(self):
        with patch.dict(os.environ, {"APP_SECRET_KEY": ""}):
            self.assertEqual(check_credentials("teste@example.com", "somente-teste", "ip-c"), (False, 503))


if __name__ == "__main__":
    unittest.main()
