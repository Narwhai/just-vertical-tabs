import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const vault = process.argv[2];
if (!vault) {
  throw new Error('Usage: npm run test:integration -- <open-development-vault-name>');
}

const bundle = await build({
  entryPoints: ['tests/sidebar-toggle.integration.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'jvtSidebarTests',
  target: 'es2018',
});
const script = bundle.outputFiles[0]?.text;
if (!script) {
  throw new Error('Integration-test bundle was not generated.');
}

// Use Obsidian's real renderer rather than mocking its DOM-moving animation code.
const code = `(async () => {
  ${script}
  const plugin = app.plugins.plugins['just-vertical-tabs'];
  if (!plugin) throw new Error('Enable Just Vertical Tabs in the target development vault.');
  const passed = await jvtSidebarTests.runSidebarToggleTests(app, plugin);
  passed.push(await jvtSidebarTests.runSidebarToggleLifecycleTest(
    app, plugin,
    () => app.plugins.unloadPlugin('just-vertical-tabs'),
    () => app.plugins.loadPlugin('just-vertical-tabs'),
  ));
  return JSON.stringify(passed);
})()`;
const output = execFileSync('obsidian', [`vault=${vault}`, 'eval', `code=${code}`], {
  encoding: 'utf8',
  timeout: 120_000,
});
const resultLine = output.split('\n').find((line) => line.startsWith('=> '));
if (!resultLine) {
  throw new Error(`Obsidian tests failed:\n${output}`);
}
const result: unknown = JSON.parse(resultLine.slice(3));
if (!Array.isArray(result) || !result.every((entry: unknown) => typeof entry === 'string')) {
  throw new Error(`Unexpected integration-test result:\n${output}`);
}
for (const message of result) {
  console.log(`PASS ${String(message)}`);
}
console.log(`Passed ${result.length} real-Obsidian regression scenarios.`);
