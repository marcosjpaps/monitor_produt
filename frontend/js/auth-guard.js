/* Impede usar os cockpits sem sessão ativa. A proteção efetiva também roda nas APIs. */
(async function guardTelemetryAccess() {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Sessão inválida');
    const data = await response.json();
    if (!data.authenticated) throw new Error('Sessão inválida');
  } catch {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace('/?login=necessario&next=' + next);
  }
})();
