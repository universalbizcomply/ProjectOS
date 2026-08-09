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
    const title = await browser.getTitle();
    // The window must be the ProjectOS Control Centre, not a blank or substituted document.
    expect(title).toContain('ProjectOS');

    // A genuine session can reach the rendered application, not merely an empty WebView.
    const root = await $('#root');
    expect(await root.isExisting()).toBe(true);
  });
});
