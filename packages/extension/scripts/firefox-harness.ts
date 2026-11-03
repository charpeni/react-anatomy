interface FirefoxDriver extends firefox.Driver {
  installWebExtension(path: string, options: { permanent: boolean }): Promise<{ id: string }>;
}

import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function launchFirefox({ extension = resolve('dist/firefox') } = {}) {
  const options = new firefox.Options()
    .addArguments('-headless')
    .setPreference('devtools.toolbox.selectedTool', 'inspector')
    .setPreference('devtools.toolbox.footer.height', 650);

  if (process.env.FIREFOX_PATH) {
    options.setBinary(process.env.FIREFOX_PATH);
  }

  const env = { ...process.env };
  const sysroot = process.env.FIREFOX_SYSROOT;

  if (sysroot) {
    env.LD_LIBRARY_PATH = [
      join(sysroot, 'usr/lib/x86_64-linux-gnu'),
      join(sysroot, 'lib/x86_64-linux-gnu'),
      env.LD_LIBRARY_PATH,
    ]
      .filter(Boolean)
      .join(':');
    env.FONTCONFIG_PATH = join(sysroot, 'etc/fonts');
    env.XDG_DATA_DIRS = join(sysroot, 'usr/share');
  }

  // Privileged access is for the test driver only. The shipped extension has
  // ordinary activeTab/scripting permissions and uses the native DevTools API.
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH)
    .setEnvironment(
      Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    )
    .addArguments('--allow-system-access');
  const driver = (await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build()) as FirefoxDriver;

  try {
    await driver.manage().window().setRect({ width: 1600, height: 1550 });
    await driver.manage().setTimeouts({ script: 30000 });

    const installed = await driver.installWebExtension(extension, { permanent: false });
    const extensionId = installed.id;
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));

    if (extensionId !== manifest.browser_specific_settings.gecko.id) {
      throw new Error('Firefox installed an unexpected extension ID');
    }

    const sourceWindow = await driver.getWindowHandle();
    const version = (await driver.getCapabilities()).get('browserVersion');

    const until = async <T>(
      fn: () => T | Promise<T>,
      message: string,
      timeout = 20000,
    ): Promise<Exclude<T, null | undefined | false>> => {
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        const value = await fn();

        if (value) {
          return value as Exclude<T, null | undefined | false>;
        }

        await new Promise((r) => setTimeout(r, 150));
      }

      throw new Error(message);
    };

    const chrome = async <Result = unknown>(expression: string): Promise<Result> => {
      await driver.switchTo().window(sourceWindow);
      await driver.setContext(firefox.Context.CHROME);

      const response = await driver.executeAsyncScript<{
        error?: string;
        stack?: string;
        value: Result;
      }>(
        `const done=arguments[0];(async()=>(${expression}))().then(value=>done({value}),error=>done({error:String(error),stack:error.stack}));`,
      );

      if (response.error) {
        throw new Error(response.error + '\n' + response.stack);
      }

      return response.value;
    };

    const source = async () => {
      await driver.switchTo().window(sourceWindow);
      await driver.setContext(firefox.Context.CONTENT);
    };

    return {
      driver,
      version,
      extensionId,
      until,
      chrome,
      async navigate(url: string) {
        await source();
        await driver.get(url);
      },
      async page<Result = unknown>(expression: string): Promise<Result> {
        await source();

        return driver.executeScript<Result>(`return (${expression});`);
      },
      async clickPage(selector: string) {
        await source();
        await driver.findElement(By.css(selector)).click();
      },
      async openPanel() {
        await chrome(`(async()=>{
          const {require}=ChromeUtils.importESModule('resource://devtools/shared/loader/Loader.sys.mjs');
          const {gDevTools}=require('devtools/client/framework/devtools');
          window.__anatomyToolbox=await gDevTools.showToolboxForTab(window.gBrowser.selectedTab,{toolId:'inspector',hostType:'bottom'});
          return true;
        })()`);
        await until(
          () =>
            chrome(`(async()=>{
            const toolbox=window.__anatomyToolbox;
            const tab=[...toolbox.doc.querySelectorAll('.devtools-tab')].find(el=>el.textContent==='Anatomy');
            if(!tab)return false;
            window.__anatomyToolId=tab.getAttribute('data-id');
            await toolbox.selectTool(window.__anatomyToolId);
            const frame=toolbox.doc.getElementById('toolbox-panel-iframe-'+toolbox.currentToolId);
            window.__anatomyBrowser=frame?.contentDocument?.querySelector('browser');
            return window.__anatomyBrowser?.browsingContext?.currentWindowGlobal?.documentURI?.spec.endsWith('/panel.html')===true;
          })()`),
          'The native Firefox Anatomy panel did not open',
        );
      },
      // Firefox's panel is a remote <browser> inside a chrome iframe. Use its
      // existing WebDriver actor; do not inject a test bridge into the extension.
      panel<Result = unknown>(expression: string) {
        return chrome<Result>(
          `window.__anatomyBrowser.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(${JSON.stringify(`return (${expression});`)},[],{timeout:20000})`,
        );
      },
      async showPanel() {
        await chrome('window.__anatomyToolbox.selectTool(window.__anatomyToolId).then(()=>true)');
      },
      async screenshot(path: string) {
        await chrome('true');
        await writeFile(path, Buffer.from(await driver.takeScreenshot(), 'base64'));
      },
      async openToolbarInspector() {
        await chrome('window.__anatomyToolbox.destroy().then(()=>true)');

        // Pin and physically click the real action, granting activeTab exactly
        // as a user would. Calling the background listener would bypass this.
        const widget = extensionId.toLowerCase().replace(/[^a-z0-9_-]/g, '_') + '-browser-action';

        await chrome(`(()=>{
          const {CustomizableUI}=window;
          CustomizableUI.addWidgetToArea(${JSON.stringify(widget)},CustomizableUI.AREA_NAVBAR);
          return true;
        })()`);

        const before = await driver.getAllWindowHandles();

        await driver.findElement(By.css(`#${widget} .webextension-browser-action`)).click();

        const popup = await until(
          async () => (await driver.getAllWindowHandles()).find((id) => !before.includes(id)),
          'The toolbar inspector did not open',
        );

        return async <Result = unknown>(expression: string): Promise<Result> => {
          await driver.switchTo().window(popup);
          await driver.setContext(firefox.Context.CONTENT);

          return driver.executeScript<Result>(`return (${expression});`);
        };
      },
      close: () => driver.quit(),
    };
  } catch (error) {
    await driver.quit();

    throw error;
  }
}
