#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createStaticServer } = require('./capture-application-media');
const { PAGES, VIEWPORTS } = require('./capture-site-visual-catalog');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'output', 'playwright', 'site-runtime-audit.json');

function parseArgs(argv) {
  const result = { output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') result.output = path.resolve(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return result;
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const overflowers = [...document.body.querySelectorAll('*')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, rect };
      })
      .filter(({ rect }) => rect.right > window.innerWidth + 1 || rect.left < -1)
      .slice(0, 12)
      .map(({ element, rect }) => ({
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${[...element.classList].slice(0, 2).join('.')}` : ''}`,
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        text: (element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 90),
      }));
    const animations = document.getAnimations().map((animation) => {
      const timing = animation.effect && typeof animation.effect.getTiming === 'function'
        ? animation.effect.getTiming()
        : {};
      return {
        play_state: animation.playState,
        duration: Number(timing.duration) || 0,
        iterations: Number(timing.iterations) || 0,
      };
    });
    const details = [...document.querySelectorAll('details')].map((element) => ({
      open: element.open,
      summary: element.querySelector('summary')?.innerText.trim() || '',
    }));
    return {
      title: document.title,
      h1: document.querySelector('h1')?.innerText.trim() || '',
      scroll_width: root.scrollWidth,
      client_width: root.clientWidth,
      scroll_height: root.scrollHeight,
      overflowers,
      active_animations: animations.filter((entry) => entry.play_state === 'running').length,
      infinite_animations: animations.filter((entry) => entry.iterations === Infinity).length,
      details,
      html_scrollbar_width: getComputedStyle(root).scrollbarWidth || 'auto',
      has_skip_link: Boolean(document.querySelector('.site-skip-link')),
      has_main: Boolean(document.querySelector('main')),
    };
  });
}

async function inspectFocus(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.focus();
  });
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      tag: active?.tagName || '',
      text: (active?.innerText || active?.getAttribute?.('aria-label') || '').trim().slice(0, 80),
      outline_style: style?.outlineStyle || '',
      outline_width: style?.outlineWidth || '',
    };
  });
}

async function inspectMobileMenu(page) {
  const toggle = page.locator('[data-site-nav-toggle]');
  if (!(await toggle.count()) || !(await toggle.isVisible())) return null;
  await toggle.click();
  const opened = await page.evaluate(() => ({
    expanded: document.querySelector('[data-site-nav-toggle]')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('[data-site-nav-mobile]')?.hidden,
  }));
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => ({
    expanded: document.querySelector('[data-site-nav-toggle]')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('[data-site-nav-mobile]')?.hidden,
    focus_restored: document.activeElement === document.querySelector('[data-site-nav-toggle]'),
  }));
  return { opened, closed };
}

async function inspectDisclosure(page, pageId) {
  if (pageId !== 'walkthrough') return null;
  const disclosure = page.locator('.transcript-disclosure');
  assert.equal(await disclosure.count(), 1, 'walkthrough transcript disclosure missing');
  const initial = await disclosure.evaluate((element) => element.open);
  await disclosure.locator('summary').click();
  const afterClick = await disclosure.evaluate((element) => element.open);
  return { initial, after_click: afterClick };
}

async function inspectReducedMotion(browser, baseUrl, pageSpec, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${baseUrl}${pageSpec.path}`, { waitUntil: 'load' });
    assert(response && response.ok(), `${pageSpec.path} reduced-motion request failed`);
    await page.waitForTimeout(160);
    return await page.evaluate(() => ({
      prefers_reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      active_animations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      hidden_reveals: [...document.querySelectorAll('[data-site-reveal]')].filter((element) => {
        const style = getComputedStyle(element);
        return style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0;
      }).length,
    }));
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const issues = [];
  try {
    for (const pageSpec of PAGES) {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: 'dark',
          reducedMotion: 'no-preference',
        });
        const page = await context.newPage();
        const consoleErrors = [];
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          const source = message.location().url || '';
          if (!source || source.startsWith(baseUrl)) consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(error.message));
        try {
          const response = await page.goto(`${baseUrl}${pageSpec.path}`, { waitUntil: 'load' });
          assert(response && response.ok(), `${pageSpec.path} returned ${response ? response.status() : 'no response'}`);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(180);
          const facts = await inspectPage(page);
          const focus = await inspectFocus(page);
          const mobileMenu = await inspectMobileMenu(page);
          const disclosure = await inspectDisclosure(page, pageSpec.id);
          const entry = { page: pageSpec.id, viewport: viewport.id, facts, focus, mobile_menu: mobileMenu, disclosure, console_errors: consoleErrors };
          results.push(entry);
          if (facts.scroll_width > facts.client_width + 1) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: `horizontal overflow ${facts.scroll_width}/${facts.client_width}`, overflowers: facts.overflowers });
          if (!facts.has_main) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'main landmark missing' });
          if (pageSpec.id !== 'home' && pageSpec.id !== 'not-found' && !facts.has_skip_link) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'skip link missing' });
          if (focus.outline_style === 'none' || focus.outline_width === '0px') issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'first keyboard target lacks a visible outline', focus });
          if (mobileMenu && (mobileMenu.opened.expanded !== 'true' || mobileMenu.opened.hidden || mobileMenu.closed.expanded !== 'false' || !mobileMenu.closed.hidden || !mobileMenu.closed.focus_restored)) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'mobile menu open/Escape/focus contract failed', mobileMenu });
          if (disclosure && (disclosure.initial !== false || disclosure.after_click !== true)) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'transcript progressive disclosure contract failed', disclosure });
          if (consoleErrors.length) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'console errors', console_errors: consoleErrors });
        } finally {
          await context.close();
        }
      }
    }

    const reducedMotion = [];
    for (const pageSpec of PAGES) {
      for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
        const facts = await inspectReducedMotion(browser, baseUrl, pageSpec, viewport);
        reducedMotion.push({ page: pageSpec.id, viewport: viewport.id, ...facts });
        if (!facts.prefers_reduce || facts.active_animations || facts.hidden_reveals) issues.push({ page: pageSpec.id, viewport: viewport.id, issue: 'reduced-motion contract failed', facts });
      }
    }

    const manifest = {
      schema: 1,
      kind: 'citadel-site-runtime-audit',
      combinations: results.length,
      reduced_motion_combinations: reducedMotion.length,
      issues,
      results,
      reduced_motion: reducedMotion,
    };
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      combinations: manifest.combinations,
      reduced_motion_combinations: manifest.reduced_motion_combinations,
      issues: issues.length,
      output: path.relative(ROOT, args.output).replace(/\\/g, '/'),
    }, null, 2)}\n`);
    if (issues.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`site runtime audit failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ parseArgs });
