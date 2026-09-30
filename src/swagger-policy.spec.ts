import { docsBasicAuth, docsPolicy } from './swagger';

const strong = 'a-long-docs-password';

describe('documentation access policy', () => {
  it('is open in development and off elsewhere by default', () => {
    expect(docsPolicy({ NODE_ENV: 'development' }).enabled).toBe(true);
    expect(docsPolicy({ NODE_ENV: 'production' }).enabled).toBe(false);
    expect(docsPolicy({}).enabled).toBe(false);
  });

  it('needs an explicit switch and real credentials in production', () => {
    expect(docsPolicy({ NODE_ENV: 'production', DOCS_ENABLED: 'true' }).enabled).toBe(false);
    expect(docsPolicy({ NODE_ENV: 'production', DOCS_ENABLED: 'true', DOCS_USER: 'docs', DOCS_PASSWORD: 'short' }).enabled).toBe(false);
    expect(docsPolicy({ NODE_ENV: 'production', DOCS_USER: 'docs', DOCS_PASSWORD: strong }).enabled).toBe(false);
    const allowed = docsPolicy({ NODE_ENV: 'production', DOCS_ENABLED: 'true', DOCS_USER: 'docs', DOCS_PASSWORD: strong });
    expect(allowed.enabled).toBe(true);
    expect(allowed.guard).toBeDefined();
  });

  it('accepts only the exact Basic credentials', () => {
    const guard = docsBasicAuth('docs', strong);
    const attempt = (authorization?: string) => {
      const res = { headers: {} as Record<string, string>, code: 0, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; return { send: () => undefined }; } };
      const next = jest.fn();
      guard({ headers: { authorization } }, res, next);
      return { next, res };
    };
    const basic = (pair: string) => 'Basic ' + Buffer.from(pair).toString('base64');
    expect(attempt(basic('docs:' + strong)).next).toHaveBeenCalled();
    for (const bad of [undefined, 'Bearer x', basic('docs:wrong'), basic('other:' + strong), basic('docs'), 'Basic !!!']) {
      const { next, res } = attempt(bad);
      expect(next).not.toHaveBeenCalled();
      expect(res.code).toBe(401);
      expect(res.headers['WWW-Authenticate']).toMatch(/^Basic/);
    }
  });
});
