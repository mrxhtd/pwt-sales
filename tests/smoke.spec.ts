import { test, expect, type Response } from '@playwright/test';

const FUNCTIONS_BASE = 'https://hbiquvmldtoinqtmbvgd.supabase.co/functions/v1';

test.describe('PWT Sales — smoke', () => {
  test('login page renders with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/');

    // The splash hides, the login overlay shows because we have no token.
    await expect(page.locator('#loginOverlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#usernameInput')).toBeVisible();
    await expect(page.locator('#passwordInput')).toBeVisible();
    await expect(page.locator('.login-card .btn-primary')).toContainText(/sign in/i);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('production CSP has no unsafe-inline for scripts', async ({ request }) => {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'];
    expect(csp, 'CSP header missing').toBeTruthy();

    // Find the script-src directive specifically.
    const directives = csp!.split(';').map((s) => s.trim()).filter(Boolean);
    const scriptSrc = directives.find((d) => d.startsWith('script-src '));
    expect(scriptSrc, 'script-src directive missing').toBeTruthy();
    expect(scriptSrc!.includes("'unsafe-inline'"), `script-src still allows unsafe-inline: ${scriptSrc}`).toBe(false);
    expect(scriptSrc!.includes("'self'")).toBe(true);
  });

  test('frame-ancestors denied & HSTS preload set', async ({ request }) => {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'] || '';
    expect(csp).toContain("frame-ancestors 'none'");

    const hsts = res.headers()['strict-transport-security'] || '';
    expect(hsts).toMatch(/max-age=\d+/);
    expect(hsts).toContain('preload');
  });

  test('Leaflet CDN scripts have SRI', async ({ page }) => {
    await page.goto('/');
    const integrities = await page.$$eval(
      'script[src*="leaflet"], link[href*="leaflet"]',
      (els) => els.map((el) => el.getAttribute('integrity')),
    );
    expect(integrities.length, 'expected to find leaflet CDN links').toBeGreaterThan(0);
    for (const i of integrities) {
      expect(i, 'Leaflet CDN bundle missing SRI hash').toMatch(/^sha\d+-/);
    }
  });

  test('REST anon access is denied on engineers / sessions', async ({ request }) => {
    // Even with the anon key the RLS deny-by-default should return [] (or 401).
    // We don't ship the anon key here; we just check the unauthenticated path.
    const sites: Response = await request.get(`${FUNCTIONS_BASE}/sites`);
    expect([401, 403]).toContain(sites.status());
  });

  test('login with bogus credentials returns 401', async ({ request }) => {
    const res = await request.post(`${FUNCTIONS_BASE}/auth`, {
      data: { username: 'nobody', password: 'wrongwrongwrong' },
      headers: { 'content-type': 'application/json' },
    });
    expect([401, 429]).toContain(res.status());
  });
});
