import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { PrivilegedIdentityService } from './privileged-identity.service';

// The actual fixture speaks TLS over loopback; this test does not mock fetch.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createMockIdp } = require('../../../scripts/mock-idp.js');
describe('staging mock IdP over HTTPS', () => {
  it('issues and introspects admin and arbitrator assertions accepted by the verifier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'garant-mock-idp-'));
    const fixture = createMockIdp({ port: 0, root });
    const originalDispatcher = getGlobalDispatcher();
    const originalFetch = globalThis.fetch;
    const fixtureDispatcher = new Agent({ connect: { ca: fixture.identity.cert } });
    try {
      await fixture.start();
      setGlobalDispatcher(fixtureDispatcher);
      globalThis.fetch = undiciFetch as unknown as typeof fetch;
      const base = fixture.issuer();
      const health = await fetch(`${base}/health`);
      expect(await health.json()).toEqual({ status: 'ok', fixture: 'staging-mock-idp' });

      for (const [kind, email, audience, scope] of [
        ['ADMIN', 'admin@local.test', 'garant-admin', 'garant:admin:step-up'],
        ['ARBITRATOR', 'arbitrator@local.test', 'garant-arbitrator', 'garant:arbitrator:step-up'],
      ] as const) {
        const login = await fetch(`${base}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: email, password: fixture.identity.passwords[email] }),
        });
        expect(login.status).toBe(200);
        const { access_token: assertion } = await login.json() as { access_token: string };
        const values: Record<string, string> = {
          [`${kind}_STEP_UP_ISSUER`]: base,
          [`${kind}_STEP_UP_AUDIENCE`]: audience,
          [`${kind}_STEP_UP_MAX_AGE_SECONDS`]: '300',
          [`${kind}_STEP_UP_JWKS_URL`]: `${base}/jwks`,
          [`${kind}_STEP_UP_JWKS_CACHE_SECONDS`]: '300',
          [`${kind}_STEP_UP_INTROSPECTION_URL`]: `${base}/introspect`,
          [`${kind}_STEP_UP_INTROSPECTION_TOKEN`]: fixture.identity.introspectionToken,
          [`${kind}_STEP_UP_REQUIRED_SCOPE`]: scope,
          [`${kind}_STEP_UP_REQUIRED_ACR`]: 'urn:garant:acr:phishing-resistant',
          [`${kind}_STEP_UP_IDP_TIMEOUT_MS`]: '2000',
        };
        const config = { get: (key: string) => values[key] } as ConfigService;
        const verifier = new PrivilegedIdentityService(config, new JwtService());
        const result = await verifier.verify({ kind, assertion, actorId: fixture.users[email].sub });
        expect(result.sub).toBe(fixture.users[email].sub);
        expect(result.scope).toContain(scope);
        expect(result.sid).toBeTruthy();
        expect(result.jti).toBeTruthy();
      }
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalDispatcher(originalDispatcher);
      await fixtureDispatcher.close();
      await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
