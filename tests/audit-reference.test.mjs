import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PUBLIC_PAGE_PATHS } from '../worker/site-routes';

const temporaryRoots = [];
afterEach(() => { for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function auditFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'reference-audit-')); temporaryRoots.push(root);
  const write = (relative, content) => {
    const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
  };
  mkdirSync(path.join(root, 'scripts/seo'), { recursive: true });
  for (const relative of ['scripts/audit-reference.mjs', 'scripts/seo/effect-routes.mjs', 'scripts/seo/tool-content.mjs']) cpSync(relative, path.join(root, relative));
  for (const route of [...PUBLIC_PAGE_PATHS, '/studio', '/my-videos', '/reset-password', '/sign-in', '/account', '/refund']) write(`dist${route === '/' ? '' : route}/index.html`, '<html><head></head><body>Fixture</body></html>');
  write('dist/404.html', '<html>Not found</html>');
  write('dist/reference-assets/poster.png', 'fixture');
  const examples = {}; const media = {};
  for (let i = 0; i < 470; i++) {
    examples[i] = { id: String(i), postUrl: `https://x.com/example/status/${i}`, poster: '/reference-assets/poster.png' };
    media[i] = { url: `https://video.twimg.com/example/${i}.mp4`, type: 'video/mp4', width: 1920, height: 1080 };
  }
  write('dist/reference-assets/data/examples.json', JSON.stringify(examples));
  write('dist/reference-assets/data/example-media.json', JSON.stringify(media));
  write('dist/reference-assets/_astro/effect-ticker.js', Array.from({ length: 21 }, (_, i) => `{id:\`effect${i}\`,name:\`Effect ${i}\`}`).join(','));
  return { write, run: () => spawnSync(process.execPath, [path.join(root, 'scripts/audit-reference.mjs')], { encoding: 'utf8' }) };
}
describe('reference route audit', () => {
  it('accepts the public generated tool and effect routes emitted by the site', () => {
    const result = auditFixture().run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it('still rejects an HTML page outside the declared site routes', () => {
    const fixture = auditFixture(); fixture.write('dist/unknown-page/index.html', '<html>Unknown</html>');
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unexpected HTML routes: /unknown-page');
  });
});
