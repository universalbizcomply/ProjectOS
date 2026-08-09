/**
 * T1 - the bounded session smoke.
 *
 * This asks exactly one question: can a genuine Tauri WebDriver session be established against the
 * real ProjectOS release binary? Everything else in the T1-T21 matrix depends on the answer, so it
 * is deliberately kept separate and asserts nothing beyond a live session and a real window.
 *
 * It must NOT be made to pass by relaxing what it checks. A pass here means a real desktop session;
 * anything less is a failure that selects the embedded provider, not a reason to soften the test.
 */
describe('T1 real ProjectOS desktop Tauri session', () => {
  it('establishes a session against the real release binary and exposes the real window', async () => {
    // The session attaches to the WebView before the document has finished loading, so the first
    // read can legitimately see an empty title. Wait for the real document rather than asserting
    // early — but wait for the REAL title, so a blank or substituted document still fails.
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, {
      timeout: 30_000,
      timeoutMsg: 'the WebView never produced a document title',
    });
    expect(await browser.getTitle()).toContain('ProjectOS');

    // A genuine session reaches the RENDERED application, not merely an empty mount point: React
    // must have put something inside #root.
    const root = await $('#root');
    await root.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      async () => (await root.getHTML(false)).trim().length > 0,
      { timeout: 30_000, timeoutMsg: '#root never rendered any content' },
    );

    // The real Control Centre shell, not an error boundary or a blank shell.
    expect(await $('nav[aria-label="Primary"]').isExisting()).toBe(true);
  });
});
