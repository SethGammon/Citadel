#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createStaticServer } = require('./capture-application-media');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'output', 'playwright', 'site-visual-audit');
const PAGES = Object.freeze([
  { id: 'home', path: '/' },
  { id: 'evidence', path: '/evidence.html' },
  { id: 'operation-control', path: '/operation-control.html' },
  { id: 'optimizer', path: '/optimizer.html' },
  { id: 'research', path: '/research.html' },
  { id: 'walkthrough', path: '/walkthrough.html' },
  { id: 'not-found', path: '/404.html' },
]);
const VIEWPORTS = Object.freeze([
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'laptop', width: 1280, height: 720 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'mobile', width: 390, height: 844 },
  { id: 'small-mobile', width: 320, height: 568 },
]);

function parseArgs(argv) {
  const result = { label: 'before', output: DEFAULT_OUTPUT, reuse: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--label') result.label = argv[++index];
    else if (argv[index] === '--output') result.output = path.resolve(argv[++index]);
    else if (argv[index] === '--reuse') result.reuse = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(result.label)) throw new Error(`invalid label: ${result.label}`);
  return result;
}

function slicePositions(scrollHeight, viewportHeight) {
  const maximum = Math.max(0, scrollHeight - viewportHeight);
  const step = Math.max(1, viewportHeight - 96);
  const positions = [];
  for (let y = 0; y < maximum; y += step) positions.push(y);
  positions.push(maximum);
  return [...new Set(positions)];
}

function existingCaptures(outputRoot) {
  const captures = [];
  for (const pageSpec of PAGES) {
    for (const viewport of VIEWPORTS) {
      const pageRoot = path.join(outputRoot, pageSpec.id, viewport.id);
      if (!fs.existsSync(pageRoot)) return null;
      const files = fs.readdirSync(pageRoot).filter((file) => /^slice-\d+\.png$/.test(file)).sort();
      if (!files.length) return null;
      captures.push({
        page: pageSpec,
        viewport,
        facts: { reused: true },
        slices: files.map((file, index) => ({
          index: index + 1,
          path: path.relative(ROOT, path.join(pageRoot, file)).replace(/\\/g, '/'),
          scroll_y: null,
        })),
        issues: [],
        console_errors: [],
      });
    }
  }
  return captures;
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const animations = document.getAnimations().map((animation) => {
      const timing = animation.effect && typeof animation.effect.getTiming === 'function'
        ? animation.effect.getTiming()
        : {};
      return {
        duration: Number(timing.duration) || 0,
        iterations: Number(timing.iterations) || 0,
        play_state: animation.playState,
      };
    });
    return {
      title: document.title,
      h1: document.querySelector('h1')?.innerText.trim() || '',
      scroll_height: Math.max(root.scrollHeight, body.scrollHeight),
      scroll_width: root.scrollWidth,
      client_width: root.clientWidth,
      sections: document.querySelectorAll('main section').length,
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll('button').length,
      animations: {
        total: animations.length,
        long_running: animations.filter((entry) => entry.play_state === 'running' && (entry.duration >= 1000 || entry.iterations === Infinity)).length,
      },
      has_skip_link: Boolean(document.querySelector('.site-skip-link')),
      has_nav_toggle: Boolean(document.querySelector('[data-site-nav-toggle]')),
    };
  });
}

async function sliceFacts(page) {
  return page.evaluate(() => {
    const top = window.scrollY;
    const bottom = top + window.innerHeight;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < window.innerHeight;
    };
    const textNodes = [...document.querySelectorAll('h1,h2,h3,p,li,code,blockquote')].filter(visible);
    const interactive = [...document.querySelectorAll('a[href],button,input,select,textarea')].filter(visible);
    return {
      scroll_y: top,
      document_range: [top, bottom],
      visible_text_blocks: textNodes.length,
      visible_characters: textNodes.reduce((sum, element) => sum + element.innerText.trim().length, 0),
      visible_headings: textNodes.filter((element) => /^H[1-3]$/.test(element.tagName)).map((element) => element.innerText.trim()).slice(0, 8),
      visible_interactive: interactive.length,
    };
  });
}

async function capturePage(browser, baseUrl, outputRoot, pageSpec, viewport, reuse) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location().url || '';
    if (!source || source.startsWith(baseUrl)) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    const response = await page.goto(`${baseUrl}${pageSpec.path}`, { waitUntil: 'load' });
    assert(response && response.ok(), `${pageSpec.path} returned ${response ? response.status() : 'no response'}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(reuse ? 20 : 350);

    const facts = await pageFacts(page);
    const issues = [];
    if (facts.scroll_width > facts.client_width + 1) {
      issues.push(`horizontal overflow ${facts.scroll_width}/${facts.client_width}`);
    }
    const positions = slicePositions(facts.scroll_height, viewport.height);
    const pageRoot = path.join(outputRoot, pageSpec.id, viewport.id);
    fs.mkdirSync(pageRoot, { recursive: true });
    const slices = [];
    for (let index = 0; index < positions.length; index += 1) {
      const y = positions[index];
      await page.evaluate((offset) => window.scrollTo(0, offset), y);
      const filename = `slice-${String(index + 1).padStart(3, '0')}.png`;
      const target = path.join(pageRoot, filename);
      if (reuse && fs.existsSync(target)) await page.waitForTimeout(0);
      else {
        await page.waitForTimeout(100);
        await page.screenshot({ path: target, fullPage: false });
      }
      slices.push({
        index: index + 1,
        path: path.relative(ROOT, target).replace(/\\/g, '/'),
        ...(await sliceFacts(page)),
      });
    }
    if (errors.length) issues.push(`console errors: ${errors.join(' | ')}`);
    return { page: pageSpec, viewport, facts, slices, issues, console_errors: errors };
  } finally {
    await context.close();
  }
}

async function reducedMotionFacts(baseUrl, pageSpec, viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${baseUrl}${pageSpec.path}`, { waitUntil: 'load' });
    assert(response && response.ok(), `${pageSpec.path} reduced-motion load failed`);
    await page.waitForTimeout(160);
    return await page.evaluate(() => {
      const active = document.getAnimations().filter((animation) => animation.playState === 'running');
      return { active_animations: active.length, prefers_reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = path.join(args.output, args.label);
  fs.mkdirSync(outputRoot, { recursive: true });
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const captures = [];
  try {
    const reused = args.reuse ? existingCaptures(outputRoot) : null;
    if (reused) captures.push(...reused);
    else {
      const browser = await chromium.launch({ headless: true });
      try {
        for (const pageSpec of PAGES) {
          for (const viewport of VIEWPORTS) captures.push(await capturePage(browser, baseUrl, outputRoot, pageSpec, viewport, args.reuse));
        }
      } finally {
        await browser.close();
      }
    }
    const reducedMotion = [];
    for (const pageSpec of PAGES) {
      for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
        try {
          reducedMotion.push({ page: pageSpec.id, viewport: viewport.id, ...(await reducedMotionFacts(baseUrl, pageSpec, viewport)) });
        } catch (error) {
          reducedMotion.push({ page: pageSpec.id, viewport: viewport.id, error: error.message });
        }
      }
    }
    const manifest = {
      schema: 1,
      kind: 'citadel-site-visual-catalog',
      label: args.label,
      pages: PAGES.length,
      viewports: VIEWPORTS.length,
      viewport_slices: captures.reduce((sum, entry) => sum + entry.slices.length, 0),
      issues: captures.flatMap((entry) => entry.issues.map((issue) => ({ page: entry.page.id, viewport: entry.viewport.id, issue }))),
      captures,
      reduced_motion: reducedMotion,
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      schema: manifest.schema,
      label: manifest.label,
      pages: manifest.pages,
      viewports: manifest.viewports,
      viewport_slices: manifest.viewport_slices,
      issues: manifest.issues.length,
      output: path.relative(ROOT, outputRoot).replace(/\\/g, '/'),
    }, null, 2)}\n`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`site visual catalog failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ PAGES, VIEWPORTS, existingCaptures, parseArgs, slicePositions });
