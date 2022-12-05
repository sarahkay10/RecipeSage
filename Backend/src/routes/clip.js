const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const Sentry = require('@sentry/node');
const he = require('he');
const url = require('url');
const { dedent } = require('ts-dedent');
const HttpsProxyAgent = require('https-proxy-agent');

const puppeteer = require('puppeteer-core');

const jsdom = require('jsdom');
const RecipeClipper = require('@julianpoy/recipe-clipper');

const INTERCEPT_PLACEHOLDER_URL = 'https://example.com/intercept-me';
const sanitizeHtml = require('sanitize-html');

const disconnectPuppeteer = (browser) => {
  try {
    browser.disconnect();
  } catch(e) {
    Sentry.captureException(e);
  }
};

const clipRecipe = async clipUrl => {
  let browser;
  try {
    let browserWSEndpoint = `ws://${process.env.BROWSERLESS_HOST}:${process.env.BROWSERLESS_PORT}?stealth&blockAds&--disable-web-security`;

    if (process.env.CLIP_PROXY_URL) {
      const proxyUrl = url.parse(process.env.CLIP_PROXY_URL);
      browserWSEndpoint += `&--proxy-server="https=${proxyUrl.host}"`;
    }

    browser = await puppeteer.connect({
      browserWSEndpoint,
    });

    const page = await browser.newPage();

    if (process.env.CLIP_PROXY_USERNAME && process.env.CLIP_PROXY_PASSWORD) {
      await page.authenticate({
        username: process.env.CLIP_PROXY_USERNAME,
        password: process.env.CLIP_PROXY_PASSWORD,
      });
    }

    await page.setBypassCSP(true);

    await page.setRequestInterception(true);
    page.on('request', async interceptedRequest => {
      if (interceptedRequest.url() === INTERCEPT_PLACEHOLDER_URL) {
        try {
          const response = await fetch(process.env.INGREDIENT_INSTRUCTION_CLASSIFIER_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: interceptedRequest.postData(),
          });

          const text = await response.text();

          interceptedRequest.respond({
            content: 'application/json',
            body: text
          });
        } catch(e) {
          console.log('Error while classifying', e);
          interceptedRequest.abort();
        }
      } else {
        interceptedRequest.continue();
      }
    });

    try {
      await page.goto(clipUrl, {
        waitUntil: 'networkidle2',
        timeout: 25000
      });
    } catch(err) {
      err.status = 400;

      Sentry.withScope(scope => {
        scope.setExtra('clipUrl', clipUrl);
        Sentry.captureException(err);
      });

      throw err;
    }

    await page.evaluate(dedent`() => {
      try {
        // Force lazyload for content listening to scroll
        window.scrollTo(0, document.body.scrollHeight);
      } catch(e) {}

      try {
        // Fix UMD for sites that define reserved names globally
        window.define = null;
        window.exports = null;
      } catch(e) {}
    }`);

    await page.addScriptTag({ path: './node_modules/@julianpoy/recipe-clipper/dist/recipe-clipper.umd.js' });
    const recipeData = await page.evaluate((interceptUrl) => {
      // eslint-disable-next-line no-undef
      return window.RecipeClipper.clipRecipe({
        mlClassifyEndpoint: interceptUrl,
      });
    }, INTERCEPT_PLACEHOLDER_URL);

    disconnectPuppeteer(browser);

    return recipeData;
  } catch (e) {
    disconnectPuppeteer(browser);

    throw e;
  }
};

const replaceBrWithBreak = (html) => {
  return html.replaceAll(new RegExp(/<br( \/)?>/, 'g'), '\n');
};

const clipRecipeJSDOM = async clipUrl => {
  const opts = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:107.0) Gecko/20100101 Firefox/107.0',
    },
  };

  if (process.env.CLIP_PROXY_URL) {
    const proxyUrl = url.parse(`http://${process.env.CLIP_PROXY_HOST}`);
    if (process.env.CLIP_PROXY_PASSWORD && process.env.CLIP_PROXY_PASSWORD) {
      proxyUrl.auth = `${process.env.CLIP_PROXY_USERNAME}:${process.env.CLIP_PROXY_PASSWORD}`;
    }

    opts.agent = new HttpsProxyAgent(proxyUrl);
  }

  const response = await fetch(clipUrl, opts);

  const document = await response.text();

  const dom = new jsdom.JSDOM(document);

  const { window } = dom;

  Object.defineProperty(window.Element.prototype, 'innerText', {
    get() {
      const html = replaceBrWithBreak(this.innerHTML);
      return sanitizeHtml(html, {
        allowedTags: [], // remove all tags and return text content only
        allowedAttributes: {}, // remove all tags and return text content only
      });
    }
  });

  window.fetch = fetch;

  return await RecipeClipper.clipRecipe({
    window,
    mlClassifyEndpoint: process.env.INGREDIENT_INSTRUCTION_CLASSIFIER_URL,
  });
};

router.get('/', async (req, res, next) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) {
      return res.status(400).send('Must provide a URL');
    }

    const clipRecipePromise = clipRecipe(url).catch((e) => {
      console.log(e);
      Sentry.captureException(e);
    });
    const clipRecipeJSDOMPromise = clipRecipeJSDOM(url).catch((e) => {
      console.log(e);
      Sentry.captureException(e);
    });

    const [clipRecipeResult, clipRecipeJSDOMResult] = await Promise.all([
      clipRecipePromise,
      clipRecipeJSDOMPromise
    ]);

    const recipeData = clipRecipeResult || {};
    const recipeDataJSDOM = clipRecipeJSDOMResult || {};

    // Merge results (browser overrides JSDOM due to accuracy)
    const results = recipeDataJSDOM;
    Object.entries(recipeData).forEach((entry) => {
      if(entry[1]) results[entry[0]] = entry[1];
    });

    // Decode all html entities from fields
    Object.entries(results).forEach((entry) => {
      results[entry[0]] = he.decode(entry[1]);
    });

    res.status(200).json(results);
  } catch(e) {
    next(e);
  }
});

module.exports = router;

