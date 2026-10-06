import { parsePost } from '../scripts/build-site.mjs';

export function source(overrides = {}, body = 'A synthetic test body.') {
  return `---\n${JSON.stringify({
    title: 'Synthetic syntax fixture', date: '2026-10-06',
    description: 'Synthetic fixtures only, never published.', tags: ['testing'], draft: false, ...overrides
  })}\n---\n${body}\n`;
}

export const code = 'const markup = "<script>alert(1)</script>";\n' + '// ' + 'wide-line-'.repeat(30) + '\n';
export const fixture = parsePost(source({}, `
## Supported syntax

A paragraph with **strong**, *emphasis*, \`inline code\`, and [safe link](https://example.com/).

> A synthetic quotation.

- First item
- Second item

1. Ordered item
2. Another item

| Field | Value |
| --- | --- |
| Synthetic | ${'long-value-'.repeat(20)} |

![Synthetic diagram](/test-diagram.svg)

\`\`\`javascript
${code}\`\`\`

## Supported syntax

<script>window.injection = true</script>

[unsafe](javascript:alert(1))
![unsafe](data:image/svg+xml;base64,PHN2Zz4=)
`), 'synthetic-syntax.md');
