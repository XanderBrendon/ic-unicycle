import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { icpBindgen } from '@icp-sdk/bindgen/plugins/vite';
import { readFileSync } from 'node:fs';

const LOCAL_IDS_PATH = '.icp/cache/mappings/local.ids.json';
const LOCAL_DESCRIPTOR_PATH = '.icp/cache/networks/local/descriptor.json';

function buildIcEnvCookieValue(): string {
  const ids = JSON.parse(readFileSync(LOCAL_IDS_PATH, 'utf8')) as Record<string, string>;
  const descriptor = JSON.parse(readFileSync(LOCAL_DESCRIPTOR_PATH, 'utf8')) as {
    'root-key': string;
  };
  const parts = [
    `ic_root_key=${descriptor['root-key']}`,
    ...Object.entries(ids).map(([name, id]) => `PUBLIC_CANISTER_ID:${name}=${id}`),
  ];
  return encodeURIComponent(parts.join('&'));
}

function icEnvCookiePlugin(): PluginOption {
  return {
    name: 'unicycle:ic-env-cookie',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        try {
          const value = buildIcEnvCookieValue();
          res.setHeader('Set-Cookie', `ic_env=${value}; Path=/; SameSite=Lax`);
        } catch (err) {
          server.config.logger.warn(
            `[ic-env-cookie] skipped (run \`icp network start -d && icp deploy\` first): ${
              (err as Error).message
            }`,
          );
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: 'src/unicycle_frontend',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    icpBindgen({
      didFile: 'src/unicycle_backend/unicycle_backend.did',
      outDir: 'src/unicycle_frontend/src/bindings/unicycle_backend',
    }),
    command === 'serve' ? icEnvCookiePlugin() : null,
  ],
}));
