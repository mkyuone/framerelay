import { chromium, type Browser } from 'playwright';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Store } from './store.ts';

export function startRenderer(store: Store, { origin }: { port: number; origin: string }) {
  let stopped = false,
    browser: Browser | undefined,
    current: Promise<void> | undefined;
  async function tick() {
    if (stopped || current) return;
    const job = store.renderJob();
    if (!job) return;
    store.setRenderStatus(job.id, 'processing');
    current = (async () => {
      let page;
      try {
        browser ??= await chromium.launch({
          headless: true,
          args: ['--enable-unsafe-swiftshader'],
        });
        page = await browser.newPage();
        await page.goto(`${origin}/_render`, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForFunction(
          () =>
            typeof (window as unknown as { framerelayRender?: unknown }).framerelayRender ===
            'function',
        );
        const source = `data:image/jpeg;base64,${readFileSync(join(store.root, 'originals', job.filename)).toString('base64')}`;
        const output = await page.evaluate(
          async ({ source, recipe }) => {
            const render = (
              window as unknown as {
                framerelayRender: (
                  source: string,
                  recipe: unknown,
                ) => Promise<{ data: string; width: number; height: number; downscaled: boolean }>;
              }
            ).framerelayRender;
            let timer: ReturnType<typeof setTimeout>;
            try {
              return await Promise.race([
                render(source, recipe),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error('Export timed out.')), 60_000);
                }),
              ]);
            } finally {
              clearTimeout(timer!);
            }
          },
          { source, recipe: JSON.parse(job.recipe!) },
        );
        if (output.downscaled) throw new Error('Server export could not preserve full resolution.');
        const latest = store.rawPhoto(job.id);
        if (latest?.recipe !== job.recipe || latest.render_status !== 'processing') return;
        const ticket = store.ticket(job.session_id),
          filename = `${ticket.code}_${String(job.number).padStart(2, '0')}_${new Date().toISOString().replace(/[-:.]/g, '')}.jpg`;
        const image = await sharp(Buffer.from(output.data, 'base64'))
          .rotate()
          .toColourspace('srgb')
          .jpeg({ quality: 96 })
          .toBuffer({ resolveWithObject: true });
        const final = store.rawPhoto(job.id);
        if (final?.recipe !== job.recipe || final.render_status !== 'processing') return;
        const path = join(store.root, 'finals', filename);
        writeFileSync(`${path}.tmp`, image.data);
        renameSync(`${path}.tmp`, path);
        store.finishRender(job.id, filename, image.info.width, image.info.height);
      } catch (error) {
        const latest = store.rawPhoto(job.id);
        if (latest?.recipe === job.recipe && latest.render_status === 'processing')
          store.setRenderStatus(
            job.id,
            'failed',
            error instanceof Error && error.message.includes('Executable')
              ? 'Full-resolution export is unavailable. Ask the event operator to check the server, then retry.'
              : 'Full-resolution export failed. Retry export or reopen this photo.',
          );
      } finally {
        await page?.close().catch(() => {});
        current = undefined;
      }
    })();
    await current;
  }
  const timer = setInterval(() => void tick(), 2000);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
    await browser?.close();
  };
}
