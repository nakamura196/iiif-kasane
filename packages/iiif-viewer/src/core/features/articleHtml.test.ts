import { describe, expect, it } from 'vitest';
import { articleBodiesOf, articleSandbox } from './articleHtml';

const URL_ = 'https://3d-api.si.edu/content/document/x/articles/a.html';

describe('articles of a step', () => {
  it('finds the external HTML bodies', () => {
    const bodies = [
      { kind: 'text' as const, value: '<h2>a</h2>', format: 'text/html' },
      { kind: 'resource' as const, url: URL_, format: 'text/html', resourceType: 'Text' },
      { kind: 'resource' as const, url: 'https://x/y.jpg', format: 'image/jpeg' },
    ];
    expect(articleBodiesOf(bodies).map((b) => b.url)).toEqual([URL_]);
  });
  it('lets an article of another site run its scripts, in its own origin', () => {
    expect(articleSandbox(URL_, 'https://kasane.ldas.jp')).toContain('allow-scripts allow-same-origin');
  });
  it('gives an article of the same site neither scripts nor its origin', () => {
    const s = articleSandbox('https://kasane.ldas.jp/a.html', 'https://kasane.ldas.jp');
    expect(s).not.toContain('allow-scripts');
    expect(s).not.toContain('allow-same-origin');
  });
  it('does not show other schemes', () => {
    expect(articleSandbox('javascript:alert(1)', 'https://kasane.ldas.jp')).toBeNull();
    expect(articleSandbox('data:text/html,x', 'https://kasane.ldas.jp')).toBeNull();
  });
});
