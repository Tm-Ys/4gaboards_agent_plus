// 浏览器会话：启动 Playwright、登录 demo、等待应用就绪、持有"最近观察"供工具解析 ref。
// 登录走真实 UI 表单（account-* 场景的被测动作；其余场景也用它作前置）。

import { chromium, type Page } from "playwright";
import { observe, type Observation } from "./observation";

const DEMO = process.env.TARGET_APP_DEMO_URL ?? "https://demo.4gaboards.com/";

function proxyServer(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

export class BrowserSession {
  readonly page: Page;
  private currentObs: Observation | null = null;

  private constructor(page: Page) {
    this.page = page;
  }

  static async launch(opts: { headless?: boolean } = {}): Promise<BrowserSession> {
    const px = proxyServer();
    const browser = await chromium.launch({
      headless: opts.headless ?? true,
      ...(px ? { proxy: { server: px } } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const session = new BrowserSession(page);
    // 会话关闭时一并关浏览器
    (session as any)._browser = browser;
    (session as any)._context = context;
    return session;
  }

  /** 取最近一次观察（工具按 ref 操作时用它解析回 Locator）。 */
  getObs(): Observation {
    if (!this.currentObs) throw new Error("尚无观察：先调用 observe 工具");
    return this.currentObs;
  }

  setObs(o: Observation) {
    this.currentObs = o;
  }

  /** 观察当前页面并记为"最近观察"。 */
  async observe(): Promise<Observation> {
    const o = await observe(this.page);
    this.currentObs = o;
    return o;
  }

  /** 登录 demo（真实表单）。 */
  async login(): Promise<void> {
    const emailOrUsername = process.env["4GABOARD_ACCOUNT"];
    const password = process.env["4GABOARD_PASSWORD"];
    if (!emailOrUsername || !password) throw new Error("缺少 4GABOARD_ACCOUNT / 4GABOARD_PASSWORD");

    await this.page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.page.waitForTimeout(1200);

    // 若已在应用内（已登录），直接返回
    if (!(await this.isOnLoginPage())) return;

    await this.page.fill('input[name="emailOrUsername"]', emailOrUsername);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {});
    await this.waitForReady();
  }

  /** 等待应用就绪：轮询直到出现可交互元素（解决 SPA 加载时序）。 */
  async waitForReady(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const o = await observe(this.page);
      if (o.elements.length > 0) {
        this.currentObs = o;
        return;
      }
      await this.page.waitForTimeout(1000);
    }
    // 超时不报错，留给上层判断
  }

  private async isOnLoginPage(): Promise<boolean> {
    return (await this.page.locator('input[name="emailOrUsername"]').count()) > 0;
  }

  async close(): Promise<void> {
    try {
      await (this as any)._context?.close();
    } catch {}
    try {
      await (this as any)._browser?.close();
    } catch {}
  }
}
