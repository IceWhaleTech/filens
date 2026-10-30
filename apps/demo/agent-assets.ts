import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Serve the distributable skill from its source so the console and CLI cannot drift.
export function agentSkillAsset(): Plugin {
  const source = fileURLToPath(new URL('../../skills/filens/SKILL.md', import.meta.url));
  const output = 'skills/filens/SKILL.md';
  let base = '/';
  return {
    name: 'filens-agent-skill',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url ?? '').split('?', 1)[0];
        if (pathname !== `${base}${output}` && pathname !== `/${output}`) return next();
        try {
          response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          response.setHeader('Cache-Control', 'no-cache');
          response.end(await readFile(source));
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      this.addWatchFile(source);
      this.emitFile({ type: 'asset', fileName: output, source: await readFile(source) });
    }
  };
}
